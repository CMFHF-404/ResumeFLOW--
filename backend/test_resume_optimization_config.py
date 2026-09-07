from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app import config


class ResumeOptimizationConfigTests(unittest.TestCase):
    def _load_with(self, **values: str):
        environment = {
            "DATABASE_URL": "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
            "LOGTO_ISSUER": "https://example.logto.app/oidc",
            "LOGTO_APP_ID": "resume-spa-app-id",
            **values,
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(config, "_load_env", return_value=None),
            patch.object(config, "_settings", None),
        ):
            return config.load_settings()

    def test_resume_optimization_defaults_are_fail_closed(self) -> None:
        settings = self._load_with()

        self.assertFalse(settings.enable_resume_optimization)
        self.assertEqual(settings.resume_optimization_max_questions, 5)
        self.assertEqual(settings.resume_optimization_max_bank_suggestions, 3)

    def test_resume_optimization_config_accepts_documented_bounds(self) -> None:
        minimums = self._load_with(
            ENABLE_RESUME_OPTIMIZATION="true",
            RESUME_OPTIMIZATION_MAX_QUESTIONS="0",
            RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS="0",
        )
        maximums = self._load_with(
            RESUME_OPTIMIZATION_MAX_QUESTIONS="5",
            RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS="3",
        )

        self.assertTrue(minimums.enable_resume_optimization)
        self.assertEqual(minimums.resume_optimization_max_questions, 0)
        self.assertEqual(minimums.resume_optimization_max_bank_suggestions, 0)
        self.assertEqual(maximums.resume_optimization_max_questions, 5)
        self.assertEqual(maximums.resume_optimization_max_bank_suggestions, 3)

    def test_resume_optimization_config_rejects_invalid_bounds(self) -> None:
        cases = (
            {"RESUME_OPTIMIZATION_MAX_QUESTIONS": "-1"},
            {"RESUME_OPTIMIZATION_MAX_QUESTIONS": "6"},
            {"RESUME_OPTIMIZATION_MAX_QUESTIONS": "not-an-int"},
            {"RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS": "-1"},
            {"RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS": "4"},
            {"RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS": "not-an-int"},
        )

        for values in cases:
            with self.subTest(values=values), self.assertRaises(RuntimeError):
                self._load_with(**values)


if __name__ == "__main__":
    unittest.main()
