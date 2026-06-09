from __future__ import annotations

import json
from copy import deepcopy
from typing import Any, Callable, Dict

from ..export.schemas import ResumePdfRenderSnapshot
from .schemas import AgentJobAnalysisResponse, AgentJobGenerateRequest


def _build_agent_jd_analysis_config(
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
) -> Dict[str, Any]:
    from . import agent_pdf_helpers

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
        "jdInputSignature": agent_pdf_helpers._hash_agent_text(jd_text),
        "experienceSignature": agent_pdf_helpers._hash_agent_text(json.dumps(result, ensure_ascii=False, sort_keys=True)),
        "result": result,
        "itemSignatures": {
            "experiences": {},
            "certifications": {},
            "skills": {},
        },
        "experienceText": "",
        "inputMode": "text",
        "updatedAt": agent_pdf_helpers._now_aware().isoformat(),
    }


def _build_agent_generated_resume_config(
    source_config: Any,
    snapshot: ResumePdfRenderSnapshot,
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
    *,
    build_jd_analysis_config: Callable[
        [AgentJobGenerateRequest, AgentJobAnalysisResponse],
        Dict[str, Any],
    ] = _build_agent_jd_analysis_config,
) -> Dict[str, Any]:
    from . import agent_pdf_helpers

    source = deepcopy(source_config) if isinstance(source_config, dict) else {}
    layout = source.get("layout") if isinstance(source.get("layout"), dict) else {}
    item_spacing_em = agent_pdf_helpers._layout_float(
        {"itemSpacingEm": snapshot.listSpacingValue.replace("em", "")},
        "itemSpacingEm",
        agent_pdf_helpers.SMART_PAGE_ITEM_SPACING_DEFAULT,
    )
    section_spacing_key = agent_pdf_helpers._layout_section_spacing_key(
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
            "skillIds": agent_pdf_helpers._snapshot_skill_ids(snapshot),
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
            "orders": agent_pdf_helpers._snapshot_layout_orders(layout, snapshot),
            "templateId": snapshot.templateId,
            "themeColorPresetId": snapshot.themeColorPresetId,
            "experienceListMarkerStyle": snapshot.experienceListMarkerStyle,
            "skillTagSeparator": snapshot.skillTagSeparator,
        },
        "jdAnalysis": build_jd_analysis_config(payload, analysis),
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
            "generatedAt": agent_pdf_helpers._now_aware().isoformat(),
        },
    }
