from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import uuid
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

from fastapi import HTTPException
from sqlalchemy import desc
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_404_NOT_FOUND, HTTP_409_CONFLICT
from ...models import AgentApiKey, AgentPluginConfig, ExperienceCategory
from ...utils.time_utils import utc_now
from ..ai.ai_service import analyze_jd, generate_personal_summary, polish_experience
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
    _apply_snapshot_trim,
    _build_agent_generated_resume_config,
    _build_agent_jd_analysis_config,
    _build_resume_pdf_snapshot,
    _build_snapshot_trim_plan,
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
from .agent_resume_helpers import (
    _is_agent_generated_resume,
    _load_agent_bank,
    _load_resume_item_categories,
    _resume_item_master_ids,
    resolve_agent_resume,
    resolve_agent_resume_detail,
)
from .schemas import (
    AgentApiKeyCreateResponse,
    AgentApiKeyRead,
    AgentPolishOption,
    AgentPolishOptionsResponse,
    AgentPluginConfigRead,
    AgentPluginConfigUpdate,
    AgentResumeTemplateOption,
    AgentResumeTemplateOptionsResponse,
    AgentSkillBundleFile,
    AgentSkillBundleResponse,
    AgentJobAnalysisResponse,
    AgentJobGenerateRequest,
    AgentJobMetadata,
    AgentJobRequest,
    AgentResumePdf,
    DEFAULT_AGENT_POLISH_LEVEL,
    DEFAULT_AGENT_TEMPLATE_ID,
)


API_KEY_PREFIX = "rfag_"
KEY_PREFIX_LENGTH = 12
@dataclass(frozen=True)
class CreatedAgentApiKey:
    plaintext_key: str
    read: AgentApiKeyRead


@dataclass(frozen=True)
class AgentAuthenticatedUser:
    id: str


@dataclass(frozen=True)
class AgentGenerateOptions:
    template_id: str
    polish_before_output: bool
    polish_level: str
    force_one_page: bool


@dataclass(frozen=True)
class AgentJobAnalysisBuild:
    response: AgentJobAnalysisResponse
    raw_result: Dict[str, Any]


def _now_aware() -> datetime:
    return datetime.now(timezone.utc)


def hash_agent_api_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def verify_agent_api_key_hash(key: str, key_hash: str) -> bool:
    return hmac.compare_digest(hash_agent_api_key(key), key_hash)


def _new_plaintext_key() -> str:
    return f"{API_KEY_PREFIX}{secrets.token_urlsafe(32)}"


def _key_prefix(key: str) -> str:
    return key[:KEY_PREFIX_LENGTH]


def _to_api_key_read(record: AgentApiKey) -> AgentApiKeyRead:
    return AgentApiKeyRead(
        id=str(record.id),
        name=record.name,
        key_prefix=record.key_prefix,
        key=getattr(record, "key_plaintext", None) if record.revoked_at is None else None,
        created_at=record.created_at,
        last_used_at=record.last_used_at,
        revoked_at=record.revoked_at,
    )


async def _list_active_agent_api_keys(session: AsyncSession, user_id: str) -> List[AgentApiKey]:
    result = await session.execute(
        select(AgentApiKey)
        .where(
            AgentApiKey.user_id == user_id,
            AgentApiKey.revoked_at.is_(None),
        )
        .order_by(desc(AgentApiKey.created_at))
    )
    return list(result.scalars().all())


def _created_from_reusable_api_key(record: AgentApiKey) -> CreatedAgentApiKey:
    return CreatedAgentApiKey(
        plaintext_key=record.key_plaintext,
        read=_to_api_key_read(record),
    )


async def _recover_agent_api_key_conflict(
    session: AsyncSession,
    user_id: str,
) -> Optional[CreatedAgentApiKey]:
    active_records = await _list_active_agent_api_keys(session, user_id)
    reusable = next(
        (
            record
            for record in active_records
            if getattr(record, "key_plaintext", None)
        ),
        None,
    )
    if reusable is not None:
        return _created_from_reusable_api_key(reusable)
    if active_records:
        raise HTTPException(
            status_code=HTTP_409_CONFLICT,
            detail="Existing Agent API key cannot be displayed. Refresh it to create a replacement.",
        )
    return None


def _to_plugin_config_read(record: Optional[AgentPluginConfig]) -> AgentPluginConfigRead:
    if record is None:
        return AgentPluginConfigRead()
    return AgentPluginConfigRead(
        selected_template_id=record.selected_template_id or DEFAULT_AGENT_TEMPLATE_ID,
        polish_before_output=bool(record.polish_before_output),
        polish_level=record.polish_level or DEFAULT_AGENT_POLISH_LEVEL,
        force_one_page=bool(record.force_one_page),
    )


async def get_agent_plugin_config(
    session: AsyncSession,
    user_id: str,
) -> AgentPluginConfigRead:
    result = await session.execute(
        select(AgentPluginConfig).where(AgentPluginConfig.user_id == user_id)
    )
    return _to_plugin_config_read(result.scalars().first())


async def upsert_agent_plugin_config(
    session: AsyncSession,
    user_id: str,
    payload: AgentPluginConfigUpdate,
) -> AgentPluginConfigRead:
    result = await session.execute(
        select(AgentPluginConfig).where(AgentPluginConfig.user_id == user_id)
    )
    record = result.scalars().first()
    if record is None:
        record = AgentPluginConfig(user_id=user_id)
    record.selected_template_id = payload.selected_template_id.strip() or DEFAULT_AGENT_TEMPLATE_ID
    record.polish_before_output = payload.polish_before_output
    record.polish_level = payload.polish_level.strip() or DEFAULT_AGENT_POLISH_LEVEL
    record.force_one_page = payload.force_one_page
    record.updated_at = utc_now()
    session.add(record)
    await session.commit()
    return _to_plugin_config_read(record)


async def resolve_agent_generate_options(
    session: AsyncSession,
    user_id: str,
    payload: AgentJobGenerateRequest,
) -> AgentGenerateOptions:
    config = await get_agent_plugin_config(session, user_id)
    return AgentGenerateOptions(
        template_id=payload.template_id or config.selected_template_id,
        polish_before_output=(
            payload.polish_before_output
            if payload.polish_before_output is not None
            else config.polish_before_output
        ),
        polish_level=payload.polish_level or config.polish_level,
        force_one_page=True,
    )


async def create_agent_api_key(
    session: AsyncSession,
    user_id: str,
    name: str,
    rotate: bool = False,
) -> CreatedAgentApiKey:
    active_records = await _list_active_agent_api_keys(session, user_id)
    if not rotate:
        reusable = next(
            (
                record
                for record in active_records
                if getattr(record, "key_plaintext", None)
            ),
            None,
        )
        if reusable is not None:
            return _created_from_reusable_api_key(reusable)
        if active_records:
            raise HTTPException(
                status_code=HTTP_409_CONFLICT,
                detail="Existing Agent API key cannot be displayed. Refresh it to create a replacement.",
            )

    plaintext_key = _new_plaintext_key()
    for record in active_records:
        record.revoked_at = utc_now()
        record.key_plaintext = None
        session.add(record)
    if active_records:
        await session.flush()
    record = AgentApiKey(
        user_id=user_id,
        name=name.strip() or "Agent",
        key_prefix=_key_prefix(plaintext_key),
        key_hash=hash_agent_api_key(plaintext_key),
        key_plaintext=plaintext_key,
    )
    session.add(record)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        recovered = await _recover_agent_api_key_conflict(session, user_id)
        if recovered is not None:
            return recovered
        raise HTTPException(
            status_code=HTTP_409_CONFLICT,
            detail="Agent API key was updated concurrently. Please retry.",
        ) from exc
    await session.refresh(record)
    return CreatedAgentApiKey(
        plaintext_key=plaintext_key,
        read=_to_api_key_read(record),
    )


async def list_agent_api_keys(session: AsyncSession, user_id: str) -> List[AgentApiKeyRead]:
    result = await session.execute(
        select(AgentApiKey)
        .where(AgentApiKey.user_id == user_id)
        .order_by(desc(AgentApiKey.created_at))
    )
    return [_to_api_key_read(record) for record in result.scalars().all()]


async def revoke_agent_api_key(
    session: AsyncSession,
    user_id: str,
    api_key_id: str,
) -> AgentApiKey:
    result = await session.execute(
        select(AgentApiKey).where(
            AgentApiKey.id == api_key_id,
            AgentApiKey.user_id == user_id,
        )
    )
    record = result.scalars().first()
    if not record:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Agent API key not found")
    if record.revoked_at is None:
        record.revoked_at = utc_now()
        record.key_plaintext = None
        session.add(record)
        await session.commit()
        await session.refresh(record)
    return record


async def authenticate_agent_api_key(
    session: AsyncSession,
    key: str,
) -> AgentAuthenticatedUser:
    if not key or not key.startswith(API_KEY_PREFIX):
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Invalid Agent API key")
    result = await session.execute(
        select(AgentApiKey).where(AgentApiKey.key_prefix == _key_prefix(key))
    )
    record = result.scalars().first()
    if not record or record.revoked_at is not None:
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Invalid Agent API key")
    if not verify_agent_api_key_hash(key, record.key_hash):
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Invalid Agent API key")
    record.last_used_at = utc_now()
    session.add(record)
    await session.commit()
    return AgentAuthenticatedUser(id=record.user_id)


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
    )
    result = await analyze_jd(
        payload.jd_text,
        resume_text=resume_text,
        experience_text=resume_text,
    )
    score = _clamp_score(result.get("matchPercentage"))
    strengths = _normalize_string_list(
        result.get("strengths"),
        _entry_reasons(result.get("experienceMatches"), minimum_score=80),
    )
    gaps = _normalize_string_list(result.get("gaps"), result.get("suggestions") or [])
    missing_keywords = _normalize_string_list(result.get("missingKeywords"))
    return AgentJobAnalysisBuild(
        response=AgentJobAnalysisResponse(
            match_percentage=score,
            evaluation=_analysis_evaluation(result, payload),
            strengths=strengths,
            gaps=gaps,
            missing_keywords=missing_keywords,
            recommendation=_recommendation(score),
            suggested_folder_name=sanitize_folder_name(payload.company_name, payload.job_title, score),
        ),
        raw_result=result if isinstance(result, dict) else {},
    )


async def build_resume_analysis_text(
    session: AsyncSession,
    user_id: str,
    resume: Resume,
    resume_items: Optional[List[ResumeExperienceItem]] = None,
    bank: Optional[Dict[str, Any]] = None,
    category_by_master_id: Optional[Dict[str, ExperienceCategory]] = None,
) -> str:
    if bank is None:
        bank = await _load_agent_bank(session, user_id)
    if resume_items is not None and category_by_master_id is None:
        category_by_master_id = await _load_resume_item_categories(session, user_id, resume_items)
    payload = {
        "resume": {
            "id": str(resume.id),
            "title": resume.title,
            "target_role": resume.target_role,
        },
        **_agent_analysis_resume_payload(
            bank,
            resume,
            resume_items,
            category_by_master_id,
        ),
    }
    return json.dumps(payload, ensure_ascii=False)


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
    generated_resume = await _persist_agent_generated_resume(
        session,
        user_id,
        source_resume=generation_resume,
        resume_items=resume_items,
        bank_experience_rows=bank["experiences"],
        snapshot=snapshot,
        payload=payload,
        analysis=analysis,
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
    if not enabled:
        return snapshot
    working_snapshot = snapshot.model_copy(deep=True)
    trim_plan = _build_snapshot_trim_plan(working_snapshot, analysis_result)
    plan_index = 0

    async def fit_current_content() -> Tuple[bool, ResumePdfRenderSnapshot]:
        base_snapshot = working_snapshot.model_copy(deep=True)
        if await _render_snapshot_page_count(session, user_id, base_snapshot) <= 1:
            best_snapshot = base_snapshot
            default_layout = {
                "lineHeight": base_snapshot.lineHeight,
                "fontSize": base_snapshot.fontSize,
                "itemSpacingEm": _layout_float(
                    {"itemSpacingEm": base_snapshot.listSpacingValue.replace("em", "")},
                    "itemSpacingEm",
                    SMART_PAGE_ITEM_SPACING_DEFAULT,
                ),
                "topPaddingPx": base_snapshot.topPaddingPx,
                "sectionSpacingKey": _layout_section_spacing_key(
                    {"sectionSpacingClass": base_snapshot.sectionSpacingClass},
                ),
            }
            for candidate_layout in _expand_snapshot_layout_candidates(default_layout):
                candidate_snapshot = _apply_snapshot_layout(
                    base_snapshot.model_copy(deep=True),
                    candidate_layout,
                )
                if await _render_snapshot_page_count(session, user_id, candidate_snapshot) <= 1:
                    best_snapshot = candidate_snapshot
            return True, best_snapshot

        compact_snapshot = _apply_snapshot_layout(
            base_snapshot.model_copy(deep=True),
            _hard_fallback_snapshot_layout(),
        )
        if await _render_snapshot_page_count(session, user_id, compact_snapshot) <= 1:
            return True, compact_snapshot
        return False, compact_snapshot

    while True:
        fits, fitted_snapshot = await fit_current_content()
        if fits:
            return fitted_snapshot
        if plan_index >= len(trim_plan):
            return fitted_snapshot
        if _apply_snapshot_trim(working_snapshot, trim_plan[plan_index]):
            plan_index += 1
            continue
        plan_index += 1


async def _persist_agent_generated_resume(
    session: AsyncSession,
    user_id: str,
    *,
    source_resume: Resume,
    resume_items: List[ResumeExperienceItem],
    snapshot: ResumePdfRenderSnapshot,
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
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
