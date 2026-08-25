from __future__ import annotations

from urllib.parse import urlencode


EXPORT_MODE_HEADER = "X-ResumeFlow-Export-Mode"
EXPORT_MODE_LEGACY_V1 = "legacy-v1"
EXPORT_MODE_AUTHENTICATED_V2 = "authenticated-v2"
MAX_EXPORT_FILE_NAME_CHARACTERS = 200
# A UTF-8 character can expand to four bytes and then three URL-encoding
# characters per byte. Bound encoded header input before decoding as well.
MAX_EXPORT_FILE_NAME_ENCODED_CHARACTERS = MAX_EXPORT_FILE_NAME_CHARACTERS * 12
SUPPORTED_EXPORT_MODES = frozenset(
    {EXPORT_MODE_LEGACY_V1, EXPORT_MODE_AUTHENTICATED_V2}
)


class ExportModeError(ValueError):
    pass


def limit_export_file_name(value: str) -> str:
    if len(value) <= MAX_EXPORT_FILE_NAME_CHARACTERS:
        return value
    if value.lower().endswith(".pdf"):
        return (
            value[: MAX_EXPORT_FILE_NAME_CHARACTERS - 4]
            + value[-4:]
        )
    return value[:MAX_EXPORT_FILE_NAME_CHARACTERS]


def resolve_export_mode(header_values: list[str]) -> str:
    if not header_values:
        return EXPORT_MODE_LEGACY_V1
    if len(header_values) != 1:
        raise ExportModeError("Conflicting export mode headers.")

    mode = header_values[0].strip()
    if mode not in SUPPORTED_EXPORT_MODES:
        raise ExportModeError("Unsupported export mode.")
    return mode


def build_versioned_download_url(
    path: str,
    *,
    mode: str,
    token: str,
    file_name: str,
) -> str:
    if mode == EXPORT_MODE_AUTHENTICATED_V2:
        return path
    if mode != EXPORT_MODE_LEGACY_V1:
        raise ExportModeError("Unsupported export mode.")
    return (
        f"{path}?"
        f"{urlencode({'token': token, 'fileName': limit_export_file_name(file_name)})}"
    )
