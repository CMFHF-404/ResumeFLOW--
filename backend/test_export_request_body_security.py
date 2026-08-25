from __future__ import annotations

import gzip
import json
from typing import Any
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import BaseModel
from starlette.requests import Request

from app.domain.export import export_router


class _Payload(BaseModel):
    value: str


class _AnyPayload(BaseModel):
    value: Any


def _build_request(
    body: bytes,
    *,
    content_encoding: str = "gzip",
    chunk_size: int = 7,
) -> Request:
    chunks = [
        body[index : index + chunk_size]
        for index in range(0, len(body), chunk_size)
    ]

    async def receive() -> dict:
        if not chunks:
            return {"type": "http.request", "body": b"", "more_body": False}
        chunk = chunks.pop(0)
        return {
            "type": "http.request",
            "body": chunk,
            "more_body": bool(chunks),
        }

    headers = [(b"content-type", b"application/json")]
    if content_encoding:
        headers.append((b"content-encoding", content_encoding.encode("ascii")))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/exports/resume-pdf",
        "raw_path": b"/exports/resume-pdf",
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }
    return Request(scope, receive)


class ExportRequestBodySecurityTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _json_body(value: str) -> bytes:
        return json.dumps(
            {"value": value},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

    async def test_chunked_normal_gzip_request_preserves_payload(self) -> None:
        body = self._json_body("正常导出")

        for encoding in ("gzip", "x-gzip", " GZip "):
            with self.subTest(encoding=encoding):
                with patch.object(
                    export_router,
                    "MAX_EXPORT_DECOMPRESSED_BODY_BYTES",
                    len(body),
                ):
                    parsed = await export_router._parse_export_request(
                        _build_request(gzip.compress(body), content_encoding=encoding),
                        _Payload,
                    )

                self.assertEqual(parsed.value, "正常导出")

    async def test_chunked_plain_json_request_preserves_payload_at_limit(self) -> None:
        body = self._json_body("plain payload")

        with patch.object(export_router, "MAX_EXPORT_REQUEST_BODY_BYTES", len(body)):
            parsed = await export_router._parse_export_request(
                _build_request(body, content_encoding="", chunk_size=2),
                _Payload,
            )

        self.assertEqual(parsed.value, "plain payload")

    async def test_gzip_bomb_exceeding_decompressed_budget_is_rejected(self) -> None:
        compressed = gzip.compress(self._json_body("a" * 100_000))

        with patch.object(export_router, "MAX_EXPORT_DECOMPRESSED_BODY_BYTES", 128):
            with self.assertRaises(HTTPException) as context:
                await export_router._parse_export_request(
                    _build_request(compressed),
                    _Payload,
                )

        self.assertEqual(context.exception.status_code, 413)
        self.assertEqual(context.exception.detail, "导出请求体过大。")

    async def test_compressed_input_limit_is_enforced_while_streaming(self) -> None:
        compressed = gzip.compress(self._json_body("ordinary payload"))

        with patch.object(
            export_router,
            "MAX_EXPORT_REQUEST_BODY_BYTES",
            len(compressed) - 1,
        ):
            with self.assertRaises(HTTPException) as context:
                await export_router._parse_export_request(
                    _build_request(compressed, chunk_size=3),
                    _Payload,
                )

        self.assertEqual(context.exception.status_code, 413)
        self.assertEqual(context.exception.detail, "导出请求体过大。")

    async def test_gzip_trailing_bytes_are_rejected(self) -> None:
        compressed = gzip.compress(self._json_body("payload")) + b"trailing-data"

        with self.assertRaises(HTTPException) as context:
            await export_router._parse_export_request(
                _build_request(compressed),
                _Payload,
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "导出请求体 gzip 解压失败。")

    async def test_concatenated_gzip_members_are_rejected(self) -> None:
        compressed = gzip.compress(self._json_body("first")) + gzip.compress(
            self._json_body("second")
        )

        with self.assertRaises(HTTPException) as context:
            await export_router._parse_export_request(
                _build_request(compressed),
                _Payload,
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "导出请求体 gzip 解压失败。")

    async def test_incomplete_gzip_stream_is_rejected(self) -> None:
        compressed = gzip.compress(self._json_body("payload"))[:-4]

        with self.assertRaises(HTTPException) as context:
            await export_router._parse_export_request(
                _build_request(compressed),
                _Payload,
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "导出请求体 gzip 解压失败。")

    async def test_invalid_gzip_stream_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as context:
            await export_router._parse_export_request(
                _build_request(b"not-a-gzip-stream"),
                _Payload,
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "导出请求体 gzip 解压失败。")

    async def test_non_finite_and_pathological_json_numbers_are_rejected(self) -> None:
        bodies = (
            b'{"value":NaN}',
            b'{"value":Infinity}',
            b'{"value":-Infinity}',
            b'{"value":1e9999}',
            b'{"value":' + (b"1" * 5000) + b"}",
        )

        for body in bodies:
            with self.subTest(body_prefix=body[:32]):
                with self.assertRaises(HTTPException) as context:
                    await export_router._parse_export_request(
                        _build_request(body, content_encoding=""),
                        _AnyPayload,
                    )
                self.assertEqual(context.exception.status_code, 400)

    async def test_excessively_nested_json_is_rejected_as_bad_request(self) -> None:
        nesting = 2000
        body = (
            b'{"value":'
            + (b"[" * nesting)
            + b"0"
            + (b"]" * nesting)
            + b"}"
        )

        with self.assertRaises(HTTPException) as context:
            await export_router._parse_export_request(
                _build_request(body, content_encoding="", chunk_size=97),
                _AnyPayload,
            )

        self.assertEqual(context.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
