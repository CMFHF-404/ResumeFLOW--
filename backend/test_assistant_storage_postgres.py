"""Opt-in PostgreSQL coverage for atomic AI-assistant storage limits.

Requires ``RUN_ASSISTANT_STORAGE_POSTGRES_TESTS=1`` and an explicitly isolated
``ASSISTANT_STORAGE_TEST_DATABASE_URL``. The normal application DATABASE_URL is
never used.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
import unittest
import uuid
from unittest.mock import patch

import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
)
os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")

from app.domain.assistant import assistant_service, assistant_storage
from app.domain.assistant.schemas import AssistantSessionCreate
from app.models import AIAssistantImageBlob, AIAssistantSession


RUN_ENV = "RUN_ASSISTANT_STORAGE_POSTGRES_TESTS"
DATABASE_URL_ENV = "ASSISTANT_STORAGE_TEST_DATABASE_URL"


def _async_url(value: str) -> str:
    if value.startswith("postgresql+asyncpg://"):
        return value
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+asyncpg://", 1)
    if value.startswith("postgres://"):
        return value.replace("postgres://", "postgresql+asyncpg://", 1)
    raise AssertionError(f"{DATABASE_URL_ENV} must use PostgreSQL")


def _asyncpg_url(value: str) -> str:
    return _async_url(value).replace("postgresql+asyncpg://", "postgresql://", 1)


@unittest.skipUnless(
    os.environ.get(RUN_ENV) == "1" and os.environ.get(DATABASE_URL_ENV),
    f"requires {RUN_ENV}=1 and isolated {DATABASE_URL_ENV}",
)
class AssistantStoragePostgresTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.database_url = _async_url(os.environ[DATABASE_URL_ENV])
        self.schema_name = f"rf_assistant_storage_{uuid.uuid4().hex}"
        connection = await asyncpg.connect(_asyncpg_url(self.database_url))
        try:
            await connection.execute(f'CREATE SCHEMA "{self.schema_name}"')
            await connection.execute(f'SET search_path TO "{self.schema_name}"')
            await connection.execute(
                """
                CREATE TABLE ai_assistant_sessions (
                    id UUID PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    entry_source TEXT NOT NULL DEFAULT 'direct',
                    context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    latest_preview JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE TABLE ai_assistant_messages (
                    id UUID PRIMARY KEY,
                    session_id UUID NOT NULL REFERENCES ai_assistant_sessions(id) ON DELETE CASCADE,
                    role TEXT NOT NULL,
                    message_type TEXT NOT NULL,
                    content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE TABLE ai_assistant_image_blobs (
                    id UUID PRIMARY KEY,
                    session_id UUID NOT NULL REFERENCES ai_assistant_sessions(id) ON DELETE CASCADE,
                    mime_type TEXT NOT NULL DEFAULT '',
                    payload_base64 TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            migration = (
                Path(__file__).with_name("migrations")
                / "019_add_assistant_storage_limits.sql"
            ).read_text(encoding="utf-8")
            await connection.execute(migration)
        finally:
            await connection.close()

        self.engine = create_async_engine(
            self.database_url,
            connect_args={
                "statement_cache_size": 0,
                "server_settings": {"search_path": self.schema_name},
            },
            pool_size=4,
            max_overflow=0,
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def asyncTearDown(self) -> None:
        await self.engine.dispose()
        connection = await asyncpg.connect(_asyncpg_url(self.database_url))
        try:
            await connection.execute(
                f'DROP SCHEMA IF EXISTS "{self.schema_name}" CASCADE'
            )
        finally:
            await connection.close()

    async def test_context_and_message_db_byte_boundaries_match_application(self) -> None:
        context_overhead = assistant_storage.storage_json_utf8_size({"text": ""})
        context = {
            "text": "x"
            * (
                assistant_storage.MAX_ASSISTANT_SESSION_CONTEXT_BYTES
                - context_overhead
            )
        }
        async with self.sessions() as session:
            created = await assistant_service.create_session(
                session,
                "user-boundary",
                AssistantSessionCreate(context_json=context),
            )
            actual_context_bytes = (
                await session.execute(
                    text(
                        "SELECT octet_length(context_json::text) "
                        "FROM ai_assistant_sessions WHERE id = :id"
                    ),
                    {"id": created.id},
                )
            ).scalar_one()
            self.assertLessEqual(
                actual_context_bytes,
                assistant_storage.MAX_ASSISTANT_SESSION_CONTEXT_BYTES,
            )

            message_overhead = assistant_storage.storage_json_utf8_size(
                {"text": ""}
            )
            content = {
                "text": "x"
                * (
                    assistant_storage.MAX_ASSISTANT_MESSAGE_CONTENT_BYTES
                    - message_overhead
                )
            }
            await assistant_service.append_message(
                session,
                created,
                role="assistant",
                message_type="assistant_text",
                content_json=content,
            )

        with self.assertRaises(ValueError):
            assistant_storage.validate_session_context(
                {"text": context["text"] + "x"}
            )
        with self.assertRaises(ValueError):
            assistant_storage.validate_message_content(
                {"text": content["text"] + "x"}
            )
        with self.assertRaises(ValueError):
            assistant_storage.validate_session_context({"bad": "nul\x00value"})

    async def test_twenty_thousand_node_json_and_unicode_escapes_are_safe(self) -> None:
        context = {
            "items": [0] * (assistant_storage.MAX_JSON_NODES - 2),
            "unicode": "汉字\\\"\n",
        }
        # The extra unicode value is one additional node, so trim one list item.
        context["items"].pop()
        async with self.sessions() as session:
            await assistant_service.create_session(
                session,
                "user-nodes",
                AssistantSessionCreate(context_json=context),
            )
        with self.assertRaises(ValueError):
            assistant_storage.validate_session_context(
                {"items": [0] * assistant_storage.MAX_JSON_NODES}
            )

    async def test_two_concurrent_session_writers_admit_exactly_one(self) -> None:
        first_has_lock = asyncio.Event()

        async def writer(title: str, *, hold: bool) -> str:
            async with self.sessions() as session:
                try:
                    await assistant_storage.ensure_user_storage_capacity(
                        session,
                        user_id="user-race",
                        projected_sessions=1,
                        projected_session_json_bytes=4,
                    )
                except assistant_storage.AssistantStorageQuotaExceeded:
                    return "rejected"
                session.add(
                    AIAssistantSession(
                        user_id="user-race",
                        title=title,
                        mode="general",
                        entry_source="direct",
                        context_json={},
                        latest_preview={},
                    )
                )
                if hold:
                    first_has_lock.set()
                    await asyncio.sleep(0.15)
                await session.commit()
                return "created"

        with patch.object(
            assistant_storage,
            "MAX_USER_ASSISTANT_SESSIONS",
            1,
        ):
            first = asyncio.create_task(writer("first", hold=True))
            await first_has_lock.wait()
            second = asyncio.create_task(writer("second", hold=False))
            outcomes = await asyncio.gather(first, second)

        self.assertCountEqual(outcomes, ["created", "rejected"])

    async def test_existing_blob_counts_and_session_delete_releases_capacity(self) -> None:
        session_id = uuid.uuid4()
        async with self.sessions() as session:
            session.add(
                AIAssistantSession(
                    id=session_id,
                    user_id="user-blob",
                    title="blob",
                    mode="general",
                    entry_source="direct",
                    context_json={},
                    latest_preview={},
                )
            )
            # The models intentionally do not declare an ORM relationship;
            # flush the FK parent so SQLAlchemy cannot reorder this fixture.
            await session.flush()
            session.add(
                AIAssistantImageBlob(
                    session_id=session_id,
                    mime_type="image/png",
                    payload_base64="eA==",
                )
            )
            await session.commit()

        with patch.object(
            assistant_storage,
            "MAX_USER_ASSISTANT_IMAGE_BLOBS",
            1,
        ):
            async with self.sessions() as session:
                with self.assertRaises(
                    assistant_storage.AssistantStorageQuotaExceeded
                ):
                    await assistant_storage.ensure_user_storage_capacity(
                        session,
                        user_id="user-blob",
                        projected_image_blobs=1,
                        projected_image_blob_bytes=4,
                    )
                await session.rollback()

            async with self.sessions() as session:
                await assistant_service.delete_session(
                    session,
                    "user-blob",
                    session_id,
                )

            async with self.sessions() as session:
                await assistant_storage.ensure_user_storage_capacity(
                    session,
                    user_id="user-blob",
                    projected_image_blobs=1,
                    projected_image_blob_bytes=4,
                )
                await session.rollback()

    async def test_not_valid_legacy_context_is_projected_and_deletable(self) -> None:
        legacy_id = uuid.uuid4()
        connection = await asyncpg.connect(_asyncpg_url(self.database_url))
        try:
            await connection.execute(f'SET search_path TO "{self.schema_name}"')
            await connection.execute(
                "ALTER TABLE ai_assistant_sessions "
                "DROP CONSTRAINT ck_ai_assistant_sessions_context_object, "
                "DROP CONSTRAINT ck_ai_assistant_sessions_context_size"
            )
            await connection.execute(
                "INSERT INTO ai_assistant_sessions "
                "(id, user_id, title, mode, context_json) "
                "VALUES ($1, 'legacy-user', 'legacy', 'general', to_jsonb(repeat('x', 300000)))",
                legacy_id,
            )
            migration = (
                Path(__file__).with_name("migrations")
                / "019_add_assistant_storage_limits.sql"
            ).read_text(encoding="utf-8")
            await connection.execute(migration)
        finally:
            await connection.close()

        async with self.sessions() as session:
            projected = await assistant_service.get_session(
                session,
                "legacy-user",
                legacy_id,
            )
            self.assertTrue(
                projected.context_json["_meta"]["storageProjectionTruncated"]
            )
            await assistant_service.delete_session(
                session,
                "legacy-user",
                legacy_id,
            )


if __name__ == "__main__":
    unittest.main()
