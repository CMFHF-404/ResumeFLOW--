from __future__ import annotations

import io
import json
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from pypdf import PdfReader

from ...models import ExperienceCategory
from ..export.schemas import (
    EducationViewSnapshot,
    ResumeExperienceViewSnapshot,
    ResumePdfRenderSnapshot,
    StarFields,
)
from ..resume.models import Resume
from ..resume.resume_schema import ResumeExperienceItem
from .agent_common_helpers import (
    _as_experience_category,
    _date_to_str,
    _hash_agent_text,
    _now_aware,
)
from .agent_auto_assembly_service import AUTO_ASSEMBLY_MAX_EXPERIENCES
from .agent_pdf_layout_service import (
    CSS_PX_PER_MM,
    FONT_SIZE_DEFAULT,
    FONT_SIZE_MAX,
    LINE_HEIGHT_DEFAULT,
    LINE_HEIGHT_MAX,
    PREVIEW_PADDING_MM,
    SMART_ONE_PAGE_FONT_SIZE,
    SMART_ONE_PAGE_ITEM_SPACING_EM,
    SMART_ONE_PAGE_LINE_HEIGHT,
    SMART_ONE_PAGE_SECTION_SPACING_KEY,
    SMART_ONE_PAGE_TOP_PADDING_PX,
    SMART_PAGE_ITEM_SPACING_DEFAULT,
    SMART_PAGE_ITEM_SPACING_MAX,
    SMART_PAGE_SECTION_SPACING_CLASS_BY_KEY,
    SMART_PAGE_SECTION_SPACING_DEFAULT_KEY,
    SMART_PAGE_SECTION_SPACING_STEPS,
    SMART_PAGE_TOP_PADDING_DEFAULT_PX,
    SMART_PAGE_TOP_PADDING_MAX_PX,
    SMART_PAGE_TOP_PADDING_STEP_PX,
    _apply_snapshot_layout,
    _expand_snapshot_layout_candidates,
    _hard_fallback_snapshot_layout,
    _layout_float,
    _layout_section_spacing_key,
    _resolve_snapshot_layout,
    _snapshot_layout_values,
    _spacing_value,
)
from .agent_pdf_snapshot_projection import _snapshot_skill_ids
from .agent_score_projection import _score_entry_id, _score_entry_score
from .agent_generated_resume_config import (
    GeneratedResumeConfigOps,
    _build_agent_generated_resume_config as _build_generated_resume_config,
    _build_agent_jd_analysis_config as _build_generated_jd_analysis_config,
)
from .agent_profile_snapshot_service import (
    _layout_orders_config,
    _profile_payload,
    _profile_payload_for_resume,
    _profile_snapshot,
    _profile_template_preset,
    _resume_layout_config,
    _resume_personal_summary_override,
    _resume_profile_config,
    _resume_summary_visible,
    _snapshot_layout_orders,
    _template_default_theme_color_preset_id,
    _template_layout_value,
    _template_section_order,
)
from .agent_resume_item_snapshot_service import (
    _build_education_snapshots,
    _build_experience_snapshots,
    _build_experiences_payload,
    _build_resume_item_education_snapshots,
    _build_resume_item_experience_snapshots,
    _certification_snapshots,
    _certifications_payload,
    _education_major,
    _skill_group_snapshots,
    _skills_payload,
    _star_fields,
    _version_payload,
)
from .schemas import AgentJobAnalysisResponse, AgentJobGenerateRequest
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

def _pdf_page_count(pdf_bytes: bytes) -> int:
    return len(PdfReader(io.BytesIO(pdf_bytes)).pages)

def _snapshot_experience_star_overrides(snapshot: ResumePdfRenderSnapshot) -> Dict[str, Dict[str, Any]]:
    return {
        item.id: item.star.model_dump(mode="json")
        for item in [*snapshot.selectedWorkItems, *snapshot.selectedProjectItems]
        if item.id
    }

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
    return _build_resume_item_experience_snapshots(
        rows,
        category_by_master_id,
        category,
        star_fields=_star_fields,
    )

def _resume_item_education_snapshots(
    rows: List[ResumeExperienceItem],
    category_by_master_id: Dict[str, ExperienceCategory],
) -> List[EducationViewSnapshot]:
    return _build_resume_item_education_snapshots(
        rows,
        category_by_master_id,
        education_major=_education_major,
    )

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

def _experiences_payload(rows: List[Tuple[Any, Any]], category: ExperienceCategory) -> List[Dict[str, Any]]:
    return _build_experiences_payload(rows, category, version_payload=_version_payload)


def _experience_snapshots(rows: List[Tuple[Any, Any]], category: ExperienceCategory) -> List[ResumeExperienceViewSnapshot]:
    return _build_experience_snapshots(rows, category, star_fields=_star_fields)


def _education_snapshots(rows: List[Tuple[Any, Any]]) -> List[EducationViewSnapshot]:
    return _build_education_snapshots(rows, education_major=_education_major)

def _resume_selection(config: Dict[str, Any]) -> Dict[str, Any]:
    from .agent_auto_assembly_service import _resume_selection as read_selection

    return read_selection(config)


def _positive_experience_ids_by_score(entries: Any) -> List[str]:
    from .agent_auto_assembly_service import _positive_experience_ids_by_score as select_ids

    return select_ids(entries)


def _threshold_match_ids(entries: Any) -> List[str]:
    from .agent_auto_assembly_service import _threshold_match_ids as select_ids

    return select_ids(entries)


def _selection_list(selection: Dict[str, Any], key: str) -> List[str]:
    from .agent_auto_assembly_service import _selection_list as read_list

    return read_list(selection, key)


def _merge_selected_ids(
    primary_ids: Iterable[str],
    fallback_ids: Iterable[str],
    limit: Optional[int] = None,
) -> List[str]:
    from .agent_auto_assembly_service import _merge_selected_ids as merge_ids

    return merge_ids(primary_ids, fallback_ids, limit)


def _agent_auto_assembly_selection(
    source_config: Any,
    analysis_result: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    from .agent_auto_assembly_service import _build_agent_auto_assembly_selection

    return _build_agent_auto_assembly_selection(
        source_config,
        analysis_result,
        positive_experience_ids_by_score=_positive_experience_ids_by_score,
        threshold_match_ids=_threshold_match_ids,
        resume_selection=_resume_selection,
        selection_list=_selection_list,
        merge_selected_ids=_merge_selected_ids,
    )


def _resume_with_agent_auto_assembly_selection(
    resume: Resume,
    analysis_result: Optional[Dict[str, Any]],
) -> Any:
    from .agent_auto_assembly_service import _build_resume_with_agent_auto_assembly_selection

    return _build_resume_with_agent_auto_assembly_selection(
        resume,
        analysis_result,
        agent_auto_assembly_selection=_agent_auto_assembly_selection,
    )


def _build_agent_jd_analysis_config(
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
) -> Dict[str, Any]:
    return _build_generated_jd_analysis_config(
        payload,
        analysis,
        ops=_legacy_generated_resume_config_ops(),
    )


def _legacy_generated_resume_config_ops() -> GeneratedResumeConfigOps:
    return GeneratedResumeConfigOps(
        hash_agent_text=_hash_agent_text,
        now_aware=_now_aware,
        layout_float=_layout_float,
        item_spacing_default=SMART_PAGE_ITEM_SPACING_DEFAULT,
        layout_section_spacing_key=_layout_section_spacing_key,
        snapshot_skill_ids=_snapshot_skill_ids,
        snapshot_layout_orders=_snapshot_layout_orders,
    )


def _build_agent_generated_resume_config(
    source_config: Any,
    snapshot: ResumePdfRenderSnapshot,
    payload: AgentJobGenerateRequest,
    analysis: AgentJobAnalysisResponse,
) -> Dict[str, Any]:
    return _build_generated_resume_config(
        source_config,
        snapshot,
        payload,
        analysis,
        build_jd_analysis_config=_build_agent_jd_analysis_config,
        ops=_legacy_generated_resume_config_ops(),
    )
