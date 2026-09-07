from __future__ import annotations

from typing import Any, Optional

from ...ai_model_capabilities import (
    is_openai_responses_streaming_unsupported,
    resolve_openai_reasoning_effort,
    supports_openai_reasoning_model,
)


AI_ROUTE_PROFILE_HYBRID = "hybrid_gemini_aifast"
AI_ROUTE_PROFILE_GEMINI = "gemini_primary"
AI_ROUTE_PROFILE_OPENAI = "openai_primary"
AI_ROUTE_PROFILE_QWEN = "qwen_primary"

def is_qwen_model(model: Optional[str]) -> bool:
    return (model or "").strip().lower().startswith("qwen")


def resolve_route_profile(settings: Any) -> str:
    return str(
        getattr(settings, "ai_route_profile", AI_ROUTE_PROFILE_HYBRID)
        or AI_ROUTE_PROFILE_HYBRID
    ).strip().lower()


def has_qwen_thinking_provider(
    settings: Any,
    *,
    route_profile: Optional[str] = None,
    qwen_model_available: Optional[bool] = None,
) -> bool:
    resolved_route_profile = (
        str(getattr(settings, "ai_route_profile", "") or "").strip().lower()
        if route_profile is None
        else str(route_profile).strip().lower()
    )
    has_qwen_model = (
        is_qwen_model(str(getattr(settings, "ai_model", "") or ""))
        if qwen_model_available is None
        else qwen_model_available
    )
    return (
        resolved_route_profile == AI_ROUTE_PROFILE_QWEN
        and bool(getattr(settings, "ai_api_key", None))
        and bool(has_qwen_model)
    )


def has_openai_stream_provider(
    settings: Any,
    *,
    route_profile: Optional[str] = None,
) -> bool:
    resolved_route_profile = (
        str(getattr(settings, "ai_route_profile", "") or "").strip().lower()
        if route_profile is None
        else str(route_profile).strip().lower()
    )
    return (
        resolved_route_profile == AI_ROUTE_PROFILE_OPENAI
        and bool(getattr(settings, "ai_api_key", None))
        and bool(str(getattr(settings, "ai_model", "") or "").strip())
    )


def has_openai_thinking_provider(
    settings: Any,
    *,
    route_profile: Optional[str] = None,
) -> bool:
    return has_openai_stream_provider(
        settings,
        route_profile=route_profile,
    ) and supports_openai_reasoning_model(
        str(getattr(settings, "ai_model", "") or "")
    )


def has_thinking_stream_provider(
    settings: Any,
    *,
    qwen_available: Optional[bool] = None,
) -> bool:
    has_qwen = (
        has_qwen_thinking_provider(settings)
        if qwen_available is None
        else qwen_available
    )
    route_profile = resolve_route_profile(settings)
    has_selected_gemini = (
        route_profile in {AI_ROUTE_PROFILE_GEMINI, AI_ROUTE_PROFILE_HYBRID}
        and bool(getattr(settings, "gemini_api_key", None))
    )
    return (
        bool(has_qwen)
        or has_openai_stream_provider(settings)
        or has_selected_gemini
    )


def resolve_thinking_model_name(
    settings: Any,
    *,
    qwen_available: Optional[bool] = None,
) -> str:
    has_qwen = (
        has_qwen_thinking_provider(settings)
        if qwen_available is None
        else qwen_available
    )
    if has_qwen or has_openai_stream_provider(settings):
        return str(getattr(settings, "ai_model", "") or "")
    if resolve_route_profile(settings) in {
        AI_ROUTE_PROFILE_OPENAI,
        AI_ROUTE_PROFILE_QWEN,
    }:
        return str(getattr(settings, "ai_model", "") or "")
    return str(
        getattr(settings, "gemini_model", "")
        or getattr(settings, "ai_model", "")
    )
