from __future__ import annotations

import math
import unittest

from app.domain.resume_optimization.bank_suggestion_service import (
    build_bank_suggestions,
)


class BankSuggestionServiceTests(unittest.TestCase):
    def test_builds_ranked_unselected_suggestions_from_metadata_only(self) -> None:
        suggestions = build_bank_suggestions(
            analysis_result={
                "experienceMatches": [
                    {"id": "selected", "score": 99, "reason": "already used"},
                    {"id": "alpha", "score": 90.4, "reason": "research evidence"},
                    {"id": "beta", "score": 90.4, "reason": "delivery evidence"},
                    {"id": "zero", "score": 0, "reason": "not eligible"},
                    {"id": "negative", "score": -1, "reason": "not eligible"},
                    {"id": "boolean", "score": True, "reason": "not eligible"},
                    {"id": "infinite", "score": math.inf, "reason": "not eligible"},
                    {"id": "string", "score": "88", "reason": "not eligible"},
                    {"id": "missing", "score": 88, "reason": "not eligible"},
                ],
                "capabilityAnalysis": {
                    "experienceDiagnoses": [
                        {
                            "experienceId": "alpha",
                            "provenCapabilities": ["User research", "Discovery"],
                            "weakCapabilities": ["Discovery", "Roadmapping"],
                        },
                        {
                            "experience_id": "beta",
                            "proven_capabilities": [{"name": "Delivery"}],
                            "weak_capabilities": ["Stakeholder management"],
                        },
                    ]
                },
            },
            selected_master_ids={"selected"},
            bank_experience_metadata={
                "alpha": {"category": "project", "title": "Alpha", "org": "Acme"},
                "beta": {"category": "work", "title": "Beta", "org": "Beta Corp"},
                "missing": {"category": "work", "title": "", "org": "Unknown"},
            },
        )

        self.assertEqual([item.master_experience_id for item in suggestions], ["alpha", "beta"])
        self.assertEqual([item.suggestion_id for item in suggestions], ["BANK_001", "BANK_002"])
        self.assertEqual([item.match_score for item in suggestions], [90, 90])
        self.assertEqual(suggestions[0].reason, "research evidence")
        self.assertEqual(
            suggestions[0].capabilities,
            ["User research", "Discovery", "Roadmapping"],
        )
        self.assertEqual(
            suggestions[1].capabilities,
            ["Delivery", "Stakeholder management"],
        )
        for suggestion in suggestions:
            self.assertNotIn("star", suggestion.model_dump())
            self.assertNotIn("summary", suggestion.model_dump())
            self.assertNotIn("tags", suggestion.model_dump())

    def test_uses_first_duplicate_match_and_never_invents_incomplete_metadata(self) -> None:
        suggestions = build_bank_suggestions(
            analysis_result={
                "experience_matches": [
                    {"id": "duplicate", "score": 42, "reason": "first reason"},
                    {"id": "duplicate", "score": 99, "reason": "later reason"},
                    {"id": "no-category", "score": 98, "reason": "ignore"},
                    {"id": "no-title", "score": 97, "reason": "ignore"},
                    {"id": "no-org", "score": 96, "reason": "ignore"},
                ]
            },
            selected_master_ids=set(),
            bank_experience_metadata={
                "duplicate": {"category": "project", "title": "Deterministic", "org": "Org"},
                "no-category": {"title": "Title", "org": "Org"},
                "no-title": {"category": "work", "org": "Org"},
                "no-org": {"category": "work", "title": "Title"},
            },
        )

        self.assertEqual(len(suggestions), 1)
        self.assertEqual(suggestions[0].match_score, 42)
        self.assertEqual(suggestions[0].reason, "first reason")

    def test_ranks_by_raw_float_score_before_rounding_display_score(self) -> None:
        suggestions = build_bank_suggestions(
            analysis_result={
                "experienceMatches": [
                    {"id": "lower-raw", "score": 90.4, "reason": "lower"},
                    {"id": "higher-raw", "score": 90.49, "reason": "higher"},
                    {"id": "equal-raw", "score": 90.49, "reason": "equal"},
                ]
            },
            selected_master_ids=set(),
            bank_experience_metadata={
                "lower-raw": {"category": "project", "title": "Lower", "org": "Org"},
                "higher-raw": {"category": "project", "title": "Higher", "org": "Org"},
                "equal-raw": {"category": "project", "title": "Equal", "org": "Org"},
            },
        )

        self.assertEqual(
            [item.master_experience_id for item in suggestions],
            ["higher-raw", "equal-raw", "lower-raw"],
        )
        self.assertEqual([item.match_score for item in suggestions], [90, 90, 90])

    def test_clamps_limit_without_auto_assembly_or_mutating_inputs(self) -> None:
        analysis_result = {
            "experienceMatches": [
                {"id": "one", "score": 3, "reason": "one"},
                {"id": "two", "score": 2, "reason": "two"},
                {"id": "three", "score": 1, "reason": "three"},
                {"id": "four", "score": 1, "reason": "four"},
            ]
        }
        metadata = {
            item_id: {"category": "project", "title": item_id, "org": "Org"}
            for item_id in ("one", "two", "three", "four")
        }

        self.assertEqual(len(build_bank_suggestions(
            analysis_result=analysis_result,
            selected_master_ids=set(),
            bank_experience_metadata=metadata,
            limit=100,
        )), 3)
        self.assertEqual(build_bank_suggestions(
            analysis_result=analysis_result,
            selected_master_ids=set(),
            bank_experience_metadata=metadata,
            limit=-1,
        ), [])
        self.assertEqual(analysis_result["experienceMatches"][0]["id"], "one")
        self.assertNotIn("selection", analysis_result)

    def test_skips_unrepresentable_scores_and_blank_reasons_without_crashing(self) -> None:
        suggestions = build_bank_suggestions(
            analysis_result={
                "experienceMatches": [
                    {"id": "huge", "score": 10**10000, "reason": "too large"},
                    {"id": "blank-reason", "score": 99, "reason": "   "},
                    {"id": "valid", "score": 88, "reason": "  useful evidence  "},
                ],
                "capabilityAnalysis": {
                    "experienceDiagnoses": [
                        {
                            "experienceId": "valid",
                            "provenCapabilities": ["  ", " Research "],
                            "weakCapabilities": [{"name": "\t"}, {"name": " Delivery "}],
                        }
                    ]
                },
            },
            selected_master_ids=set(),
            bank_experience_metadata={
                item_id: {"category": "work", "title": item_id, "org": "Org"}
                for item_id in ("huge", "blank-reason", "valid")
            },
        )

        self.assertEqual([item.master_experience_id for item in suggestions], ["valid"])
        self.assertEqual(suggestions[0].reason, "useful evidence")
        self.assertEqual(suggestions[0].capabilities, ["Research", "Delivery"])
        for value in (
            suggestions[0].category,
            suggestions[0].title,
            suggestions[0].org,
            suggestions[0].reason,
            *suggestions[0].capabilities,
        ):
            self.assertTrue(value.strip())


if __name__ == "__main__":
    unittest.main()
