from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.utcnow()


def utc_now_aware() -> datetime:
    return datetime.now(timezone.utc)
