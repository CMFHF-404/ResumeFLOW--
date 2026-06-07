from fastapi import APIRouter, Depends, HTTPException
from starlette.status import HTTP_429_TOO_MANY_REQUESTS

from ...dependencies import get_current_user
from .schemas import VerificationCodeCooldownRead, VerificationCodeCooldownRequest
from .verification_cooldown_service import (
    VerificationCodeCooldownError,
    verification_code_cooldown_store,
)

router = APIRouter(prefix="/account", tags=["account"])


@router.post(
    "/verification-code-cooldown",
    response_model=VerificationCodeCooldownRead,
)
async def reserve_verification_code_cooldown(
    payload: VerificationCodeCooldownRequest,
    current_user=Depends(get_current_user),
) -> VerificationCodeCooldownRead:
    try:
        result = await verification_code_cooldown_store.reserve(
            user_id=current_user.id,
            identifier_type=payload.identifier.type,
            identifier_value=payload.identifier.value,
        )
    except VerificationCodeCooldownError as exc:
        raise HTTPException(
            status_code=HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "verification_code_cooldown",
                "message": exc.message,
                "retry_after_seconds": exc.retry_after_seconds,
            },
        ) from exc

    return VerificationCodeCooldownRead(
        allowed=result.allowed,
        cooldown_seconds=result.cooldown_seconds,
        retry_after_seconds=result.retry_after_seconds,
    )


@router.delete("/verification-code-cooldown")
async def release_verification_code_cooldown(
    payload: VerificationCodeCooldownRequest,
    current_user=Depends(get_current_user),
) -> dict[str, bool]:
    released = await verification_code_cooldown_store.release(
        user_id=current_user.id,
        identifier_type=payload.identifier.type,
        identifier_value=payload.identifier.value,
    )
    return {"released": released}
