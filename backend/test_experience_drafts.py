import os
import unittest

from sqlalchemy.exc import IntegrityError


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_AUDIENCE", "https://api.example.com")


_set_required_env_defaults()

from app.domain.experience import draft_service  # noqa: E402
from app.domain.experience.draft_schemas import ExperienceDraftUpsert  # noqa: E402
from app.domain.experience.experience_service import NotFoundError  # noqa: E402
from app.models import ExperienceCategory, ExperienceDraft  # noqa: E402


class _FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def first(self):
        return self._value


class _FakeExecuteResult:
    def __init__(self, value):
        self._value = value

    def scalars(self):
        return _FakeScalarResult(self._value)


class _FakeSession:
    def __init__(self, value):
        self.value = value
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _FakeExecuteResult(self.value)


class _ConcurrentInsertSession:
    def __init__(self, values):
        self.values = list(values)
        self.statements = []
        self.added = []
        self.commits = 0
        self.rollbacks = 0
        self.refreshed = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _FakeExecuteResult(self.values.pop(0))

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.commits += 1
        if self.commits == 1:
            raise IntegrityError("insert experience_drafts", {}, Exception("duplicate key"))

    async def rollback(self):
        self.rollbacks += 1

    async def refresh(self, value):
        self.refreshed.append(value)


class ExperienceDraftPayloadTests(unittest.TestCase):
    def test_normalizes_draft_payload_without_losing_card_data(self) -> None:
        payload = ExperienceDraftUpsert.model_validate(
            {
                "category": "work",
                "client_draft_key": "draft-1",
                "mode": "simple",
                "simple_text": "S\n---\nT",
                "card_data": {
                    "org": "原子简历",
                    "title": "",
                    "star": {"s": "", "t": "", "a": "行动", "r": ""},
                },
            }
        )

        normalized = draft_service.normalize_draft_payload(payload)

        self.assertEqual(normalized["category"], "work")
        self.assertEqual(normalized["client_draft_key"], "draft-1")
        self.assertEqual(normalized["mode"], "simple")
        self.assertEqual(normalized["simple_text"], "S\n---\nT")
        self.assertEqual(normalized["card_data"]["title"], "")
        self.assertEqual(normalized["card_data"]["star"]["a"], "行动")

    def test_rejects_invalid_draft_mode(self) -> None:
        with self.assertRaises(ValueError):
            ExperienceDraftUpsert.model_validate(
                {
                    "category": "project",
                    "client_draft_key": "draft-1",
                    "mode": "compact",
                    "simple_text": "",
                    "card_data": {},
                }
            )

    def test_rejects_blank_client_draft_key_after_trimming(self) -> None:
        with self.assertRaises(ValueError):
            ExperienceDraftUpsert.model_validate(
                {
                    "category": "work",
                    "client_draft_key": "   ",
                    "mode": "simple",
                    "simple_text": "",
                    "card_data": {},
                }
            )


class ExperienceDraftTargetOwnershipTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolves_target_master_id_owned_by_current_user(self) -> None:
        target_id = "11111111-1111-1111-1111-111111111111"
        session = _FakeSession(target_id)

        result = await draft_service.resolve_target_master_id_for_user(
            session,
            "user-1",
            target_id,
        )

        self.assertEqual(str(result), target_id)
        self.assertEqual(len(session.statements), 1)

    async def test_rejects_target_master_id_not_owned_by_current_user(self) -> None:
        session = _FakeSession(None)

        with self.assertRaises(NotFoundError):
            await draft_service.resolve_target_master_id_for_user(
                session,
                "user-1",
                "22222222-2222-2222-2222-222222222222",
            )


class ExperienceDraftUpsertTests(unittest.IsolatedAsyncioTestCase):
    async def test_recovers_when_concurrent_first_autosave_inserts_same_key(self) -> None:
        existing_draft = ExperienceDraft(
            user_id="user-1",
            category=ExperienceCategory.WORK,
            client_draft_key="draft-1",
            mode="simple",
            simple_text="old",
            card_data={"title": "old"},
        )
        session = _ConcurrentInsertSession([None, existing_draft])
        payload = ExperienceDraftUpsert.model_validate(
            {
                "category": "work",
                "client_draft_key": "draft-1",
                "mode": "expert",
                "simple_text": "new simple text",
                "card_data": {"title": "new"},
            }
        )

        result = await draft_service.upsert_experience_draft(session, "user-1", payload)

        self.assertIs(result, existing_draft)
        self.assertEqual(existing_draft.mode, "expert")
        self.assertEqual(existing_draft.simple_text, "new simple text")
        self.assertEqual(existing_draft.card_data["title"], "new")
        self.assertEqual(session.rollbacks, 1)
        self.assertEqual(session.commits, 2)
        self.assertEqual(session.refreshed, [existing_draft])


class ExperienceDraftSchemaTests(unittest.TestCase):
    def test_model_and_schema_define_independent_draft_storage(self) -> None:
        self.assertEqual(ExperienceDraft.__tablename__, "experience_drafts")
        self.assertTrue(hasattr(ExperienceDraft, "client_draft_key"))
        self.assertTrue(hasattr(ExperienceDraft, "simple_text"))
        self.assertTrue(hasattr(ExperienceDraft, "card_data"))

    def test_dev_schema_includes_experience_drafts_table(self) -> None:
        with open("app/database.py", "r", encoding="utf-8") as handle:
            source = handle.read()

        self.assertRegex(
            source,
            r"async def ensure_dev_schema\(\)[\s\S]*await ensure_experience_version_tags_column\(\)[\s\S]*await ensure_experience_drafts_table\(\)",
        )
