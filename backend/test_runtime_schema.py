import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app import database
from app import main


RUNTIME_SCHEMA_STEPS = (
    "ensure_experience_version_tags_column",
    "ensure_experience_drafts_table",
    "ensure_export_render_snapshots_table",
    "ensure_ai_assistant_tables",
    "ensure_agent_api_keys_table",
    "ensure_ai_token_billing_tables",
    "ensure_redemption_code_tables",
    "ensure_feedback_contact_type_column",
    "ensure_feedback_images_column",
)


class RuntimeSchemaTests(unittest.IsolatedAsyncioTestCase):
    def test_bootstrap_schema_contains_runtime_model_additions(self) -> None:
        schema = (Path(__file__).resolve().parent / "schema.sql").read_text(encoding="utf-8")

        self.assertIn("key_plaintext TEXT", schema)
        self.assertIn("CREATE TABLE IF NOT EXISTS ai_assistant_image_blobs", schema)
        self.assertIn("idx_ai_assistant_image_blobs_session_id", schema)

    async def test_runtime_schema_runs_each_step_in_existing_order(self) -> None:
        calls: list[str] = []

        def make_step(name: str) -> AsyncMock:
            async def record_step() -> None:
                calls.append(name)

            return AsyncMock(side_effect=record_step)

        patches = [
            patch.object(database, name, make_step(name))
            for name in RUNTIME_SCHEMA_STEPS
        ]
        for step_patch in patches:
            step_patch.start()
        self.addCleanup(lambda: [step_patch.stop() for step_patch in reversed(patches)])

        await database.ensure_runtime_schema()

        self.assertEqual(calls, list(RUNTIME_SCHEMA_STEPS))

    async def test_dev_schema_only_adds_init_before_runtime_schema(self) -> None:
        calls: list[str] = []
        init_db = AsyncMock(side_effect=lambda: calls.append("init_db"))
        ensure_runtime_schema = AsyncMock(
            side_effect=lambda: calls.append("ensure_runtime_schema")
        )

        with (
            patch.object(database, "init_db", init_db),
            patch.object(database, "ensure_runtime_schema", ensure_runtime_schema),
        ):
            await database.ensure_dev_schema()

        self.assertEqual(calls, ["init_db", "ensure_runtime_schema"])

    async def test_application_lifespan_uses_runtime_schema_authority(self) -> None:
        calls: list[str] = []
        verify = AsyncMock(side_effect=lambda: calls.append("verify"))
        ensure_runtime_schema = AsyncMock(
            side_effect=lambda: calls.append("ensure_runtime_schema")
        )
        close_browser = AsyncMock(side_effect=lambda: calls.append("close_browser"))

        with (
            patch.object(main, "verify_db_connection", verify),
            patch.object(main, "ensure_runtime_schema", ensure_runtime_schema),
            patch.object(main, "close_browser", close_browser),
        ):
            async with main.lifespan(main.app):
                calls.append("yield")

        self.assertEqual(
            calls,
            ["verify", "ensure_runtime_schema", "yield", "close_browser"],
        )


if __name__ == "__main__":
    unittest.main()
