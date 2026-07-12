from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from ..export.schemas import ResumePdfRenderSnapshot
from .agent_common_helpers import _hash_agent_text, _now_aware
from .agent_pdf_layout_service import (
    SMART_PAGE_ITEM_SPACING_DEFAULT,
    _layout_float,
    _layout_section_spacing_key,
)
from .agent_pdf_snapshot_projection import _snapshot_skill_ids
from .agent_profile_snapshot_service import _snapshot_layout_orders
from .schemas import AgentJobAnalysisResponse, AgentJobGenerateRequest


@dataclass(frozen=True)
class GeneratedResumeConfigOps:
    hash_agent_text: Callable[[str], str] = _hash_agent_text
    now_aware: Callable[[], datetime] = _now_aware
    layout_float: Callable[[Dict[str, Any], str, float], float] = _layout_float
    item_spacing_default: float = SMART_PAGE_ITEM_SPACING_DEFAULT
    layout_section_spacing_key: Callable[[Dict[str, Any]], int] = _layout_section_spacing_key
    snapshot_skill_ids: Callable[[ResumePdfRenderSnapshot], List[str]] = _snapshot_skill_ids
    snapshot_layout_orders: Callable[
        [Dict[str, Any], ResumePdfRenderSnapshot],
        Dict[str, Any],
    ] = _snapshot_layout_orders


DEFAULT_GENERATED_RESUME_CONFIG_OPS = GeneratedResumeConfigOps()


def _build_agent_jd_analysis_config(
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
    *,
    ops: GeneratedResumeConfigOps = DEFAULT_GENERATED_RESUME_CONFIG_OPS,
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
        "jdInputSignature": ops.hash_agent_text(jd_text),
        "experienceSignature": ops.hash_agent_text(json.dumps(result, ensure_ascii=False, sort_keys=True)),
        "result": result,
        "itemSignatures": {
            "experiences": {},
            "certifications": {},
            "skills": {},
        },
        "experienceText": "",
        "inputMode": "text",
        "updatedAt": ops.now_aware().isoformat(),
    }


def _build_agent_generated_resume_config(
    source_config: Any,
    snapshot: ResumePdfRenderSnapshot,
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
    *,
    build_jd_analysis_config: Optional[Callable[
        [AgentJobGenerateRequest, AgentJobAnalysisResponse],
        Dict[str, Any],
    ]] = None,
    ops: GeneratedResumeConfigOps = DEFAULT_GENERATED_RESUME_CONFIG_OPS,
) -> Dict[str, Any]:
    source = deepcopy(source_config) if isinstance(source_config, dict) else {}
    layout = source.get("layout") if isinstance(source.get("layout"), dict) else {}
    item_spacing_em = ops.layout_float(
        {"itemSpacingEm": snapshot.listSpacingValue.replace("em", "")},
        "itemSpacingEm",
        ops.item_spacing_default,
    )
    section_spacing_key = ops.layout_section_spacing_key(
        {"sectionSpacingClass": snapshot.sectionSpacingClass}
    )
    return {
        "profile": snapshot.profile.model_dump(mode="json"),
        "personalSummary": snapshot.profile.summary,
        "profileSyncMode": "local",
        "selection": {
            "experienceIds": [item.id for item in [*snapshot.selectedWorkItems, *snapshot.selectedProjectItems]],
            "educationIds": snapshot.selectedEduIds,
            "certificationIds": snapshot.selectedCertIds,
            "skillIds": ops.snapshot_skill_ids(snapshot),
        },
        "layout": {
            "sectionOrder": snapshot.sectionOrder,
            "density": "compact",
            "topPaddingPx": snapshot.topPaddingPx,
            "sectionSpacingKey": section_spacing_key,
            "sectionSpacingClass": snapshot.sectionSpacingClass,
            "itemSpacingEm": item_spacing_em,
            "lineHeight": snapshot.lineHeight,
            "fontSize": snapshot.fontSize,
            "isSmartPageApplied": True,
            "isSummaryVisible": bool(snapshot.profile.summary.strip()),
            "orders": ops.snapshot_layout_orders(layout, snapshot),
            "templateId": snapshot.templateId,
            "themeColorPresetId": snapshot.themeColorPresetId,
            "experienceListMarkerStyle": snapshot.experienceListMarkerStyle,
            "skillTagSeparator": snapshot.skillTagSeparator,
        },
        "jdAnalysis": (
            build_jd_analysis_config(payload, analysis)
            if build_jd_analysis_config is not None
            else _build_agent_jd_analysis_config(payload, analysis, ops=ops)
        ),
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
            "generatedAt": ops.now_aware().isoformat(),
        },
    }
