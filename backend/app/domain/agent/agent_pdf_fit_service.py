from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from ..export.schemas import ResumePdfRenderSnapshot
from .agent_pdf_layout_service import (
    SMART_PAGE_ITEM_SPACING_DEFAULT,
    _apply_snapshot_layout,
    _expand_snapshot_layout_candidates,
    _hard_fallback_snapshot_layout,
    _layout_float,
    _layout_section_spacing_key,
)
from .agent_pdf_trim_service import _apply_snapshot_trim, _build_snapshot_trim_plan

SnapshotPageCount = Callable[[ResumePdfRenderSnapshot], Awaitable[int]]
SnapshotTrimPlan = Callable[[ResumePdfRenderSnapshot, Optional[Dict[str, Any]]], List[Tuple[str, str]]]
SnapshotTrim = Callable[[ResumePdfRenderSnapshot, Tuple[str, str]], bool]
SnapshotLayoutApply = Callable[[ResumePdfRenderSnapshot, Dict[str, Any]], ResumePdfRenderSnapshot]
SnapshotLayoutCandidates = Callable[[Dict[str, Any]], List[Dict[str, Any]]]
SnapshotLayoutFactory = Callable[[], Dict[str, Any]]
SnapshotLayoutFloat = Callable[[Dict[str, Any], str, float], float]
SnapshotSectionSpacingKey = Callable[[Dict[str, Any]], int]


async def fit_snapshot_to_one_page(
    snapshot: ResumePdfRenderSnapshot,
    analysis_result: Optional[Dict[str, Any]],
    *,
    enabled: bool,
    render_page_count: SnapshotPageCount,
    build_trim_plan: Optional[SnapshotTrimPlan] = None,
    apply_trim: Optional[SnapshotTrim] = None,
    apply_layout: Optional[SnapshotLayoutApply] = None,
    expand_layout_candidates: Optional[SnapshotLayoutCandidates] = None,
    hard_fallback_layout: Optional[SnapshotLayoutFactory] = None,
    layout_float: Optional[SnapshotLayoutFloat] = None,
    layout_section_spacing_key: Optional[SnapshotSectionSpacingKey] = None,
    item_spacing_default: float = SMART_PAGE_ITEM_SPACING_DEFAULT,
) -> ResumePdfRenderSnapshot:
    if not enabled:
        return snapshot
    build_trim_plan = build_trim_plan or _build_snapshot_trim_plan
    apply_trim = apply_trim or _apply_snapshot_trim
    apply_layout = apply_layout or _apply_snapshot_layout
    expand_layout_candidates = expand_layout_candidates or _expand_snapshot_layout_candidates
    hard_fallback_layout = hard_fallback_layout or _hard_fallback_snapshot_layout
    layout_float = layout_float or _layout_float
    layout_section_spacing_key = layout_section_spacing_key or _layout_section_spacing_key
    working_snapshot = snapshot.model_copy(deep=True)
    trim_plan = build_trim_plan(working_snapshot, analysis_result)
    plan_index = 0

    async def fit_current_content() -> Tuple[bool, ResumePdfRenderSnapshot]:
        base_snapshot = working_snapshot.model_copy(deep=True)
        if await render_page_count(base_snapshot) <= 1:
            best_snapshot = base_snapshot
            default_layout = {
                "lineHeight": base_snapshot.lineHeight,
                "fontSize": base_snapshot.fontSize,
                "itemSpacingEm": layout_float(
                    {"itemSpacingEm": base_snapshot.listSpacingValue.replace("em", "")},
                    "itemSpacingEm",
                    item_spacing_default,
                ),
                "topPaddingPx": base_snapshot.topPaddingPx,
                "sectionSpacingKey": layout_section_spacing_key(
                    {"sectionSpacingClass": base_snapshot.sectionSpacingClass},
                ),
            }
            for candidate_layout in expand_layout_candidates(default_layout):
                candidate_snapshot = apply_layout(
                    base_snapshot.model_copy(deep=True),
                    candidate_layout,
                )
                if await render_page_count(candidate_snapshot) <= 1:
                    best_snapshot = candidate_snapshot
            return True, best_snapshot

        compact_snapshot = apply_layout(
            base_snapshot.model_copy(deep=True),
            hard_fallback_layout(),
        )
        if await render_page_count(compact_snapshot) <= 1:
            return True, compact_snapshot
        return False, compact_snapshot

    while True:
        fits, fitted_snapshot = await fit_current_content()
        if fits:
            return fitted_snapshot
        if plan_index >= len(trim_plan):
            return fitted_snapshot
        if apply_trim(working_snapshot, trim_plan[plan_index]):
            plan_index += 1
            continue
        plan_index += 1
