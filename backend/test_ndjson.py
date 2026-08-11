import json
import os
import unittest


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.ai import ai_router  # noqa: E402
from app.domain.assistant import assistant_router  # noqa: E402
from app.domain.parser import parser_router  # noqa: E402
from app.utils.ndjson import ndjson_line  # noqa: E402


class NdjsonLineTests(unittest.TestCase):
    def test_serializes_unicode_with_exactly_one_trailing_newline(self) -> None:
        payload = {"message": "中文 résumé 🙂", "details": {"city": "香港"}}

        line = ndjson_line(payload)

        self.assertTrue(line.endswith("\n"))
        self.assertFalse(line.endswith("\n\n"))
        self.assertIn("中文 résumé 🙂", line)
        self.assertNotIn("\\u4e2d", line)
        self.assertEqual(json.loads(line), payload)

    def test_routers_keep_their_private_patch_alias(self) -> None:
        self.assertIs(ai_router._ndjson_line, ndjson_line)
        self.assertIs(assistant_router._ndjson_line, ndjson_line)
        self.assertIs(parser_router._ndjson_line, ndjson_line)
