import asyncio
import copy
import json
import re
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.domain.ai import ai_router, jd_analysis_service, prompts, resume_evaluation_service
from app.domain.ai.response_normalizers import (
    _extract_skill_ids,
)
from app.domain.ai.resume_evaluation import (
    DIMENSION_NAMES,
    DIMENSION_SUBSCORES,
    normalize_resume_evaluation,
)


TEST_FACT_METADATA = [
    {
        "fact_id": "FACT_001",
        "content": "将产品完成率从70%提升至88%",
        "verification_status": "user_claimed",
        "source": "resume.experiences[0].star.a",
        "confidence": 1,
    }
]


class JDAnalysisRouterErrorMappingTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_final_analysis_maps_to_bad_gateway(self):
        operation = AsyncMock(side_effect=ValueError("invalid repaired schema"))

        with self.assertRaises(HTTPException) as context:
            await ai_router._resolve_jd_analysis_response(operation())

        self.assertEqual(context.exception.status_code, 502)
        self.assertIn("invalid response", context.exception.detail)

    def test_stream_timeout_event_preserves_retryable_gateway_timeout_contract(self):
        event = ai_router._stream_error_event(
            HTTPException(status_code=504, detail="deep report timed out")
        )

        self.assertEqual(
            event,
            {
                "type": "error",
                "message": "deep report timed out",
                "statusCode": 504,
                "retryable": True,
            },
        )


def _subscores_for_total(spec, total, evidence_id="E001"):
    remaining = total
    result = []
    for name, maximum in spec:
        score = min(maximum, remaining)
        remaining -= score
        result.append(
            {
                "name": name,
                "maxScore": maximum,
                "score": score,
                "evidenceIds": [evidence_id] if score > 0 else [],
            }
        )
    if remaining:
        raise AssertionError(f"cannot allocate dimension total {total}")
    return result


def make_evaluation(
    *,
    totals=None,
    jd_match=82,
    fact_id="FACT_001",
    source_text="将产品完成率从70%提升至88%",
    verification_status="user_claimed",
):
    totals = totals or [70, 70, 70, 70, 70, 73]
    dimensions = []
    issues = []
    for index, ((dimension, spec), total) in enumerate(
        zip(DIMENSION_SUBSCORES, totals), start=1
    ):
        issue_id = f"ISSUE_{index:03d}"
        dimensions.append(
            {
                "dimension": dimension,
                "score": 1,
                "level": "wrong",
                "subscores": _subscores_for_total(spec, total),
                "strengths": [],
                "issues": [issue_id],
                "improvementQuestions": [],
            }
        )
        issues.append(
            {
                "issueId": issue_id,
                "description": f"{dimension}待改进",
                "primaryDimension": dimension,
                "relatedDimensions": [],
                "evidenceIds": [],
                "severity": "medium",
                "pointsNotEarned": 100 - total,
            }
        )
    return {
        "evaluationVersion": "resume_flow_v1",
        "evaluationScope": "full_resume",
        "targetRole": "产品经理",
        "overallScore": 1,
        "overallLevel": "wrong",
        "evaluationConfidence": 0.8,
        "scoreCalculation": {
            "dimensionSum": 6,
            "rawAverage": 1,
            "roundingRule": "wrong",
            "finalScore": 1,
        },
        "dimensions": dimensions,
        "evidence": [
            {
                "evidenceId": "E001",
                "sourceText": source_text,
                "location": "resume.experiences[0].star.a",
                "factId": fact_id,
                "verificationStatus": verification_status,
                "supportedDimensions": [item[0] for item in DIMENSION_SUBSCORES],
            }
        ],
        "issues": issues,
        "missingInformation": [],
        "riskFlags": [],
        "topPriorities": [],
        "jdMatch": jd_match,
    }


def make_analysis_result(*, jd_match=82):
    return {
        "matchPercentage": 9,
        "experienceMatches": [{"id": "exp-1", "score": 67, "reason": "原有独立项"}],
        "certificationMatches": [{"id": "cert-1", "score": 40, "reason": "原有独立项"}],
        "skillMatches": [{"id": "skill-1", "score": 88, "reason": "直接匹配"}],
        "jdInterpretation": {"roleFamily": "产品"},
        "capabilityAnalysis": {"coreCapabilities": []},
        "resumeEvaluation": make_evaluation(jd_match=jd_match),
    }


def make_cross_primary_analysis_result():
    result = make_analysis_result()
    evaluation = result["resumeEvaluation"]
    duplicate = {
        **evaluation["issues"][0],
        "issueId": "ISSUE_CROSS_PRIMARY",
        "primaryDimension": "STAR应用",
    }
    evaluation["issues"].append(duplicate)
    evaluation["dimensions"][1]["issues"].append("ISSUE_CROSS_PRIMARY")
    return result


def make_valid_issue_repair():
    evaluation = make_evaluation()
    return {
        "issueRepair": {
            "issues": copy.deepcopy(evaluation["issues"]),
            "dimensionIssueIds": {
                dimension["dimension"]: list(dimension["issues"])
                for dimension in evaluation["dimensions"]
            },
            "topPriorities": copy.deepcopy(evaluation["topPriorities"]),
        }
    }


def _to_snake(value):
    if isinstance(value, dict):
        return {
            re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower(): _to_snake(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_to_snake(item) for item in value]
    return value


class ResumeEvaluationNormalizerTests(unittest.TestCase):
    def test_valid_result_recalculates_dimension_and_half_up_overall_scores(self):
        normalized = normalize_resume_evaluation(
            make_evaluation(), jd_available=True, fact_metadata=TEST_FACT_METADATA
        )

        self.assertEqual([item["score"] for item in normalized["dimensions"]], [70, 70, 70, 70, 70, 73])
        self.assertEqual(normalized["scoreCalculation"]["dimensionSum"], 423)
        self.assertEqual(normalized["scoreCalculation"]["rawAverage"], 70.5)
        self.assertEqual(normalized["overallScore"], 71)
        self.assertEqual(normalized["overallLevel"], "合格")
        self.assertEqual(normalized["scoreCalculation"]["finalScore"], 71)

    def test_snake_case_payload_is_normalized_to_camel_case(self):
        result = normalize_resume_evaluation(
            _to_snake(make_evaluation()),
            jd_available=True,
            fact_metadata=TEST_FACT_METADATA,
        )

        self.assertEqual(result["evaluationVersion"], "resume_flow_v1")
        self.assertIn("improvementQuestions", result["dimensions"][0])

    def test_missing_fixed_dimension_is_rejected(self):
        evaluation = make_evaluation()
        evaluation["dimensions"].pop()

        with self.assertRaisesRegex(ValueError, "exactly six fixed dimensions"):
            normalize_resume_evaluation(
                evaluation, jd_available=True, fact_metadata=TEST_FACT_METADATA
            )

    def test_invalid_evidence_reference_is_rejected(self):
        evaluation = make_evaluation()
        evaluation["dimensions"][0]["subscores"][0]["evidenceIds"] = ["E404"]

        with self.assertRaisesRegex(ValueError, "unknown evidence ids"):
            normalize_resume_evaluation(
                evaluation, jd_available=True, fact_metadata=TEST_FACT_METADATA
            )

    def test_no_jd_forces_jd_match_to_null(self):
        normalized = normalize_resume_evaluation(
            make_evaluation(jd_match=99),
            jd_available=False,
            fact_metadata=TEST_FACT_METADATA,
        )

        self.assertIsNone(normalized["jdMatch"])

    def test_duplicate_issue_is_deduplicated_and_references_are_remapped(self):
        evaluation = make_evaluation()
        issue = evaluation["issues"][-1]
        issue["relatedDimensions"] = ["STAR应用", "STAR应用", "成果量化"]
        duplicate = dict(issue, issueId="ISSUE_DUPLICATE")
        evaluation["issues"].append(duplicate)
        evaluation["dimensions"][-1]["issues"].append("ISSUE_DUPLICATE")
        evaluation["topPriorities"] = [
            {"priority": 4, "issueId": "ISSUE_DUPLICATE", "action": "补充前后指标", "expectedScoreGain": 10}
        ]

        normalized = normalize_resume_evaluation(
            evaluation, jd_available=True, fact_metadata=TEST_FACT_METADATA
        )

        self.assertEqual(len(normalized["issues"]), 6)
        self.assertNotIn("ISSUE_DUPLICATE", [item["issueId"] for item in normalized["issues"]])
        self.assertEqual(normalized["dimensions"][-1]["issues"], ["ISSUE_006"])
        self.assertEqual(normalized["issues"][-1]["relatedDimensions"], ["STAR应用"])
        self.assertEqual(normalized["topPriorities"][0]["issueId"], "ISSUE_006")

    def test_issue_points_are_reconciled_to_dimension_score(self):
        evaluation = make_evaluation()
        evaluation["issues"][0]["pointsNotEarned"] -= 1

        normalized = normalize_resume_evaluation(
            evaluation, jd_available=True, fact_metadata=TEST_FACT_METADATA
        )

        self.assertEqual(normalized["issues"][0]["pointsNotEarned"], 30)

    def test_issue_points_use_deterministic_largest_remainder_order(self):
        evaluation = make_evaluation()
        evaluation["issues"][0]["pointsNotEarned"] = 1
        for index in range(2, 5):
            issue_id = f"ISSUE_WEIGHT_{index}"
            evaluation["issues"].append(
                {
                    **evaluation["issues"][0],
                    "issueId": issue_id,
                    "description": f"逻辑清晰独立问题{index}",
                    "pointsNotEarned": 1,
                }
            )
            evaluation["dimensions"][0]["issues"].append(issue_id)

        normalized = normalize_resume_evaluation(
            evaluation, jd_available=True, fact_metadata=TEST_FACT_METADATA
        )
        points = {
            item["issueId"]: item["pointsNotEarned"]
            for item in normalized["issues"]
        }

        self.assertEqual(
            [
                points["ISSUE_001"],
                points["ISSUE_WEIGHT_2"],
                points["ISSUE_WEIGHT_3"],
                points["ISSUE_WEIGHT_4"],
            ],
            [8, 8, 7, 7],
        )

    def test_all_zero_issue_weights_are_distributed_evenly(self):
        evaluation = make_evaluation()
        evaluation["issues"][0]["pointsNotEarned"] = 0
        evaluation["issues"].append(
            {
                **evaluation["issues"][0],
                "issueId": "ISSUE_ZERO_2",
                "description": "逻辑清晰另一个独立问题",
            }
        )
        evaluation["dimensions"][0]["issues"].append("ISSUE_ZERO_2")

        normalized = normalize_resume_evaluation(
            evaluation, jd_available=True, fact_metadata=TEST_FACT_METADATA
        )
        points = {
            item["issueId"]: item["pointsNotEarned"]
            for item in normalized["issues"]
        }

        self.assertEqual(points["ISSUE_001"], 15)
        self.assertEqual(points["ISSUE_ZERO_2"], 15)

    def test_full_score_dimension_sets_all_referenced_issue_points_to_zero(self):
        evaluation = make_evaluation(totals=[100, 70, 70, 70, 70, 73])
        evaluation["issues"][0]["pointsNotEarned"] = 100

        normalized = normalize_resume_evaluation(
            evaluation, jd_available=True, fact_metadata=TEST_FACT_METADATA
        )

        self.assertEqual(normalized["issues"][0]["pointsNotEarned"], 0)

    def test_positive_dimension_gap_without_issue_is_rejected(self):
        evaluation = make_evaluation()
        evaluation["issues"] = evaluation["issues"][1:]
        evaluation["dimensions"][0]["issues"] = []

        with self.assertRaisesRegex(ValueError, "without any referenced issue"):
            normalize_resume_evaluation(
                evaluation, jd_available=True, fact_metadata=TEST_FACT_METADATA
            )

    def test_issue_points_must_be_in_zero_to_one_hundred_range(self):
        for invalid_points in (-1, 101):
            with self.subTest(invalid_points=invalid_points):
                evaluation = make_evaluation()
                evaluation["issues"][0]["pointsNotEarned"] = invalid_points
                with self.assertRaisesRegex(ValueError, "must be between 0 and 100"):
                    normalize_resume_evaluation(
                        evaluation,
                        jd_available=True,
                        fact_metadata=TEST_FACT_METADATA,
                    )

    def test_issue_can_only_be_referenced_by_its_primary_dimension(self):
        evaluation = make_evaluation()
        evaluation["dimensions"][1]["issues"].append("ISSUE_001")

        with self.assertRaisesRegex(ValueError, "may only be referenced by its primaryDimension"):
            normalize_resume_evaluation(
                evaluation, jd_available=True, fact_metadata=TEST_FACT_METADATA
            )

    def test_every_global_issue_must_be_referenced_exactly_once(self):
        evaluation = make_evaluation()
        evaluation["issues"].append(
            {
                "issueId": "ISSUE_UNREFERENCED",
                "description": "未归档的问题",
                "primaryDimension": "逻辑清晰",
                "relatedDimensions": [],
                "evidenceIds": [],
                "severity": "low",
                "pointsNotEarned": 0,
            }
        )

        with self.assertRaisesRegex(ValueError, "referenced by exactly one dimension"):
            normalize_resume_evaluation(
                evaluation, jd_available=True, fact_metadata=TEST_FACT_METADATA
            )

    def test_same_issue_description_cannot_cross_primary_dimensions(self):
        evaluation = make_evaluation()
        evaluation["issues"][0]["description"] = "缺少结果指标"
        evaluation["issues"].append(
            {
                **evaluation["issues"][0],
                "issueId": "ISSUE_CROSS_DIMENSION",
                "primaryDimension": "STAR应用",
                "description": "结果指标缺失",
            }
        )

        with self.assertRaisesRegex(ValueError, "cannot use multiple primary dimensions"):
            normalize_resume_evaluation(
                evaluation, jd_available=True, fact_metadata=TEST_FACT_METADATA
            )

    def test_major_issue_categories_detect_cross_dimension_paraphrases(self):
        cases = [
            ("缺少结果层", "结果未说明"),
            ("叙事顺序混乱", "信息组织顺序不清晰"),
            ("句子过长难以扫读", "扫读困难且长句冗长"),
            ("教育模块缺失", "缺少教育经历"),
            ("岗位术语不专业", "专业术语使用不足"),
        ]
        for first, second in cases:
            with self.subTest(first=first, second=second):
                evaluation = make_evaluation()
                evaluation["issues"][0]["description"] = first
                evaluation["issues"][1]["description"] = second
                with self.assertRaisesRegex(ValueError, "cannot use multiple primary dimensions"):
                    normalize_resume_evaluation(
                        evaluation,
                        jd_available=True,
                        fact_metadata=TEST_FACT_METADATA,
                    )

    def test_same_evidence_can_support_distinct_result_and_quantification_issues(self):
        evaluation = make_evaluation()
        evaluation["issues"][1]["description"] = "缺少结果层"
        evaluation["issues"][1]["evidenceIds"] = ["E001"]
        evaluation["issues"][5]["description"] = "成果缺少数字"
        evaluation["issues"][5]["evidenceIds"] = ["E001"]

        normalized = normalize_resume_evaluation(
            evaluation,
            jd_available=True,
            fact_metadata=TEST_FACT_METADATA,
        )

        self.assertEqual(normalized["issues"][1]["primaryDimension"], "STAR应用")
        self.assertEqual(normalized["issues"][5]["primaryDimension"], "成果量化")

    def test_unique_fact_id_in_evidence_refs_is_mapped_to_response_evidence_id(self):
        evaluation = make_evaluation()
        evaluation["issues"][0]["evidenceIds"] = ["FACT_001"]
        evaluation["riskFlags"] = [
            {
                "type": "unverified_fact",
                "description": "需要复核表述",
                "evidenceIds": ["FACT_001"],
            }
        ]
        evaluation["dimensions"][0]["subscores"][0]["evidenceIds"] = ["FACT_001"]

        normalized = normalize_resume_evaluation(
            evaluation,
            jd_available=True,
            fact_metadata=TEST_FACT_METADATA,
        )

        self.assertEqual(normalized["issues"][0]["evidenceIds"], ["E001"])
        self.assertEqual(normalized["riskFlags"][0]["evidenceIds"], ["E001"])
        self.assertEqual(
            normalized["dimensions"][0]["subscores"][0]["evidenceIds"],
            ["E001"],
        )

    def test_ambiguous_fact_id_in_evidence_refs_is_rejected(self):
        evaluation = make_evaluation()
        evaluation["evidence"].append(
            {
                **evaluation["evidence"][0],
                "evidenceId": "E002",
            }
        )
        evaluation["issues"][0]["evidenceIds"] = ["FACT_001"]

        with self.assertRaisesRegex(ValueError, "unknown evidence ids: FACT_001"):
            normalize_resume_evaluation(
                evaluation,
                jd_available=True,
                fact_metadata=TEST_FACT_METADATA,
            )

    def test_evidence_fact_id_must_exist_in_current_request(self):
        with self.assertRaisesRegex(ValueError, "unknown factId"):
            normalize_resume_evaluation(
                make_evaluation(fact_id="FACT_404"),
                jd_available=True,
                fact_metadata=TEST_FACT_METADATA,
            )

    def test_missing_evidence_fact_id_is_inferred_from_one_grounded_fact(self):
        for raw_fact_id in (None, ""):
            with self.subTest(raw_fact_id=raw_fact_id):
                evaluation = make_evaluation()
                if raw_fact_id is None:
                    del evaluation["evidence"][0]["factId"]
                else:
                    evaluation["evidence"][0]["factId"] = raw_fact_id

                normalized = normalize_resume_evaluation(
                    evaluation,
                    jd_available=True,
                    fact_metadata=TEST_FACT_METADATA,
                )

                self.assertEqual(normalized["evidence"][0]["factId"], "FACT_001")

    def test_missing_evidence_fact_id_rejects_no_grounded_fact(self):
        evaluation = make_evaluation(source_text="不存在于任何当前事实中的证据")
        del evaluation["evidence"][0]["factId"]

        with self.assertRaisesRegex(ValueError, "cannot be uniquely inferred"):
            normalize_resume_evaluation(
                evaluation,
                jd_available=True,
                fact_metadata=TEST_FACT_METADATA,
            )

    def test_missing_evidence_fact_id_rejects_duplicate_grounded_facts(self):
        evaluation = make_evaluation()
        del evaluation["evidence"][0]["factId"]
        duplicate_facts = [
            TEST_FACT_METADATA[0],
            {**TEST_FACT_METADATA[0], "fact_id": "FACT_002"},
        ]

        with self.assertRaisesRegex(ValueError, "cannot be uniquely inferred"):
            normalize_resume_evaluation(
                evaluation,
                jd_available=True,
                fact_metadata=duplicate_facts,
            )

    def test_explicit_unknown_evidence_fact_id_is_not_inferred(self):
        evaluation = make_evaluation(fact_id="FACT_EXPLICIT_UNKNOWN")

        with self.assertRaisesRegex(ValueError, "unknown factId FACT_EXPLICIT_UNKNOWN"):
            normalize_resume_evaluation(
                evaluation,
                jd_available=True,
                fact_metadata=TEST_FACT_METADATA,
            )

    def test_known_fact_id_fills_missing_source_and_status(self):
        for raw_value in (None, ""):
            with self.subTest(raw_value=raw_value):
                evaluation = make_evaluation()
                for field in ("sourceText", "verificationStatus"):
                    if raw_value is None:
                        del evaluation["evidence"][0][field]
                    else:
                        evaluation["evidence"][0][field] = raw_value

                normalized = normalize_resume_evaluation(
                    evaluation,
                    jd_available=True,
                    fact_metadata=TEST_FACT_METADATA,
                )

                self.assertEqual(
                    normalized["evidence"][0]["sourceText"],
                    TEST_FACT_METADATA[0]["content"],
                )
                self.assertEqual(
                    normalized["evidence"][0]["verificationStatus"],
                    "user_claimed",
                )

    def test_known_fact_id_still_rejects_explicit_status_conflict(self):
        with self.assertRaisesRegex(ValueError, "verificationStatus does not match"):
            normalize_resume_evaluation(
                make_evaluation(verification_status="verified"),
                jd_available=True,
                fact_metadata=TEST_FACT_METADATA,
            )

    def test_unknown_fact_id_rejects_even_when_source_and_status_are_missing(self):
        evaluation = make_evaluation(fact_id="FACT_UNKNOWN")
        del evaluation["evidence"][0]["sourceText"]
        del evaluation["evidence"][0]["verificationStatus"]

        with self.assertRaisesRegex(ValueError, "unknown factId FACT_UNKNOWN"):
            normalize_resume_evaluation(
                evaluation,
                jd_available=True,
                fact_metadata=TEST_FACT_METADATA,
            )

    def test_missing_fact_id_and_source_cannot_be_inferred(self):
        evaluation = make_evaluation()
        del evaluation["evidence"][0]["factId"]
        del evaluation["evidence"][0]["sourceText"]

        with self.assertRaisesRegex(ValueError, "sourceText must be a string"):
            normalize_resume_evaluation(
                evaluation,
                jd_available=True,
                fact_metadata=TEST_FACT_METADATA,
            )

    def test_evidence_status_must_match_current_fact_metadata(self):
        with self.assertRaisesRegex(ValueError, "verificationStatus does not match"):
            normalize_resume_evaluation(
                make_evaluation(verification_status="verified"),
                jd_available=True,
                fact_metadata=TEST_FACT_METADATA,
            )

    def test_known_fact_id_reanchors_fabricated_source_to_fact_content(self):
        normalized = normalize_resume_evaluation(
            make_evaluation(source_text="推动收入增长百分之五十"),
            jd_available=True,
            fact_metadata=TEST_FACT_METADATA,
        )

        self.assertEqual(normalized["evidence"][0]["factId"], "FACT_001")
        self.assertEqual(
            normalized["evidence"][0]["sourceText"],
            TEST_FACT_METADATA[0]["content"],
        )

    def test_wrong_known_fact_id_is_remapped_by_unique_source_and_status(self):
        facts = [
            TEST_FACT_METADATA[0],
            {
                **TEST_FACT_METADATA[0],
                "fact_id": "FACT_028",
                "content": "将另一个项目完成率从60%提升至80%",
            },
        ]

        normalized = normalize_resume_evaluation(
            make_evaluation(fact_id="FACT_028"),
            jd_available=True,
            fact_metadata=facts,
        )

        self.assertEqual(normalized["evidence"][0]["factId"], "FACT_001")
        self.assertEqual(
            normalized["evidence"][0]["sourceText"],
            "将产品完成率从70%提升至88%",
        )
        self.assertEqual(
            normalized["evidence"][0]["verificationStatus"],
            "user_claimed",
        )

    def test_wrong_known_fact_id_rejects_ambiguous_source_remap(self):
        facts = [
            TEST_FACT_METADATA[0],
            {**TEST_FACT_METADATA[0], "fact_id": "FACT_DUPLICATE"},
            {
                **TEST_FACT_METADATA[0],
                "fact_id": "FACT_028",
                "content": "另一个不匹配当前引用文本的事实",
            },
        ]

        with self.assertRaisesRegex(ValueError, "ambiguously matches multiple facts"):
            normalize_resume_evaluation(
                make_evaluation(fact_id="FACT_028"),
                jd_available=True,
                fact_metadata=facts,
            )

    def test_wrong_known_fact_id_reanchors_source_with_no_remap_candidate(self):
        facts = [
            TEST_FACT_METADATA[0],
            {
                **TEST_FACT_METADATA[0],
                "fact_id": "FACT_028",
                "content": "将另一个项目完成率从60%提升至80%",
            },
        ]

        normalized = normalize_resume_evaluation(
            make_evaluation(
                fact_id="FACT_028",
                source_text="当前请求中不存在的显式引用文本",
            ),
            jd_available=True,
            fact_metadata=facts,
        )

        self.assertEqual(normalized["evidence"][0]["factId"], "FACT_028")
        self.assertEqual(
            normalized["evidence"][0]["sourceText"],
            "将另一个项目完成率从60%提升至80%",
        )

    def test_faithful_fact_excerpt_is_accepted(self):
        normalized = normalize_resume_evaluation(
            make_evaluation(source_text="完成率从70%"),
            jd_available=True,
            fact_metadata=TEST_FACT_METADATA,
        )

        self.assertEqual(normalized["evidence"][0]["sourceText"], "完成率从70%")

    def test_supported_dimensions_keep_aliases_and_drop_unknown_extras(self):
        evaluation = make_evaluation()
        evaluation["evidence"][0]["supportedDimensions"] = [
            "logic_clarity",
            *list(DIMENSION_NAMES[1:]),
            "团队协作",
            "logic_clarity",
        ]

        normalized = normalize_resume_evaluation(
            evaluation,
            jd_available=True,
            fact_metadata=TEST_FACT_METADATA,
        )

        self.assertEqual(
            normalized["evidence"][0]["supportedDimensions"],
            list(DIMENSION_NAMES),
        )

    def test_supported_dimensions_are_derived_from_positive_grounded_usage(self):
        evaluation = make_evaluation()
        evaluation["evidence"][0]["supportedDimensions"] = [
            "团队协作",
            "领导力",
        ]

        normalized = normalize_resume_evaluation(
            evaluation,
            jd_available=True,
            fact_metadata=TEST_FACT_METADATA,
        )

        self.assertEqual(
            normalized["evidence"][0]["supportedDimensions"],
            list(DIMENSION_NAMES),
        )

    def test_missing_supported_dimensions_do_not_bypass_evidence_grounding(self):
        evaluation = make_evaluation(source_text="未出现在当前事实中的内容")
        evaluation["evidence"][0]["supportedDimensions"] = []
        del evaluation["evidence"][0]["factId"]

        with self.assertRaisesRegex(ValueError, "cannot be uniquely inferred"):
            normalize_resume_evaluation(
                evaluation,
                jd_available=True,
                fact_metadata=TEST_FACT_METADATA,
            )

    def test_missing_supported_dimensions_do_not_allow_unverified_positive_evidence(self):
        evaluation = make_evaluation(verification_status="unverified")
        evaluation["evidence"][0]["supportedDimensions"] = []
        facts = [dict(TEST_FACT_METADATA[0], verification_status="unverified")]

        with self.assertRaisesRegex(ValueError, "uses unverified evidence positively"):
            normalize_resume_evaluation(
                evaluation,
                jd_available=True,
                fact_metadata=facts,
            )

    def test_supported_dimension_non_string_extras_remain_invalid(self):
        for invalid_value in (None, 1, {"dimension": "逻辑清晰"}):
            with self.subTest(invalid_value=invalid_value):
                evaluation = make_evaluation()
                evaluation["evidence"][0]["supportedDimensions"].append(invalid_value)
                with self.assertRaisesRegex(ValueError, "must be a string"):
                    normalize_resume_evaluation(
                        evaluation,
                        jd_available=True,
                        fact_metadata=TEST_FACT_METADATA,
                    )

    def test_quantification_without_effective_numbers_is_capped_at_49(self):
        facts = [
            dict(
                TEST_FACT_METADATA[0],
                content="负责产品需求分析并交付上线结果",
            )
        ]
        with self.assertRaisesRegex(ValueError, "成果量化 score 50 exceeds cap 49"):
            normalize_resume_evaluation(
                make_evaluation(
                    totals=[70, 70, 70, 70, 70, 50],
                    source_text="负责产品需求分析并交付上线结果",
                ),
                jd_available=True,
                fact_metadata=facts,
            )

    def test_quantification_with_only_process_or_scale_numbers_is_capped_at_74(self):
        facts = [
            dict(
                TEST_FACT_METADATA[0],
                content="完成3轮用户调研，覆盖100名用户",
            )
        ]
        with self.assertRaisesRegex(ValueError, "成果量化 score 75 exceeds cap 74"):
            normalize_resume_evaluation(
                make_evaluation(
                    totals=[70, 70, 70, 70, 70, 75],
                    source_text="完成3轮用户调研，覆盖100名用户",
                ),
                jd_available=True,
                fact_metadata=facts,
            )

    def test_process_count_is_not_upgraded_by_unrelated_business_wording(self):
        facts = [
            dict(
                TEST_FACT_METADATA[0],
                content="围绕效率问题完成3轮调研，以提升后续方案质量",
            )
        ]
        with self.assertRaisesRegex(ValueError, "成果量化 score 75 exceeds cap 74"):
            normalize_resume_evaluation(
                make_evaluation(
                    totals=[70, 70, 70, 70, 70, 75],
                    source_text="围绕效率问题完成3轮调研，以提升后续方案质量",
                ),
                jd_available=True,
                fact_metadata=facts,
            )

    def test_process_count_is_not_upgraded_by_distant_change_verb(self):
        facts = [
            dict(
                TEST_FACT_METADATA[0],
                content="提升用户体验并完成3次迭代",
            )
        ]
        with self.assertRaisesRegex(ValueError, "成果量化 score 75 exceeds cap 74"):
            normalize_resume_evaluation(
                make_evaluation(
                    totals=[70, 70, 70, 70, 70, 75],
                    source_text="提升用户体验并完成3次迭代",
                ),
                jd_available=True,
                    fact_metadata=facts,
                )

    def test_process_count_is_not_upgraded_by_nearby_change_word_without_metric(self):
        facts = [
            dict(
                TEST_FACT_METADATA[0],
                content="提升体验做3次迭代",
            )
        ]
        with self.assertRaisesRegex(ValueError, "成果量化 score 75 exceeds cap 74"):
            normalize_resume_evaluation(
                make_evaluation(
                    totals=[70, 70, 70, 70, 70, 75],
                    source_text="提升体验做3次迭代",
                ),
                jd_available=True,
                fact_metadata=facts,
            )

    def test_numeric_business_result_can_use_a_count_unit_when_metric_is_bound(self):
        facts = [
            dict(
                TEST_FACT_METADATA[0],
                content="活跃用户增长100人",
            )
        ]
        normalized = normalize_resume_evaluation(
            make_evaluation(
                totals=[70, 70, 70, 70, 70, 85],
                source_text="活跃用户增长100人",
            ),
            jd_available=True,
            fact_metadata=facts,
        )

        self.assertEqual(normalized["dimensions"][-1]["score"], 85)

    def test_profile_and_credential_numbers_are_not_quantification_evidence(self):
        cases = [
            ("13800138000", "resume.profile.phone"),
            ("20260807001", "resume.certifications[0].credentialId"),
        ]
        for content, source in cases:
            with self.subTest(source=source):
                facts = [
                    dict(TEST_FACT_METADATA[0], content=content, source=source)
                ]
                with self.assertRaisesRegex(ValueError, "成果量化 score 50 exceeds cap 49"):
                    normalize_resume_evaluation(
                        make_evaluation(
                            totals=[70, 70, 70, 70, 70, 50],
                            source_text=content,
                        ),
                        jd_available=True,
                        fact_metadata=facts,
                    )

    def test_technology_versions_and_standard_ids_are_not_quantification_evidence(self):
        cases = [
            ("熟练使用Python 3和React 18", "resume.skills[0].name"),
            ("持有ISO 9001认证", "resume.certifications[0].name"),
        ]
        for content, source in cases:
            with self.subTest(content=content):
                facts = [
                    dict(TEST_FACT_METADATA[0], content=content, source=source)
                ]
                with self.assertRaisesRegex(ValueError, "成果量化 score 50 exceeds cap 49"):
                    normalize_resume_evaluation(
                        make_evaluation(
                            totals=[70, 70, 70, 70, 70, 50],
                            source_text=content,
                        ),
                        jd_available=True,
                        fact_metadata=facts,
                    )

    def test_quantification_accepts_score_above_74_with_numeric_business_result(self):
        normalized = normalize_resume_evaluation(
            make_evaluation(totals=[70, 70, 70, 70, 70, 85]),
            jd_available=True,
            fact_metadata=TEST_FACT_METADATA,
        )

        self.assertEqual(normalized["dimensions"][-1]["score"], 85)

    def test_pure_date_or_date_field_does_not_count_as_effective_number(self):
        for source in (
            "resume.experiences[0].start_date",
            "resume.experiences[0].star.r",
        ):
            with self.subTest(source=source):
                facts = [
                    dict(
                        TEST_FACT_METADATA[0],
                        content="2024-01至2024-06",
                        source=source,
                    )
                ]
                with self.assertRaisesRegex(ValueError, "exceeds cap 49"):
                    normalize_resume_evaluation(
                        make_evaluation(
                            totals=[70, 70, 70, 70, 70, 50],
                            source_text="2024-01至2024-06",
                        ),
                        jd_available=True,
                        fact_metadata=facts,
                    )

    def test_user_claimed_positive_evidence_caps_confidence_at_point_89(self):
        evaluation = make_evaluation()
        evaluation["evaluationConfidence"] = 0.9
        with self.assertRaisesRegex(ValueError, "must not exceed 0.89"):
            normalize_resume_evaluation(
                evaluation,
                jd_available=True,
                fact_metadata=TEST_FACT_METADATA,
            )

        evaluation["evaluationConfidence"] = 0.89
        normalized = normalize_resume_evaluation(
            evaluation,
            jd_available=True,
            fact_metadata=TEST_FACT_METADATA,
        )
        self.assertEqual(normalized["evaluationConfidence"], 0.89)

    def test_verified_positive_evidence_can_keep_full_confidence(self):
        facts = [dict(TEST_FACT_METADATA[0], verification_status="verified")]
        evaluation = make_evaluation(verification_status="verified")
        evaluation["evaluationConfidence"] = 1.0

        normalized = normalize_resume_evaluation(
            evaluation,
            jd_available=True,
            fact_metadata=facts,
        )

        self.assertEqual(normalized["evaluationConfidence"], 1.0)

    def test_unverified_or_inferred_fact_cannot_support_positive_subscore(self):
        for status in ("unverified", "inferred"):
            with self.subTest(status=status):
                facts = [dict(TEST_FACT_METADATA[0], verification_status=status)]
                with self.assertRaisesRegex(ValueError, f"uses {status} evidence positively"):
                    normalize_resume_evaluation(
                        make_evaluation(verification_status=status),
                        jd_available=True,
                        fact_metadata=facts,
                    )

    def test_positive_subscore_requires_a_grounded_evidence_reference(self):
        evaluation = make_evaluation()
        evaluation["dimensions"][0]["subscores"][0]["evidenceIds"] = []

        with self.assertRaisesRegex(ValueError, "positive score without evidence"):
            normalize_resume_evaluation(
                evaluation,
                jd_available=True,
                fact_metadata=TEST_FACT_METADATA,
            )


class SplitResumeEvaluationServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.wrapper = json.dumps(
            {
                "evaluation_scope": "full_resume",
                "target_role": "产品经理",
                "resume": {"skills": [{"id": "selected-skill", "name": "PRD"}]},
                "experience_atoms": [{"id": "exp-1"}],
                "match_candidates": {
                    "certifications": [{"id": "cert-1"}],
                    "skills": [
                        {"id": "skill-1", "name": "SQL"},
                        {"id": "skill-2", "name": "调研"},
                    ],
                },
                "fact_metadata": TEST_FACT_METADATA,
            },
            ensure_ascii=False,
        )

    def test_legacy_snapshot_gets_grounded_user_claimed_fact_metadata(self):
        evaluation_input = resume_evaluation_service._build_full_resume_evaluation_input(
            "JD",
            json.dumps({"summary": "真实旧简历事实", "skills": []}, ensure_ascii=False),
        )

        self.assertEqual(
            evaluation_input["fact_metadata"],
            [
                {
                    "fact_id": "LEGACY_FACT_001",
                    "content": "真实旧简历事实",
                    "verification_status": "user_claimed",
                    "source": "resume.summary",
                    "confidence": 1,
                }
            ],
        )

    def test_router_exposes_separate_light_and_deep_paths(self):
        paths = {route.path for route in ai_router.router.routes}

        self.assertIn("/api/analyze-jd", paths)
        self.assertIn("/api/analyze-jd/stream", paths)
        self.assertIn("/api/resume-evaluation", paths)
        self.assertIn("/api/resume-evaluation/stream", paths)

    def test_light_prompt_does_not_request_deep_report(self):
        self.assertNotIn("RESUME_EVALUATION_RULES", prompts.JD_ANALYSIS)
        self.assertNotIn("also return 'resumeEvaluation'", prompts.JD_ANALYSIS)
        self.assertIn("single top-level key 'resumeEvaluation'", prompts.RESUME_EVALUATION)

    async def test_lightweight_jd_analysis_keeps_jd_score_and_never_repairs_evaluation(self):
        model_result = make_analysis_result()
        model_result["resumeEvaluation"] = {"dimensions": []}
        call_mock = AsyncMock(return_value=model_result)

        with patch.object(jd_analysis_service, "_call_llm", call_mock):
            result = await jd_analysis_service.analyze_jd("产品经理 JD", self.wrapper)

        self.assertEqual(result["matchPercentage"], 9)
        self.assertNotIn("resumeEvaluation", result)
        self.assertEqual(call_mock.await_count, 1)

    async def test_deep_evaluation_returns_wrapper_and_uses_canonical_jd_match(self):
        model_result = make_analysis_result(jd_match=12)
        call_mock = AsyncMock(return_value=model_result)

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "产品经理 JD",
                self.wrapper,
                82,
            )

        self.assertEqual(set(result), {"resumeEvaluation"})
        self.assertEqual(result["resumeEvaluation"]["overallScore"], 71)
        self.assertEqual(result["resumeEvaluation"]["jdMatch"], 82)
        self.assertEqual(call_mock.await_args.kwargs["lane"], "default")
        self.assertEqual(call_mock.await_args.kwargs["gemini_thinking_level"], "low")
        user_content = call_mock.await_args.args[0][1]["content"]
        self.assertIn('"canonical_jd_match": 82', user_content)

    async def test_deep_evaluation_without_jd_forces_null_jd_match(self):
        call_mock = AsyncMock(return_value=make_analysis_result(jd_match=91))

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "",
                self.wrapper,
            )

        self.assertIsNone(result["resumeEvaluation"]["jdMatch"])

    async def test_issue_point_mismatch_is_reconciled_without_repair(self):
        model_result = make_analysis_result()
        model_result["resumeEvaluation"]["issues"][0]["pointsNotEarned"] = 1
        call_mock = AsyncMock(return_value=model_result)

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "JD",
                self.wrapper,
                82,
            )

        self.assertEqual(
            result["resumeEvaluation"]["issues"][0]["pointsNotEarned"],
            30,
        )
        self.assertEqual(call_mock.await_count, 1)

    async def test_missing_supported_dimension_bookkeeping_is_derived_without_repair(self):
        model_result = make_analysis_result()
        model_result["resumeEvaluation"]["evidence"][0]["supportedDimensions"] = []
        call_mock = AsyncMock(return_value=model_result)

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "JD",
                self.wrapper,
                82,
            )

        self.assertEqual(
            result["resumeEvaluation"]["evidence"][0]["supportedDimensions"],
            list(DIMENSION_NAMES),
        )
        self.assertEqual(call_mock.await_count, 1)

    async def test_unique_fact_id_reference_is_normalized_without_repair(self):
        model_result = make_analysis_result()
        model_result["resumeEvaluation"]["issues"][0]["evidenceIds"] = ["FACT_001"]
        call_mock = AsyncMock(return_value=model_result)

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "JD",
                self.wrapper,
                82,
            )

        self.assertEqual(
            result["resumeEvaluation"]["issues"][0]["evidenceIds"],
            ["E001"],
        )
        self.assertEqual(call_mock.await_count, 1)

    async def test_missing_evidence_fact_id_is_grounded_without_repair(self):
        model_result = make_analysis_result()
        del model_result["resumeEvaluation"]["evidence"][0]["factId"]
        call_mock = AsyncMock(return_value=model_result)

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "JD",
                self.wrapper,
                82,
            )

        self.assertEqual(
            result["resumeEvaluation"]["evidence"][0]["factId"],
            "FACT_001",
        )
        self.assertEqual(call_mock.await_count, 1)

    async def test_known_fact_id_fills_missing_evidence_fields_without_repair(self):
        model_result = make_analysis_result()
        del model_result["resumeEvaluation"]["evidence"][0]["sourceText"]
        del model_result["resumeEvaluation"]["evidence"][0]["verificationStatus"]
        call_mock = AsyncMock(return_value=model_result)

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "JD",
                self.wrapper,
                82,
            )

        evidence = result["resumeEvaluation"]["evidence"][0]
        self.assertEqual(evidence["sourceText"], TEST_FACT_METADATA[0]["content"])
        self.assertEqual(evidence["verificationStatus"], "user_claimed")
        self.assertEqual(call_mock.await_count, 1)

    async def test_wrong_known_fact_id_is_uniquely_remapped_without_repair(self):
        evaluation_input = json.loads(self.wrapper)
        evaluation_input["fact_metadata"].append(
            {
                **TEST_FACT_METADATA[0],
                "fact_id": "FACT_028",
                "content": "另一个不匹配当前引用文本的事实",
            }
        )
        model_result = make_analysis_result()
        model_result["resumeEvaluation"]["evidence"][0]["factId"] = "FACT_028"
        call_mock = AsyncMock(return_value=model_result)

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "JD",
                json.dumps(evaluation_input, ensure_ascii=False),
                82,
            )

        evidence = result["resumeEvaluation"]["evidence"][0]
        self.assertEqual(evidence["factId"], "FACT_001")
        self.assertEqual(
            evidence["sourceText"],
            "将产品完成率从70%提升至88%",
        )
        self.assertEqual(evidence["verificationStatus"], "user_claimed")
        self.assertEqual(call_mock.await_count, 1)

    async def test_singleton_object_list_is_unwrapped_without_repair(self):
        call_mock = AsyncMock(return_value=[make_analysis_result()])

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "JD",
                self.wrapper,
                82,
            )

        self.assertEqual(result["resumeEvaluation"]["overallScore"], 71)
        self.assertEqual(call_mock.await_count, 1)

    async def test_multi_item_list_is_rejected_then_repaired(self):
        invalid_result = [make_analysis_result(), make_analysis_result()]
        call_mock = AsyncMock(side_effect=[invalid_result, make_analysis_result()])

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "JD",
                self.wrapper,
                82,
            )

        self.assertEqual(result["resumeEvaluation"]["overallScore"], 71)
        self.assertEqual(call_mock.await_count, 2)
        repair_payload = call_mock.await_args.args[0][1]["content"]
        self.assertIn('"invalid_resume_evaluation": [{', repair_payload)

    async def test_non_dict_result_can_be_repaired_without_attribute_error(self):
        call_mock = AsyncMock(side_effect=["malformed result", make_analysis_result()])

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "JD",
                self.wrapper,
                82,
            )

        self.assertEqual(result["resumeEvaluation"]["overallScore"], 71)
        self.assertEqual(call_mock.await_count, 2)
        repair_payload = call_mock.await_args.args[0][1]["content"]
        self.assertIn('"invalid_resume_evaluation": "malformed result"', repair_payload)

    async def test_full_repair_fabricated_source_reanchors_locally_without_third_call(self):
        repaired = make_analysis_result()
        repaired["resumeEvaluation"]["evidence"][0]["sourceText"] = (
            "模型修复时生成但未绑定当前事实的文本"
        )
        call_mock = AsyncMock(
            side_effect=[
                {"resumeEvaluation": {"dimensions": []}},
                repaired,
            ]
        )

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "JD",
                self.wrapper,
                82,
            )

        self.assertEqual(call_mock.await_count, 2)
        self.assertEqual(
            result["resumeEvaluation"]["evidence"][0]["sourceText"],
            TEST_FACT_METADATA[0]["content"],
        )

    async def test_cross_primary_issue_uses_compact_patch_and_two_calls(self):
        call_mock = AsyncMock(
            side_effect=[
                make_cross_primary_analysis_result(),
                make_valid_issue_repair(),
            ]
        )

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "JD",
                self.wrapper,
                82,
            )

        self.assertEqual(call_mock.await_count, 2)
        self.assertEqual(
            call_mock.await_args.kwargs["request_label"],
            "resume_evaluation_issue_repair",
        )
        self.assertEqual(call_mock.await_args.kwargs["lane"], "default")
        self.assertEqual(
            call_mock.await_args.kwargs["gemini_thinking_level"],
            "minimal",
        )
        repair_content = call_mock.await_args.args[0][1]["content"]
        compact_payload = json.loads(repair_content.split("\n", 1)[1])
        self.assertEqual(
            set(compact_payload),
            {
                "validation_error",
                "dimensions",
                "issues",
                "topPriorities",
                "validEvidenceIds",
            },
        )
        self.assertNotIn("fact_metadata", repair_content)
        self.assertNotIn("sourceText", repair_content)
        self.assertNotIn("resumeEvaluation", repair_content)
        self.assertEqual(compact_payload["validEvidenceIds"], ["E001"])
        self.assertEqual(len(compact_payload["dimensions"]), 6)
        self.assertEqual(len(result["resumeEvaluation"]["issues"]), 6)

    def test_cross_primary_compact_payload_projects_allowlist_and_bounds_raw_fields(self):
        raw_result = make_cross_primary_analysis_result()
        evaluation = raw_result["resumeEvaluation"]
        oversized_text = "超长内容" * 1000
        evaluation["issues"] = [
            {
                **evaluation["issues"][0],
                "issueId": f"ISSUE_{index:03d}_" + ("X" * 300),
                "description": oversized_text,
                "relatedDimensions": ["逻辑清晰"] * 100,
                "evidenceIds": ["E001"] * 100,
                "sourceText": "SHOULD_NOT_LEAK_SOURCE",
                "fact_metadata": {"secret": "SHOULD_NOT_LEAK_FACT"},
                "extra": "SHOULD_NOT_LEAK_EXTRA",
            }
            for index in range(80)
        ]
        evaluation["topPriorities"] = [
            {
                "priority": index + 1,
                "action": oversized_text,
                "issueId": "ISSUE_001",
                "expectedScoreGain": 10,
                "sourceText": "SHOULD_NOT_LEAK_PRIORITY_SOURCE",
                "extra": "SHOULD_NOT_LEAK_PRIORITY_EXTRA",
            }
            for index in range(30)
        ]
        evaluation["issues"][0]["pointsNotEarned"] = 10**10000
        evaluation["topPriorities"][0]["priority"] = 10**10000

        payload = resume_evaluation_service._compact_issue_repair_payload(
            raw_result,
            validation_error=ValueError("x" * 5000),
        )
        serialized = json.dumps(payload, ensure_ascii=False)

        self.assertEqual(
            set(payload["issues"][0]),
            {
                "issueId",
                "description",
                "primaryDimension",
                "relatedDimensions",
                "evidenceIds",
                "severity",
                "pointsNotEarned",
            },
        )
        self.assertEqual(
            set(payload["topPriorities"][0]),
            {"priority", "action", "issueId", "expectedScoreGain"},
        )
        self.assertLessEqual(
            len(payload["issues"]),
            resume_evaluation_service._COMPACT_REPAIR_MAX_ISSUES,
        )
        self.assertLessEqual(
            len(payload["topPriorities"]),
            resume_evaluation_service._COMPACT_REPAIR_MAX_PRIORITIES,
        )
        self.assertLessEqual(
            len(payload["issues"][0]["description"]),
            resume_evaluation_service._COMPACT_REPAIR_MAX_TEXT_CHARS,
        )
        self.assertLessEqual(
            len(payload["issues"][0]["relatedDimensions"]),
            resume_evaluation_service._COMPACT_REPAIR_MAX_REFS,
        )
        self.assertLessEqual(
            len(payload["validation_error"]),
            resume_evaluation_service._COMPACT_REPAIR_MAX_TEXT_CHARS,
        )
        self.assertNotIn("sourceText", serialized)
        self.assertNotIn("fact_metadata", serialized)
        self.assertNotIn("SHOULD_NOT_LEAK", serialized)

    async def test_invalid_cross_primary_patch_never_calls_model_a_third_time(self):
        call_mock = AsyncMock(
            side_effect=[
                make_cross_primary_analysis_result(),
                {"issueRepair": {"issues": []}},
            ]
        )

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            with self.assertRaisesRegex(ValueError, "after one repair attempt"):
                await resume_evaluation_service.analyze_resume_evaluation(
                    "JD",
                    self.wrapper,
                    82,
                )

        self.assertEqual(call_mock.await_count, 2)

    async def test_cross_primary_patch_that_still_violates_contract_never_retries(self):
        invalid_repair = make_valid_issue_repair()
        duplicate = {
            **invalid_repair["issueRepair"]["issues"][0],
            "issueId": "ISSUE_STILL_CROSS_PRIMARY",
            "primaryDimension": "STAR应用",
        }
        invalid_repair["issueRepair"]["issues"].append(duplicate)
        invalid_repair["issueRepair"]["dimensionIssueIds"]["STAR应用"].append(
            "ISSUE_STILL_CROSS_PRIMARY"
        )
        call_mock = AsyncMock(
            side_effect=[make_cross_primary_analysis_result(), invalid_repair]
        )

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            with self.assertRaisesRegex(ValueError, "after one repair attempt"):
                await resume_evaluation_service.analyze_resume_evaluation(
                    "JD",
                    self.wrapper,
                    82,
                )

        self.assertEqual(call_mock.await_count, 2)

    async def test_cross_primary_issue_repair_timeout_is_bounded(self):
        calls = 0

        async def call_llm(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                return make_cross_primary_analysis_result()
            await asyncio.Event().wait()
            return make_valid_issue_repair()

        with patch.object(resume_evaluation_service, "_call_llm", side_effect=call_llm):
            with patch.object(resume_evaluation_service, "_REPAIR_TIMEOUT_SECONDS", 0.01):
                with self.assertRaises(HTTPException) as context:
                    await resume_evaluation_service.analyze_resume_evaluation(
                        "JD",
                        self.wrapper,
                        82,
                    )

        self.assertEqual(context.exception.status_code, 504)
        self.assertEqual(calls, 2)

    async def test_cross_primary_issue_repair_external_cancellation_propagates(self):
        repair_started = asyncio.Event()
        calls = 0

        async def call_llm(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                return make_cross_primary_analysis_result()
            repair_started.set()
            await asyncio.Event().wait()
            return make_valid_issue_repair()

        with patch.object(resume_evaluation_service, "_call_llm", side_effect=call_llm):
            task = asyncio.create_task(
                resume_evaluation_service.analyze_resume_evaluation(
                    "JD",
                    self.wrapper,
                    82,
                )
            )
            await repair_started.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        self.assertEqual(calls, 2)

    async def test_invalid_deep_structure_gets_one_compact_repair(self):
        repaired = make_analysis_result()
        call_mock = AsyncMock(
            side_effect=[
                {"resumeEvaluation": {"dimensions": []}},
                repaired,
            ]
        )

        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation(
                "JD",
                self.wrapper,
                82,
            )

        self.assertEqual(result["resumeEvaluation"]["overallScore"], 71)
        self.assertEqual(call_mock.await_count, 2)
        repair_messages = call_mock.await_args.args[0]
        self.assertEqual(len(repair_messages), 2)
        self.assertNotIn("experienceMatches", repair_messages[1]["content"])
        self.assertEqual(call_mock.await_args.kwargs["request_label"], "resume_evaluation_repair")
        self.assertEqual(call_mock.await_args.kwargs["lane"], "default")
        self.assertEqual(
            call_mock.await_args.kwargs["gemini_thinking_level"],
            "minimal",
        )

    def test_deep_timeout_budgets_allow_one_bounded_fallback_repair(self):
        self.assertEqual(resume_evaluation_service._TOTAL_TIMEOUT_SECONDS, 150.0)
        self.assertEqual(resume_evaluation_service._REPAIR_TIMEOUT_SECONDS, 75.0)
        self.assertLess(
            resume_evaluation_service._REPAIR_TIMEOUT_SECONDS,
            resume_evaluation_service._TOTAL_TIMEOUT_SECONDS,
        )

    async def test_repair_timeout_has_short_independent_boundary(self):
        calls = 0

        async def call_llm(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                return {"resumeEvaluation": {"dimensions": []}}
            await asyncio.sleep(1)
            return make_analysis_result()

        with patch.object(resume_evaluation_service, "_call_llm", side_effect=call_llm):
            with patch.object(resume_evaluation_service, "_REPAIR_TIMEOUT_SECONDS", 0.01):
                with self.assertRaises(HTTPException) as context:
                    await resume_evaluation_service.analyze_resume_evaluation(
                        "JD",
                        self.wrapper,
                        82,
                    )

        self.assertEqual(context.exception.status_code, 504)
        self.assertEqual(calls, 2)
        self.assertIn("75-second safety limit", context.exception.detail)

    async def test_sync_deep_operation_has_one_total_timeout(self):
        async def slow_call(*args, **kwargs):
            await asyncio.sleep(1)
            return make_analysis_result()

        with patch.object(resume_evaluation_service, "_call_llm", side_effect=slow_call):
            with patch.object(resume_evaluation_service, "_TOTAL_TIMEOUT_SECONDS", 0.01):
                with self.assertRaises(HTTPException) as context:
                    await resume_evaluation_service.analyze_resume_evaluation(
                        "JD",
                        self.wrapper,
                        82,
                    )

        self.assertEqual(context.exception.status_code, 504)
        self.assertIn("Please retry", context.exception.detail)
        self.assertIn("150-second safety limit", context.exception.detail)

    async def test_provider_unavailable_without_fallback_remains_clear(self):
        provider_error = HTTPException(
            status_code=503,
            detail=(
                "The configured resume-analysis AI provider account or access is unavailable, "
                "and no fallback AI route is configured."
            ),
        )
        with patch.object(
            resume_evaluation_service,
            "_call_llm",
            AsyncMock(side_effect=provider_error),
        ):
            with self.assertRaises(HTTPException) as context:
                await resume_evaluation_service.analyze_resume_evaluation(
                    "JD",
                    self.wrapper,
                    82,
                )

        self.assertEqual(context.exception.status_code, 503)
        self.assertIn("no fallback AI route", context.exception.detail)

    async def test_with_thoughts_call_remains_inside_the_same_total_timeout(self):
        call_mock = AsyncMock()

        async def slow_call(*args, **kwargs):
            await asyncio.sleep(1)
            return make_analysis_result()

        call_mock.side_effect = slow_call
        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            with patch.object(resume_evaluation_service, "_TOTAL_TIMEOUT_SECONDS", 0.01):
                with self.assertRaises(HTTPException) as context:
                    await resume_evaluation_service.analyze_resume_evaluation_with_thoughts(
                        "JD",
                        self.wrapper,
                        82,
                    )

        self.assertEqual(context.exception.status_code, 504)
        call_mock.assert_awaited_once()

    async def test_with_thoughts_external_cancellation_propagates(self):
        started = asyncio.Event()

        async def blocked_call(*args, **kwargs):
            started.set()
            await asyncio.Event().wait()
            return make_analysis_result()

        with patch.object(resume_evaluation_service, "_call_llm", side_effect=blocked_call):
            task = asyncio.create_task(
                resume_evaluation_service.analyze_resume_evaluation_with_thoughts(
                    "JD",
                    self.wrapper,
                    82,
                )
            )
            await started.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

    async def test_outer_cancellation_is_not_converted_to_timeout(self):
        started = asyncio.Event()

        async def blocked_call(*args, **kwargs):
            started.set()
            await asyncio.Event().wait()
            return make_analysis_result()

        with patch.object(resume_evaluation_service, "_call_llm", side_effect=blocked_call):
            task = asyncio.create_task(
                resume_evaluation_service.analyze_resume_evaluation(
                    "JD",
                    self.wrapper,
                    82,
                )
            )
            await started.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

    async def test_stream_deep_path_uses_same_strict_finalizer(self):
        call_mock = AsyncMock(return_value=make_analysis_result())
        thought_callback = AsyncMock()
        with patch.object(resume_evaluation_service, "_call_llm", call_mock):
            result = await resume_evaluation_service.analyze_resume_evaluation_with_thoughts(
                "JD",
                self.wrapper,
                82,
                thought_callback=thought_callback,
            )

        self.assertEqual(result["resumeEvaluation"]["jdMatch"], 82)
        call_mock.assert_awaited_once()
        self.assertEqual(call_mock.await_args.kwargs["lane"], "default")
        self.assertEqual(call_mock.await_args.kwargs["gemini_thinking_level"], "low")
        thought_callback.assert_awaited_once_with(
            {"type": "thought", "summary": "正在生成六维简历报告"}
        )


if __name__ == "__main__":
    unittest.main()
