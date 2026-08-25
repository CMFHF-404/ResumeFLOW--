from __future__ import annotations

import os
import unittest
import uuid
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError


def _set_required_env_defaults() -> None:
    os.environ.setdefault(
        "DATABASE_URL",
        "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
    )
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from fastapi import HTTPException  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402

from app.domain.assistant import assistant_router, assistant_service  # noqa: E402
from app.domain.assistant import assistant_storage  # noqa: E402
from app.domain.assistant.schemas import (  # noqa: E402
    AssistantSessionCreate,
    AssistantSessionUpdate,
)


class _FakeForm:
    def __init__(self, files, *, extra_fields: int = 0):
        self._files = list(files)
        self._values = {
            "user_message": "hello",
            **{f"tiny-{index}": "x" for index in range(extra_fields)},
        }

    def getlist(self, key):
        return list(self._files) if key == "files" else []

    def get(self, key, default=None):
        return self._values.get(key, default)


class _FakeRequest:
    def __init__(self, form):
        self.headers = {"content-type": "multipart/form-data; boundary=test"}
        self.form = AsyncMock(return_value=form)


def _upload(name: str):
    return SimpleNamespace(
        filename=name,
        content_type="image/png",
        size=1,
        read=AsyncMock(return_value=b"x"),
        seek=AsyncMock(),
    )


class AssistantSchemaStorageBoundaryTests(unittest.TestCase):
    def test_session_title_accepts_200_characters_and_rejects_201(self) -> None:
        self.assertEqual(
            AssistantSessionCreate(title="x" * 200).title,
            "x" * 200,
        )
        self.assertEqual(
            AssistantSessionUpdate(title="x" * 200).title,
            "x" * 200,
        )
        with self.assertRaises(ValidationError):
            AssistantSessionCreate(title="x" * 201)
        with self.assertRaises(ValidationError):
            AssistantSessionUpdate(title="x" * 201)

    def test_context_requires_strict_json_object_and_compact_utf8_budget(self) -> None:
        with self.assertRaises(ValidationError):
            AssistantSessionCreate.model_validate({"context_json": []})
        with self.assertRaises(ValidationError):
            AssistantSessionCreate(context_json={"bad": ("tuple",)})
        with self.assertRaises(ValidationError):
            AssistantSessionCreate(context_json={"bad": float("nan")})
        with self.assertRaises(ValidationError):
            AssistantSessionCreate(context_json={"bad": "nul\x00value"})
        with self.assertRaises(ValidationError):
            AssistantSessionCreate(context_json={"bad\x00key": "value"})
        with self.assertRaises(ValidationError):
            AssistantSessionCreate(context_json={"text": "汉" * (256 * 1024)})

    def test_context_db_equivalent_utf8_boundary_is_enforced_at_plus_one(self) -> None:
        overhead = assistant_storage.storage_json_utf8_size({"text": ""})
        accepted = {"text": "x" * (assistant_storage.MAX_ASSISTANT_SESSION_CONTEXT_BYTES - overhead)}
        rejected = {"text": accepted["text"] + "x"}

        self.assertEqual(
            assistant_storage.storage_json_utf8_size(accepted),
            assistant_storage.MAX_ASSISTANT_SESSION_CONTEXT_BYTES,
        )
        self.assertEqual(AssistantSessionCreate(context_json=accepted).context_json, accepted)
        with self.assertRaises(ValidationError):
            AssistantSessionCreate(context_json=rejected)

    def test_runtime_schema_and_migration_share_limits_without_retention(self) -> None:
        backend_root = Path(__file__).resolve().parent
        database_source = (backend_root / "app" / "database.py").read_text(
            encoding="utf-8"
        )
        schema_source = (backend_root / "schema.sql").read_text(encoding="utf-8")
        migration_source = (
            backend_root / "migrations" / "019_add_assistant_storage_limits.sql"
        ).read_text(encoding="utf-8")
        combined = "\n".join((database_source, schema_source, migration_source))

        self.assertIn("octet_length(context_json::text) <= 262144", combined)
        self.assertIn("octet_length(content_json::text) <= 8388608", combined)
        self.assertIn("char_length(mime_type) <= 255", combined)
        self.assertIn("octet_length(payload_base64) <= 6990508", combined)
        self.assertNotIn("ai_assistant_image_blobs(expires_at)", combined)
        self.assertNotIn("ai_assistant_image_blobs\nWHERE expires_at", combined)

    def test_image_blob_mime_type_is_ascii_and_bounded(self) -> None:
        self.assertEqual(
            assistant_storage.normalize_image_mime_type("image/png"),
            ("image/png", len("image/png")),
        )
        with self.assertRaises(ValueError):
            assistant_storage.normalize_image_mime_type("x" * 256)
        with self.assertRaises(ValueError):
            assistant_storage.normalize_image_mime_type("图像/png")


class AssistantMultipartFileCountTests(unittest.IsolatedAsyncioTestCase):
    async def test_six_files_are_rejected_before_any_file_read_or_parser_call(self) -> None:
        files = [_upload(f"{index}.png") for index in range(6)]
        request = _FakeRequest(_FakeForm(files))

        with patch.object(
            assistant_router.jd_attachment_service,
            "extract_jd_from_attachment",
            AsyncMock(),
        ) as parser, patch.object(
            assistant_router,
            "_persist_image_blob",
            AsyncMock(),
            create=True,
        ) as blob_writer:
            with self.assertRaises(HTTPException) as raised:
                await assistant_router._parse_stream_payload(request)

        self.assertEqual(raised.exception.status_code, 400)
        for file in files:
            file.read.assert_not_awaited()
        parser.assert_not_awaited()
        blob_writer.assert_not_awaited()

    async def test_many_tiny_parts_with_six_files_fail_before_attachment_work(self) -> None:
        files = [_upload(f"{index}.png") for index in range(6)]
        request = _FakeRequest(_FakeForm(files, extra_fields=5_000))

        with patch.object(
            assistant_router,
            "_prepare_attachment_result",
            AsyncMock(),
        ) as parser:
            with self.assertRaises(HTTPException):
                await assistant_router._parse_stream_payload(request)

        for file in files:
            file.read.assert_not_awaited()
        parser.assert_not_awaited()


class _PersistenceSession:
    def __init__(self):
        self.added = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    def add(self, value):
        self.added.append(value)


class AssistantPersistenceStorageTests(unittest.IsolatedAsyncioTestCase):
    async def test_turn_persists_bounded_image_blob_and_keeps_base64_out_of_message(self) -> None:
        from app.models import AIAssistantImageBlob

        session = _PersistenceSession()
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            user_id="user-1",
            title="AI 助理",
            latest_preview={},
            updated_at=None,
        )

        with patch.object(
            assistant_service,
            "ensure_user_storage_capacity",
            AsyncMock(),
            create=True,
        ):
            messages = await assistant_service.persist_assistant_turn(
                session,
                assistant_session,
                user_message="看图",
                user_attachments=[
                    {
                        "name": "a.png",
                        "kind": "image",
                        "mimeType": "image/png",
                        "imageB64": "eA==",
                    }
                ],
                assistant_text="收到",
                draft_card=None,
            )

        blobs = [value for value in session.added if isinstance(value, AIAssistantImageBlob)]
        self.assertEqual(len(blobs), 1)
        self.assertEqual(blobs[0].payload_base64, "eA==")
        attachment = messages[0].content_json["attachment"]
        self.assertEqual(attachment["imageBlobId"], str(blobs[0].id))
        self.assertNotIn("imageB64", attachment)

    async def test_oversized_message_content_is_rejected_before_commit(self) -> None:
        session = _PersistenceSession()
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            user_id="user-1",
            title="AI 助理",
            latest_preview={},
            updated_at=None,
        )

        with self.assertRaises(ValueError):
            await assistant_service.persist_assistant_turn(
                session,
                assistant_session,
                user_message="hello",
                assistant_text="x" * (8 * 1024 * 1024),
                draft_card=None,
            )

        session.commit.assert_not_awaited()

    async def test_long_thinking_is_utf8_safely_truncated_with_explicit_marker(self) -> None:
        session = _PersistenceSession()
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            user_id="user-1",
            title="AI 助理",
            latest_preview={},
            updated_at=None,
        )

        with patch.object(
            assistant_storage,
            "MAX_ASSISTANT_MESSAGE_CONTENT_BYTES",
            1_024,
        ), patch.object(
            assistant_service,
            "ensure_user_storage_capacity",
            AsyncMock(),
        ):
            messages = await assistant_service.persist_assistant_turn(
                session,
                assistant_session,
                user_message="hello",
                assistant_text="答" * 200,
                assistant_thinking="思" * 600,
                draft_card=None,
            )

        assistant_content = messages[1].content_json
        self.assertTrue(assistant_content["thinkingTruncated"])
        self.assertTrue(assistant_content["thinking"])
        self.assertLess(len(assistant_content["thinking"]), 600)
        self.assertLessEqual(
            assistant_storage.storage_json_utf8_size(assistant_content),
            1_024,
        )
        session.commit.assert_awaited_once()

    async def test_quota_rejection_after_ai_leaves_no_partial_message_or_blob(self) -> None:
        session = _PersistenceSession()
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            user_id="user-1",
            title="AI 助理",
            latest_preview={},
            updated_at=None,
        )

        with patch.object(
            assistant_service,
            "ensure_user_storage_capacity",
            AsyncMock(
                side_effect=assistant_storage.AssistantStorageQuotaExceeded(
                    "session_message_bytes"
                )
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                await assistant_service.persist_assistant_turn(
                    session,
                    assistant_session,
                    user_message="看图",
                    user_attachments=[
                        {
                            "name": "a.png",
                            "kind": "image",
                            "mimeType": "image/png",
                            "imageB64": "eA==",
                        }
                    ],
                    assistant_text="完成",
                    assistant_thinking="思考",
                    draft_card=None,
                )

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(session.added, [])
        session.commit.assert_not_awaited()
        event = assistant_router._assistant_stream_error_event(raised.exception)
        self.assertEqual(event["statusCode"], 429)


class _OneResult:
    def __init__(self, row):
        self._row = row

    def one(self):
        return self._row


class AssistantUserStorageQuotaTests(unittest.IsolatedAsyncioTestCase):
    async def test_projected_overflow_is_429_after_postgres_user_lock(self) -> None:
        session = object()
        usage = {
            "sessions": assistant_storage.MAX_USER_ASSISTANT_SESSIONS,
            "session_json_bytes": 0,
            "messages": 0,
            "message_bytes": 0,
            "image_blobs": 0,
            "image_blob_bytes": 0,
        }

        with patch.object(
            assistant_storage,
            "_dialect_name",
            return_value="postgresql",
        ), patch.object(
            assistant_storage,
            "_lock_user_storage",
            AsyncMock(),
        ) as lock_user, patch.object(
            assistant_storage,
            "_read_user_storage_usage",
            AsyncMock(return_value=usage),
        ):
            with self.assertRaises(HTTPException) as raised:
                await assistant_storage.ensure_user_storage_capacity(
                    session,
                    user_id="user-1",
                    projected_sessions=1,
                )

        self.assertEqual(raised.exception.status_code, 429)
        lock_user.assert_awaited_once_with(session, "user-1", "postgresql")

    async def test_usage_counts_all_existing_image_blobs_without_ttl_filter(self) -> None:
        session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    _OneResult((1, 10)),
                    _OneResult((2, 20)),
                    _OneResult((7, 700)),
                ]
            )
        )

        usage = await assistant_storage._read_user_storage_usage(
            session,
            user_id="user-1",
            dialect="postgresql",
        )

        self.assertEqual(usage["image_blobs"], 7)
        self.assertEqual(usage["image_blob_bytes"], 700)
        image_statement = session.execute.await_args_list[2].args[0]
        compiled = str(image_statement.compile()).lower()
        self.assertNotIn("expires", compiled)

    async def test_unknown_test_double_skips_db_specific_accounting(self) -> None:
        session = SimpleNamespace(execute=AsyncMock())
        await assistant_storage.ensure_user_storage_capacity(
            session,
            user_id="user-1",
            projected_messages=1,
        )
        session.execute.assert_not_awaited()

    async def test_per_session_message_overflow_is_rejected_under_same_lock(self) -> None:
        session = object()
        usage = {
            "sessions": 1,
            "session_json_bytes": 4,
            "messages": 1,
            "message_bytes": 10,
            "image_blobs": 0,
            "image_blob_bytes": 0,
        }
        with patch.object(
            assistant_storage,
            "_dialect_name",
            return_value="postgresql",
        ), patch.object(
            assistant_storage,
            "_lock_user_storage",
            AsyncMock(),
        ), patch.object(
            assistant_storage,
            "_read_user_storage_usage",
            AsyncMock(return_value=usage),
        ), patch.object(
            assistant_storage,
            "_read_session_message_usage",
            AsyncMock(
                return_value=(
                    assistant_storage.MAX_ASSISTANT_SESSION_MESSAGES,
                    10,
                )
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                await assistant_storage.ensure_user_storage_capacity(
                    session,
                    user_id="user-1",
                    assistant_session_id=uuid.uuid4(),
                    projected_messages=1,
                    projected_message_bytes=1,
                )

        self.assertEqual(raised.exception.status_code, 429)

    async def test_named_database_boundary_violation_is_rolled_back_and_mapped_429(self) -> None:
        original = SimpleNamespace(
            constraint_name="ck_ai_assistant_messages_content_size"
        )
        session = SimpleNamespace(
            commit=AsyncMock(
                side_effect=IntegrityError("insert", {}, original)
            ),
            rollback=AsyncMock(),
        )

        with self.assertRaises(HTTPException) as raised:
            await assistant_storage.commit_assistant_storage(session)

        self.assertEqual(raised.exception.status_code, 429)
        session.rollback.assert_awaited_once()


class AssistantBoundedHistoryQueryTests(unittest.IsolatedAsyncioTestCase):
    async def test_turn_history_uses_two_db_bounded_queries(self) -> None:
        session = SimpleNamespace(
            get_bind=lambda: SimpleNamespace(
                dialect=SimpleNamespace(name="postgresql")
            ),
            execute=AsyncMock(
                side_effect=[
                    SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [])),
                    SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [])),
                ]
            ),
        )

        result = await assistant_service.list_turn_history(
            session,
            assistant_session_id=uuid.uuid4(),
        )

        self.assertEqual(result, [])
        self.assertEqual(session.execute.await_count, 2)
        recent_sql = str(session.execute.await_args_list[0].args[0].compile()).lower()
        attachment_sql = str(session.execute.await_args_list[1].args[0].compile()).lower()
        self.assertIn("row_number() over", recent_sql)
        self.assertIn("sum(", recent_sql)
        self.assertIn("message_rank", recent_sql)
        self.assertIn("cumulative_bytes", recent_sql)
        self.assertIn("ai_assistant_messages.role", attachment_sql)
        self.assertIn("?", attachment_sql)

    async def test_explicit_old_filename_adds_bounded_db_match_query(self) -> None:
        old_message = SimpleNamespace(
            id=uuid.uuid4(),
            created_at=datetime(2025, 1, 1),
        )

        def result(items):
            return SimpleNamespace(
                scalars=lambda: SimpleNamespace(all=lambda: items)
            )

        session = SimpleNamespace(
            get_bind=lambda: SimpleNamespace(
                dialect=SimpleNamespace(name="postgresql")
            ),
            execute=AsyncMock(
                side_effect=[result([]), result([]), result([old_message])]
            ),
        )

        messages = await assistant_service.list_turn_history(
            session,
            assistant_session_id=uuid.uuid4(),
            user_message="请继续处理 fourth-old.pdf",
        )

        self.assertEqual(messages, [old_message])
        self.assertEqual(session.execute.await_count, 3)
        explicit_sql = str(session.execute.await_args_list[2].args[0].compile()).lower()
        self.assertIn("lower(", explicit_sql)
        self.assertIn("like", explicit_sql)

    def test_detail_cursor_round_trips_stable_timestamp_and_uuid(self) -> None:
        message = SimpleNamespace(
            id=uuid.uuid4(),
            created_at=datetime(2025, 1, 1, 12, 30, 45),
        )
        cursor = assistant_service._encode_message_cursor(message)
        self.assertEqual(
            assistant_service._decode_message_cursor(cursor),
            (message.created_at, message.id),
        )

    def test_session_cursor_round_trips_stable_timestamp_and_uuid(self) -> None:
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            updated_at=datetime(2025, 1, 2, 12, 30, 45),
        )
        cursor = assistant_service._encode_session_cursor(assistant_session)
        self.assertEqual(
            assistant_service._decode_session_cursor(cursor),
            (assistant_session.updated_at, assistant_session.id),
        )


if __name__ == "__main__":
    unittest.main()
