from typing import Literal

from pydantic import BaseModel, Field


class VerificationCodeIdentifier(BaseModel):
    type: Literal["email", "phone"]
    value: str = Field(min_length=1)


class VerificationCodeCooldownRequest(BaseModel):
    identifier: VerificationCodeIdentifier


class VerificationCodeCooldownRead(BaseModel):
    allowed: bool
    cooldown_seconds: int
    retry_after_seconds: int
