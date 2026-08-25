from __future__ import annotations

import base64
import binascii
import io
import re

from PIL import Image, UnidentifiedImageError


MAX_AVATAR_IMAGE_BYTES = 2 * 1024 * 1024
MAX_AVATAR_IMAGE_DIMENSION = 2048
MAX_AVATAR_IMAGE_PIXELS = 4_000_000
ALLOWED_AVATAR_IMAGE_FORMATS = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}
_AVATAR_DATA_URL_PATTERN = re.compile(
    r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$",
    re.IGNORECASE,
)


def validate_avatar_data_url(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""

    match = _AVATAR_DATA_URL_PATTERN.fullmatch(normalized)
    if not match:
        raise ValueError("头像必须是 PNG、JPEG 或 WebP 的 data URI。")

    mime_type = match.group(1).lower()
    encoded = match.group(2)
    if len(encoded) > ((MAX_AVATAR_IMAGE_BYTES + 2) // 3) * 4:
        raise ValueError("头像图片不能超过 2 MiB。")

    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("头像 data URI 的 base64 内容无效。") from exc

    if not decoded or len(decoded) > MAX_AVATAR_IMAGE_BYTES:
        raise ValueError("头像图片不能超过 2 MiB。")

    try:
        with Image.open(io.BytesIO(decoded)) as image:
            actual_format = (image.format or "").upper()
            width, height = image.size
            if actual_format != ALLOWED_AVATAR_IMAGE_FORMATS[mime_type]:
                raise ValueError("头像 data URI 的 MIME 类型与图片内容不匹配。")
            # Animated files can render a later frame in Chromium/PDF output.  Reject
            # them before any consumer receives the data URL; checking both fields
            # covers Pillow's format-specific animation metadata consistently.
            is_animated = bool(getattr(image, "is_animated", False))
            frame_count = getattr(image, "n_frames", 1)
            if is_animated or frame_count != 1:
                raise ValueError("头像图片不支持动画帧。")
            if width <= 0 or height <= 0:
                raise ValueError("头像图片尺寸无效。")
            if width > MAX_AVATAR_IMAGE_DIMENSION or height > MAX_AVATAR_IMAGE_DIMENSION:
                raise ValueError("头像图片宽高不能超过 2048 像素。")
            if width * height > MAX_AVATAR_IMAGE_PIXELS:
                raise ValueError("头像图片像素总量不能超过 400 万。")
            # Pillow verify() checks the compressed file structure without decoding
            # all pixels. Dimension gates deliberately run first so a tiny compressed
            # image with a hostile header never reaches that scan.
            image.verify()
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError("头像 data URI 不包含可安全使用的有效图片。") from exc

    return normalized


def normalize_avatar_data_url_or_empty(value: object) -> str:
    if not isinstance(value, str):
        return ""
    try:
        return validate_avatar_data_url(value)
    except ValueError:
        return ""
