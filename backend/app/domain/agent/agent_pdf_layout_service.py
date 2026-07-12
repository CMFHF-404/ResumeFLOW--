from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from ..export.schemas import ResumePdfRenderSnapshot

if TYPE_CHECKING:
    from .agent_key_service import AgentGenerateOptions


SMART_ONE_PAGE_LINE_HEIGHT = 1.35
SMART_ONE_PAGE_FONT_SIZE = 13
SMART_ONE_PAGE_TOP_PADDING_PX = 15
SMART_ONE_PAGE_ITEM_SPACING_EM = 0.25
SMART_ONE_PAGE_SECTION_SPACING_KEY = 2
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


def _layout_section_spacing_key(
    layout: Dict[str, Any],
    fallback: int = SMART_PAGE_SECTION_SPACING_DEFAULT_KEY,
) -> int:
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


def _apply_snapshot_layout(
    snapshot: ResumePdfRenderSnapshot,
    values: Dict[str, Any],
) -> ResumePdfRenderSnapshot:
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
