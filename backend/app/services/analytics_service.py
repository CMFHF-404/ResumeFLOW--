from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from ..utils.posthog_client import get_posthog_client

DEFAULT_LOOKBACK_DAYS = 7
DEFAULT_POSITION_COUNT = 6

EVENT_PAGE_VIEW = "page_view"
EVENT_SIGN_UP_SUCCESS = "sign_up_success"
EVENT_FIRST_EXPERIENCE_CREATED = "first_experience_created"
EVENT_RESUME_EXPORTED = "resume_exported"
EVENT_AI_POLISH_RESULT = "ai_polish_result"
EVENT_JD_ANALYSIS_COMPLETE = "jd_analysis_complete"
EVENT_LAYOUT_MODE_CHANGE = "layout_mode_change"
EVENT_SMART_ONE_PAGE = "smart_one_page_triggered"
EVENT_MODULE_REORDERED = "module_reordered"
PROPERTY_VIEW = "view"
LANDING_VIEW = "DASHBOARD"

POLISH_ACTIONS = ("applied", "edited", "discarded")
MATCH_SCORE_BUCKETS: List[Tuple[int, int]] = [
    (0, 20),
    (20, 40),
    (40, 60),
    (60, 80),
    (80, 101),
]

DEFAULT_LAYOUT_MODES = ("compact", "standard", "spacious")
DEFAULT_MODULE_KEYS = (
    "experience:work",
    "experience:project",
    "education",
    "certification",
    "skill_group",
    "section:work",
    "section:project",
    "section:education",
    "section:certifications",
    "section:skills",
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _format_date(value: datetime) -> str:
    return value.strftime("%Y-%m-%d")


def _build_date_series(days: int) -> List[str]:
    today = _utc_now().date()
    dates: List[str] = []
    for offset in range(days - 1, -1, -1):
        date_value = datetime.combine(today - timedelta(days=offset), datetime.min.time())
        dates.append(_format_date(date_value))
    return dates


def _format_in_list(values: Iterable[str]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def _build_hogql_payload(query: str) -> Dict[str, Any]:
    return {"query": {"kind": "HogQLQuery", "query": query}}


async def _run_hogql(query: str) -> Optional[List[Any]]:
    client = get_posthog_client()
    if not client:
        return None
    return await client.query(_build_hogql_payload(query))


async def _fetch_event_counts(event_names: Sequence[str], days: int) -> Optional[Dict[str, int]]:
    in_list = _format_in_list(event_names)
    query = (
        "select event, count() "
        "from events "
        f"where event in ({in_list}) "
        f"and timestamp >= now() - interval {days} day "
        "group by event"
    )
    rows = await _run_hogql(query)
    if not rows:
        return None
    return {str(row[0]): int(row[1]) for row in rows if len(row) >= 2}


async def _fetch_event_count_with_property(
    event_name: str,
    property_key: str,
    property_value: str,
    days: int,
) -> Optional[int]:
    query = (
        "select count() "
        "from events "
        f"where event = '{event_name}' "
        f"and timestamp >= now() - interval {days} day "
        f"and properties['{property_key}'] = '{property_value}'"
    )
    rows = await _run_hogql(query)
    if not rows:
        return None
    first = rows[0] if isinstance(rows, list) and rows else None
    if not first:
        return None
    count = first[0] if isinstance(first, (list, tuple)) and first else first
    try:
        return int(count)
    except (TypeError, ValueError):
        return None


async def _fetch_property_counts(
    event_name: str, property_key: str, days: int
) -> Optional[Dict[str, int]]:
    query = (
        f"select properties['{property_key}'] as prop, count() "
        "from events "
        f"where event = '{event_name}' "
        f"and timestamp >= now() - interval {days} day "
        "group by prop"
    )
    rows = await _run_hogql(query)
    if not rows:
        return None
    counts: Dict[str, int] = {}
    for row in rows:
        if len(row) < 2:
            continue
        key = str(row[0]) if row[0] is not None else "unknown"
        counts[key] = int(row[1])
    return counts


async def _fetch_daily_counts(event_name: str, days: int) -> Optional[Dict[str, int]]:
    query = (
        "select toDate(timestamp) as day, count() "
        "from events "
        f"where event = '{event_name}' "
        f"and timestamp >= now() - interval {days} day "
        "group by day "
        "order by day"
    )
    rows = await _run_hogql(query)
    if not rows:
        return None
    return {str(row[0]): int(row[1]) for row in rows if len(row) >= 2}


async def _fetch_daily_percentiles(
    event_name: str,
    property_key: str,
    days: int,
) -> Optional[Dict[str, Dict[str, float]]]:
    query = (
        "select toDate(timestamp) as day, "
        f"quantile(0.5)(toFloat64(properties['{property_key}'])) as p50, "
        f"quantile(0.95)(toFloat64(properties['{property_key}'])) as p95, "
        f"quantile(0.99)(toFloat64(properties['{property_key}'])) as p99 "
        "from events "
        f"where event = '{event_name}' "
        f"and timestamp >= now() - interval {days} day "
        "group by day "
        "order by day"
    )
    rows = await _run_hogql(query)
    if not rows:
        return None
    return {
        str(row[0]): {
            "p50": float(row[1] or 0),
            "p95": float(row[2] or 0),
            "p99": float(row[3] or 0),
        }
        for row in rows
        if len(row) >= 4
    }


async def _fetch_score_distribution(days: int) -> Optional[Dict[str, int]]:
    cases = []
    for lower, upper in MATCH_SCORE_BUCKETS:
        label = f"{lower}-{upper if upper < 101 else 100}"
        cases.append(f"when score >= {lower} and score < {upper} then '{label}'")
    case_expr = "case " + " ".join(cases) + " else 'unknown' end"
    query = (
        "select " + case_expr + " as bucket, count() "
        "from (select toFloat64(properties['match_score']) as score from events "
        f"where event = '{EVENT_JD_ANALYSIS_COMPLETE}' "
        f"and timestamp >= now() - interval {days} day) "
        "group by bucket"
    )
    rows = await _run_hogql(query)
    if not rows:
        return None
    return {str(row[0]): int(row[1]) for row in rows if len(row) >= 2}


async def _fetch_module_reorder_heatmap(
    days: int,
) -> Optional[List[Tuple[str, int, int]]]:
    query = (
        "select properties['module_key'] as module_key, "
        "toInt64OrNull(properties['to_position']) as position, "
        "count() "
        "from events "
        f"where event = '{EVENT_MODULE_REORDERED}' "
        f"and timestamp >= now() - interval {days} day "
        "group by module_key, position"
    )
    rows = await _run_hogql(query)
    if not rows:
        return None
    results: List[Tuple[str, int, int]] = []
    for row in rows:
        if len(row) < 3:
            continue
        module_key = str(row[0]) if row[0] is not None else "unknown"
        position = int(row[1]) if row[1] is not None else 0
        count = int(row[2])
        results.append((module_key, position, count))
    return results


def _build_funnel_steps(counts: Optional[Dict[str, int]]) -> List[Dict[str, Any]]:
    steps = [
        {"name": "访问落地页", "event": EVENT_PAGE_VIEW},
        {"name": "注册成功", "event": EVENT_SIGN_UP_SUCCESS},
        {"name": "创建首条经历", "event": EVENT_FIRST_EXPERIENCE_CREATED},
        {"name": "导出 PDF", "event": EVENT_RESUME_EXPORTED},
    ]
    resolved = []
    previous = None
    for step in steps:
        count = counts.get(step["event"], 0) if counts else 0
        conversion = 0.0 if previous in (None, 0) else count / previous
        dropoff = 0.0 if previous in (None, 0) else max(0.0, 1 - conversion)
        resolved.append(
            {
                "name": step["name"],
                "event": step["event"],
                "count": count,
                "conversion_rate": round(conversion, 4),
                "dropoff_rate": round(dropoff, 4),
            }
        )
        previous = count
    return resolved


def _build_action_distribution(counts: Optional[Dict[str, int]]) -> List[Dict[str, Any]]:
    return [
        {"action": action, "count": int(counts.get(action, 0) if counts else 0)}
        for action in POLISH_ACTIONS
    ]


def _build_score_distribution(counts: Optional[Dict[str, int]]) -> List[Dict[str, Any]]:
    entries = []
    for lower, upper in MATCH_SCORE_BUCKETS:
        label = f"{lower}-{upper if upper < 101 else 100}"
        entries.append({"range": label, "count": int(counts.get(label, 0) if counts else 0)})
    return entries


def _build_latency_series(
    series: Optional[Dict[str, Dict[str, float]]], days: int
) -> List[Dict[str, Any]]:
    dates = _build_date_series(days)
    resolved = []
    for day in dates:
        metrics = series.get(day, {}) if series else {}
        resolved.append(
            {
                "date": day,
                "p50": float(metrics.get("p50", 0)),
                "p95": float(metrics.get("p95", 0)),
                "p99": float(metrics.get("p99", 0)),
            }
        )
    return resolved


def _build_layout_distribution(counts: Optional[Dict[str, int]]) -> List[Dict[str, Any]]:
    return [
        {"mode": mode, "count": int(counts.get(mode, 0) if counts else 0)}
        for mode in DEFAULT_LAYOUT_MODES
    ]


def _build_smart_page_series(
    series: Optional[Dict[str, int]], days: int
) -> List[Dict[str, Any]]:
    dates = _build_date_series(days)
    return [{"date": day, "count": int(series.get(day, 0) if series else 0)} for day in dates]


def _build_heatmap_payload(
    rows: Optional[List[Tuple[str, int, int]]],
    position_count: int,
) -> Dict[str, Any]:
    modules = list(DEFAULT_MODULE_KEYS)
    positions = [str(index + 1) for index in range(position_count)]
    values: List[List[int]] = []
    module_index = {module: idx for idx, module in enumerate(modules)}
    if rows:
        for module_key, position, count in rows:
            module = module_key if module_key in module_index else "unknown"
            if module not in module_index:
                module_index[module] = len(modules)
                modules.append(module)
            if position <= 0:
                continue
            position_idx = min(position_count, position) - 1
            values.append([position_idx, module_index[module], count])
    return {"modules": modules, "positions": positions, "values": values}


async def get_funnel_data(lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> Dict[str, Any]:
    counts = await _fetch_event_counts(
        [
            EVENT_PAGE_VIEW,
            EVENT_SIGN_UP_SUCCESS,
            EVENT_FIRST_EXPERIENCE_CREATED,
            EVENT_RESUME_EXPORTED,
        ],
        lookback_days,
    )
    landing_count = await _fetch_event_count_with_property(
        EVENT_PAGE_VIEW,
        PROPERTY_VIEW,
        LANDING_VIEW,
        lookback_days,
    )
    if landing_count is not None:
        resolved = dict(counts or {})
        resolved[EVENT_PAGE_VIEW] = landing_count
        counts = resolved
    return {
        "updated_at": _utc_now().isoformat(),
        "steps": _build_funnel_steps(counts),
    }


async def get_ai_quality_data(lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> Dict[str, Any]:
    action_counts = await _fetch_property_counts(
        EVENT_AI_POLISH_RESULT, "action", lookback_days
    )
    score_counts = await _fetch_score_distribution(lookback_days)
    latency_series = await _fetch_daily_percentiles(
        EVENT_AI_POLISH_RESULT, "duration_ms", lookback_days
    )
    return {
        "updated_at": _utc_now().isoformat(),
        "polish_actions": _build_action_distribution(action_counts),
        "match_score_distribution": _build_score_distribution(score_counts),
        "latency_series": _build_latency_series(latency_series, lookback_days),
    }


async def get_editor_ux_data(lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> Dict[str, Any]:
    layout_counts = await _fetch_property_counts(
        EVENT_LAYOUT_MODE_CHANGE, "to", lookback_days
    )
    smart_page_series = await _fetch_daily_counts(EVENT_SMART_ONE_PAGE, lookback_days)
    heatmap_rows = await _fetch_module_reorder_heatmap(lookback_days)
    return {
        "updated_at": _utc_now().isoformat(),
        "layout_modes": _build_layout_distribution(layout_counts),
        "smart_one_page_series": _build_smart_page_series(
            smart_page_series, lookback_days
        ),
        "module_reorder_heatmap": _build_heatmap_payload(
            heatmap_rows, DEFAULT_POSITION_COUNT
        ),
    }
