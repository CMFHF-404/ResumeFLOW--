from __future__ import annotations

import asyncio
from typing import Awaitable, TypeVar

import httpx
from fastapi import HTTPException
from starlette.status import HTTP_502_BAD_GATEWAY, HTTP_503_SERVICE_UNAVAILABLE

from .runtime_budget import TERMINAL_AI_RUNTIME_ERRORS, ai_runtime_http_exception


AI_PROVIDER_INVALID_RESPONSE_MESSAGE = (
    "AI analysis returned an invalid response. Please retry."
)
AI_PROVIDER_UNAVAILABLE_MESSAGE = (
    "AI provider is temporarily unavailable. Please retry."
)


class AiProviderPayloadError(ValueError):
    """The upstream provider returned a syntactically or structurally invalid payload."""


class AiProviderUnavailableError(ValueError):
    """The upstream provider rejected or could not complete the request."""


def translate_ai_public_exception(exc: Exception) -> HTTPException | None:
    if isinstance(exc, TERMINAL_AI_RUNTIME_ERRORS):
        return ai_runtime_http_exception(exc)
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, (httpx.HTTPError, AiProviderUnavailableError)):
        return HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail=AI_PROVIDER_UNAVAILABLE_MESSAGE,
        )
    if isinstance(exc, AiProviderPayloadError):
        return HTTPException(
            status_code=HTTP_502_BAD_GATEWAY,
            detail=AI_PROVIDER_INVALID_RESPONSE_MESSAGE,
        )
    return None


_T = TypeVar("_T")


async def resolve_ai_public_response(operation: Awaitable[_T]) -> _T:
    try:
        return await operation
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        translated = translate_ai_public_exception(exc)
        if translated is None:
            raise
        if translated is exc:
            raise
        raise translated from exc
