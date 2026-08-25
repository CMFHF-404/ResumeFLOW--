from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

from app import auth_middleware
from app.database import get_session
from app.domain.agent import agent_router
from app.domain.export import export_router
from app.domain.export.download_contract import (
    MAX_EXPORT_FILE_NAME_CHARACTERS,
    MAX_EXPORT_FILE_NAME_ENCODED_CHARACTERS,
)
from app.domain.export.schemas import (
    ExperienceBankPdfRenderSnapshot,
    ResumeEditorProfileSnapshot,
    ResumePdfRenderSnapshot,
)
from app.domain.export.limits import MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS
from app.domain.export.snapshot_service import build_render_snapshot_token


class _ScalarResult:
    def __init__(self, value) -> None:
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value

    def one(self):
        return self._value


class _SnapshotSession:
    def __init__(self, record) -> None:
        self.record = record

    async def execute(self, statement):
        statement_sql = str(statement).lower()
        if statement.__class__.__name__ == "Delete":
            return _ScalarResult(None)
        if "pg_advisory_xact_lock" in statement_sql:
            return _ScalarResult(None)
        if "count(" in statement_sql and "octet_length" in statement_sql:
            return _ScalarResult((1, 1024, 0))
        if "count(" in statement_sql:
            return _ScalarResult(1)
        if (
            statement.__class__.__name__ == "Select"
            and "export_render_snapshots.expires_at" in statement_sql
            and "payload_json" not in statement_sql
        ):
            return _ScalarResult(self.record.expires_at)
        if (
            statement.__class__.__name__ == "Select"
            and "export_render_snapshots.user_id" in statement_sql
            and "payload_json" not in statement_sql
        ):
            return _ScalarResult(self.record.user_id)
        return _ScalarResult(self.record)

    async def commit(self) -> None:
        return None

    async def rollback(self) -> None:
        return None

    async def refresh(self, _record) -> None:
        return None

    async def flush(self) -> None:
        return None

    def add(self, _record) -> None:
        return None


class _SessionContext:
    def __init__(self, session: _SnapshotSession) -> None:
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, traceback):
        return False


def _snapshot() -> ResumePdfRenderSnapshot:
    return ResumePdfRenderSnapshot(
        resumeName="HTTP 合同",
        profile=ResumeEditorProfileSnapshot(name="林澈"),
        lineHeight=1.4,
        fontSize=13,
        listSpacingValue="0.3em",
        bulletSpacingValue="0.15em",
        topPaddingPx=42,
        sectionSpacingClass="mb-3",
        listSpacingClass="space-y-2",
    )


def _record(
    *,
    user_id: str = "user-1",
    expires_at: datetime | None = None,
    consumed: bool = False,
):
    snapshot = _snapshot()
    return SimpleNamespace(
        id=uuid.uuid4(),
        user_id=user_id,
        payload_json=snapshot.model_dump(mode="json"),
        expires_at=expires_at or datetime.now(timezone.utc) + timedelta(minutes=5),
        consumed_at=datetime.now(timezone.utc) if consumed else None,
    )


class ExportHttpCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    def assert_no_store(self, response: httpx.Response) -> None:
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["pragma"], "no-cache")
        self.assertEqual(response.headers["referrer-policy"], "no-referrer")

    def _build_app(self, session: _SnapshotSession, *, include_agent: bool = False) -> FastAPI:
        app = FastAPI()
        app.include_router(export_router.router)
        if include_agent:
            app.include_router(agent_router.router)
        app.add_middleware(auth_middleware.LogtoAuthMiddleware)

        async def override_session():
            yield session

        app.dependency_overrides[get_session] = override_session
        return app

    def test_openapi_marks_query_token_contract_as_legacy(self) -> None:
        app = self._build_app(_SnapshotSession(_record()), include_agent=True)
        openapi = app.openapi()
        paths = openapi["paths"]

        for path in (
            "/exports/download/resume-pdf/{snapshot_id}",
            "/exports/render-snapshots/{snapshot_id}",
        ):
            parameters = paths[path]["get"]["parameters"]
            token_parameter = next(
                parameter for parameter in parameters if parameter["name"] == "token"
            )
            self.assertEqual(token_parameter["in"], "query")
            self.assertTrue(token_parameter["deprecated"])

        for path in (
            "/exports/download/resume-pdf/{snapshot_id}",
            "/exports/download/experience-bank-pdf/{snapshot_id}",
            "/agent/v1/exports/resume-pdf/{snapshot_id}",
        ):
            operation = paths[path]["get"]
            self.assertEqual(
                set(operation["responses"]["200"]["content"]),
                {"application/pdf"},
            )
            schema = operation["responses"]["200"]["content"]["application/pdf"][
                "schema"
            ]
            self.assertEqual(schema, {"type": "string", "format": "binary"})

        generate_parameters = paths["/agent/v1/jobs/generate"]["post"]["parameters"]
        export_mode_parameter = next(
            parameter
            for parameter in generate_parameters
            if parameter["name"] == "X-ResumeFlow-Export-Mode"
        )
        self.assertEqual(export_mode_parameter["in"], "header")
        for path in (
            "/exports/resume-pdf-link",
            "/exports/experience-bank-pdf-link",
        ):
            parameters = paths[path]["post"]["parameters"]
            mode_parameter = next(
                parameter
                for parameter in parameters
                if parameter["name"] == "X-ResumeFlow-Export-Mode"
            )
            self.assertEqual(mode_parameter["in"], "header")
        create_key_schema = openapi["components"]["schemas"]["AgentApiKeyCreate"]
        self.assertIn("expected_active_key_id", create_key_schema["properties"])

    async def test_oversized_file_names_are_rejected_at_http_boundaries(self) -> None:
        record = _record()
        session = _SnapshotSession(record)
        app = self._build_app(session)
        oversized_name = "a" * (MAX_EXPORT_FILE_NAME_CHARACTERS + 1)

        with (
            patch.object(
                auth_middleware,
                "_verify_token",
                new=AsyncMock(return_value={"sub": "user-1"}),
            ),
            patch.object(
                auth_middleware,
                "_ensure_user_exists",
                new=AsyncMock(),
            ),
        ):
            body_response = await self._request(
                app,
                "POST",
                "/exports/resume-pdf-link",
                headers={"Authorization": "Bearer test-token"},
                json={
                    "snapshot": _snapshot().model_dump(mode="json"),
                    "fileName": oversized_name,
                },
            )
            header_response = await self._request(
                app,
                "GET",
                f"/exports/download/resume-pdf/{record.id}",
                headers={
                    "Authorization": "Bearer test-token",
                    "X-ResumeFlow-File-Name": (
                        "a" * (MAX_EXPORT_FILE_NAME_ENCODED_CHARACTERS + 1)
                    ),
                },
            )

        query_response = await self._request(
            app,
            "GET",
            f"/exports/download/resume-pdf/{record.id}",
            params={"token": "signed", "fileName": oversized_name},
        )
        self.assertEqual(body_response.status_code, 400)
        self.assertEqual(header_response.status_code, 422)
        self.assertEqual(query_response.status_code, 422)
        self.assert_no_store(body_response)

    async def test_oversized_query_tokens_are_rejected_before_snapshot_decode(self) -> None:
        record = _record()
        app = self._build_app(_SnapshotSession(record))
        oversized_token = "t" * (MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS + 1)

        with patch.object(
            export_router,
            "get_render_snapshot_by_token",
            new=AsyncMock(side_effect=AssertionError("token must not be decoded")),
        ) as lookup:
            responses = (
                await self._request(
                    app,
                    "GET",
                    f"/exports/download/resume-pdf/{record.id}",
                    params={"token": oversized_token},
                ),
                await self._request(
                    app,
                    "GET",
                    f"/exports/render-snapshots/{record.id}",
                    params={"token": oversized_token},
                ),
            )

        self.assertEqual([response.status_code for response in responses], [422, 422])
        lookup.assert_not_awaited()

    async def test_default_link_post_returns_legacy_signed_url_that_downloads_directly(self) -> None:
        record = _record()
        session = _SnapshotSession(record)
        app = self._build_app(session)
        token = build_render_snapshot_token(record)
        snapshot = _snapshot()

        async def create_snapshot(_session, _user_id, requested_snapshot):
            record.payload_json = requested_snapshot.model_dump(mode="json")
            return record, token

        with (
            patch.object(auth_middleware, "_verify_token", new=AsyncMock(return_value={"sub": "user-1"})),
            patch.object(auth_middleware, "_ensure_user_exists", new=AsyncMock()),
            patch.object(export_router, "create_render_snapshot", new=AsyncMock(side_effect=create_snapshot)),
            patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: _SessionContext(session),
            ),
            patch.object(export_router, "render_resume_pdf", new=AsyncMock(return_value=b"%PDF-v1")),
        ):
            created = await self._request(
                app,
                "POST",
                "/exports/resume-pdf-link",
                headers={"Authorization": "Bearer logto-id-token"},
                json={"snapshot": snapshot.model_dump(mode="json"), "fileName": "legacy file.pdf"},
            )
            self.assertEqual(created.status_code, 200, created.text)
            self.assert_no_store(created)
            download_url = created.json()["downloadUrl"]
            self.assertIn("token=", download_url)
            self.assertIn("fileName=legacy+file.pdf", download_url)

            downloaded = await self._request(app, "GET", download_url)

        self.assertEqual(downloaded.status_code, 200, downloaded.text)
        self.assertEqual(downloaded.content, b"%PDF-v1")

    async def test_agent_legacy_signed_url_downloads_without_api_key(self) -> None:
        record = _record()
        session = _SnapshotSession(record)
        app = self._build_app(session, include_agent=True)
        token = build_render_snapshot_token(record)
        renderer = AsyncMock(return_value=b"%PDF-agent-v1")

        with (
            patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: _SessionContext(session),
            ),
            patch.object(agent_router, "render_resume_pdf", new=renderer),
        ):
            response = await self._request(
                app,
                "GET",
                f"/agent/v1/exports/resume-pdf/{record.id}",
                params={"token": token, "fileName": "agent.pdf"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.content, b"%PDF-agent-v1")

    async def test_default_experience_link_is_signed_and_downloads_directly(self) -> None:
        record = _record()
        session = _SnapshotSession(record)
        app = self._build_app(session)
        token = build_render_snapshot_token(record)
        snapshot = ExperienceBankPdfRenderSnapshot()

        async def create_snapshot(_session, _user_id, requested_snapshot):
            record.payload_json = requested_snapshot.model_dump(mode="json")
            return record, token

        with (
            patch.object(auth_middleware, "_verify_token", new=AsyncMock(return_value={"sub": "user-1"})),
            patch.object(auth_middleware, "_ensure_user_exists", new=AsyncMock()),
            patch.object(export_router, "create_render_snapshot", new=AsyncMock(side_effect=create_snapshot)),
            patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: _SessionContext(session),
            ),
            patch.object(
                export_router,
                "render_experience_bank_pdf",
                new=AsyncMock(return_value=b"%PDF-bank-v1"),
            ),
        ):
            created = await self._request(
                app,
                "POST",
                "/exports/experience-bank-pdf-link",
                headers={"Authorization": "Bearer logto-id-token"},
                json={
                    "snapshot": snapshot.model_dump(mode="json"),
                    "fileName": "bank.pdf",
                },
            )
            self.assertEqual(created.status_code, 200, created.text)
            self.assert_no_store(created)
            download_url = created.json()["downloadUrl"]
            self.assertIn("token=", download_url)
            self.assertIn("fileName=bank.pdf", download_url)
            downloaded = await self._request(app, "GET", download_url)

        self.assertEqual(downloaded.status_code, 200, downloaded.text)
        self.assertEqual(downloaded.content, b"%PDF-bank-v1")

    async def test_authenticated_v2_link_is_bare_for_both_root_link_routes(self) -> None:
        record = _record()
        session = _SnapshotSession(record)
        app = self._build_app(session)
        token = build_render_snapshot_token(record)

        with (
            patch.object(auth_middleware, "_verify_token", new=AsyncMock(return_value={"sub": "user-1"})),
            patch.object(auth_middleware, "_ensure_user_exists", new=AsyncMock()),
            patch.object(
                export_router,
                "create_render_snapshot",
                new=AsyncMock(return_value=(record, token)),
            ),
        ):
            cases = (
                (
                    "/exports/resume-pdf-link",
                    {"snapshot": _snapshot().model_dump(mode="json"), "fileName": "resume.pdf"},
                ),
                (
                    "/exports/experience-bank-pdf-link",
                    {
                        "snapshot": ExperienceBankPdfRenderSnapshot().model_dump(mode="json"),
                        "fileName": "bank.pdf",
                    },
                ),
            )
            for path, payload in cases:
                with self.subTest(path=path):
                    response = await self._request(
                        app,
                        "POST",
                        path,
                        headers={
                            "Authorization": "Bearer logto-id-token",
                            "X-ResumeFlow-Export-Mode": "authenticated-v2",
                        },
                        json=payload,
                    )
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assert_no_store(response)
                    self.assertNotIn("?", response.json()["downloadUrl"])

    async def test_link_post_rejects_unknown_or_conflicting_export_mode_headers(self) -> None:
        record = _record()
        app = self._build_app(_SnapshotSession(record))
        payload = {"snapshot": _snapshot().model_dump(mode="json")}

        with (
            patch.object(auth_middleware, "_verify_token", new=AsyncMock(return_value={"sub": "user-1"})),
            patch.object(auth_middleware, "_ensure_user_exists", new=AsyncMock()),
        ):
            unknown = await self._request(
                app,
                "POST",
                "/exports/resume-pdf-link",
                headers={
                    "Authorization": "Bearer logto-id-token",
                    "X-ResumeFlow-Export-Mode": "future-v9",
                },
                json=payload,
            )
            conflicting = await self._request(
                app,
                "POST",
                "/exports/resume-pdf-link",
                headers=[
                    ("Authorization", "Bearer logto-id-token"),
                    ("X-ResumeFlow-Export-Mode", "legacy-v1"),
                    ("X-ResumeFlow-Export-Mode", "authenticated-v2"),
                ],
                json=payload,
            )

        self.assertEqual(unknown.status_code, 400, unknown.text)
        self.assertEqual(conflicting.status_code, 400, conflicting.text)
        self.assert_no_store(unknown)
        self.assert_no_store(conflicting)

    async def _request(self, app: FastAPI, method: str, url: str, **kwargs):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="https://api.example.test",
        ) as client:
            return await client.request(method, url, **kwargs)

    async def test_legacy_download_get_succeeds_without_logto_and_sanitizes_filename(self) -> None:
        record = _record()
        session = _SnapshotSession(record)
        app = self._build_app(session)
        token = build_render_snapshot_token(record)
        renderer = AsyncMock(return_value=b"%PDF-legacy")

        with (
            patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: _SessionContext(session),
            ),
            patch.object(export_router, "render_resume_pdf", new=renderer),
            patch.object(auth_middleware, "_verify_token", new=AsyncMock()) as verify,
        ):
            response = await self._request(
                app,
                "GET",
                f"/exports/download/resume-pdf/{record.id}",
                params={
                    "token": token,
                    "fileName": "safe\r\nX-Injected: yes.pdf",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.content, b"%PDF-legacy")
        self.assertNotIn("\r", response.headers["content-disposition"])
        self.assertNotIn("\n", response.headers["content-disposition"])
        self.assertNotIn("X-Injected:", response.headers["content-disposition"])
        self.assertNotIn("x-injected", response.headers)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["referrer-policy"], "no-referrer")
        verify.assert_not_awaited()
        renderer.assert_awaited_once_with(str(record.id), token)

    async def test_legacy_download_rejects_wrong_and_cross_snapshot_tokens(self) -> None:
        record = _record()
        session = _SnapshotSession(record)
        app = self._build_app(session)
        cross_record = _record()
        cross_token = build_render_snapshot_token(cross_record)
        wrong_token = "not-a-valid-snapshot-token"
        renderer = AsyncMock(return_value=b"%PDF-1.7")

        with (
            patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: _SessionContext(session),
            ),
            patch.object(export_router, "render_resume_pdf", new=renderer),
        ):
            wrong = await self._request(
                app,
                "GET",
                f"/exports/download/resume-pdf/{record.id}?token={wrong_token}",
            )
            cross = await self._request(
                app,
                "GET",
                f"/exports/download/resume-pdf/{record.id}?token={cross_token}",
            )

        self.assertEqual(wrong.status_code, 403, wrong.text)
        self.assertEqual(cross.status_code, 403, cross.text)
        self.assertEqual(wrong.headers["cache-control"], "no-store")
        self.assertEqual(cross.headers["referrer-policy"], "no-referrer")
        renderer.assert_not_awaited()

    async def test_legacy_download_rejects_consumed_and_expired_snapshots(self) -> None:
        consumed_record = _record(consumed=True)
        consumed_session = _SnapshotSession(consumed_record)
        consumed_app = self._build_app(consumed_session)
        consumed_token = build_render_snapshot_token(consumed_record)

        expired_record = _record(
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)
        )
        expired_session = _SnapshotSession(expired_record)
        expired_app = self._build_app(expired_session)
        expired_token = build_render_snapshot_token(expired_record)
        renderer = AsyncMock(return_value=b"%PDF-1.7")

        with patch.object(export_router, "render_resume_pdf", new=renderer):
            with patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: _SessionContext(consumed_session),
            ):
                consumed = await self._request(
                    consumed_app,
                    "GET",
                    f"/exports/download/resume-pdf/{consumed_record.id}?token={consumed_token}",
                )
            with patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: _SessionContext(expired_session),
            ):
                expired = await self._request(
                    expired_app,
                    "GET",
                    f"/exports/download/resume-pdf/{expired_record.id}?token={expired_token}",
                )

        self.assertEqual(consumed.status_code, 410, consumed.text)
        self.assertEqual(expired.status_code, 410, expired.text)
        renderer.assert_not_awaited()

    async def test_new_download_mode_requires_logto_and_uses_owner_lookup(self) -> None:
        record = _record()
        session = _SnapshotSession(record)
        app = self._build_app(session)
        snapshot = _snapshot()
        owner_lookup = AsyncMock(return_value=(record, snapshot))
        renderer = AsyncMock(return_value=b"%PDF-owner")

        with (
            patch.object(auth_middleware, "_verify_token", new=AsyncMock(return_value={"sub": "user-1"})),
            patch.object(auth_middleware, "_ensure_user_exists", new=AsyncMock()),
            patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: _SessionContext(session),
            ),
            patch.object(export_router, "get_render_snapshot_by_owner", new=owner_lookup),
            patch.object(export_router, "render_resume_pdf", new=renderer),
        ):
            unauthenticated = await self._request(
                app,
                "GET",
                f"/exports/download/resume-pdf/{record.id}",
            )
            authenticated = await self._request(
                app,
                "GET",
                f"/exports/download/resume-pdf/{record.id}",
                headers={
                    "Authorization": "Bearer logto-id-token",
                    "X-ResumeFlow-File-Name": "owner%20file.pdf",
                },
            )

        self.assertEqual(unauthenticated.status_code, 401, unauthenticated.text)
        self.assertEqual(authenticated.status_code, 200, authenticated.text)
        self.assertIn("owner%20file.pdf", authenticated.headers["content-disposition"])
        self.assertTrue(
            all(call.args[2] == "user-1" for call in owner_lookup.await_args_list)
        )

    async def test_auth_middleware_only_publicizes_exact_single_token_download(self) -> None:
        record = _record()
        session = _SnapshotSession(record)
        app = self._build_app(session)

        duplicate = await self._request(
            app,
            "GET",
            f"/exports/download/resume-pdf/{record.id}?token=one&token=two",
        )
        empty = await self._request(
            app,
            "GET",
            f"/exports/download/resume-pdf/{record.id}?token=",
        )
        extra_path = await self._request(
            app,
            "GET",
            f"/exports/download/resume-pdf/{record.id}/extra?token=one",
        )

        self.assertEqual(duplicate.status_code, 401, duplicate.text)
        self.assertEqual(empty.status_code, 401, empty.text)
        self.assertEqual(extra_path.status_code, 401, extra_path.text)

    async def test_snapshot_get_accepts_header_or_legacy_query_and_rejects_conflict(self) -> None:
        record = _record()
        session = _SnapshotSession(record)
        app = self._build_app(session)
        token = build_render_snapshot_token(record)
        other_token = build_render_snapshot_token(_record())
        path = f"/exports/render-snapshots/{record.id}"

        query_response = await self._request(app, "GET", path, params={"token": token})
        header_response = await self._request(
            app,
            "GET",
            path,
            headers={"Authorization": f"Bearer {token}"},
        )
        conflict_response = await self._request(
            app,
            "GET",
            path,
            params={"token": token},
            headers={"Authorization": f"Bearer {other_token}"},
        )

        self.assertEqual(query_response.status_code, 200, query_response.text)
        self.assertEqual(header_response.status_code, 200, header_response.text)
        self.assertEqual(conflict_response.status_code, 403, conflict_response.text)
        for response in (query_response, header_response, conflict_response):
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(response.headers["referrer-policy"], "no-referrer")


if __name__ == "__main__":
    unittest.main()
