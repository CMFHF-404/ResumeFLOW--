import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app import database
from app import main
from app.models import ExportRenderSnapshot


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
        backend_root = Path(__file__).resolve().parent
        schema = (backend_root / "schema.sql").read_text(encoding="utf-8")

        self.assertIn("key_plaintext TEXT", schema)
        self.assertIn("runtime_schema_migration_markers", schema)
        self.assertIn("agent_api_key_plaintext_phase_b_runtime_guard", schema)
        self.assertIn("agent_api_keys.key_plaintext_phase_b", schema)
        self.assertIn("DROP TRIGGER IF EXISTS trg_agent_api_keys_discard_plaintext", schema)
        self.assertIn("DROP FUNCTION IF EXISTS discard_agent_api_key_plaintext", schema)
        self.assertNotIn("CREATE TRIGGER trg_agent_api_keys_discard_plaintext", schema)
        self.assertNotIn("SET key_plaintext = NULL", schema)
        self.assertIn("ADD COLUMN IF NOT EXISTS tags TEXT[]", schema)
        self.assertIn("ADD COLUMN IF NOT EXISTS contact_type TEXT", schema)
        self.assertIn("ADD COLUMN IF NOT EXISTS image_base64_list TEXT[]", schema)
        self.assertIn("uniq_agent_api_keys_active_user", schema)
        self.assertIn("CREATE TABLE IF NOT EXISTS ai_assistant_image_blobs", schema)
        self.assertIn("idx_ai_assistant_image_blobs_session_id", schema)

    def test_export_snapshot_claim_schema_is_aligned_across_bootstrap_paths(self) -> None:
        backend_root = Path(__file__).resolve().parent
        schema = (backend_root / "schema.sql").read_text(encoding="utf-8")
        runtime_schema = (backend_root / "app" / "database.py").read_text(
            encoding="utf-8"
        )
        migration = (
            backend_root
            / "migrations"
            / "018_add_export_render_snapshot_render_claims.sql"
        ).read_text(encoding="utf-8")
        required_fragments = (
            "render_claim_id UUID",
            "render_claim_expires_at TIMESTAMPTZ",
            "rendered_pdf BYTEA",
            "rendered_pdf_expires_at TIMESTAMPTZ",
            "idx_export_render_snapshots_render_claim_expires_at",
            "idx_export_render_snapshots_rendered_pdf_expires_at",
        )

        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, schema)
                self.assertIn(fragment, runtime_schema)
                self.assertIn(fragment, migration)

        for bootstrap_source in (schema, runtime_schema):
            self.assertIn(
                "idx_export_render_snapshots_user_id",
                bootstrap_source,
            )

        model_columns = ExportRenderSnapshot.__table__.c
        for column_name in (
            "render_claim_id",
            "render_claim_expires_at",
            "rendered_pdf",
            "rendered_pdf_expires_at",
        ):
            with self.subTest(column=column_name):
                self.assertIn(column_name, model_columns)

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
        payment_worker = type(
            "PaymentWorker",
            (),
            {
                "start": AsyncMock(
                    side_effect=lambda: calls.append("payment_start")
                ),
                "stop": AsyncMock(
                    side_effect=lambda: calls.append("payment_stop")
                ),
            },
        )()
        export_worker = type(
            "ExportWorker",
            (),
            {
                "start": AsyncMock(
                    side_effect=lambda: calls.append("export_start")
                ),
                "stop": AsyncMock(
                    side_effect=lambda: calls.append("export_stop")
                ),
            },
        )()

        with (
            patch.object(main, "verify_db_connection", verify),
            patch.object(main, "ensure_runtime_schema", ensure_runtime_schema),
            patch.object(main, "close_browser", close_browser),
            patch.object(main, "PaymentExpiryWorker", return_value=payment_worker),
            patch.object(
                main,
                "ExportSnapshotCleanupWorker",
                return_value=export_worker,
            ),
        ):
            async with main.lifespan(main.app):
                calls.append("yield")

        self.assertEqual(
            calls,
            [
                "verify",
                "ensure_runtime_schema",
                "payment_start",
                "export_start",
                "yield",
                "export_stop",
                "payment_stop",
                "close_browser",
            ],
        )


if __name__ == "__main__":
    unittest.main()
