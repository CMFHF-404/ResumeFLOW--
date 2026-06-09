from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple

from ..export.schemas import ResumePdfRenderSnapshot, SkillGroupViewSnapshot


def _analysis_score_map(entries: Any) -> Dict[str, int]:
    from . import agent_pdf_helpers

    if not isinstance(entries, list):
        return {}
    result: Dict[str, int] = {}
    for entry in entries:
        item_id = agent_pdf_helpers._score_entry_id(entry)
        if item_id:
            result[item_id] = agent_pdf_helpers._score_entry_score(entry)
    return result


def _sort_selected_ids_by_score_asc(ids: Iterable[str], score_map: Dict[str, int]) -> List[str]:
    return sorted(
        [item_id for item_id in ids if item_id],
        key=lambda item_id: (score_map.get(item_id, 0), item_id),
    )


def _snapshot_experience_ids(snapshot: ResumePdfRenderSnapshot) -> List[str]:
    return [item.id for item in [*snapshot.selectedWorkItems, *snapshot.selectedProjectItems] if item.id]


def _build_snapshot_trim_plan(
    snapshot: ResumePdfRenderSnapshot,
    analysis_result: Optional[Dict[str, Any]],
) -> List[Tuple[str, str]]:
    from . import agent_pdf_helpers

    analysis = analysis_result if isinstance(analysis_result, dict) else {}
    plan: List[Tuple[str, str]] = []
    skill_score_map = _analysis_score_map(analysis.get("skillMatches"))
    cert_score_map = _analysis_score_map(analysis.get("certificationMatches"))
    experience_score_map = _analysis_score_map(analysis.get("experienceMatches"))
    skill_ids = agent_pdf_helpers._snapshot_skill_ids(snapshot)
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
