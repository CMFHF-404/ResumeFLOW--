from __future__ import annotations

import re
from typing import Optional


_SNAPSHOT_SUFFIX = r"(?:-\d{4}-\d{2}-\d{2})?"
_OPENAI_REASONING_MODEL_PATTERN = re.compile(
    rf"(?:"
    rf"gpt-5(?:-(?:mini|nano|pro|codex))?"
    rf"|gpt-5\.1(?:-codex(?:-(?:mini|max))?)?"
    rf"|gpt-5\.2(?:-(?:pro|codex))?"
    rf"|gpt-5\.3-codex(?:-spark)?"
    rf"|gpt-5\.4(?:-(?:mini|nano|pro))?"
    rf"|gpt-5\.5(?:-pro)?"
    rf"|gpt-5\.6(?:-(?:sol|terra|luna))?"
    rf"|gpt-6-astra"
    rf"|o1(?:-(?:mini|preview|pro))?"
    rf"|o3(?:-(?:mini|pro|deep-research))?"
    rf"|o4-mini(?:-deep-research)?"
    rf"){_SNAPSHOT_SUFFIX}"
)
_OPENAI_SAMPLING_MODEL_PATTERN = re.compile(
    rf"(?:"
    rf"gpt-3\.5-turbo(?:-\d{{4}})?"
    rf"|gpt-4\.1(?:-(?:mini|nano))?"
    rf"|gpt-4o(?:-mini)?"
    rf"|gpt-4\.5-preview"
    rf"|gpt-5(?:\.\d+)?-chat-latest"
    rf"){_SNAPSHOT_SUFFIX}"
)
_OPENAI_HIGH_ONLY_REASONING_PATTERN = re.compile(
    rf"gpt-5-pro{_SNAPSHOT_SUFFIX}"
)
_OPENAI_RESPONSES_STREAMING_UNSUPPORTED_PATTERN = re.compile(
    rf"(?:o1-pro|o3-pro|gpt-5\.5-pro){_SNAPSHOT_SUFFIX}"
)


def _normalize_model_id(model: Optional[str]) -> str:
    return (model or "").strip().lower()


def resolve_openai_reasoning_effort(model: Optional[str]) -> Optional[str]:
    """Resolve a valid native reasoning effort for documented model IDs.

    Unknown provider aliases intentionally return ``None`` so callers omit
    reasoning-only parameters instead of discovering capabilities through a
    failed, potentially billable request.
    """
    normalized = _normalize_model_id(model)
    if normalized == "codex-mini-latest":
        return "medium"
    if _OPENAI_HIGH_ONLY_REASONING_PATTERN.fullmatch(normalized):
        return "high"
    if _OPENAI_REASONING_MODEL_PATTERN.fullmatch(normalized):
        return "medium"
    return None


def supports_openai_reasoning_model(model: Optional[str]) -> bool:
    return resolve_openai_reasoning_effort(model) is not None


def supports_openai_sampling_temperature(model: Optional[str]) -> bool:
    return bool(
        _OPENAI_SAMPLING_MODEL_PATTERN.fullmatch(_normalize_model_id(model))
    )


def openai_chat_output_token_field(model: Optional[str]) -> str:
    return (
        "max_completion_tokens"
        if supports_openai_reasoning_model(model)
        else "max_tokens"
    )


def is_openai_responses_streaming_unsupported(model: Optional[str]) -> bool:
    return bool(
        _OPENAI_RESPONSES_STREAMING_UNSUPPORTED_PATTERN.fullmatch(
            _normalize_model_id(model)
        )
    )
