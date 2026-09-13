from __future__ import annotations

import unittest
from datetime import datetime, timezone

from pydantic import ValidationError

from app.domain.resume_optimization.schemas import (
    OPTIMIZER_VERSION,
    POLICY_VERSION,
    PROMPT_VERSION,
    BankSuggestion,
    OptimizationAction,
    OptimizationAnswer,
    OptimizationAnswerState,
    OptimizationChange,
    OptimizationModuleType,
    OptimizationPlan,
    OptimizationQuestion,
    OptimizationQuestionChoice,
    OptimizationSafetySummary,
    OptimizationScope,
    ResumeOptimizationAnswersRequest,
    ResumeOptimizationApplyRequest,
    ResumeOptimizationApplyResponse,
    ResumeOptimizationFinalizeResponse,
    ResumeOptimizationGuidancePostEvaluation,
    ResumeOptimizationRunRead,
    ResumeOptimizationStartRequest,
    ResumeOptimizationStatus,
)
from app.domain.resume_optimization.state_machine import (
    InvalidOptimizationTransitionError,
    require_status_transition,
)


def _change(**overrides) -> OptimizationChange:
    values = {
        "change_id": "CHG_001",
        "issue_ids": ["I003"],
        "dimension": "STAR应用",
        "module_type": "experience_star",
        "module_id": "master-experience-uuid",
        "field_path": "star.a",
        "action_kind": "rewrite_now",
        "scope": "general",
        "before_value": "参与支付页面改版",
        "general_value": "参与支付页面改版，完成表单交互与异常状态处理",
        "targeted_value": "参与支付页面改版，完成表单交互与异常状态处理",
        "source_refs": [
            "/currentResume/experiences/master-experience-uuid/star/a",
        ],
        "rationale": "在已有事实范围内补足动作",
    }
    values.update(overrides)
    return OptimizationChange(**values)


def _question(index: int = 1) -> OptimizationQuestion:
    return OptimizationQuestion(
        question_id=f"Q{index:03d}",
        module_id="master-experience-uuid",
        field_path="responsibility",
        text="你负责整个模块，还是其中部分页面？",
        reason="需要确认责任边界",
        answer_type="single_choice_with_text",
        choices=[
            OptimizationQuestionChoice(value="partial", label="负责部分页面"),
        ],
        affects_change_ids=["CHG_001"],
        priority=index,
    )


def _suggestion(index: int = 1) -> BankSuggestion:
    return BankSuggestion(
        suggestion_id=f"BANK_{index:03d}",
        master_experience_id=f"master-{index}",
        category="project",
        title="校园电商产品项目",
        org="课程项目",
        match_score=87,
        reason="包含用户调研证据",
        capabilities=["用户研究"],
    )


class ResumeOptimizationEnumTests(unittest.TestCase):
    def test_public_versions_are_frozen(self) -> None:
        self.assertEqual(OPTIMIZER_VERSION, "resume_optimization_v1")
        self.assertEqual(POLICY_VERSION, "json_structure_v1")
        self.assertEqual(PROMPT_VERSION, "resume_optimization_single_pass_v1")

    def test_public_enum_values_are_exact(self) -> None:
        self.assertEqual(
            [item.value for item in ResumeOptimizationStatus],
            [
                "planning",
                "awaiting_answers",
                "preview_ready",
                "applying",
                "applied",
                "rescoring",
                "completed",
                "failed",
                "stale",
                "cancelled",
                "reverted",
            ],
        )
        self.assertEqual(
            [item.value for item in OptimizationAction],
            ["rewrite_now", "ask_user", "suggest_from_bank", "leave_unchanged"],
        )
        self.assertEqual(
            [item.value for item in OptimizationScope],
            ["general", "jd_targeted"],
        )
        self.assertEqual(
            [item.value for item in OptimizationModuleType],
            [
                "experience_star",
                "personal_summary",
                "skills_order",
                "skill_text",
                "education_courses", "education_notes", "certification_order", "certification_hide",
                "experience_order", "experience_hide", "experience_restructure", "skill_create",
                "section_order",
                "bank_suggestion",
            ],
        )
        self.assertEqual(
            [item.value for item in OptimizationAnswerState],
            ["answered", "no_data", "unknown", "not_my_work", "skipped"],
        )

        self.assertEqual(OptimizationAction("rewrite_now").value, "rewrite_now")
        self.assertEqual(OptimizationScope("general").value, "general")
        self.assertEqual(
            OptimizationModuleType("experience_star").value,
            "experience_star",
        )
        self.assertEqual(OptimizationAnswerState("no_data").value, "no_data")
        self.assertEqual(ResumeOptimizationStatus("planning").value, "planning")

    def test_invalid_enum_values_are_rejected(self) -> None:
        enum_types = (
            OptimizationAction,
            OptimizationScope,
            OptimizationModuleType,
            OptimizationAnswerState,
            ResumeOptimizationStatus,
        )
        for enum_type in enum_types:
            with self.subTest(enum_type=enum_type.__name__):
                with self.assertRaises(ValueError):
                    enum_type("not-a-public-contract-value")

        with self.assertRaises(ValidationError):
            _change(action_kind="not-a-public-contract-value")


class ResumeOptimizationSchemaTests(unittest.TestCase):
    def test_public_change_omits_internal_expected_score_gain(self) -> None:
        change = _change(expected_score_gain=37)
        self.assertEqual(change.expected_score_gain, 37)
        self.assertNotIn("expected_score_gain", change.model_dump(mode="json"))

    def test_guidance_post_evaluation_contains_bands_without_quality_scores(self) -> None:
        value = ResumeOptimizationGuidancePostEvaluation.model_validate({
            "version": "guidance_optimization_post_v1",
            "evaluationSignature": "signature",
            "resumeUpdatedAt": "2026-09-07T00:00:00+00:00",
            "overallBandBefore": "needs_attention",
            "overallBandAfter": "adequate",
            "dimensionStatusChanges": [
                {
                    "dimension": dimension,
                    "beforeStatus": "needs_attention",
                    "afterStatus": "adequate",
                }
                for dimension in (
                    "逻辑清晰", "STAR应用", "内容可读", "内容完整", "专业表达", "成果量化"
                )
            ],
            "issueSummary": {"resolved": 2, "remaining": 1},
            "unresolvedFactGapCount": 1,
            "acceptedChangeCount": 2,
            "blockedChangeCount": 0,
            "bankSuggestionCount": 0,
            "safetySummary": {},
        })
        dumped = value.model_dump(mode="json")
        self.assertFalse(
            {"beforeScore", "afterScore", "scoreDelta", "dimensionDeltas"} & set(dumped)
        )

    def test_change_accepts_the_public_contract(self) -> None:
        change = _change()

        self.assertEqual(change.change_id, "CHG_001")
        self.assertEqual(change.action_kind, OptimizationAction.REWRITE_NOW)
        self.assertEqual(change.scope, OptimizationScope.GENERAL)
        self.assertEqual(change.safety_status, "pending")
        self.assertTrue(change.default_selected)
        self.assertEqual(change.introduced_terms, [])
        self.assertEqual(change.safety_findings, [])

    def test_required_identifiers_reject_empty_or_whitespace_values(self) -> None:
        for field_name in ("change_id", "module_id", "field_path"):
            with self.subTest(model="change", field_name=field_name):
                with self.assertRaises(ValidationError):
                    _change(**{field_name: "   "})

        for field_name in ("question_id", "module_id", "field_path"):
            values = _question().model_dump()
            values[field_name] = "   "
            with self.subTest(model="question", field_name=field_name):
                with self.assertRaises(ValidationError):
                    OptimizationQuestion(**values)

    def test_plan_limits_questions_and_bank_suggestions(self) -> None:
        valid = OptimizationPlan(
            changes=[_change()],
            questions=[_question(index) for index in range(1, 6)],
            bank_suggestions=[_suggestion(index) for index in range(1, 4)],
        )
        self.assertEqual(len(valid.questions), 5)
        self.assertEqual(len(valid.bank_suggestions), 3)

        with self.assertRaises(ValidationError):
            OptimizationPlan(
                changes=[_change()],
                questions=[_question(index) for index in range(1, 7)],
            )
        with self.assertRaises(ValidationError):
            OptimizationPlan(
                changes=[_change()],
                bank_suggestions=[_suggestion(index) for index in range(1, 5)],
            )

    def test_text_rewrite_requires_a_source_reference(self) -> None:
        with self.assertRaises(ValidationError):
            _change(source_refs=[])

        with self.assertRaises(ValidationError):
            _change(source_refs=["   "])

    def test_ask_user_may_defer_rewritten_values_and_sources(self) -> None:
        change = _change(
            action_kind="ask_user",
            general_value=None,
            targeted_value=None,
            source_refs=[],
        )

        self.assertIsNone(change.general_value)
        self.assertIsNone(change.targeted_value)
        self.assertEqual(change.source_refs, [])

    def test_rewrite_now_requires_both_general_and_targeted_candidates(self) -> None:
        equal_text_candidates = _change(
            general_value="安全改写",
            targeted_value="安全改写",
        )
        self.assertEqual(
            equal_text_candidates.general_value,
            equal_text_candidates.targeted_value,
        )

        for missing_field in ("general_value", "targeted_value"):
            with self.subTest(module="text", missing_field=missing_field):
                with self.assertRaises(ValidationError):
                    _change(**{missing_field: None})

        order_values = {
            "module_type": "section_order",
            "field_path": "sectionOrder",
            "before_value": ["summary", "experience"],
            "general_value": ["experience", "summary"],
            "targeted_value": ["experience", "summary"],
            "source_refs": [],
        }
        equal_order_candidates = _change(**order_values)
        self.assertEqual(
            equal_order_candidates.general_value,
            equal_order_candidates.targeted_value,
        )

        for missing_field in ("general_value", "targeted_value"):
            invalid_order_values = dict(order_values)
            invalid_order_values[missing_field] = None
            with self.subTest(module="order", missing_field=missing_field):
                with self.assertRaises(ValidationError):
                    _change(**invalid_order_values)

    def test_order_changes_are_permutations_of_existing_ids(self) -> None:
        change = _change(
            module_type="skills_order",
            field_path="selection.skillIds",
            before_value=["skill-a", "skill-b"],
            general_value=["skill-b", "skill-a"],
            targeted_value=["skill-b", "skill-a"],
            source_refs=[],
        )
        self.assertEqual(change.general_value, ["skill-b", "skill-a"])

        invalid_values = (
            {"before_value": "skill-a,skill-b"},
            {"general_value": "skill-b,skill-a"},
            {"general_value": ["skill-b", "skill-new"]},
            {"general_value": ["skill-a", "skill-a"]},
            {"general_value": ["skill-a"]},
        )
        for invalid in invalid_values:
            with self.subTest(invalid=invalid):
                order_values = {
                    "module_type": "skills_order",
                    "field_path": "selection.skillIds",
                    "before_value": ["skill-a", "skill-b"],
                    "general_value": ["skill-b", "skill-a"],
                    "targeted_value": ["skill-b", "skill-a"],
                    "source_refs": [],
                }
                order_values.update(invalid)
                with self.assertRaises(ValidationError):
                    _change(**order_values)

    def test_answered_value_is_required_but_terminal_no_data_may_be_empty(self) -> None:
        with self.assertRaises(ValidationError):
            OptimizationAnswer(question_id="Q001", state="answered", value="   ")

        answer = OptimizationAnswer(question_id="Q001", state="no_data", value="")
        self.assertEqual(answer.state, OptimizationAnswerState.NO_DATA)
        self.assertEqual(answer.value, "")

    def test_shared_request_and_response_contracts_round_trip(self) -> None:
        now = datetime(2026, 9, 1, tzinfo=timezone.utc)
        plan = OptimizationPlan(
            changes=[_change()],
            questions=[_question()],
            bank_suggestions=[_suggestion()],
            safety_summary=OptimizationSafetySummary(
                allowed_change_ids=["CHG_001"],
            ),
        )
        run = ResumeOptimizationRunRead(
            id="run-uuid",
            resume_id="resume-uuid",
            status="preview_ready",
            source_resume_updated_at=now,
            source_evaluation_signature="evaluation-signature",
            source_snapshot_hash="snapshot-hash",
            plan=plan,
            created_at=now,
            updated_at=now,
        )

        start = ResumeOptimizationStartRequest(
            resume_id="resume-uuid",
            evaluation_signature="evaluation-signature",
            expected_resume_updated_at=now,
        )
        answers = ResumeOptimizationAnswersRequest(
            answers=[
                OptimizationAnswer(
                    question_id="Q001",
                    state="answered",
                    value="负责其中两个前端页面",
                ),
            ],
        )
        apply = ResumeOptimizationApplyRequest(
            accepted_change_ids=["CHG_001"],
            expected_resume_updated_at=now,
        )
        apply_response = ResumeOptimizationApplyResponse(
            run=run,
            resume_updated_at=now,
            applied_change_ids=["CHG_001"],
        )
        finalize_response = ResumeOptimizationFinalizeResponse(run=run)

        self.assertTrue(start.include_bank_suggestions)
        self.assertEqual(answers.answers[0].question_id, "Q001")
        self.assertEqual(apply.accepted_change_ids, ["CHG_001"])
        self.assertEqual(apply_response.run.status, ResumeOptimizationStatus.PREVIEW_READY)
        self.assertEqual(finalize_response.run.id, "run-uuid")
        self.assertEqual(run.optimizer_version, OPTIMIZER_VERSION)
        self.assertEqual(run.policy_version, POLICY_VERSION)
        self.assertEqual(run.prompt_version, PROMPT_VERSION)

    def test_apply_request_rejects_blank_and_duplicate_change_ids(self) -> None:
        now = datetime(2026, 9, 1, tzinfo=timezone.utc)

        for accepted_change_ids in (["CHG_001", "   "], ["CHG_001", "CHG_001"]):
            with self.subTest(accepted_change_ids=accepted_change_ids):
                with self.assertRaises(ValidationError):
                    ResumeOptimizationApplyRequest(
                        accepted_change_ids=accepted_change_ids,
                        expected_resume_updated_at=now,
                    )

    def test_answers_request_rejects_blank_or_duplicate_question_ids(self) -> None:
        with self.assertRaises(ValidationError):
            ResumeOptimizationAnswersRequest(
                answers=[
                    {"question_id": "   ", "state": "no_data", "value": ""},
                ],
            )

        with self.assertRaises(ValidationError):
            ResumeOptimizationAnswersRequest(
                answers=[
                    {"question_id": "Q001", "state": "no_data", "value": ""},
                    {"question_id": "Q001", "state": "skipped", "value": ""},
                ],
            )


class ResumeOptimizationTransitionTests(unittest.TestCase):
    def test_exact_legal_transitions_are_allowed(self) -> None:
        legal = {
            "planning": {"awaiting_answers", "preview_ready", "failed", "cancelled"},
            "awaiting_answers": {"preview_ready", "failed", "stale", "cancelled"},
            "preview_ready": {"applying", "stale", "cancelled"},
            "applying": {"applied", "failed", "stale"},
            "applied": {"rescoring", "reverted"},
            "rescoring": {"completed", "applied"},
            "completed": {"reverted"},
        }

        for current, targets in legal.items():
            for target in targets:
                with self.subTest(current=current, target=target):
                    self.assertIsNone(
                        require_status_transition(
                            ResumeOptimizationStatus(current),
                            ResumeOptimizationStatus(target),
                        ),
                    )

    def test_every_transition_outside_the_legal_matrix_is_rejected(self) -> None:
        legal = {
            ResumeOptimizationStatus.PLANNING: {
                ResumeOptimizationStatus.AWAITING_ANSWERS,
                ResumeOptimizationStatus.PREVIEW_READY,
                ResumeOptimizationStatus.FAILED,
                ResumeOptimizationStatus.CANCELLED,
            },
            ResumeOptimizationStatus.AWAITING_ANSWERS: {
                ResumeOptimizationStatus.PREVIEW_READY,
                ResumeOptimizationStatus.FAILED,
                ResumeOptimizationStatus.STALE,
                ResumeOptimizationStatus.CANCELLED,
            },
            ResumeOptimizationStatus.PREVIEW_READY: {
                ResumeOptimizationStatus.APPLYING,
                ResumeOptimizationStatus.STALE,
                ResumeOptimizationStatus.CANCELLED,
            },
            ResumeOptimizationStatus.APPLYING: {
                ResumeOptimizationStatus.APPLIED,
                ResumeOptimizationStatus.FAILED,
                ResumeOptimizationStatus.STALE,
            },
            ResumeOptimizationStatus.APPLIED: {
                ResumeOptimizationStatus.RESCORING,
                ResumeOptimizationStatus.REVERTED,
            },
            ResumeOptimizationStatus.RESCORING: {
                ResumeOptimizationStatus.COMPLETED,
                ResumeOptimizationStatus.APPLIED,
            },
            ResumeOptimizationStatus.COMPLETED: {
                ResumeOptimizationStatus.REVERTED,
            },
        }

        for current in ResumeOptimizationStatus:
            for target in ResumeOptimizationStatus:
                if target in legal.get(current, set()):
                    continue
                with self.subTest(current=current.value, target=target.value):
                    with self.assertRaises(InvalidOptimizationTransitionError):
                        require_status_transition(current, target)

    def test_explicitly_forbidden_shortcuts_are_rejected(self) -> None:
        forbidden = (
            ("planning", "completed"),
            ("awaiting_answers", "applying"),
            ("preview_ready", "completed"),
            ("reverted", "applying"),
        )

        for current, target in forbidden:
            with self.subTest(current=current, target=target):
                with self.assertRaises(InvalidOptimizationTransitionError):
                    require_status_transition(
                        ResumeOptimizationStatus(current),
                        ResumeOptimizationStatus(target),
                    )

    def test_applied_self_transition_requires_explicit_rescore_retry_context(self) -> None:
        with self.assertRaises(InvalidOptimizationTransitionError):
            require_status_transition(
                ResumeOptimizationStatus.APPLIED,
                ResumeOptimizationStatus.APPLIED,
            )

        self.assertIsNone(
            require_status_transition(
                ResumeOptimizationStatus.APPLIED,
                ResumeOptimizationStatus.APPLIED,
                allow_rescore_retry=True,
            ),
        )

    def test_rescore_retry_context_enables_no_other_self_transition(self) -> None:
        for status in ResumeOptimizationStatus:
            if status == ResumeOptimizationStatus.APPLIED:
                continue
            with self.subTest(status=status.value):
                with self.assertRaises(InvalidOptimizationTransitionError):
                    require_status_transition(
                        status,
                        status,
                        allow_rescore_retry=True,
                    )


if __name__ == "__main__":
    unittest.main()
