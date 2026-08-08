from __future__ import annotations

import json
import math
import uuid
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from ...models import ExperienceCategory
from ..ai.ai_service import (
    analyze_jd,
    analyze_resume_evaluation,
    generate_personal_summary,
    polish_experience,
)
from ..export.schemas import (
    CertificationViewSnapshot,
    EducationViewSnapshot,
    ResumeEditorProfileSnapshot,
    ResumeExperienceViewSnapshot,
    ResumePdfRenderSnapshot,
    SkillGroupViewSnapshot,
    SkillItemViewSnapshot,
    StarFields,
)
from ..export.browser_pdf_service import render_resume_pdf
from ..export.snapshot_service import create_render_snapshot
from ..resume.models import Resume, ResumeExperienceLink
from ..resume.resume_schema import ResumeExperienceItem
from ..resume.resume_analysis_freshness import acquire_user_resume_analysis_lock
from .agent_option_helpers import (
    _absolute_url,
    _analysis_evaluation,
    _clamp_score,
    _entry_reasons,
    _normalize_string_list,
    _recommendation,
    build_agent_polish_options,
    build_agent_resume_template_options,
    build_agent_skill_bundle,
    sanitize_folder_name,
)
from .agent_pdf_helpers import (
    SMART_PAGE_ITEM_SPACING_DEFAULT,
    _agent_analysis_bank_payload,
    _agent_analysis_resume_payload,
    _agent_auto_assembly_selection,
    _agent_polish_mode,
    _apply_snapshot_layout,
    _build_resume_pdf_snapshot,
    _expand_snapshot_layout_candidates,
    _hard_fallback_snapshot_layout,
    _layout_float,
    _layout_section_spacing_key,
    _pdf_page_count,
    _polish_content_for_experience,
    _polished_star,
    _resume_summary_visible,
    _resume_with_agent_auto_assembly_selection,
    _snapshot_experience_star_overrides,
    _summary_generation_payload,
)
from .agent_generated_resume_config import (
    _build_agent_evaluation_signature,
    _build_agent_generated_resume_config,
    _build_agent_jd_analysis_config,
)
from .agent_pdf_fit_service import fit_snapshot_to_one_page
from .agent_pdf_trim_service import (
    _apply_snapshot_trim,
    _build_snapshot_trim_plan,
)
from .agent_resume_helpers import (
    _is_agent_generated_resume,
    _load_agent_bank,
    _load_resume_item_categories,
    _resume_item_master_ids,
    resolve_agent_resume,
    resolve_agent_resume_detail,
)
from .agent_key_service import (
    API_KEY_PREFIX,
    KEY_PREFIX_LENGTH,
    AgentAuthenticatedUser,
    AgentGenerateOptions,
    CreatedAgentApiKey,
    authenticate_agent_api_key,
    create_agent_api_key,
    get_agent_plugin_config,
    hash_agent_api_key,
    list_agent_api_keys,
    resolve_agent_generate_options,
    revoke_agent_api_key,
    upsert_agent_plugin_config,
    verify_agent_api_key_hash,
    _created_from_reusable_api_key,
    _key_prefix,
    _list_active_agent_api_keys,
    _new_plaintext_key,
    _recover_agent_api_key_conflict,
    _to_api_key_read,
    _to_plugin_config_read,
)
from .schemas import (
    AgentPolishOption,
    AgentPolishOptionsResponse,
    AgentResumeTemplateOption,
    AgentResumeTemplateOptionsResponse,
    AgentSkillBundleFile,
    AgentSkillBundleResponse,
    AgentJobAnalysisResponse,
    AgentJobGenerateRequest,
    AgentJobMetadata,
    AgentJobRequest,
    AgentResumePdf,
)


@dataclass(frozen=True)
class AgentJobAnalysisBuild:
    response: AgentJobAnalysisResponse
    raw_result: Dict[str, Any]


_AGENT_EVALUATION_SECTION_ORDER = (
    "summary",
    "education",
    "work",
    "project",
    "certifications",
    "skills",
)


class AgentBankChangedError(Exception):
    pass


def _now_aware() -> datetime:
    return datetime.now(timezone.utc)


async def build_agent_job_analysis(
    session: AsyncSession,
    user_id: str,
    payload: AgentJobRequest,
) -> AgentJobAnalysisResponse:
    return (await build_agent_job_analysis_detail(session, user_id, payload)).response


async def build_agent_job_analysis_detail(
    session: AsyncSession,
    user_id: str,
    payload: AgentJobRequest,
) -> AgentJobAnalysisBuild:
    resume, resume_items = await resolve_agent_resume_detail(session, user_id, payload.resume_id)
    bank = await _load_agent_bank(session, user_id)
    category_by_master_id = await _load_resume_item_categories(session, user_id, resume_items)
    resume_text = await build_resume_analysis_text(
        session,
        user_id,
        resume,
        resume_items=resume_items,
        bank=bank,
        category_by_master_id=category_by_master_id,
        target_role=payload.job_title,
    )
    result = await analyze_jd(
        payload.jd_text,
        resume_text=resume_text,
    )
    result = dict(result)
    jd_match_score = _require_agent_match_percentage(result)
    if payload.include_resume_evaluation:
        evaluation_result = await analyze_resume_evaluation(
            payload.jd_text,
            resume_text,
            jd_match_score,
        )
        if isinstance(evaluation_result.get("resumeEvaluation"), dict):
            result = {
                **result,
                "resumeEvaluation": evaluation_result["resumeEvaluation"],
            }
    else:
        result.pop("resumeEvaluation", None)
        result.pop("resume_evaluation", None)
    return _build_agent_job_analysis_from_result(payload, result)


def _build_agent_job_analysis_from_result(
    payload: AgentJobRequest,
    result: Dict[str, Any],
) -> AgentJobAnalysisBuild:
    resume_evaluation = result.get("resumeEvaluation") if isinstance(result, dict) else None
    jd_match_score = _require_agent_match_percentage(result)
    resume_quality_score = (
        _clamp_score(resume_evaluation.get("overallScore"))
        if isinstance(resume_evaluation, dict)
        and resume_evaluation.get("overallScore") is not None
        else None
    )
    strengths = _normalize_string_list(
        result.get("strengths"),
        _entry_reasons(result.get("experienceMatches"), minimum_score=80),
    )
    gaps = _normalize_string_list(result.get("gaps"), result.get("suggestions") or [])
    missing_keywords = _normalize_string_list(result.get("missingKeywords"))
    return AgentJobAnalysisBuild(
        response=AgentJobAnalysisResponse(
            match_percentage=jd_match_score,
            jd_match_percentage=jd_match_score,
            resume_quality_percentage=resume_quality_score,
            score_version="resume_flow_v1",
            evaluation=_analysis_evaluation(result, payload),
            strengths=strengths,
            gaps=gaps,
            missing_keywords=missing_keywords,
            recommendation=_recommendation(jd_match_score),
            suggested_folder_name=sanitize_folder_name(payload.company_name, payload.job_title, jd_match_score),
        ),
        raw_result=result if isinstance(result, dict) else {},
    )


def _require_agent_match_percentage(result: Dict[str, Any]) -> int:
    raw_match_score = result.get("matchPercentage")
    if raw_match_score is None:
        raw_match_score = result.get("match_percentage")
    if (
        isinstance(raw_match_score, bool)
        or not isinstance(raw_match_score, (int, float))
        or not math.isfinite(float(raw_match_score))
    ):
        raise ValueError("AI analysis result is missing a valid matchPercentage.")
    return _clamp_score(raw_match_score)


def _replace_agent_job_analysis(
    target: AgentJobAnalysisResponse,
    replacement: AgentJobAnalysisResponse,
) -> None:
    for field, value in replacement.model_dump().items():
        setattr(target, field, value)


async def build_resume_analysis_text(
    session: AsyncSession,
    user_id: str,
    resume: Resume,
    resume_items: Optional[List[ResumeExperienceItem]] = None,
    bank: Optional[Dict[str, Any]] = None,
    category_by_master_id: Optional[Dict[str, ExperienceCategory]] = None,
    target_role: Optional[str] = None,
) -> str:
    if bank is None:
        bank = await _load_agent_bank(session, user_id)
    if resume_items is not None and category_by_master_id is None:
        category_by_master_id = await _load_resume_item_categories(session, user_id, resume_items)
    resume_payload = _agent_analysis_resume_payload(
        bank,
        resume,
        resume_items,
        category_by_master_id,
    )
    candidate_payload = _agent_analysis_bank_payload(bank)
    raw_profile = (
        resume_payload.get("profile")
        if isinstance(resume_payload.get("profile"), dict)
        else {}
    )
    personal_summary = str(raw_profile.get("summary") or "")
    profile = _agent_visible_profile(raw_profile)
    formal_experiences = [
        *[
            _agent_visible_experience(item, category="work")
            for item in _agent_payload_list(resume_payload, "work_experiences")
        ],
        *[
            _agent_visible_experience(item, category="project")
            for item in _agent_payload_list(resume_payload, "project_experiences")
        ],
    ]
    candidate_experiences = [
        *(_agent_payload_list(candidate_payload, "work_experiences")),
        *(_agent_payload_list(candidate_payload, "project_experiences")),
    ]
    formal_resume = {
        "section_order": _agent_analysis_section_order(resume, personal_summary),
        "profile": profile,
        "personal_summary": personal_summary,
        "experiences": formal_experiences,
        "educations": [
            _agent_visible_education(item)
            for item in _agent_payload_list(resume_payload, "education_experiences")
        ],
        "certifications": [
            _agent_visible_certification(item)
            for item in _agent_payload_list(resume_payload, "certifications")
        ],
        "skills": [
            _agent_visible_skill(item)
            for item in _agent_payload_list(resume_payload, "skills")
        ],
    }
    resolved_target_role = str(
        target_role if target_role is not None else getattr(resume, "target_role", "") or ""
    )
    payload = {
        "evaluation_scope": "full_resume",
        "target_role": resolved_target_role,
        "resume": formal_resume,
        # The candidate pools intentionally remain broader than the assembled
        # resume. They are consumed only by the existing independent match arrays.
        "experience_atoms": candidate_experiences,
        "match_candidates": {
            "certifications": _agent_payload_list(candidate_payload, "certifications"),
            "skills": _agent_payload_list(candidate_payload, "skills"),
        },
        "fact_metadata": _agent_resume_fact_metadata(
            formal_resume,
            target_role=resolved_target_role,
        ),
    }
    return json.dumps(payload, ensure_ascii=False)


def _agent_payload_list(payload: Dict[str, Any], key: str) -> List[Dict[str, Any]]:
    value = payload.get(key)
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _normalize_agent_section_order(
    value: Any,
    *,
    has_summary: bool,
) -> List[str]:
    raw_order = value if isinstance(value, list) else []
    normalized: List[str] = []
    for section_id in [*raw_order, *_AGENT_EVALUATION_SECTION_ORDER]:
        if (
            section_id not in _AGENT_EVALUATION_SECTION_ORDER
            or section_id in normalized
            or (section_id == "summary" and not has_summary)
        ):
            continue
        normalized.append(section_id)
    return normalized


def _agent_analysis_section_order(resume: Any, personal_summary: str) -> List[str]:
    raw_config = getattr(resume, "config", None)
    config = raw_config if isinstance(raw_config, dict) else {}
    layout = config.get("layout") if isinstance(config.get("layout"), dict) else {}
    return _normalize_agent_section_order(
        layout.get("sectionOrder"),
        has_summary=bool(personal_summary.strip()),
    )


def _agent_visible_profile(profile: Dict[str, Any]) -> Dict[str, str]:
    social_links = profile.get("social_links")
    linkedin_value = social_links.get("linkedin") if isinstance(social_links, dict) else ""
    if isinstance(linkedin_value, dict):
        linkedin_value = linkedin_value.get("url")
    return {
        "name": str(profile.get("full_name") or ""),
        "email": str(profile.get("email") or ""),
        "phone": str(profile.get("phone") or ""),
        "location": str(profile.get("location") or ""),
        "linkedin": str(linkedin_value or ""),
    }


def _agent_visible_experience(item: Dict[str, Any], *, category: str) -> Dict[str, Any]:
    raw_star = item.get("star") if isinstance(item.get("star"), dict) else {}
    return {
        "id": str(item.get("id") or ""),
        "title": str(item.get("title") or ""),
        "org": str(item.get("org") or ""),
        "start_date": str(item.get("start_date") or ""),
        "end_date": "至今" if item.get("is_current") is True else str(item.get("end_date") or ""),
        "star": {
            key: str(raw_star.get(key) or "")
            for key in ("s", "t", "a", "r")
        },
        "category": category,
    }


def _agent_visible_education(item: Dict[str, Any]) -> Dict[str, Any]:
    raw_star = item.get("star") if isinstance(item.get("star"), dict) else {}
    title = str(item.get("title") or "")
    degree = str(raw_star.get("degree") or "")
    major = title if title and title != degree else str(raw_star.get("major") or item.get("summary") or "")
    return {
        "id": str(item.get("id") or ""),
        "school": str(item.get("org") or title),
        "major": major,
        "degree": degree,
        "start_date": str(item.get("start_date") or ""),
        "end_date": "至今" if item.get("is_current") is True else str(item.get("end_date") or ""),
        "gpa": str(raw_star.get("gpa") or ""),
        "courses": str(raw_star.get("courses") or ""),
    }


def _agent_visible_certification(item: Dict[str, Any]) -> Dict[str, str]:
    return {
        "id": str(item.get("id") or ""),
        "name": str(item.get("name") or ""),
        "issuer": str(item.get("issuer") or ""),
        "issue_date": str(item.get("issue_date") or ""),
    }


def _agent_visible_skill(item: Dict[str, Any]) -> Dict[str, str]:
    return {
        "id": str(item.get("id") or ""),
        "name": str(item.get("name") or ""),
        "category": str(item.get("category") or ""),
    }


def _agent_snapshot_analysis_text(
    snapshot: ResumePdfRenderSnapshot,
    bank: Dict[str, Any],
    *,
    target_role: str,
) -> str:
    formal_experiences = [
        *[
            {
                "id": item.id,
                "title": item.title,
                "org": item.company,
                "start_date": item.startDate or "",
                "end_date": item.endDate or "",
                "star": item.star.model_dump(mode="json"),
                "category": "work",
            }
            for item in snapshot.selectedWorkItems
        ],
        *[
            {
                "id": item.id,
                "title": item.title,
                "org": item.company,
                "start_date": item.startDate or "",
                "end_date": item.endDate or "",
                "star": item.star.model_dump(mode="json"),
                "category": "project",
            }
            for item in snapshot.selectedProjectItems
        ],
    ]
    formal_resume = {
        "section_order": _normalize_agent_section_order(
            snapshot.sectionOrder,
            has_summary=bool(snapshot.profile.summary.strip()),
        ),
        "profile": {
            "name": snapshot.profile.name,
            "email": snapshot.profile.email,
            "phone": snapshot.profile.phone,
            "location": snapshot.profile.location,
            "linkedin": snapshot.profile.linkedin,
        },
        "personal_summary": snapshot.profile.summary,
        "experiences": formal_experiences,
        "educations": [
            {
                "id": item.id,
                "school": item.school,
                "major": item.major,
                "degree": item.degree,
                "start_date": item.startDate,
                "end_date": "至今" if item.isCurrent else item.endDate,
                "gpa": item.gpa or "",
                "courses": item.courses or "",
            }
            for item in snapshot.educations
        ],
        "certifications": [
            {
                "id": item.id,
                "name": item.name,
                "issuer": item.issuer or "",
                "issue_date": item.date,
            }
            for item in snapshot.sortedCertifications
        ],
        "skills": [
            {
                "id": item.id,
                "name": item.name,
                "category": group.name,
            }
            for group in snapshot.selectedSkillGroups
            for item in group.skills
        ],
    }
    candidate_payload = _agent_analysis_bank_payload(bank)
    candidate_experiences = [
        *(_agent_payload_list(candidate_payload, "work_experiences")),
        *(_agent_payload_list(candidate_payload, "project_experiences")),
    ]
    payload = {
        "evaluation_scope": "full_resume",
        "target_role": target_role,
        "resume": formal_resume,
        "experience_atoms": candidate_experiences,
        "match_candidates": {
            "certifications": _agent_payload_list(candidate_payload, "certifications"),
            "skills": _agent_payload_list(candidate_payload, "skills"),
        },
        "fact_metadata": _agent_resume_fact_metadata(
            formal_resume,
            target_role=target_role,
        ),
    }
    return json.dumps(payload, ensure_ascii=False)


def _agent_bank_signature(bank: Dict[str, Any]) -> str:
    return json.dumps(
        _agent_analysis_bank_payload(bank),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        default=str,
    )


def _expire_agent_bank_entities(session: AsyncSession, bank: Dict[str, Any]) -> None:
    expire = getattr(session, "expire", None)
    if not callable(expire):
        return
    entities: List[Any] = []
    profile = bank.get("profile")
    if profile is not None:
        entities.append(profile)
    for row in bank.get("experiences") or []:
        if isinstance(row, (tuple, list)) or hasattr(row, "_mapping"):
            entities.extend(item for item in row if item is not None)
    entities.extend(bank.get("certifications") or [])
    for row in bank.get("skills") or []:
        if isinstance(row, (tuple, list)) or hasattr(row, "_mapping"):
            entities.extend(item for item in row if item is not None)
    seen: set[int] = set()
    for entity in entities:
        identity = id(entity)
        if identity in seen:
            continue
        seen.add(identity)
        expire(entity)


def _should_rescore_agent_final_snapshot(
    payload: AgentJobGenerateRequest,
    analysis_result: Optional[Dict[str, Any]],
) -> bool:
    return isinstance(analysis_result, dict)


def _agent_resume_fact_metadata(
    formal_resume: Dict[str, Any],
    *,
    target_role: str = "",
) -> List[Dict[str, Any]]:
    facts: List[Dict[str, Any]] = []

    def add(source: str, value: Any) -> None:
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            return
        content = str(value).strip()
        if not content:
            return
        facts.append(
            {
                "fact_id": f"FACT_{len(facts) + 1:03d}",
                "content": content,
                "verification_status": "user_claimed",
                "source": source,
                "confidence": 1,
            }
        )

    def collect(source: str, value: Any) -> None:
        if isinstance(value, dict):
            for key, nested in value.items():
                if key not in {"id", "category", "section_order"}:
                    collect(f"{source}.{key}", nested)
        elif isinstance(value, list):
            for index, nested in enumerate(value):
                collect(f"{source}[{index}]", nested)
        else:
            add(source, value)

    collect("resume", formal_resume)
    add("target_role", target_role)
    return facts


async def build_agent_resume_pdf(
    request: Any,
    session: AsyncSession,
    user_id: str,
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
    analysis_result: Optional[Dict[str, Any]] = None,
) -> AgentResumePdf:
    options = await resolve_agent_generate_options(session, user_id, payload)
    resume, resume_items = await resolve_agent_resume_detail(session, user_id, payload.resume_id)
    bank = await _load_agent_bank(session, user_id)
    category_by_master_id = await _load_resume_item_categories(session, user_id, resume_items)
    generation_resume = _resume_with_agent_auto_assembly_selection(
        resume,
        analysis_result,
    ) if options.force_one_page else resume
    personal_summary = await _build_personal_summary(
        bank,
        payload,
        options,
        resume=generation_resume,
        resume_items=resume_items,
        category_by_master_id=category_by_master_id,
    )
    snapshot = _build_resume_pdf_snapshot(
        generation_resume,
        bank,
        payload,
        analysis,
        personal_summary,
        options,
        resume_items=resume_items,
        category_by_master_id=category_by_master_id,
    )
    snapshot = await _polish_snapshot_experiences(snapshot, payload, options)
    snapshot = await _fit_snapshot_to_one_page(
        session,
        user_id,
        snapshot,
        analysis_result,
        enabled=options.force_one_page,
    )
    final_analysis_result = analysis_result
    final_resume_text: Optional[str] = None
    should_rescore_final_snapshot = _should_rescore_agent_final_snapshot(
        payload,
        analysis_result,
    )
    if should_rescore_final_snapshot and isinstance(analysis_result, dict):
        final_resume_text = _agent_snapshot_analysis_text(
            snapshot,
            bank,
            target_role=payload.job_title,
        )
        final_result = await analyze_jd(
            payload.jd_text,
            resume_text=final_resume_text,
        )
        final_jd_match_score = _require_agent_match_percentage(final_result)
        if payload.include_resume_evaluation:
            if not isinstance(final_result.get("resumeEvaluation"), dict):
                final_evaluation_result = await analyze_resume_evaluation(
                    payload.jd_text,
                    final_resume_text,
                    final_jd_match_score,
                )
                if isinstance(final_evaluation_result.get("resumeEvaluation"), dict):
                    final_result = {
                        **final_result,
                        "resumeEvaluation": final_evaluation_result["resumeEvaluation"],
                    }
        final_analysis_build = _build_agent_job_analysis_from_result(payload, final_result)
        _replace_agent_job_analysis(analysis, final_analysis_build.response)
        final_analysis_result = final_analysis_build.raw_result
    original_bank_signature = _agent_bank_signature(bank)
    await acquire_user_resume_analysis_lock(session, user_id)
    _expire_agent_bank_entities(session, bank)
    latest_bank = await _load_agent_bank(session, user_id)
    bank_is_unchanged = original_bank_signature == _agent_bank_signature(latest_bank)
    if final_resume_text is not None and not bank_is_unchanged:
        raise AgentBankChangedError(
            "Resume bank changed during generation. Retry with the latest data."
        )
    analysis_is_final_snapshot = final_resume_text is not None and bank_is_unchanged
    if (
        analysis_is_final_snapshot
        and payload.include_resume_evaluation
        and isinstance(final_analysis_result, dict)
        and isinstance(final_analysis_result.get("resumeEvaluation"), dict)
    ):
        final_evaluation_signature = _build_agent_evaluation_signature(
            payload.jd_text,
            final_resume_text,
        )
    else:
        final_evaluation_signature = None
    generated_resume = await _persist_agent_generated_resume(
        session,
        user_id,
        source_resume=generation_resume,
        resume_items=resume_items,
        bank_experience_rows=bank["experiences"],
        snapshot=snapshot,
        payload=payload,
        analysis=analysis,
        analysis_result=final_analysis_result,
        include_resume_evaluation=bool(
            payload.include_resume_evaluation
            and isinstance(final_analysis_result, dict)
            and isinstance(final_analysis_result.get("resumeEvaluation"), dict)
        ),
        evaluation_signature=final_evaluation_signature,
        analysis_is_final_snapshot=analysis_is_final_snapshot,
        persist_snapshot_star_overrides=options.polish_before_output,
    )
    file_name = f"{analysis.suggested_folder_name}.pdf"
    record, token = await create_render_snapshot(session, user_id, snapshot)
    download_path = f"/exports/download/resume-pdf/{record.id}?{urlencode({'token': token, 'fileName': file_name})}"
    return AgentResumePdf(
        download_url=_absolute_url(request, download_path),
        file_name=file_name,
        generated_resume_id=str(generated_resume.id),
        generated_resume_title=generated_resume.title,
    )


async def build_agent_job_metadata(
    payload: AgentJobRequest,
    analysis: AgentJobAnalysisResponse,
) -> AgentJobMetadata:
    return AgentJobMetadata(
        job_title=payload.job_title,
        company_name=payload.company_name,
        jd_text=payload.jd_text,
        job_url=str(payload.job_url),
        source=payload.source,
        generated_at=_now_aware(),
        folder_name=analysis.suggested_folder_name,
        match_percentage=analysis.match_percentage,
        jd_match_percentage=analysis.jd_match_percentage,
        resume_quality_percentage=analysis.resume_quality_percentage,
        score_version=analysis.score_version,
    )


async def _build_personal_summary(
    bank: Dict[str, Any],
    payload: AgentJobGenerateRequest,
    options: AgentGenerateOptions,
    resume: Optional[Resume] = None,
    resume_items: Optional[List[ResumeExperienceItem]] = None,
    category_by_master_id: Optional[Dict[str, ExperienceCategory]] = None,
) -> str:
    if not options.polish_before_output:
        return ""
    raw_config = getattr(resume, "config", None)
    config = raw_config if isinstance(raw_config, dict) else {}
    if not _resume_summary_visible(config):
        return ""
    summary_payload = _summary_generation_payload(
        bank,
        resume,
        resume_items,
        category_by_master_id,
    )
    try:
        result = await generate_personal_summary(
            mode="resume",
            profile=summary_payload["profile"],
            work_experiences=summary_payload["work_experiences"],
            project_experiences=summary_payload["project_experiences"],
            education_experiences=summary_payload["education_experiences"],
            certifications=summary_payload["certifications"],
            skills=summary_payload["skills"],
            jd_text=payload.jd_text,
            polish_level=options.polish_level,
        )
    except Exception:
        return ""
    return str(result.get("summary") or result.get("content") or "").strip()


async def _polish_snapshot_experiences(
    snapshot: ResumePdfRenderSnapshot,
    payload: AgentJobGenerateRequest,
    options: AgentGenerateOptions,
) -> ResumePdfRenderSnapshot:
    if not options.polish_before_output:
        return snapshot
    polished_snapshot = snapshot.model_copy(deep=True)
    mode = _agent_polish_mode(options.polish_level)
    for item in [*polished_snapshot.selectedWorkItems, *polished_snapshot.selectedProjectItems]:
        try:
            result = await polish_experience(
                _polish_content_for_experience(item),
                target_field=None,
                jd_text=payload.jd_text,
                mode=mode,
            )
        except Exception:
            continue
        if isinstance(result, dict):
            item.star = _polished_star(item.star, result)
    return polished_snapshot


async def _render_snapshot_page_count(
    session: AsyncSession,
    user_id: str,
    snapshot: ResumePdfRenderSnapshot,
) -> int:
    record, token = await create_render_snapshot(session, user_id, snapshot.model_copy(deep=True))
    pdf_bytes = await render_resume_pdf(str(record.id), token)
    return _pdf_page_count(pdf_bytes)


async def _fit_snapshot_to_one_page(
    session: AsyncSession,
    user_id: str,
    snapshot: ResumePdfRenderSnapshot,
    analysis_result: Optional[Dict[str, Any]],
    *,
    enabled: bool,
) -> ResumePdfRenderSnapshot:
    async def render_page_count(candidate: ResumePdfRenderSnapshot) -> int:
        return await _render_snapshot_page_count(session, user_id, candidate)

    return await fit_snapshot_to_one_page(
        snapshot,
        analysis_result,
        enabled=enabled,
        render_page_count=render_page_count,
        build_trim_plan=_build_snapshot_trim_plan,
        apply_trim=_apply_snapshot_trim,
        apply_layout=_apply_snapshot_layout,
        expand_layout_candidates=_expand_snapshot_layout_candidates,
        hard_fallback_layout=_hard_fallback_snapshot_layout,
        layout_float=_layout_float,
        layout_section_spacing_key=_layout_section_spacing_key,
        item_spacing_default=SMART_PAGE_ITEM_SPACING_DEFAULT,
    )


async def _persist_agent_generated_resume(
    session: AsyncSession,
    user_id: str,
    *,
    source_resume: Resume,
    resume_items: List[ResumeExperienceItem],
    snapshot: ResumePdfRenderSnapshot,
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
    analysis_result: Optional[Dict[str, Any]] = None,
    include_resume_evaluation: bool = True,
    evaluation_signature: Optional[str] = None,
    analysis_is_final_snapshot: bool = False,
    persist_snapshot_star_overrides: bool = False,
    bank_experience_rows: Optional[List[Tuple[Any, Any]]] = None,
) -> Resume:
    title = f"{payload.company_name} - {payload.job_title} [Agent]"
    target_role = payload.job_title or getattr(source_resume, "target_role", None)
    generated = Resume(
        user_id=user_id,
        title=title,
        target_role=target_role,
        config=_build_agent_generated_resume_config(
            getattr(source_resume, "config", None),
            snapshot,
            payload,
            analysis,
            analysis_result=analysis_result,
            include_resume_evaluation=include_resume_evaluation,
            evaluation_signature=evaluation_signature,
            analysis_is_final_snapshot=analysis_is_final_snapshot,
        ),
    )
    session.add(generated)
    await session.flush()

    selected_master_ids = {
        item.id for item in [*snapshot.selectedWorkItems, *snapshot.selectedProjectItems, *snapshot.educations]
    }
    selected_snapshot_ids = [
        item.id for item in [*snapshot.selectedWorkItems, *snapshot.selectedProjectItems, *snapshot.educations]
    ]
    snapshot_star_overrides = (
        _snapshot_experience_star_overrides(snapshot)
        if persist_snapshot_star_overrides
        else {}
    )
    linked_master_ids: set[str] = set()
    max_display_order: Optional[int] = None
    for item in resume_items:
        experience = getattr(item, "experience", None)
        master_id = str(getattr(experience, "master_experience_id", "") or "")
        if master_id not in selected_master_ids:
            continue
        linked_master_ids.add(master_id)
        display_order = int(item.display_order)
        max_display_order = (
            display_order
            if max_display_order is None
            else max(max_display_order, display_order)
        )
        overrides = deepcopy(item.overrides_json or {})
        if master_id in snapshot_star_overrides:
            overrides["star"] = snapshot_star_overrides[master_id]
        session.add(
            ResumeExperienceLink(
                resume_id=generated.id,
                experience_version_id=uuid.UUID(str(item.experience_version_id)),
                overrides_json=overrides,
                display_order=display_order,
            )
        )

    bank_version_by_master_id = {
        str(getattr(master, "id", "")): version
        for master, version in (bank_experience_rows or [])
        if version is not None and str(getattr(master, "id", ""))
    }
    next_display_order = (max_display_order + 1) if max_display_order is not None else 0
    for master_id in selected_snapshot_ids:
        if master_id in linked_master_ids:
            continue
        version = bank_version_by_master_id.get(master_id)
        if version is None:
            continue
        overrides = {}
        if master_id in snapshot_star_overrides:
            overrides["star"] = snapshot_star_overrides[master_id]
        session.add(
            ResumeExperienceLink(
                resume_id=generated.id,
                experience_version_id=uuid.UUID(str(getattr(version, "id"))),
                overrides_json=overrides,
                display_order=next_display_order,
            )
        )
        linked_master_ids.add(master_id)
        next_display_order += 1

    await session.commit()
    await session.refresh(generated)
    return generated
