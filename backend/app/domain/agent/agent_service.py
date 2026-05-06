from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import uuid
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple
from urllib.parse import quote, urlencode

from fastapi import HTTPException
from sqlalchemy import desc
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_404_NOT_FOUND

from ...models import AgentApiKey, AgentPluginConfig, ExperienceCategory, MasterExperience
from ...utils.time_utils import utc_now
from ..ai.ai_service import analyze_jd, generate_personal_summary
from ..certifications.certification_service import list_certifications
from ..experience.experience_service import list_experiences
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
from ..export.snapshot_service import create_render_snapshot
from ..profile.profile_service import get_profile_if_exists
from ..resume.models import Resume, ResumeExperienceLink
from ..resume.resume_service import NotFoundError as ResumeNotFoundError
from ..resume.resume_service import get_resume_detail
from ..resume.resume_schema import ResumeExperienceItem
from ..skills.skill_service import list_user_skills
from .schemas import (
    AgentApiKeyCreateResponse,
    AgentApiKeyRead,
    AgentPluginConfigRead,
    AgentPluginConfigUpdate,
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
RECENT_RESUME_LIMIT = 1
AGENT_EXPERIENCE_FETCH_LIMIT = 200
FOLDER_SAFE_PATTERN = re.compile(r'[\\/:*?"<>|\r\n\t]+')
SMART_ONE_PAGE_LINE_HEIGHT = 1.35
SMART_ONE_PAGE_FONT_SIZE = 13
SMART_ONE_PAGE_TOP_PADDING_PX = 15
SMART_ONE_PAGE_ITEM_SPACING_EM = 0.25
SMART_ONE_PAGE_SECTION_SPACING_KEY = 2
PROFILE_TEMPLATE_PRESETS_KEY = "resumeTemplatePresets"
AGENT_SKILL_DIR = Path(__file__).resolve().parent / "skill_bundles" / "resumeflow-job-search"
AGENT_SKILL_FILES = ("SKILL.md", "references/api.md", "agents/openai.yaml")


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
        created_at=record.created_at,
        last_used_at=record.last_used_at,
        revoked_at=record.revoked_at,
    )


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
) -> CreatedAgentApiKey:
    plaintext_key = _new_plaintext_key()
    record = AgentApiKey(
        user_id=user_id,
        name=name.strip() or "Agent",
        key_prefix=_key_prefix(plaintext_key),
        key_hash=hash_agent_api_key(plaintext_key),
    )
    session.add(record)
    await session.commit()
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


def build_agent_skill_bundle() -> AgentSkillBundleResponse:
    files: List[AgentSkillBundleFile] = []
    for relative_path in AGENT_SKILL_FILES:
        path = AGENT_SKILL_DIR / relative_path
        if not path.is_file():
            raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Agent skill bundle not found")
        files.append(
            AgentSkillBundleFile(
                path=relative_path.replace("\\", "/"),
                content=path.read_text(encoding="utf-8"),
            )
        )
    return AgentSkillBundleResponse(name="resumeflow-job-search", files=files)


async def resolve_agent_resume(
    session: AsyncSession,
    user_id: str,
    resume_id: Optional[str],
) -> Resume:
    if resume_id:
        try:
            resume, _items = await get_resume_detail(session, user_id, resume_id)
        except ResumeNotFoundError as exc:
            raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        return resume

    result = await session.execute(
        select(Resume)
        .where(Resume.user_id == user_id)
        .order_by(desc(Resume.updated_at))
        .limit(RECENT_RESUME_LIMIT)
    )
    resume = result.scalars().all()
    if not resume:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="No resume found")
    return resume[0]


async def resolve_agent_resume_detail(
    session: AsyncSession,
    user_id: str,
    resume_id: Optional[str],
) -> Tuple[Resume, List[ResumeExperienceItem]]:
    resume = await resolve_agent_resume(session, user_id, resume_id)
    try:
        return await get_resume_detail(session, user_id, str(resume.id))
    except ResumeNotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc


def sanitize_folder_name(company_name: str, job_title: str, match_percentage: int) -> str:
    parts = [company_name.strip(), job_title.strip(), str(match_percentage)]
    cleaned_parts = []
    for part in parts:
        cleaned = FOLDER_SAFE_PATTERN.sub("_", part)
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._")
        cleaned_parts.append(cleaned or "unknown")
    return "_".join(cleaned_parts)


def _clamp_score(value: Any) -> int:
    try:
        numeric = int(round(float(value)))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, numeric))


def _normalize_string_list(value: Any, fallback: Iterable[str] = ()) -> List[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()][:8]
    return [item for item in fallback if item][:8]


def _analysis_evaluation(result: Dict[str, Any], payload: AgentJobRequest) -> str:
    summary = str(result.get("summary") or result.get("evaluation") or "").strip()
    if summary:
        return summary
    score = _clamp_score(result.get("matchPercentage"))
    if score >= 85:
        return f"{payload.company_name} 的 {payload.job_title} 匹配度较高，建议优先生成材料。"
    if score >= 70:
        return f"{payload.company_name} 的 {payload.job_title} 具备一定匹配度，建议人工复核后投递。"
    return f"{payload.company_name} 的 {payload.job_title} 匹配度偏低，建议谨慎投入时间。"


def _recommendation(score: int) -> str:
    if score >= 80:
        return "generate"
    if score >= 65:
        return "review"
    return "skip"


async def build_agent_job_analysis(
    session: AsyncSession,
    user_id: str,
    payload: AgentJobRequest,
) -> AgentJobAnalysisResponse:
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
    return AgentJobAnalysisResponse(
        match_percentage=score,
        evaluation=_analysis_evaluation(result, payload),
        strengths=strengths,
        gaps=gaps,
        missing_keywords=missing_keywords,
        recommendation=_recommendation(score),
        suggested_folder_name=sanitize_folder_name(payload.company_name, payload.job_title, score),
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
) -> AgentResumePdf:
    options = await resolve_agent_generate_options(session, user_id, payload)
    resume, resume_items = await resolve_agent_resume_detail(session, user_id, payload.resume_id)
    bank = await _load_agent_bank(session, user_id)
    category_by_master_id = await _load_resume_item_categories(session, user_id, resume_items)
    personal_summary = await _build_personal_summary(
        bank,
        payload,
        options,
        resume=resume,
        resume_items=resume_items,
        category_by_master_id=category_by_master_id,
    )
    snapshot = _build_resume_pdf_snapshot(
        resume,
        bank,
        payload,
        analysis,
        personal_summary,
        options,
        resume_items=resume_items,
        category_by_master_id=category_by_master_id,
    )
    generated_resume = await _persist_agent_generated_resume(
        session,
        user_id,
        source_resume=resume,
        resume_items=resume_items,
        snapshot=snapshot,
        payload=payload,
        analysis=analysis,
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


def _absolute_url(request: Any, path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    try:
        base = f"{request.url.scheme}://{request.url.netloc}"
    except Exception:
        return path
    return f"{base}{path}"


def _entry_reasons(entries: Any, minimum_score: int) -> List[str]:
    if not isinstance(entries, list):
        return []
    reasons = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if _clamp_score(entry.get("score")) < minimum_score:
            continue
        reason = str(entry.get("reason") or entry.get("title") or "").strip()
        if reason:
            reasons.append(reason)
    return reasons


def _agent_analysis_bank_payload(bank: Dict[str, Any]) -> Dict[str, Any]:
    experiences = bank["experiences"]
    return {
        "profile": _profile_payload(bank["profile"]),
        "work_experiences": _experiences_payload(experiences, ExperienceCategory.WORK),
        "project_experiences": _experiences_payload(experiences, ExperienceCategory.PROJECT),
        "education_experiences": _experiences_payload(experiences, ExperienceCategory.EDUCATION),
        "certifications": _certifications_payload(bank["certifications"]),
        "skills": _skills_payload(bank["skills"]),
    }


def _agent_analysis_resume_payload(
    bank: Dict[str, Any],
    resume: Resume,
    resume_items: Optional[List[ResumeExperienceItem]],
    category_by_master_id: Optional[Dict[str, ExperienceCategory]],
) -> Dict[str, Any]:
    return _summary_generation_payload(
        bank,
        resume,
        _resume_items_or_none(resume_items),
        category_by_master_id,
    )


async def _load_agent_bank(session: AsyncSession, user_id: str) -> Dict[str, Any]:
    profile = await get_profile_if_exists(session, user_id)
    experience_rows = await list_experiences(
        session,
        user_id,
        category=None,
        keyword=None,
        limit=AGENT_EXPERIENCE_FETCH_LIMIT,
        offset=0,
        include_archived=False,
    )
    certifications = await list_certifications(session, user_id)
    skill_rows = await list_user_skills(session, user_id)
    return {
        "profile": profile,
        "experiences": experience_rows,
        "certifications": certifications,
        "skills": skill_rows,
    }


def _resume_item_master_ids(resume_items: List[ResumeExperienceItem]) -> List[str]:
    ids: List[str] = []
    for item in resume_items:
        master_id = str(getattr(item.experience, "master_experience_id", "") or "")
        if master_id:
            ids.append(master_id)
    return ids


async def _load_resume_item_categories(
    session: AsyncSession,
    user_id: str,
    resume_items: List[ResumeExperienceItem],
) -> Dict[str, ExperienceCategory]:
    master_ids = _resume_item_master_ids(resume_items)
    if not master_ids:
        return {}
    master_uuid_ids: List[uuid.UUID] = []
    for master_id in master_ids:
        try:
            master_uuid_ids.append(uuid.UUID(master_id))
        except ValueError:
            continue
    if not master_uuid_ids:
        return {}
    result = await session.execute(
        select(MasterExperience).where(
            MasterExperience.user_id == user_id,
            MasterExperience.id.in_(master_uuid_ids),
        )
    )
    category_by_master_id: Dict[str, ExperienceCategory] = {}
    for master in result.scalars().all():
        category = _as_experience_category(getattr(master, "category", None))
        if category:
            category_by_master_id[str(master.id)] = category
    return category_by_master_id


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


def _layout_float(layout: Dict[str, Any], key: str, fallback: float) -> float:
    value = layout.get(key)
    if value is None or value == "":
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _spacing_value(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".") + "em"


def _resolve_snapshot_layout(
    layout: Dict[str, Any],
    options: Optional[AgentGenerateOptions],
) -> Dict[str, Any]:
    item_spacing = _layout_float(layout, "itemSpacingEm", 0.2)
    values: Dict[str, Any] = {
        "lineHeight": _layout_float(layout, "lineHeight", 1.45),
        "fontSize": _layout_float(layout, "fontSize", 11),
        "itemSpacingEm": item_spacing,
        "topPaddingPx": _layout_float(layout, "topPaddingPx", 32),
        "sectionSpacingClass": str(layout.get("sectionSpacingClass") or "space-y-4"),
        "listSpacingClass": str(layout.get("listSpacingClass") or "space-y-2"),
    }
    values.update(
        lineHeight=min(values["lineHeight"], SMART_ONE_PAGE_LINE_HEIGHT),
        fontSize=min(values["fontSize"], SMART_ONE_PAGE_FONT_SIZE),
        itemSpacingEm=min(values["itemSpacingEm"], SMART_ONE_PAGE_ITEM_SPACING_EM),
        topPaddingPx=min(values["topPaddingPx"], SMART_ONE_PAGE_TOP_PADDING_PX),
        sectionSpacingClass=f"mb-{SMART_ONE_PAGE_SECTION_SPACING_KEY}",
        listSpacingClass="space-y-1",
    )
    return values


def _hash_agent_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _snapshot_skill_ids(snapshot: ResumePdfRenderSnapshot) -> List[str]:
    ids: List[str] = []
    for group in snapshot.selectedSkillGroups:
        ids.extend(skill.id for skill in group.skills if skill.id)
    return ids


def _build_agent_jd_analysis_config(
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
) -> Dict[str, Any]:
    jd_text = payload.jd_text.strip()
    result = {
        "matchPercentage": analysis.match_percentage,
        "jobKeywords": [],
        "missingKeywords": analysis.missing_keywords,
        "jobTitle": payload.job_title,
        "company": payload.company_name,
        "summary": analysis.evaluation,
        "extractedJdText": jd_text,
    }
    return {
        "jdText": jd_text,
        "jdInputSignature": _hash_agent_text(jd_text),
        "experienceSignature": _hash_agent_text(json.dumps(result, ensure_ascii=False, sort_keys=True)),
        "result": result,
        "itemSignatures": {
            "experiences": {},
            "certifications": {},
            "skills": {},
        },
        "experienceText": "",
        "inputMode": "text",
        "updatedAt": _now_aware().isoformat(),
    }


def _build_agent_generated_resume_config(
    source_config: Any,
    snapshot: ResumePdfRenderSnapshot,
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
) -> Dict[str, Any]:
    source = deepcopy(source_config) if isinstance(source_config, dict) else {}
    layout = source.get("layout") if isinstance(source.get("layout"), dict) else {}
    return {
        "profile": snapshot.profile.model_dump(mode="json"),
        "personalSummary": snapshot.profile.summary,
        "profileSyncMode": "local",
        "selection": {
            "experienceIds": [item.id for item in [*snapshot.selectedWorkItems, *snapshot.selectedProjectItems]],
            "educationIds": snapshot.selectedEduIds,
            "certificationIds": snapshot.selectedCertIds,
            "skillIds": _snapshot_skill_ids(snapshot),
        },
        "layout": {
            "sectionOrder": snapshot.sectionOrder,
            "density": "compact",
            "topPaddingPx": snapshot.topPaddingPx,
            "sectionSpacingKey": SMART_ONE_PAGE_SECTION_SPACING_KEY,
            "sectionSpacingClass": snapshot.sectionSpacingClass,
            "itemSpacingEm": SMART_ONE_PAGE_ITEM_SPACING_EM,
            "lineHeight": snapshot.lineHeight,
            "fontSize": snapshot.fontSize,
            "isSmartPageApplied": True,
            "isSummaryVisible": bool(snapshot.profile.summary.strip()),
            "orders": layout.get("orders", {}) if isinstance(layout.get("orders"), dict) else {},
            "templateId": snapshot.templateId,
            "themeColorPresetId": snapshot.themeColorPresetId,
            "experienceListMarkerStyle": snapshot.experienceListMarkerStyle,
            "skillTagSeparator": snapshot.skillTagSeparator,
        },
        "jdAnalysis": _build_agent_jd_analysis_config(payload, analysis),
        "agentJob": {
            "jobTitle": payload.job_title,
            "companyName": payload.company_name,
            "jobUrl": str(payload.job_url),
            "source": payload.source,
            "matchPercentage": analysis.match_percentage,
            "recommendation": analysis.recommendation,
            "suggestedFolderName": analysis.suggested_folder_name,
            "strengths": analysis.strengths,
            "gaps": analysis.gaps,
            "missingKeywords": analysis.missing_keywords,
            "generatedAt": _now_aware().isoformat(),
        },
    }


async def _persist_agent_generated_resume(
    session: AsyncSession,
    user_id: str,
    *,
    source_resume: Resume,
    resume_items: List[ResumeExperienceItem],
    snapshot: ResumePdfRenderSnapshot,
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
) -> Resume:
    title = f"{payload.company_name} - {payload.job_title}"
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
    for item in resume_items:
        experience = getattr(item, "experience", None)
        master_id = str(getattr(experience, "master_experience_id", "") or "")
        if master_id not in selected_master_ids:
            continue
        session.add(
            ResumeExperienceLink(
                resume_id=generated.id,
                experience_version_id=uuid.UUID(str(item.experience_version_id)),
                overrides_json=deepcopy(item.overrides_json or {}),
                display_order=int(item.display_order),
            )
        )

    await session.commit()
    await session.refresh(generated)
    return generated


def _resume_selection(config: Dict[str, Any]) -> Dict[str, Any]:
    selection = config.get("selection")
    return selection if isinstance(selection, dict) else {}


def _resume_profile_config(config: Dict[str, Any]) -> Dict[str, Any]:
    profile = config.get("profile")
    return profile if isinstance(profile, dict) else {}


def _resume_layout_config(config: Dict[str, Any]) -> Dict[str, Any]:
    layout = config.get("layout")
    return layout if isinstance(layout, dict) else {}


def _layout_orders_config(layout: Dict[str, Any]) -> Dict[str, Any]:
    orders = layout.get("orders")
    return orders if isinstance(orders, dict) else {}


def _resume_summary_visible(config: Dict[str, Any]) -> bool:
    return _resume_layout_config(config).get("isSummaryVisible") is not False


def _resume_personal_summary(config: Dict[str, Any]) -> str:
    value = config.get("personalSummary")
    return str(value).strip() if value is not None else ""


def _resume_personal_summary_override(config: Dict[str, Any]) -> Optional[str]:
    if "personalSummary" not in config:
        return None
    return _resume_personal_summary(config)


def _resume_items_or_none(
    resume_items: Optional[List[ResumeExperienceItem]],
) -> Optional[List[ResumeExperienceItem]]:
    return resume_items if resume_items else None


def _selected_ids(selection: Dict[str, Any], key: str) -> Optional[set[str]]:
    if key not in selection:
        return None
    value = selection.get(key)
    if not isinstance(value, list):
        return set()
    return {str(item) for item in value if str(item)}


def _as_experience_category(value: Any) -> Optional[ExperienceCategory]:
    if isinstance(value, ExperienceCategory):
        return value
    try:
        return ExperienceCategory(value)
    except (TypeError, ValueError):
        return None


def _profile_extra_json(profile: Any) -> Dict[str, Any]:
    extra_json = getattr(profile, "extra_json", {}) if profile is not None else {}
    return extra_json if isinstance(extra_json, dict) else {}


def _profile_template_preset(profile: Any, template_id: str) -> Dict[str, Any]:
    presets = _profile_extra_json(profile).get(PROFILE_TEMPLATE_PRESETS_KEY)
    if not isinstance(presets, dict):
        return {}
    preset = presets.get(template_id)
    return preset if isinstance(preset, dict) else {}


def _template_layout_value(layout: Dict[str, Any], preset: Dict[str, Any], key: str, fallback: str) -> str:
    preset_value = preset.get(key)
    if isinstance(preset_value, str) and preset_value:
        return preset_value
    layout_value = layout.get(key)
    if isinstance(layout_value, str) and layout_value:
        return layout_value
    return fallback


def _template_section_order(layout: Dict[str, Any], preset: Dict[str, Any]) -> List[str]:
    preset_order = preset.get("sectionOrder")
    if isinstance(preset_order, list) and preset_order:
        return [str(section_id) for section_id in preset_order if str(section_id)]
    layout_order = layout.get("sectionOrder")
    if isinstance(layout_order, list) and layout_order:
        return [str(section_id) for section_id in layout_order if str(section_id)]
    return ["summary", "work", "project", "education", "certifications", "skills"]


def _experience_category_map(rows: List[Tuple[Any, Any]]) -> Dict[str, ExperienceCategory]:
    result: Dict[str, ExperienceCategory] = {}
    for master, _version in rows:
        master_id = str(getattr(master, "id", ""))
        category = _as_experience_category(getattr(master, "category", None))
        if master_id and category:
            result[master_id] = category
    return result


def _merged_category_map(
    rows: List[Tuple[Any, Any]],
    category_by_master_id: Optional[Dict[str, ExperienceCategory]] = None,
) -> Dict[str, ExperienceCategory]:
    result = _experience_category_map(rows)
    if category_by_master_id:
        result.update(category_by_master_id)
    return result


def _filter_experience_rows_by_master_ids(
    rows: List[Tuple[Any, Any]],
    selected_ids: Optional[set[str]],
) -> List[Tuple[Any, Any]]:
    if selected_ids is None:
        return rows
    return [row for row in rows if str(getattr(row[0], "id", "")) in selected_ids]


def _resume_item_experience_payloads(
    rows: List[ResumeExperienceItem],
    category_by_master_id: Dict[str, ExperienceCategory],
    category: ExperienceCategory,
    selected_ids: Optional[set[str]],
) -> List[Dict[str, Any]]:
    payload: List[Dict[str, Any]] = []
    for item in rows:
        experience = item.experience
        master_id = str(getattr(experience, "master_experience_id", "") or "")
        if category_by_master_id.get(master_id) != category:
            continue
        if selected_ids is not None and master_id not in selected_ids:
            continue
        payload.append(
            {
                "id": master_id,
                "title": getattr(experience, "title", "") or "",
                "org": getattr(experience, "org", "") or "",
                "start_date": _date_to_str(getattr(experience, "start_date", None)),
                "end_date": _date_to_str(getattr(experience, "end_date", None)),
                "is_current": bool(getattr(experience, "is_current", False)),
                "summary": getattr(experience, "summary", "") or "",
                "star": getattr(experience, "star", {}) or {},
                "tags": getattr(experience, "tags", []) or [],
            }
        )
    return payload


def _summary_generation_payload(
    bank: Dict[str, Any],
    resume: Optional[Resume],
    resume_items: Optional[List[ResumeExperienceItem]],
    category_by_master_id: Optional[Dict[str, ExperienceCategory]],
) -> Dict[str, Any]:
    resume_items = _resume_items_or_none(resume_items)
    raw_config = getattr(resume, "config", None)
    config = raw_config if isinstance(raw_config, dict) else {}
    selection = _resume_selection(config)
    selected_experience_ids = _selected_ids(selection, "experienceIds")
    selected_education_ids = _selected_ids(selection, "educationIds")
    if resume_items is None:
        work_source = _filter_experience_rows_by_master_ids(bank["experiences"], selected_experience_ids)
        project_source = _filter_experience_rows_by_master_ids(bank["experiences"], selected_experience_ids)
        education_source = _filter_experience_rows_by_master_ids(bank["experiences"], selected_education_ids)
        work_experiences = _experiences_payload(work_source, ExperienceCategory.WORK)
        project_experiences = _experiences_payload(project_source, ExperienceCategory.PROJECT)
        education_experiences = _experiences_payload(education_source, ExperienceCategory.EDUCATION)
    else:
        category_map = _merged_category_map(bank["experiences"], category_by_master_id)
        work_experiences = _resume_item_experience_payloads(
            resume_items,
            category_map,
            ExperienceCategory.WORK,
            selected_experience_ids,
        )
        project_experiences = _resume_item_experience_payloads(
            resume_items,
            category_map,
            ExperienceCategory.PROJECT,
            selected_experience_ids,
        )
        education_experiences = _resume_item_experience_payloads(
            resume_items,
            category_map,
            ExperienceCategory.EDUCATION,
            selected_education_ids,
        )
    return {
        "profile": _profile_payload_for_resume(bank["profile"], config),
        "work_experiences": work_experiences,
        "project_experiences": project_experiences,
        "education_experiences": education_experiences,
        "certifications": _certifications_payload(
            _filter_certifications(bank["certifications"], _selected_ids(selection, "certificationIds"))
        ),
        "skills": _skills_payload(
            _filter_skills(bank["skills"], _selected_ids(selection, "skillIds"))
        ),
    }


def _resume_item_experience_snapshots(
    rows: List[ResumeExperienceItem],
    category_by_master_id: Dict[str, ExperienceCategory],
    category: ExperienceCategory,
) -> List[ResumeExperienceViewSnapshot]:
    items: List[ResumeExperienceViewSnapshot] = []
    for item in rows:
        experience = item.experience
        master_id = str(getattr(experience, "master_experience_id", ""))
        if category_by_master_id.get(master_id) != category:
            continue
        start = _date_to_str(getattr(experience, "start_date", None))
        end = "至今" if getattr(experience, "is_current", False) else _date_to_str(getattr(experience, "end_date", None))
        items.append(
            ResumeExperienceViewSnapshot(
                id=master_id,
                title=getattr(experience, "title", "") or "",
                company=getattr(experience, "org", "") or "",
                date=" - ".join(part for part in [start, end] if part),
                startDate=start or None,
                endDate=end or None,
                isCurrent=bool(getattr(experience, "is_current", False)),
                star=_star_fields(getattr(experience, "star", {}) or {}),
                category=category.value,
            )
        )
    return items


def _resume_item_education_snapshots(
    rows: List[ResumeExperienceItem],
    category_by_master_id: Dict[str, ExperienceCategory],
) -> List[EducationViewSnapshot]:
    items: List[EducationViewSnapshot] = []
    for item in rows:
        experience = item.experience
        master_id = str(getattr(experience, "master_experience_id", ""))
        if category_by_master_id.get(master_id) != ExperienceCategory.EDUCATION:
            continue
        star = getattr(experience, "star", {}) or {}
        items.append(
            EducationViewSnapshot(
                id=master_id,
                school=getattr(experience, "org", "") or getattr(experience, "title", "") or "",
                major=str(star.get("major") or getattr(experience, "summary", "") or ""),
                degree=str(star.get("degree") or getattr(experience, "title", "") or ""),
                startDate=_date_to_str(getattr(experience, "start_date", None)),
                endDate=_date_to_str(getattr(experience, "end_date", None)),
                isCurrent=bool(getattr(experience, "is_current", False)),
                gpa=str(star.get("gpa") or "") or None,
                courses=str(star.get("courses") or "") or None,
            )
        )
    return items


def _filter_certifications(certs: List[Any], selected_ids: Optional[set[str]]) -> List[Any]:
    if selected_ids is None:
        return certs
    return [cert for cert in certs if str(getattr(cert, "id", "")) in selected_ids]


def _filter_skills(rows: List[Tuple[Any, Any]], selected_ids: Optional[set[str]]) -> List[Tuple[Any, Any]]:
    if selected_ids is None:
        return rows
    return [row for row in rows if str(getattr(row[0], "id", "")) in selected_ids]


def _filter_educations(
    educations: List[EducationViewSnapshot],
    selected_ids: Optional[set[str]],
) -> List[EducationViewSnapshot]:
    if selected_ids is None:
        return educations
    return [education for education in educations if education.id in selected_ids]


def _filter_experience_snapshots(
    items: List[ResumeExperienceViewSnapshot],
    selected_ids: Optional[set[str]],
) -> List[ResumeExperienceViewSnapshot]:
    if selected_ids is None:
        return items
    return [item for item in items if item.id in selected_ids]


def _apply_explicit_order(
    items: List[Any],
    order: Any,
    key_fn: Callable[[Any], str],
) -> List[Any]:
    if not isinstance(order, list) or not order:
        return items
    by_key = {str(key_fn(item)): item for item in items}
    used: set[str] = set()
    ordered: List[Any] = []
    for raw_key in order:
        key = str(raw_key)
        if key in used or key not in by_key:
            continue
        used.add(key)
        ordered.append(by_key[key])
    return ordered + [item for item in items if str(key_fn(item)) not in used]


def _build_resume_pdf_snapshot(
    resume: Resume,
    bank: Dict[str, Any],
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
    personal_summary: str,
    options: Optional[AgentGenerateOptions] = None,
    resume_items: Optional[List[ResumeExperienceItem]] = None,
    category_by_master_id: Optional[Dict[str, ExperienceCategory]] = None,
) -> ResumePdfRenderSnapshot:
    config = resume.config if isinstance(resume.config, dict) else {}
    layout = _resume_layout_config(config)
    orders = _layout_orders_config(layout)
    selection = _resume_selection(config)
    profile_config = _resume_profile_config(config)
    summary_override: Optional[str] = personal_summary if personal_summary else None
    if summary_override is None:
        summary_override = _resume_personal_summary_override(config)
    profile = _profile_snapshot(
        bank["profile"],
        profile_config,
        summary_override,
    )
    if not _resume_summary_visible(config):
        profile.summary = ""
    experiences = bank["experiences"]
    resume_items = _resume_items_or_none(resume_items)
    if resume_items is None:
        work_items = _experience_snapshots(experiences, ExperienceCategory.WORK)
        project_items = _experience_snapshots(experiences, ExperienceCategory.PROJECT)
        educations = _education_snapshots(experiences)
    else:
        category_map = _merged_category_map(experiences, category_by_master_id)
        work_items = _resume_item_experience_snapshots(resume_items, category_map, ExperienceCategory.WORK)
        project_items = _resume_item_experience_snapshots(resume_items, category_map, ExperienceCategory.PROJECT)
        educations = _resume_item_education_snapshots(resume_items, category_map)
    selected_experience_ids = _selected_ids(selection, "experienceIds")
    work_items = _filter_experience_snapshots(work_items, selected_experience_ids)
    project_items = _filter_experience_snapshots(project_items, selected_experience_ids)
    educations = _filter_educations(educations, _selected_ids(selection, "educationIds"))
    work_items = _apply_explicit_order(work_items, orders.get("workExperienceIds"), lambda item: item.id)
    project_items = _apply_explicit_order(project_items, orders.get("projectExperienceIds"), lambda item: item.id)
    educations = _apply_explicit_order(educations, orders.get("educationIds"), lambda item: item.id)
    certs = _certification_snapshots(
        _filter_certifications(bank["certifications"], _selected_ids(selection, "certificationIds"))
    )
    certs = _apply_explicit_order(certs, orders.get("certificationIds"), lambda item: item.id)
    skill_groups = _skill_group_snapshots(
        _filter_skills(bank["skills"], _selected_ids(selection, "skillIds"))
    )
    skill_groups = _apply_explicit_order(skill_groups, orders.get("skillGroupNames"), lambda group: group.name)
    snapshot_layout = _resolve_snapshot_layout(layout, options)
    item_spacing_value = _spacing_value(snapshot_layout["itemSpacingEm"])
    template_id = (options.template_id if options else payload.template_id) or layout.get("templateId") or "modern-slate"
    template_preset = _profile_template_preset(bank["profile"], template_id)

    return ResumePdfRenderSnapshot(
        resumeName=analysis.suggested_folder_name,
        profile=profile,
        lineHeight=snapshot_layout["lineHeight"],
        fontSize=snapshot_layout["fontSize"],
        listSpacingValue=item_spacing_value,
        bulletSpacingValue=item_spacing_value,
        topPaddingPx=snapshot_layout["topPaddingPx"],
        sectionSpacingClass=snapshot_layout["sectionSpacingClass"],
        listSpacingClass=snapshot_layout["listSpacingClass"],
        sectionOrder=_template_section_order(layout, template_preset),
        selectedWorkItems=work_items,
        selectedProjectItems=project_items,
        educations=educations,
        selectedEduIds=[item.id for item in educations],
        sortedCertifications=certs,
        selectedCertIds=[item.id for item in certs],
        selectedSkillGroups=skill_groups,
        templateId=template_id,
        themeColorPresetId=_template_layout_value(layout, template_preset, "themeColorPresetId", "slate"),
        experienceListMarkerStyle=_template_layout_value(layout, template_preset, "experienceListMarkerStyle", "unordered"),
        skillTagSeparator=_template_layout_value(layout, template_preset, "skillTagSeparator", "，"),
    )


def _profile_payload(profile: Any) -> Dict[str, Any]:
    if profile is None:
        return {}
    extra_json = getattr(profile, "extra_json", {}) or {}
    avatar_data_url = (
        extra_json.get("avatar_data_url")
        if isinstance(extra_json, dict)
        else ""
    )
    return {
        "full_name": getattr(profile, "full_name", "") or "",
        "title": getattr(profile, "title", "") or "",
        "summary": getattr(profile, "summary", "") or "",
        "location": getattr(profile, "location", "") or "",
        "email": getattr(profile, "email", "") or "",
        "phone": getattr(profile, "phone", "") or "",
        "social_links": getattr(profile, "social_links", {}) or {},
        "avatar_data_url": avatar_data_url if isinstance(avatar_data_url, str) else "",
    }


def _social_link_url(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        url = value.get("url")
        return url if isinstance(url, str) else ""
    return ""


def _string_field(config: Dict[str, Any], key: str, fallback: Any = "") -> str:
    if key in config:
        value = config.get(key)
        return str(value) if value is not None else ""
    return str(fallback or "")


def _profile_payload_for_resume(profile: Any, config: Dict[str, Any]) -> Dict[str, Any]:
    base = _profile_payload(profile)
    summary_visible = _resume_summary_visible(config)
    personal_summary_override = _resume_personal_summary_override(config)
    config_profile = _resume_profile_config(config)
    if config.get("profileSyncMode") == "local" and config_profile:
        social_links = dict(base.get("social_links") or {})
        linkedin = str(config_profile.get("linkedin") or "").strip()
        if linkedin:
            social_links["linkedin"] = linkedin
        elif "linkedin" in config_profile:
            social_links.pop("linkedin", None)
        summary = personal_summary_override
        if summary is None:
            summary = str(config_profile.get("summary") or "")
        return {
            "full_name": str(config_profile.get("name") or ""),
            "title": base.get("title", ""),
            "summary": summary if summary_visible else "",
            "location": str(config_profile.get("location") or ""),
            "email": str(config_profile.get("email") or ""),
            "phone": str(config_profile.get("phone") or ""),
            "social_links": social_links,
        }
    if not summary_visible:
        return {**base, "summary": ""}
    if personal_summary_override is not None:
        return {**base, "summary": personal_summary_override}
    return base


def _profile_snapshot(
    profile: Any,
    config: Dict[str, Any],
    personal_summary: Optional[str],
) -> ResumeEditorProfileSnapshot:
    base = _profile_payload(profile)
    social_links = base.get("social_links") if isinstance(base.get("social_links"), dict) else {}
    linkedin = _string_field(
        config,
        "linkedin",
        _social_link_url(social_links.get("linkedin")),
    )
    avatar_data_url = _string_field(config, "avatarDataUrl", base.get("avatar_data_url"))
    summary = personal_summary
    if summary is None:
        summary = _string_field(config, "summary", base.get("summary"))
    return ResumeEditorProfileSnapshot(
        name=_string_field(config, "name", base.get("full_name")),
        email=_string_field(config, "email", base.get("email")),
        phone=_string_field(config, "phone", base.get("phone")),
        location=_string_field(config, "location", base.get("location")),
        linkedin=linkedin,
        summary=summary,
        avatarDataUrl=avatar_data_url,
    )


def _experiences_payload(rows: List[Tuple[Any, Any]], category: ExperienceCategory) -> List[Dict[str, Any]]:
    payload = []
    for master, version in rows:
        if getattr(master, "category", None) != category or version is None:
            continue
        payload.append(_version_payload(version))
    return payload


def _version_payload(version: Any) -> Dict[str, Any]:
    return {
        "id": str(getattr(version, "id", "")),
        "title": getattr(version, "title", "") or "",
        "org": getattr(version, "org", "") or "",
        "start_date": _date_to_str(getattr(version, "start_date", None)),
        "end_date": _date_to_str(getattr(version, "end_date", None)),
        "is_current": bool(getattr(version, "is_current", False)),
        "summary": getattr(version, "summary", "") or "",
        "star": getattr(version, "star", {}) or {},
        "tags": getattr(version, "tags", []) or [],
    }


def _experience_snapshots(rows: List[Tuple[Any, Any]], category: ExperienceCategory) -> List[ResumeExperienceViewSnapshot]:
    items = []
    for master, version in rows:
        if getattr(master, "category", None) != category or version is None:
            continue
        start = _date_to_str(getattr(version, "start_date", None))
        end = "至今" if getattr(version, "is_current", False) else _date_to_str(getattr(version, "end_date", None))
        items.append(
            ResumeExperienceViewSnapshot(
                id=str(getattr(master, "id", getattr(version, "id", ""))),
                title=getattr(version, "title", "") or "",
                company=getattr(version, "org", "") or "",
                date=" - ".join(part for part in [start, end] if part),
                startDate=start or None,
                endDate=end or None,
                isCurrent=bool(getattr(version, "is_current", False)),
                star=_star_fields(getattr(version, "star", {}) or {}),
                category=category.value,
            )
        )
    return items


def _education_snapshots(rows: List[Tuple[Any, Any]]) -> List[EducationViewSnapshot]:
    items = []
    for master, version in rows:
        if getattr(master, "category", None) != ExperienceCategory.EDUCATION or version is None:
            continue
        star = getattr(version, "star", {}) or {}
        items.append(
            EducationViewSnapshot(
                id=str(getattr(master, "id", getattr(version, "id", ""))),
                school=getattr(version, "org", "") or getattr(version, "title", "") or "",
                major=str(star.get("major") or getattr(version, "summary", "") or ""),
                degree=str(star.get("degree") or getattr(version, "title", "") or ""),
                startDate=_date_to_str(getattr(version, "start_date", None)),
                endDate=_date_to_str(getattr(version, "end_date", None)),
                isCurrent=bool(getattr(version, "is_current", False)),
                gpa=str(star.get("gpa") or "") or None,
                courses=str(star.get("courses") or "") or None,
            )
        )
    return items


def _certifications_payload(certs: List[Any]) -> List[Dict[str, Any]]:
    return [
        {
            "id": str(getattr(cert, "id", "")),
            "name": getattr(cert, "name", "") or "",
            "issuer": getattr(cert, "issuer", "") or "",
            "issue_date": _date_to_str(getattr(cert, "issue_date", None)),
            "description": getattr(cert, "description", "") or "",
        }
        for cert in certs
    ]


def _certification_snapshots(certs: List[Any]) -> List[CertificationViewSnapshot]:
    return [
        CertificationViewSnapshot(
            id=str(getattr(cert, "id", "")),
            name=getattr(cert, "name", "") or "",
            issuer=getattr(cert, "issuer", None),
            date=_date_to_str(getattr(cert, "issue_date", None)),
        )
        for cert in certs
    ]


def _skills_payload(rows: List[Tuple[Any, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "id": str(getattr(user_skill, "id", "")),
            "name": getattr(skill, "name", "") or "",
            "category": getattr(skill, "category", "") or "",
            "proficiency": getattr(user_skill, "proficiency", None),
        }
        for user_skill, skill in rows
    ]


def _skill_group_snapshots(rows: List[Tuple[Any, Any]]) -> List[SkillGroupViewSnapshot]:
    grouped: Dict[str, List[SkillItemViewSnapshot]] = {}
    for user_skill, skill in rows:
        category = getattr(skill, "category", None) or "技能"
        grouped.setdefault(category, []).append(
            SkillItemViewSnapshot(
                id=str(getattr(user_skill, "id", "")),
                name=getattr(skill, "name", "") or "",
            )
        )
    return [SkillGroupViewSnapshot(name=name, skills=items) for name, items in grouped.items()]


def _star_fields(star: Dict[str, Any]) -> StarFields:
    return StarFields(
        s=str(star.get("s") or ""),
        t=str(star.get("t") or ""),
        a=str(star.get("a") or ""),
        r=str(star.get("r") or ""),
    )


def _date_to_str(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m")
    return str(value)
