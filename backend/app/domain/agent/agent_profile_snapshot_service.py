from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional

from ..export.schemas import ResumeEditorProfileSnapshot, ResumePdfRenderSnapshot
from .agent_option_helpers import AGENT_RESUME_TEMPLATE_OPTIONS


PROFILE_TEMPLATE_PRESETS_KEY = "resumeTemplatePresets"


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
