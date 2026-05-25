from __future__ import annotations

import hashlib
import io
import json
import re
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from pypdf import PdfReader

from ...models import ExperienceCategory
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
from ..resume.models import Resume
from ..resume.resume_schema import ResumeExperienceItem
from .agent_common_helpers import _as_experience_category, _date_to_str
from .agent_option_helpers import AGENT_RESUME_TEMPLATE_OPTIONS, _clamp_score
from .schemas import AgentJobAnalysisResponse, AgentJobGenerateRequest


def _now_aware() -> datetime:
    return datetime.now(timezone.utc)


SMART_ONE_PAGE_LINE_HEIGHT = 1.35
SMART_ONE_PAGE_FONT_SIZE = 13
SMART_ONE_PAGE_TOP_PADDING_PX = 15
SMART_ONE_PAGE_ITEM_SPACING_EM = 0.25
SMART_ONE_PAGE_SECTION_SPACING_KEY = 2
AUTO_ASSEMBLY_MAX_EXPERIENCES = 3
AUTO_ASSEMBLY_MATCH_THRESHOLD = 80
CSS_PX_PER_MM = 96 / 25.4
PREVIEW_PADDING_MM = 20
SMART_PAGE_TOP_PADDING_DEFAULT_PX = CSS_PX_PER_MM * PREVIEW_PADDING_MM
SMART_PAGE_TOP_PADDING_MAX_PX = SMART_PAGE_TOP_PADDING_DEFAULT_PX + 10
SMART_PAGE_TOP_PADDING_STEP_PX = 5
LINE_HEIGHT_DEFAULT = 1.6
LINE_HEIGHT_MAX = 1.75
FONT_SIZE_DEFAULT = 16
FONT_SIZE_MAX = 18
SMART_PAGE_ITEM_SPACING_DEFAULT = 1
SMART_PAGE_ITEM_SPACING_MAX = 2
SMART_PAGE_SECTION_SPACING_DEFAULT_KEY = 6
SMART_PAGE_SECTION_SPACING_STEPS = [12, 10, 8, 6, 5, 4, 3, 2]
SMART_PAGE_SECTION_SPACING_CLASS_BY_KEY = {
    12: "mb-12",
    10: "mb-10",
    8: "mb-8",
    6: "mb-6",
    5: "mb-5",
    4: "mb-4",
    3: "mb-3",
    2: "mb-2",
}
PROFILE_TEMPLATE_PRESETS_KEY = "resumeTemplatePresets"


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

def _agent_polish_mode(polish_level: str) -> str:
    normalized = (polish_level or "").strip()
    if normalized == "保守":
        return "highlight"
    if normalized == "增强":
        return "enhanced"
    if normalized == "强匹配":
        return "strong_match"
    return "default"

def _polish_content_for_experience(item: ResumeExperienceViewSnapshot) -> Dict[str, Any]:
    return {
        "title": item.title,
        "company": item.company,
        "role": item.title,
        "s": item.star.s,
        "t": item.star.t,
        "a": item.star.a,
        "r": item.star.r,
    }

def _polished_star(original: StarFields, result: Dict[str, Any]) -> StarFields:
    return StarFields(
        s=str(result.get("s") or original.s),
        t=str(result.get("t") or original.t),
        a=str(result.get("a") or original.a),
        r=str(result.get("r") or original.r),
    )

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

def _layout_section_spacing_key(layout: Dict[str, Any], fallback: int = SMART_PAGE_SECTION_SPACING_DEFAULT_KEY) -> int:
    value = layout.get("sectionSpacingKey")
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        class_value = str(layout.get("sectionSpacingClass") or "")
        match = re.fullmatch(r"mb-(\d+)", class_value)
        numeric = int(match.group(1)) if match else fallback
    return numeric if numeric in SMART_PAGE_SECTION_SPACING_CLASS_BY_KEY else fallback

def _snapshot_layout_values(
    *,
    line_height: float,
    font_size: float,
    item_spacing_em: float,
    top_padding_px: float,
    section_spacing_key: int,
) -> Dict[str, Any]:
    return {
        "lineHeight": line_height,
        "fontSize": font_size,
        "itemSpacingEm": item_spacing_em,
        "topPaddingPx": top_padding_px,
        "sectionSpacingKey": section_spacing_key,
        "sectionSpacingClass": SMART_PAGE_SECTION_SPACING_CLASS_BY_KEY.get(section_spacing_key, "mb-6"),
        "listSpacingClass": "space-y-1" if item_spacing_em <= SMART_ONE_PAGE_ITEM_SPACING_EM else "space-y-2",
    }

def _apply_snapshot_layout(snapshot: ResumePdfRenderSnapshot, values: Dict[str, Any]) -> ResumePdfRenderSnapshot:
    snapshot.lineHeight = values["lineHeight"]
    snapshot.fontSize = values["fontSize"]
    snapshot.listSpacingValue = _spacing_value(values["itemSpacingEm"])
    snapshot.bulletSpacingValue = _spacing_value(values["itemSpacingEm"])
    snapshot.topPaddingPx = values["topPaddingPx"]
    snapshot.sectionSpacingClass = values["sectionSpacingClass"]
    snapshot.listSpacingClass = values["listSpacingClass"]
    return snapshot

def _resolve_snapshot_layout(
    layout: Dict[str, Any],
    options: Optional[AgentGenerateOptions],
) -> Dict[str, Any]:
    return _snapshot_layout_values(
        line_height=_layout_float(layout, "lineHeight", LINE_HEIGHT_DEFAULT),
        font_size=_layout_float(layout, "fontSize", FONT_SIZE_DEFAULT),
        item_spacing_em=_layout_float(layout, "itemSpacingEm", SMART_PAGE_ITEM_SPACING_DEFAULT),
        top_padding_px=_layout_float(layout, "topPaddingPx", SMART_PAGE_TOP_PADDING_DEFAULT_PX),
        section_spacing_key=_layout_section_spacing_key(layout),
    )

def _hard_fallback_snapshot_layout() -> Dict[str, Any]:
    return _snapshot_layout_values(
        line_height=SMART_ONE_PAGE_LINE_HEIGHT,
        font_size=SMART_ONE_PAGE_FONT_SIZE,
        item_spacing_em=SMART_ONE_PAGE_ITEM_SPACING_EM,
        top_padding_px=SMART_ONE_PAGE_TOP_PADDING_PX,
        section_spacing_key=SMART_ONE_PAGE_SECTION_SPACING_KEY,
    )

def _expand_snapshot_layout_candidates(default_layout: Dict[str, Any]) -> List[Dict[str, Any]]:
    section_keys = [
        key
        for key in SMART_PAGE_SECTION_SPACING_STEPS
        if key >= int(default_layout["sectionSpacingKey"])
    ]
    section_keys.sort()
    max_section_key = max(section_keys) if section_keys else int(default_layout["sectionSpacingKey"])

    def step(value: float, maximum: float, offset: int, step_size: float) -> float:
        return min(maximum, value + (offset * step_size))

    def section_step(value: int, offset: int) -> int:
        if not section_keys:
            return value
        try:
            base_index = section_keys.index(value)
        except ValueError:
            base_index = min(
                range(len(section_keys)),
                key=lambda index: abs(section_keys[index] - value),
            )
        return section_keys[min(base_index + offset, len(section_keys) - 1)]

    stages = [
        (1, 0.25, 0.05, 0.5, 1),
        (2, 0.5, 0.10, 1.0, 2),
        (3, 0.75, 0.15, 1.5, 3),
        (999, SMART_PAGE_ITEM_SPACING_MAX, LINE_HEIGHT_MAX, FONT_SIZE_MAX, 999),
    ]
    candidates: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for top_offset, item_target, line_target, font_target, section_offset in stages:
        if top_offset == 999:
            values = _snapshot_layout_values(
                line_height=LINE_HEIGHT_MAX,
                font_size=FONT_SIZE_MAX,
                item_spacing_em=SMART_PAGE_ITEM_SPACING_MAX,
                top_padding_px=SMART_PAGE_TOP_PADDING_MAX_PX,
                section_spacing_key=max_section_key,
            )
        else:
            current_key = int(default_layout["sectionSpacingKey"])
            next_key = section_step(current_key, section_offset)
            values = _snapshot_layout_values(
                line_height=min(LINE_HEIGHT_MAX, default_layout["lineHeight"] + line_target),
                font_size=min(FONT_SIZE_MAX, default_layout["fontSize"] + font_target),
                item_spacing_em=min(SMART_PAGE_ITEM_SPACING_MAX, default_layout["itemSpacingEm"] + item_target),
                top_padding_px=step(
                    default_layout["topPaddingPx"],
                    SMART_PAGE_TOP_PADDING_MAX_PX,
                    top_offset,
                    SMART_PAGE_TOP_PADDING_STEP_PX,
                ),
                section_spacing_key=next_key,
            )
        signature = json.dumps(values, sort_keys=True)
        if signature not in seen:
            seen.add(signature)
            candidates.append(values)
    return candidates

def _hash_agent_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def _snapshot_skill_ids(snapshot: ResumePdfRenderSnapshot) -> List[str]:
    ids: List[str] = []
    for group in snapshot.selectedSkillGroups:
        ids.extend(skill.id for skill in group.skills if skill.id)
    return ids

def _pdf_page_count(pdf_bytes: bytes) -> int:
    return len(PdfReader(io.BytesIO(pdf_bytes)).pages)

def _analysis_score_map(entries: Any) -> Dict[str, int]:
    if not isinstance(entries, list):
        return {}
    result: Dict[str, int] = {}
    for entry in entries:
        item_id = _score_entry_id(entry)
        if item_id:
            result[item_id] = _score_entry_score(entry)
    return result

def _sort_selected_ids_by_score_asc(ids: Iterable[str], score_map: Dict[str, int]) -> List[str]:
    return sorted(
        [item_id for item_id in ids if item_id],
        key=lambda item_id: (score_map.get(item_id, 0), item_id),
    )

def _snapshot_experience_ids(snapshot: ResumePdfRenderSnapshot) -> List[str]:
    return [item.id for item in [*snapshot.selectedWorkItems, *snapshot.selectedProjectItems] if item.id]

def _snapshot_experience_star_overrides(snapshot: ResumePdfRenderSnapshot) -> Dict[str, Dict[str, Any]]:
    return {
        item.id: item.star.model_dump(mode="json")
        for item in [*snapshot.selectedWorkItems, *snapshot.selectedProjectItems]
        if item.id
    }

def _build_snapshot_trim_plan(
    snapshot: ResumePdfRenderSnapshot,
    analysis_result: Optional[Dict[str, Any]],
) -> List[Tuple[str, str]]:
    analysis = analysis_result if isinstance(analysis_result, dict) else {}
    plan: List[Tuple[str, str]] = []
    skill_score_map = _analysis_score_map(analysis.get("skillMatches"))
    cert_score_map = _analysis_score_map(analysis.get("certificationMatches"))
    experience_score_map = _analysis_score_map(analysis.get("experienceMatches"))
    skill_ids = _snapshot_skill_ids(snapshot)
    cert_ids = [item.id for item in snapshot.sortedCertifications if item.id]
    experience_ids = _snapshot_experience_ids(snapshot)

    plan.extend(("skill", item_id) for item_id in _sort_selected_ids_by_score_asc(skill_ids, skill_score_map))
    plan.extend(("certification", item_id) for item_id in _sort_selected_ids_by_score_asc(cert_ids, cert_score_map))
    experience_removals = _sort_selected_ids_by_score_asc(experience_ids, experience_score_map)
    if len(experience_removals) > 1:
        plan.extend(("experience", item_id) for item_id in experience_removals[:-1])
    return plan

def _remove_snapshot_skill(snapshot: ResumePdfRenderSnapshot, item_id: str) -> bool:
    changed = False
    next_groups: List[SkillGroupViewSnapshot] = []
    for group in snapshot.selectedSkillGroups:
        next_skills = [skill for skill in group.skills if skill.id != item_id]
        if len(next_skills) != len(group.skills):
            changed = True
        if next_skills:
            next_groups.append(SkillGroupViewSnapshot(name=group.name, skills=next_skills))
    if changed:
        snapshot.selectedSkillGroups = next_groups
    return changed

def _remove_snapshot_certification(snapshot: ResumePdfRenderSnapshot, item_id: str) -> bool:
    next_items = [item for item in snapshot.sortedCertifications if item.id != item_id]
    if len(next_items) == len(snapshot.sortedCertifications):
        return False
    snapshot.sortedCertifications = next_items
    snapshot.selectedCertIds = [item.id for item in next_items]
    return True

def _remove_snapshot_experience(snapshot: ResumePdfRenderSnapshot, item_id: str) -> bool:
    current_ids = _snapshot_experience_ids(snapshot)
    if len(current_ids) <= 1:
        return False
    next_work_items = [item for item in snapshot.selectedWorkItems if item.id != item_id]
    next_project_items = [item for item in snapshot.selectedProjectItems if item.id != item_id]
    if (
        len(next_work_items) == len(snapshot.selectedWorkItems)
        and len(next_project_items) == len(snapshot.selectedProjectItems)
    ):
        return False
    snapshot.selectedWorkItems = next_work_items
    snapshot.selectedProjectItems = next_project_items
    return True

def _apply_snapshot_trim(snapshot: ResumePdfRenderSnapshot, target: Tuple[str, str]) -> bool:
    kind, item_id = target
    if kind == "skill":
        return _remove_snapshot_skill(snapshot, item_id)
    if kind == "certification":
        return _remove_snapshot_certification(snapshot, item_id)
    if kind == "experience":
        return _remove_snapshot_experience(snapshot, item_id)
    return False

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
    item_spacing_em = _layout_float(
        {"itemSpacingEm": snapshot.listSpacingValue.replace("em", "")},
        "itemSpacingEm",
        SMART_PAGE_ITEM_SPACING_DEFAULT,
    )
    section_spacing_key = _layout_section_spacing_key(
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
            "skillIds": _snapshot_skill_ids(snapshot),
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
            "orders": _snapshot_layout_orders(layout, snapshot),
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

def _resume_selection(config: Dict[str, Any]) -> Dict[str, Any]:
    selection = config.get("selection")
    return selection if isinstance(selection, dict) else {}

def _score_entry_id(entry: Any) -> str:
    if not isinstance(entry, dict):
        return ""
    return str(entry.get("id") or "").strip()

def _score_entry_score(entry: Any) -> int:
    if not isinstance(entry, dict):
        return 0
    return _clamp_score(entry.get("score"))

def _positive_experience_ids_by_score(entries: Any) -> List[str]:
    if not isinstance(entries, list):
        return []
    scored: List[Tuple[str, int, int]] = []
    for index, entry in enumerate(entries):
        item_id = _score_entry_id(entry)
        score = _score_entry_score(entry)
        if item_id and score > 0:
            scored.append((item_id, score, index))
    scored.sort(key=lambda item: (-item[1], item[2]))
    return [item_id for item_id, _score, _index in scored[:AUTO_ASSEMBLY_MAX_EXPERIENCES]]

def _threshold_match_ids(entries: Any) -> List[str]:
    if not isinstance(entries, list):
        return []
    selected: List[str] = []
    for entry in entries:
        item_id = _score_entry_id(entry)
        if item_id and _score_entry_score(entry) > AUTO_ASSEMBLY_MATCH_THRESHOLD:
            selected.append(item_id)
    return selected

def _selection_list(selection: Dict[str, Any], key: str) -> List[str]:
    value = selection.get(key)
    if not isinstance(value, list):
        return []
    return [str(item_id) for item_id in value if str(item_id or "").strip()]

def _merge_selected_ids(
    primary_ids: Iterable[str],
    fallback_ids: Iterable[str],
    limit: Optional[int] = None,
) -> List[str]:
    selected: List[str] = []
    seen: set[str] = set()
    for item_id in [*primary_ids, *fallback_ids]:
        normalized = str(item_id or "").strip()
        if not normalized or normalized in seen:
            continue
        selected.append(normalized)
        seen.add(normalized)
        if limit is not None and len(selected) >= limit:
            break
    return selected

def _agent_auto_assembly_selection(
    source_config: Any,
    analysis_result: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    if not isinstance(analysis_result, dict):
        return None
    experience_ids = _positive_experience_ids_by_score(analysis_result.get("experienceMatches"))
    if not experience_ids:
        return None

    config = source_config if isinstance(source_config, dict) else {}
    current_selection = _resume_selection(config)
    cert_ids = _merge_selected_ids(
        _threshold_match_ids(analysis_result.get("certificationMatches")),
        _selection_list(current_selection, "certificationIds"),
    )
    skill_ids = _merge_selected_ids(
        _threshold_match_ids(analysis_result.get("skillMatches")),
        _selection_list(current_selection, "skillIds"),
    )
    return {
        **deepcopy(current_selection),
        "experienceIds": _merge_selected_ids(
            experience_ids,
            _selection_list(current_selection, "experienceIds"),
            AUTO_ASSEMBLY_MAX_EXPERIENCES,
        ),
        **({"certificationIds": cert_ids} if cert_ids or "certificationIds" in current_selection else {}),
        **({"skillIds": skill_ids} if skill_ids or "skillIds" in current_selection else {}),
    }

def _resume_with_agent_auto_assembly_selection(
    resume: Resume,
    analysis_result: Optional[Dict[str, Any]],
) -> Any:
    config = getattr(resume, "config", None)
    selection = _agent_auto_assembly_selection(config, analysis_result)
    if selection is None:
        return resume
    next_config = deepcopy(config) if isinstance(config, dict) else {}
    next_config["selection"] = selection
    layout = next_config.get("layout") if isinstance(next_config.get("layout"), dict) else {}
    orders = deepcopy(layout.get("orders")) if isinstance(layout.get("orders"), dict) else {}
    experience_ids = selection.get("experienceIds") if isinstance(selection.get("experienceIds"), list) else []
    orders["workExperienceIds"] = experience_ids
    orders["projectExperienceIds"] = experience_ids
    next_config["layout"] = {
        **layout,
        "density": "compact",
        "isSmartPageApplied": True,
        "orders": orders,
    }
    return SimpleNamespace(
        id=getattr(resume, "id", None),
        title=getattr(resume, "title", None),
        target_role=getattr(resume, "target_role", None),
        config=next_config,
    )

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

def _selected_id_order(selection: Dict[str, Any], key: str) -> Optional[List[str]]:
    if key not in selection:
        return None
    value = selection.get(key)
    if not isinstance(value, list):
        return []
    ordered: List[str] = []
    used: set[str] = set()
    for raw_item in value:
        item_id = str(raw_item)
        if not item_id or item_id in used:
            continue
        used.add(item_id)
        ordered.append(item_id)
    return ordered

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

def _template_default_theme_color_preset_id(template_id: str) -> str:
    for template in AGENT_RESUME_TEMPLATE_OPTIONS:
        if template["id"] == template_id:
            return str(template["default_theme_color_preset_id"])
    return "slate"

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

def _merge_by_id(
    base_items: List[Any],
    preferred_items: List[Any],
    key_fn: Callable[[Any], str],
) -> List[Any]:
    preferred_by_id = {key_fn(item): item for item in preferred_items if key_fn(item)}
    used: set[str] = set()
    merged: List[Any] = []
    for item in base_items:
        item_id = key_fn(item)
        if item_id in preferred_by_id:
            merged.append(preferred_by_id[item_id])
            used.add(item_id)
        else:
            merged.append(item)
            if item_id:
                used.add(item_id)
    merged.extend(
        item
        for item in preferred_items
        if key_fn(item) and key_fn(item) not in used
    )
    return merged

def _merge_payloads_by_id(
    base_items: List[Dict[str, Any]],
    preferred_items: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    return _merge_by_id(base_items, preferred_items, lambda item: str(item.get("id") or ""))

def _apply_payload_order(
    items: List[Dict[str, Any]],
    order: Optional[List[str]],
) -> List[Dict[str, Any]]:
    return _apply_explicit_order(items, order, lambda item: str(item.get("id") or ""))

def _preferred_payload_order(
    layout_order: Any,
    fallback_order: Optional[List[str]],
) -> Optional[List[str]]:
    return layout_order if isinstance(layout_order, list) and layout_order else fallback_order

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
    selected_experience_order = _selected_id_order(selection, "experienceIds")
    selected_education_order = _selected_id_order(selection, "educationIds")
    layout_orders = _layout_orders_config(_resume_layout_config(config))
    work_experience_order = _preferred_payload_order(
        layout_orders.get("workExperienceIds"),
        selected_experience_order,
    )
    project_experience_order = _preferred_payload_order(
        layout_orders.get("projectExperienceIds"),
        selected_experience_order,
    )
    education_order = _preferred_payload_order(
        layout_orders.get("educationIds"),
        selected_education_order,
    )
    if resume_items is None:
        work_source = _filter_experience_rows_by_master_ids(bank["experiences"], selected_experience_ids)
        project_source = _filter_experience_rows_by_master_ids(bank["experiences"], selected_experience_ids)
        education_source = _filter_experience_rows_by_master_ids(bank["experiences"], selected_education_ids)
        work_experiences = _experiences_payload(work_source, ExperienceCategory.WORK)
        project_experiences = _experiences_payload(project_source, ExperienceCategory.PROJECT)
        education_experiences = _experiences_payload(education_source, ExperienceCategory.EDUCATION)
    else:
        category_map = _merged_category_map(bank["experiences"], category_by_master_id)
        resume_work_experiences = _resume_item_experience_payloads(
            resume_items,
            category_map,
            ExperienceCategory.WORK,
            selected_experience_ids,
        )
        resume_project_experiences = _resume_item_experience_payloads(
            resume_items,
            category_map,
            ExperienceCategory.PROJECT,
            selected_experience_ids,
        )
        resume_education_experiences = _resume_item_experience_payloads(
            resume_items,
            category_map,
            ExperienceCategory.EDUCATION,
            selected_education_ids,
        )
        if selected_experience_ids is None:
            work_experiences = resume_work_experiences
            project_experiences = resume_project_experiences
        else:
            work_experiences = _merge_payloads_by_id(
                _experiences_payload(
                    _filter_experience_rows_by_master_ids(bank["experiences"], selected_experience_ids),
                    ExperienceCategory.WORK,
                ),
                resume_work_experiences,
            )
            project_experiences = _merge_payloads_by_id(
                _experiences_payload(
                    _filter_experience_rows_by_master_ids(bank["experiences"], selected_experience_ids),
                    ExperienceCategory.PROJECT,
                ),
                resume_project_experiences,
            )
        if selected_education_ids is None:
            education_experiences = resume_education_experiences
        else:
            education_experiences = _merge_payloads_by_id(
                _experiences_payload(
                    _filter_experience_rows_by_master_ids(bank["experiences"], selected_education_ids),
                    ExperienceCategory.EDUCATION,
                ),
                resume_education_experiences,
            )
    work_experiences = _apply_payload_order(work_experiences, work_experience_order)
    project_experiences = _apply_payload_order(project_experiences, project_experience_order)
    education_experiences = _apply_payload_order(education_experiences, education_order)
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
                major=_education_major(getattr(experience, "title", ""), star, getattr(experience, "summary", "")),
                degree=str(star.get("degree") or ""),
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

def _merge_experience_snapshots_by_id(
    base_items: List[ResumeExperienceViewSnapshot],
    preferred_items: List[ResumeExperienceViewSnapshot],
) -> List[ResumeExperienceViewSnapshot]:
    return _merge_by_id(base_items, preferred_items, lambda item: item.id)

def _merge_education_snapshots_by_id(
    base_items: List[EducationViewSnapshot],
    preferred_items: List[EducationViewSnapshot],
) -> List[EducationViewSnapshot]:
    return _merge_by_id(base_items, preferred_items, lambda item: item.id)

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

def _snapshot_layout_orders(
    layout: Dict[str, Any],
    snapshot: ResumePdfRenderSnapshot,
) -> Dict[str, Any]:
    source_orders = layout.get("orders") if isinstance(layout.get("orders"), dict) else {}
    return {
        **deepcopy(source_orders),
        "workExperienceIds": [item.id for item in snapshot.selectedWorkItems],
        "projectExperienceIds": [item.id for item in snapshot.selectedProjectItems],
        "educationIds": snapshot.selectedEduIds,
        "certificationIds": snapshot.selectedCertIds,
        "skillGroupNames": [group.name for group in snapshot.selectedSkillGroups],
    }

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
        selected_experience_ids = _selected_ids(selection, "experienceIds")
        resume_work_items = _resume_item_experience_snapshots(resume_items, category_map, ExperienceCategory.WORK)
        resume_project_items = _resume_item_experience_snapshots(resume_items, category_map, ExperienceCategory.PROJECT)
        resume_educations = _resume_item_education_snapshots(resume_items, category_map)
        if selected_experience_ids is None:
            work_items = resume_work_items
            project_items = resume_project_items
        else:
            work_items = _merge_experience_snapshots_by_id(
                _filter_experience_snapshots(
                    _experience_snapshots(experiences, ExperienceCategory.WORK),
                    selected_experience_ids,
                ),
                _filter_experience_snapshots(resume_work_items, selected_experience_ids),
            )
            project_items = _merge_experience_snapshots_by_id(
                _filter_experience_snapshots(
                    _experience_snapshots(experiences, ExperienceCategory.PROJECT),
                    selected_experience_ids,
                ),
                _filter_experience_snapshots(resume_project_items, selected_experience_ids),
            )
        selected_education_ids = _selected_ids(selection, "educationIds")
        if selected_education_ids is None:
            educations = resume_educations
        else:
            educations = _merge_education_snapshots_by_id(
                _filter_educations(_education_snapshots(experiences), selected_education_ids),
                _filter_educations(resume_educations, selected_education_ids),
            )
    selected_experience_ids = _selected_ids(selection, "experienceIds")
    selected_experience_order = _selected_id_order(selection, "experienceIds")
    work_items = _filter_experience_snapshots(work_items, selected_experience_ids)
    project_items = _filter_experience_snapshots(project_items, selected_experience_ids)
    educations = _filter_educations(educations, _selected_ids(selection, "educationIds"))
    work_items = _apply_explicit_order(work_items, selected_experience_order, lambda item: item.id)
    project_items = _apply_explicit_order(project_items, selected_experience_order, lambda item: item.id)
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
        themeColorPresetId=_template_layout_value(
            layout,
            template_preset,
            "themeColorPresetId",
            _template_default_theme_color_preset_id(template_id),
        ),
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
        item = _version_payload(version)
        item["id"] = str(getattr(master, "id", getattr(version, "id", "")))
        payload.append(item)
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

def _education_major(title: Any, star: Dict[str, Any], summary: Any) -> str:
    title_text = str(title or "")
    degree_text = str(star.get("degree") or "")
    if title_text and title_text != degree_text:
        return title_text
    return str(star.get("major") or summary or "")

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
                major=_education_major(getattr(version, "title", ""), star, getattr(version, "summary", "")),
                degree=str(star.get("degree") or ""),
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
