from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app import config


class ExportConfigTests(unittest.TestCase):
    def _load_with(self, **values: str):
        config.load_settings()
        with (
            patch.dict(os.environ, values, clear=False),
            patch.object(config, "_settings", None),
        ):
            return config.load_settings()

    def test_export_time_budgets_accept_documented_bounds(self) -> None:
        minimums = self._load_with(
            EXPORT_SNAPSHOT_TTL_SECONDS="30",
            EXPORT_RENDER_TIMEOUT_SECONDS="5",
        )
        maximums = self._load_with(
            EXPORT_SNAPSHOT_TTL_SECONDS="3600",
            EXPORT_RENDER_TIMEOUT_SECONDS="120",
        )

        self.assertEqual(minimums.export_snapshot_ttl_seconds, 30)
        self.assertEqual(minimums.export_render_timeout_seconds, 5)
        self.assertEqual(maximums.export_snapshot_ttl_seconds, 3600)
        self.assertEqual(maximums.export_render_timeout_seconds, 120)

    def test_export_time_budgets_reject_invalid_or_unbounded_values(self) -> None:
        cases = (
            {"EXPORT_SNAPSHOT_TTL_SECONDS": "29"},
            {"EXPORT_SNAPSHOT_TTL_SECONDS": "3601"},
            {"EXPORT_SNAPSHOT_TTL_SECONDS": "not-an-int"},
            {"EXPORT_RENDER_TIMEOUT_SECONDS": "4"},
            {"EXPORT_RENDER_TIMEOUT_SECONDS": "121"},
            {"EXPORT_RENDER_TIMEOUT_SECONDS": "not-an-int"},
        )

        for values in cases:
            with self.subTest(values=values), self.assertRaises(RuntimeError):
                self._load_with(**values)


if __name__ == "__main__":
    unittest.main()
