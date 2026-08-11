from __future__ import annotations

import base64
import time
from typing import Any, Mapping

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding


SIGN_TYPE = "RSA"
CHECKOUT_PATH = "/api/pay/submit"
QUERY_PATH = "/api/pay/query"
MAX_TIMESTAMP_SKEW_SECONDS = 300


class PaymentProviderError(RuntimeError):
    pass


def canonicalize_parameters(parameters: Mapping[str, Any]) -> str:
    pairs: list[tuple[str, str]] = []
    for key, value in parameters.items():
        if key in {"sign", "sign_type"} or value is None or value == "":
            continue
        if isinstance(value, (bytes, bytearray, list, tuple, dict, set)):
            continue
        pairs.append((str(key), str(value)))
    pairs.sort(key=lambda item: item[0])
    return "&".join(f"{key}={value}" for key, value in pairs)


def _normalized_key_text(value: str, label: str) -> str:
    normalized = (value or "").strip().replace("\\n", "\n")
    if not normalized:
        raise PaymentProviderError(f"missing {label}")
    return normalized


def _load_private_key(value: str):
    normalized = _normalized_key_text(value, "merchant private key")
    if "-----BEGIN" in normalized:
        return serialization.load_pem_private_key(normalized.encode("utf-8"), password=None)
    return serialization.load_der_private_key(
        base64.b64decode("".join(normalized.split()), validate=True),
        password=None,
    )


def _load_public_key(value: str):
    normalized = _normalized_key_text(value, "platform public key")
    if "-----BEGIN" in normalized:
        return serialization.load_pem_public_key(normalized.encode("utf-8"))
    return serialization.load_der_public_key(
        base64.b64decode("".join(normalized.split()), validate=True)
    )


def sign_parameters(parameters: Mapping[str, Any], merchant_private_key: str) -> str:
    try:
        private_key = _load_private_key(merchant_private_key)
        signature = private_key.sign(
            canonicalize_parameters(parameters).encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
    except (TypeError, ValueError) as exc:
        raise PaymentProviderError("invalid merchant private key") from exc
    return base64.b64encode(signature).decode("ascii")


def verify_parameters(
    parameters: Mapping[str, Any],
    platform_public_key: str,
    *,
    now_timestamp: int | None = None,
    max_timestamp_skew_seconds: int | None = MAX_TIMESTAMP_SKEW_SECONDS,
) -> bool:
    signature = str(parameters.get("sign") or "")
    if not signature:
        return False
    sign_type = str(parameters.get("sign_type") or SIGN_TYPE).upper()
    if sign_type != SIGN_TYPE:
        return False
    if max_timestamp_skew_seconds is not None:
        try:
            response_timestamp = int(str(parameters.get("timestamp") or ""))
        except (TypeError, ValueError):
            return False
        current_timestamp = int(time.time()) if now_timestamp is None else int(now_timestamp)
        if abs(current_timestamp - response_timestamp) > max_timestamp_skew_seconds:
            return False
    try:
        public_key = _load_public_key(platform_public_key)
        public_key.verify(
            base64.b64decode(signature, validate=True),
            canonicalize_parameters(parameters).encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except (InvalidSignature, TypeError, ValueError):
        return False


def provider_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}{path}"


def build_signed_fields(parameters: Mapping[str, Any], merchant_private_key: str) -> dict[str, str]:
    fields = {key: str(value) for key, value in parameters.items() if value is not None and value != ""}
    fields["sign_type"] = SIGN_TYPE
    fields["sign"] = sign_parameters(fields, merchant_private_key)
    return fields


async def query_order(
    *,
    base_url: str,
    merchant_id: str,
    merchant_private_key: str,
    platform_public_key: str,
    merchant_order_no: str,
) -> dict[str, Any]:
    fields = build_signed_fields(
        {
            "pid": merchant_id,
            "out_trade_no": merchant_order_no,
            "timestamp": str(int(time.time())),
        },
        merchant_private_key,
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(provider_url(base_url, QUERY_PATH), data=fields)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise PaymentProviderError("Yifut order query failed") from exc
    if not isinstance(payload, dict):
        raise PaymentProviderError("invalid Yifut order query response")
    if not verify_parameters(payload, platform_public_key):
        raise PaymentProviderError("invalid Yifut order query signature")
    return payload
