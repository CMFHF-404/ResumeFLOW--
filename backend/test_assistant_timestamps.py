"""Offline regression for PostgreSQL assistant timestamps and UTC pagination."""

import os
import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:password@localhost:5432/resumeflow")
os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")

from sqlalchemy.dialects.postgresql.asyncpg import dialect

from app.domain.assistant import assistant_service
from app.models import AIAssistantImageBlob, AIAssistantMessage, AIAssistantSession
from app.utils.time_utils import utc_now


class AssistantTimestampTests(unittest.IsolatedAsyncioTestCase):
    def test_timestamp_columns_match_production_and_keep_defaults(self):
        for model, names in (
            (AIAssistantSession, ("created_at", "updated_at")),
            (AIAssistantMessage, ("created_at",)),
            (AIAssistantImageBlob, ("created_at",)),
        ):
            for name in names:
                with self.subTest(model=model.__name__, field=name):
                    column = model.__table__.c[name]
                    self.assertTrue(column.type.timezone)
                    self.assertFalse(column.nullable)
                    self.assertIs(model.model_fields[name].default_factory, utc_now)

    async def test_utc_message_pages_bind_timestamptz_and_preserve_cursor(self):
        timestamp = datetime(2026, 9, 8, 0, 30, 26, 6264, tzinfo=timezone.utc)
        assistant_session = SimpleNamespace(id=uuid.uuid4())
        older, newer = [
            AIAssistantMessage(
                id=uuid.UUID(int=index), session_id=assistant_session.id,
                role="assistant", message_type="text",
                content_json={"text": f"message {index}"}, created_at=timestamp,
            )
            for index in (1, 2)
        ]

        def rows(items):
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: items))

        session = SimpleNamespace(
            get_bind=lambda: SimpleNamespace(dialect=SimpleNamespace(name="postgresql")),
            execute=AsyncMock(side_effect=[
                rows([newer]), SimpleNamespace(first=lambda: (older.id,)),
                SimpleNamespace(first=lambda: None),
                rows([older]), SimpleNamespace(first=lambda: None),
                SimpleNamespace(first=lambda: None),
            ]),
        )
        with patch.object(assistant_service, "get_session", AsyncMock(return_value=assistant_session)):
            first = await assistant_service.get_session_detail_page(
                session, "test-user", assistant_session.id, limit=1,
            )
            self.assertEqual(first.messages, [newer])
            self.assertTrue(first.truncated)
            self.assertEqual(
                assistant_service._decode_message_cursor(first.next_cursor),
                (timestamp, newer.id),
            )
            second = await assistant_service.get_session_detail_page(
                session, "test-user", assistant_session.id,
                limit=1, before_cursor=first.next_cursor,
            )
        self.assertEqual(second.messages, [older])
        self.assertFalse(second.truncated)
        self.assertIsNone(second.next_cursor)
        # First-page has_more, next-page bounded query, and next-page has_more
        # all bind timestamps using the real asyncpg dialect.
        for index in (1, 3, 4):
            compiled = session.execute.await_args_list[index].args[0].compile(dialect=dialect())
            sql = str(compiled)
            self.assertIn("TIMESTAMP WITH TIME ZONE", sql)
            self.assertNotIn("TIMESTAMP WITHOUT TIME ZONE", sql)
            dates = [value for value in compiled.params.values() if isinstance(value, datetime)]
            self.assertEqual(len(dates), 2)
            self.assertTrue(all(value == timestamp and value.tzinfo is timezone.utc for value in dates))


if __name__ == "__main__":
    unittest.main()
