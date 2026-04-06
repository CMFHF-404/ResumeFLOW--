import os
import unittest
from datetime import datetime, timezone


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_AUDIENCE", "https://api.example.com")


_set_required_env_defaults()

from app.domain.feedback.feedback_notifier import (  # noqa: E402
    _build_text_payload,
    _format_contact,
    FeedbackNotification,
)


class FeedbackNotifierTests(unittest.TestCase):
    def test_format_contact_falls_back_when_contact_type_missing(self) -> None:
        self.assertEqual(_format_contact(None, "demo-wechat"), "demo-wechat")

    def test_format_contact_labels_email_contact(self) -> None:
        self.assertEqual(_format_contact("email", "user@example.com"), "邮箱: user@example.com")

    def test_build_text_payload_supports_legacy_contact_without_contact_type(self) -> None:
        payload = _build_text_payload(
            FeedbackNotification(
                feedback_id="feedback-1",
                user_id="user-1",
                category="bug",
                content="something happened",
                contact_type=None,
                contact="demo-wechat",
                context={},
                created_at=datetime(2026, 4, 6, tzinfo=timezone.utc),
            )
        )

        self.assertEqual(payload["msg_type"], "text")
        self.assertIn("联系方式: demo-wechat", payload["content"]["text"])
