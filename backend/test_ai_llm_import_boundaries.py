import os
import subprocess
import sys
import textwrap
import unittest
from unittest.mock import AsyncMock, patch


class AILLMImportBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def test_llm_transport_import_and_usage_callback_do_not_load_billing_or_database(
        self,
    ) -> None:
        script = textwrap.dedent(
            """
            import asyncio
            import sys

            from app.domain.ai import llm_transport

            events = []
            asyncio.run(
                llm_transport._emit_usage_payload(
                    events.append,
                    {
                        "provider": "test",
                        "model": "test-model",
                        "request_label": "boundary",
                        "status": "success",
                        "prompt_tokens": 1,
                        "completion_tokens": 2,
                        "total_tokens": 3,
                        "metadata": {},
                    },
                )
            )

            assert len(events) == 1
            assert "app.domain.billing.billing_service" not in sys.modules
            assert "app.database" not in sys.modules
            """
        )
        env = os.environ.copy()
        env.setdefault(
            "DATABASE_URL",
            "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
        )

        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=os.path.dirname(__file__),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

    async def test_billing_bridge_preserves_usage_patch_points(self) -> None:
        from app.domain.ai import llm_transport
        from app.domain.billing import billing_service

        usage_callback = AsyncMock()
        emit_usage_callback = AsyncMock()
        record_current_usage = AsyncMock()
        payload = {
            "provider": "test",
            "model": "test-model",
            "request_label": "patch_compatibility",
            "status": "success",
            "prompt_tokens": 1,
            "completion_tokens": 2,
            "total_tokens": 3,
            "metadata": {},
        }

        with (
            patch.object(
                billing_service,
                "emit_usage_callback",
                emit_usage_callback,
            ),
            patch.object(
                billing_service,
                "record_current_usage",
                record_current_usage,
            ),
        ):
            await llm_transport._emit_usage_payload(usage_callback, payload)

        emit_usage_callback.assert_awaited_once_with(usage_callback, payload)
        record_current_usage.assert_awaited_once_with(payload)


if __name__ == "__main__":
    unittest.main()
