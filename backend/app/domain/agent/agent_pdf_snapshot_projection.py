from __future__ import annotations

from typing import List

from ..export.schemas import ResumePdfRenderSnapshot


def _snapshot_skill_ids(snapshot: ResumePdfRenderSnapshot) -> List[str]:
    ids: List[str] = []
    for group in snapshot.selectedSkillGroups:
        ids.extend(skill.id for skill in group.skills if skill.id)
    return ids
