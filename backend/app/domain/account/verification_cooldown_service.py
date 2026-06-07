from __future__ import annotations

import asyncio
from dataclasses import dataclass
import math
import time

VERIFICATION_CODE_COOLDOWN_SECONDS = 60
CHINA_MAINLAND_PHONE_PATTERN_LENGTH = 11


@dataclass(frozen=True)
class VerificationCodeCooldownResult:
    allowed: bool
    cooldown_seconds: int
    retry_after_seconds: int


class VerificationCodeCooldownError(Exception):
    def __init__(self, retry_after_seconds: int, message: str = "请稍后再试") -> None:
        super().__init__(message)
        self.message = message
        self.retry_after_seconds = retry_after_seconds


class VerificationCodeCooldownStore:
    def __init__(
        self,
        *,
        cooldown_seconds: int = VERIFICATION_CODE_COOLDOWN_SECONDS,
        now=time.monotonic,
    ) -> None:
        self._cooldown_seconds = cooldown_seconds
        self._now = now
        self._lock = asyncio.Lock()
        self._expires_at_by_key: dict[tuple[str, str, str], float] = {}

    async def reserve(
        self,
        *,
        user_id: str,
        identifier_type: str,
        identifier_value: str,
    ) -> VerificationCodeCooldownResult:
        normalized_type = identifier_type.strip().lower()
        normalized_value = _normalize_identifier_value(normalized_type, identifier_value)
        key = (user_id, normalized_type, normalized_value)
        now = self._now()

        async with self._lock:
            self._drop_expired(now)
            expires_at = self._expires_at_by_key.get(key)
            if expires_at and expires_at > now:
                raise VerificationCodeCooldownError(
                    retry_after_seconds=max(1, math.ceil(expires_at - now))
                )

            self._expires_at_by_key[key] = now + self._cooldown_seconds
            return VerificationCodeCooldownResult(
                allowed=True,
                cooldown_seconds=self._cooldown_seconds,
                retry_after_seconds=0,
            )

    async def release(
        self,
        *,
        user_id: str,
        identifier_type: str,
        identifier_value: str,
    ) -> bool:
        normalized_type = identifier_type.strip().lower()
        normalized_value = _normalize_identifier_value(normalized_type, identifier_value)
        key = (user_id, normalized_type, normalized_value)

        async with self._lock:
            return self._expires_at_by_key.pop(key, None) is not None

    def _drop_expired(self, now: float) -> None:
        expired_keys = [
            key
            for key, expires_at in self._expires_at_by_key.items()
            if expires_at <= now
        ]
        for key in expired_keys:
            del self._expires_at_by_key[key]


def _normalize_identifier_value(identifier_type: str, value: str) -> str:
    if identifier_type == "email":
        return value.strip().lower()
    if identifier_type == "phone":
        digits = "".join(character for character in value if character.isdigit())
        if len(digits) == CHINA_MAINLAND_PHONE_PATTERN_LENGTH:
            return digits
        if digits.startswith("86") and len(digits) == CHINA_MAINLAND_PHONE_PATTERN_LENGTH + 2:
            return digits[2:]
        return digits
    return value.strip()


verification_code_cooldown_store = VerificationCodeCooldownStore()
