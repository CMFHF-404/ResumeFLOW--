import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()
sys.path.append(str(Path(__file__).parent))

from app.domain.parser import semantic_duplicate_detection  # noqa: E402
from app.domain.parser.schemas import (  # noqa: E402
    DuplicateMatch,
    ParsedExperienceItem,
    ParsedExperienceVersion,
)
from app.models import ExperienceCategory  # noqa: E402


def _parsed_item(
    item_id: str,
    *,
    category: ExperienceCategory = ExperienceCategory.PROJECT,
    title: str = "软瘾互助小组 发起人",
    org: str = "",
    duplicate: DuplicateMatch | None = None,
) -> ParsedExperienceItem:
    return ParsedExperienceItem(
        id=item_id,
        category=category,
        version=ParsedExperienceVersion(title=title, org=org),
        duplicate=duplicate or DuplicateMatch(is_duplicate=False),
    )


def _existing_entry(
    entry_id: str,
    *,
    category: ExperienceCategory = ExperienceCategory.PROJECT,
    title: str = "负责人",
    org: str = "软瘾互助小组",
):
    return SimpleNamespace(id=entry_id, category=category, title=title, org=org)


class ParserSemanticDuplicateDetectionTests(unittest.IsolatedAsyncioTestCase):
    def _settings(self, *, enabled: bool = True):
        return SimpleNamespace(
            ai_dedupe_enabled=enabled,
            ai_dedupe_model="qwen-dedupe",
            ai_dedupe_max_candidates=24,
        )

    async def test_exact_or_rule_duplicate_items_do_not_call_llm(self) -> None:
        item = _parsed_item(
            "parsed-1",
            duplicate=DuplicateMatch(is_duplicate=True, match_type="exact", match_score=1.0),
        )

        with patch.object(semantic_duplicate_detection, "settings", self._settings()):
            with patch.object(
                semantic_duplicate_detection,
                "call_llm_json",
                new_callable=AsyncMock,
            ) as llm_call:
                result = await semantic_duplicate_detection.apply_semantic_duplicate_flags(
                    [item],
                    [_existing_entry("exp-1")],
                    request_id="req-skip",
                )

        llm_call.assert_not_awaited()
        self.assertEqual(result[0].duplicate.match_type, "exact")

    async def test_gray_project_candidate_accepts_high_confidence_semantic_match(self) -> None:
        item = _parsed_item("parsed-1")
        existing = [_existing_entry("exp-1")]
        llm_payload = {
            "matches": [
                {
                    "item_id": "parsed-1",
                    "existing_id": "exp-1",
                    "is_duplicate": True,
                    "confidence": 0.82,
                    "reason": "同一项目经历，角色名称存在轻微漂移。",
                }
            ]
        }

        with patch.object(semantic_duplicate_detection, "settings", self._settings()):
            with patch.object(
                semantic_duplicate_detection,
                "call_llm_json",
                new_callable=AsyncMock,
                return_value=llm_payload,
            ) as llm_call:
                [result] = await semantic_duplicate_detection.apply_semantic_duplicate_flags(
                    [item],
                    existing,
                    request_id="req-semantic",
                )

        llm_call.assert_awaited_once()
        self.assertEqual(llm_call.await_args.kwargs["model"], "qwen-dedupe")
        self.assertTrue(result.duplicate.is_duplicate)
        self.assertEqual(result.duplicate.match_type, "semantic")
        self.assertEqual(result.duplicate.match_score, 0.82)
        self.assertEqual(result.duplicate.matched_existing_id, "exp-1")
        self.assertEqual(result.duplicate.match_reason, "同一项目经历，角色名称存在轻微漂移。")

    async def test_low_confidence_and_unknown_ids_do_not_override_rule_result(self) -> None:
        items = [_parsed_item("parsed-1"), _parsed_item("parsed-2")]
        existing = [_existing_entry("exp-1")]
        llm_payload = {
            "matches": [
                {
                    "item_id": "parsed-1",
                    "existing_id": "exp-1",
                    "is_duplicate": True,
                    "confidence": 0.74,
                    "reason": "置信度不足。",
                },
                {
                    "item_id": "parsed-2",
                    "existing_id": "missing-exp",
                    "is_duplicate": True,
                    "confidence": 0.96,
                    "reason": "未知 existing id。",
                },
            ]
        }

        with patch.object(semantic_duplicate_detection, "settings", self._settings()):
            with patch.object(
                semantic_duplicate_detection,
                "call_llm_json",
                new_callable=AsyncMock,
                return_value=llm_payload,
            ):
                result = await semantic_duplicate_detection.apply_semantic_duplicate_flags(
                    items,
                    existing,
                    request_id="req-ignore",
                )

        self.assertFalse(result[0].duplicate.is_duplicate)
        self.assertFalse(result[1].duplicate.is_duplicate)

    async def test_llm_error_falls_back_to_rule_result(self) -> None:
        item = _parsed_item("parsed-1")

        with patch.object(semantic_duplicate_detection, "settings", self._settings()):
            with patch.object(
                semantic_duplicate_detection,
                "call_llm_json",
                new_callable=AsyncMock,
                side_effect=RuntimeError("model unavailable"),
            ):
                [result] = await semantic_duplicate_detection.apply_semantic_duplicate_flags(
                    [item],
                    [_existing_entry("exp-1")],
                    request_id="req-error",
                )

        self.assertFalse(result.duplicate.is_duplicate)

    async def test_disabled_setting_skips_semantic_dedupe(self) -> None:
        item = _parsed_item("parsed-1")

        with patch.object(semantic_duplicate_detection, "settings", self._settings(enabled=False)):
            with patch.object(
                semantic_duplicate_detection,
                "call_llm_json",
                new_callable=AsyncMock,
            ) as llm_call:
                [result] = await semantic_duplicate_detection.apply_semantic_duplicate_flags(
                    [item],
                    [_existing_entry("exp-1")],
                    request_id="req-disabled",
                )

        llm_call.assert_not_awaited()
        self.assertFalse(result.duplicate.is_duplicate)


if __name__ == "__main__":
    unittest.main()
