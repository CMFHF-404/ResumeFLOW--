from __future__ import annotations

from datetime import date, datetime
import re
from typing import Any, Optional


PRESENT_DATE_MARKERS = {
    "present",
    "current",
    "now",
    "ongoing",
    "至今",
    "当前",
    "现在",
    "目前",
}


def is_blank_or_present_date(value: Any) -> bool:
    if value is None:
        return True
    text = str(value).strip()
    return not text or text.lower() in PRESENT_DATE_MARKERS


def coerce_month_date(value: Any) -> Optional[date]:
    if is_blank_or_present_date(value):
        return None

    if isinstance(value, datetime):
        return date(value.year, value.month, 1)
    if isinstance(value, date):
        return date(value.year, value.month, 1)

    text = str(value).strip()
    normalized = (
        text.replace("年", "-")
        .replace("月", "-")
        .replace("日", "")
        .replace(".", "-")
        .replace("/", "-")
    )
    normalized = re.sub(r"\s+", "", normalized)
    normalized = re.sub(r"-+$", "", normalized)
    match = re.match(r"^(\d{4})(?:-(\d{1,2})(?:-\d{1,2})?)?$", normalized)
    if not match:
        return None

    year = int(match.group(1))
    month = int(match.group(2) or "1")
    if month < 1 or month > 12:
        return None
    return date(year, month, 1)


def normalize_month_date_string(value: Any) -> Optional[str]:
    normalized = coerce_month_date(value)
    return normalized.isoformat() if normalized else None
