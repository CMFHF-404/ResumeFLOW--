from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .agent_score_projection import _score_entry_id, _score_entry_score


AUTO_ASSEMBLY_MAX_EXPERIENCES = 3
AUTO_ASSEMBLY_MATCH_THRESHOLD = 80


def _resume_selection(config: Dict[str, Any]) -> Dict[str, Any]:
    selection = config.get("selection")
    return selection if isinstance(selection, dict) else {}


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


def _build_agent_auto_assembly_selection(
    source_config: Any,
    analysis_result: Optional[Dict[str, Any]],
    *,
    positive_experience_ids_by_score=_positive_experience_ids_by_score,
    threshold_match_ids=_threshold_match_ids,
    resume_selection=_resume_selection,
    selection_list=_selection_list,
    merge_selected_ids=_merge_selected_ids,
) -> Optional[Dict[str, Any]]:
    if not isinstance(analysis_result, dict):
        return None
    experience_ids = positive_experience_ids_by_score(analysis_result.get("experienceMatches"))
    if not experience_ids:
        return None

    config = source_config if isinstance(source_config, dict) else {}
    current_selection = resume_selection(config)
    cert_ids = merge_selected_ids(
        threshold_match_ids(analysis_result.get("certificationMatches")),
        selection_list(current_selection, "certificationIds"),
    )
    skill_ids = merge_selected_ids(
        threshold_match_ids(analysis_result.get("skillMatches")),
        selection_list(current_selection, "skillIds"),
    )
    return {
        **deepcopy(current_selection),
        "experienceIds": merge_selected_ids(
            experience_ids,
            selection_list(current_selection, "experienceIds"),
            AUTO_ASSEMBLY_MAX_EXPERIENCES,
        ),
        **({"certificationIds": cert_ids} if cert_ids or "certificationIds" in current_selection else {}),
        **({"skillIds": skill_ids} if skill_ids or "skillIds" in current_selection else {}),
    }


def _agent_auto_assembly_selection(
    source_config: Any,
    analysis_result: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    return _build_agent_auto_assembly_selection(source_config, analysis_result)


def _build_resume_with_agent_auto_assembly_selection(
    resume: Any,
    analysis_result: Optional[Dict[str, Any]],
    *,
    agent_auto_assembly_selection=_agent_auto_assembly_selection,
) -> Any:
    config = getattr(resume, "config", None)
    selection = agent_auto_assembly_selection(config, analysis_result)
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


def _resume_with_agent_auto_assembly_selection(
    resume: Any,
    analysis_result: Optional[Dict[str, Any]],
) -> Any:
    return _build_resume_with_agent_auto_assembly_selection(resume, analysis_result)
