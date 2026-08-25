from __future__ import annotations

from ..ai.public_errors import AiProviderPayloadError


class ResumeInputError(ValueError):
    """The uploaded resume is unsupported, empty, damaged, or unreadable."""


class ResumeUpstreamPayloadError(AiProviderPayloadError):
    """The resume parser provider returned an empty or invalid result."""
