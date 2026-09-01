from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

from app.domain.resume_optimization.context_service import FrozenOptimizationContext
from app.domain.resume_optimization.normalizers import (
    OptimizationPlanNormalizationError,
    normalize_optimization_plan,
)
from app.domain.resume_optimization.planner_service import (
    plan_resume_optimization,
    rewrite_answered_modules,
)
from app.domain.resume_optimization.prompts import (
    ANSWER_REWRITE_SYSTEM_PROMPT,
    OPTIMIZATION_SYSTEM_PROMPT,
)
from app.domain.resume_optimization.schemas import OptimizationAnswer


SELECTED_ID = "exp-selected"
OTHER_ID = "exp-other"
SECOND_SELECTED_ID = "exp-second-selected"


def _change(issue_id: str = "I1", **overrides):
    value = {
        "changeId": f"CHG_{issue_id}",
        "issueIds": [issue_id],
        "dimension": "STAR应用",
        "moduleType": "experience_star",
        "moduleId": SELECTED_ID,
        "fieldPath": "star.a",
        "actionKind": "rewrite_now",
        "scope": "general",
        "beforeValue": "参与交付",
        "generalValue": "完成已明确的交付工作",
        "targetedValue": "完成已明确的交付工作",
        "sourceRefs": [f"/currentResume/experiences/{SELECTED_ID}/star/a"],
        "introducedTerms": [],
        "rationale": "重组已有事实",
        "expectedScoreGain": 3,
        "defaultSelected": True,
    }
    value.update(overrides)
    return value


def _question(**overrides):
    value = {
        "questionId": "Q1",
        "moduleId": SELECTED_ID,
        "fieldPath": "star.r",
        "text": "是否有可确认的结果？",
        "reason": "不能编造结果",
        "answerType": "single_choice_with_text",
        "choices": [{"value": "no_data", "label": "没有数据"}],
        "affectsChangeIds": ["CHG_I1"],
        "priority": 1,
    }
    value.update(overrides)
    return value


def _unsupported_change(issue_id: str, **overrides):
    value = {
        "changeId": f"CHG_{issue_id}",
        "issueIds": [issue_id],
        "dimension": "内容完整性",
        "moduleType": "personal_summary",
        "moduleId": "current_resume",
        "fieldPath": "unsupported",
        "actionKind": "leave_unchanged",
        "scope": "general",
        "beforeValue": None,
        "generalValue": None,
        "targetedValue": None,
        "sourceRefs": [],
        "introducedTerms": [],
        "rationale": "Gate A 不直接修改教育或证书内容",
        "expectedScoreGain": 0,
        "defaultSelected": False,
    }
    value.update(overrides)
    return value


def _normalize(raw, *, issues=None):
    return normalize_optimization_plan(
        raw,
        known_issue_ids=set(issues or {"I1"}),
        selected_master_ids={SELECTED_ID},
        selected_skill_ids={"skill-a", "skill-b"},
        current_section_order=["summary", "experience", "skills"],
    )


def _context() -> FrozenOptimizationContext:
    return FrozenOptimizationContext(
        resume_id="resume-1",
        resume_updated_at="2026-09-01T00:00:00+00:00",
        evaluation_signature="evaluation-signature",
        jd_signature="jd-signature",
        target_role="Product Manager",
        evaluation={
            "evaluationVersion": "resume_flow_v1",
            "issues": [
                {
                    "issueId": "I1",
                    "primaryDimension": "STAR应用",
                    "description": "行动层表达不清",
                }
            ],
        },
        current_resume={
            "section_order": ["summary", "experience", "skills"],
            "profile": {
                "name": "Candidate Secret",
                "email": "private@example.com",
                "phone": "+852 5555 0101",
                "linkedin": "linkedin.com/in/private-candidate",
                "location": "Private Location",
            },
            "personal_summary": "Current summary",
            "experiences": {
                SELECTED_ID: {
                    "id": SELECTED_ID,
                    "category": "work",
                    "star": {"s": "S", "t": "T", "a": "A", "r": "R"},
                }
            },
            "skills": [
                {"id": "skill-a", "name": "Discovery"},
                {"id": "skill-b", "name": "Delivery"},
            ],
            "educations": [
                {"id": "edu-1", "school": "Example University", "major": "Design"}
            ],
            "certifications": [
                {"id": "cert-1", "name": "Current Certificate"}
            ],
        },
        selected_source_experiences={
            SELECTED_ID: {
                "id": SELECTED_ID,
                "category": "work",
                "star": {"s": "source S", "t": "source T", "a": "source A", "r": "source R"},
            }
        },
        selected_master_experience_ids=[SELECTED_ID],
        selected_experience_links={SELECTED_ID: {"link_id": "link-1"}},
        bank_suggestion_candidates=[
            {"id": OTHER_ID, "title": "UNSELECTED SECRET", "score": 99}
        ],
        fact_metadata=[
            {
                "fact_id": "FACT_PROFILE",
                "content": "Candidate Secret",
                "source": "/currentResume/profile/name",
            },
            {
                "fact_id": "FACT_EXPERIENCE",
                "content": "source A",
                "source": f"/currentResume/experiences/{SELECTED_ID}/star/a",
            },
            {
                "fact_id": "FACT_EDUCATION",
                "content": "Design",
                "source": "/currentResume/educations/0/major",
            },
        ],
    )


class PromptContractTests(unittest.TestCase):
    def test_system_prompt_contains_every_truth_and_output_contract(self) -> None:
        prompt = OPTIMIZATION_SYSTEM_PROMPT.lower()
        required = (
            "only current assembled resume is modified",
            "selected full source versions may supplement the same experience",
            "unselected experiences cannot support a rewrite",
            "do not invent numbers, tools, methods, ownership, causality, courses, or skills",
            "rewrite_now / ask_user / leave_unchanged",
            "maximum five questions",
            "no_data is valid",
            "generalvalue and targetedvalue",
            "each change references issue ids and sourcerefs",
            "six-dimensional report",
            "never generate bank suggestions",
            "education and certification content unchanged",
            "reorder only existing skill and section ids",
        )
        for contract in required:
            with self.subTest(contract=contract):
                self.assertIn(contract, prompt)

    def test_answer_prompt_requires_the_complete_existing_id_set_unchanged(self) -> None:
        prompt = ANSWER_REWRITE_SYSTEM_PROMPT.lower()
        self.assertIn("return every existing changeid unchanged", prompt)
        self.assertIn("do not add new or modify ids", prompt)

    def test_system_prompt_defines_the_read_only_unsupported_issue_sentinel(self) -> None:
        prompt = OPTIMIZATION_SYSTEM_PROMPT.lower()
        for contract in (
            "education, certification, and other unsupported gate a issues",
            "moduletype=personal_summary",
            "moduleid=current_resume",
            "fieldpath=unsupported",
            "actionkind=leave_unchanged",
            "expectedscoregain=0",
            "defaultselected=false",
        ):
            with self.subTest(contract=contract):
                self.assertIn(contract, prompt)


class OptimizationPlanNormalizerTests(unittest.TestCase):
    def assertRejected(self, raw, *, issues=None):  # noqa: N802
        with self.assertRaises(OptimizationPlanNormalizationError):
            _normalize(raw, issues=issues)

    def test_rejects_non_object_root(self) -> None:
        for raw in (None, [], "{}"):
            with self.subTest(raw=raw):
                self.assertRejected(raw)

    def test_rejects_duplicate_change_or_question_ids(self) -> None:
        self.assertRejected({"changes": [_change(), _change()], "questions": []})
        ask_change = _change(actionKind="ask_user", generalValue=None, targetedValue=None, sourceRefs=[])
        self.assertRejected(
            {"changes": [ask_change], "questions": [_question(), _question()]}
        )

    def test_rejects_unknown_missing_duplicate_or_uncovered_issue_ids(self) -> None:
        self.assertRejected({"changes": [_change(issueIds=[])], "questions": []})
        self.assertRejected({"changes": [_change(issueIds=["UNKNOWN"])], "questions": []})
        self.assertRejected(
            {
                "changes": [_change("I1"), _change("I2", issueIds=["I1"])],
                "questions": [],
            },
            issues={"I1"},
        )
        self.assertRejected(
            {"changes": [_change("I1")], "questions": []},
            issues={"I1", "I2"},
        )

    def test_rejects_unsupported_selection_changing_module_or_path(self) -> None:
        self.assertRejected(
            {"changes": [_change(fieldPath="selectedMasterExperienceIds")], "questions": []}
        )
        self.assertRejected(
            {"changes": [_change(moduleType="education")], "questions": []}
        )
        self.assertRejected(
            {"changes": [_change(moduleId=OTHER_ID)], "questions": []}
        )

    def test_rejects_unselected_or_cross_project_questions(self) -> None:
        ask_change = _change(actionKind="ask_user", generalValue=None, targetedValue=None, sourceRefs=[])
        self.assertRejected(
            {"changes": [ask_change], "questions": [_question(moduleId=OTHER_ID)]}
        )
        self.assertRejected(
            {
                "changes": [ask_change],
                "questions": [
                    _question(text="在另一个项目中你是否主导过发布？")
                ],
            }
        )

    def test_rejects_more_than_five_questions(self) -> None:
        changes = []
        questions = []
        issues = set()
        for index in range(6):
            issue_id = f"I{index}"
            change_id = f"CHG_{issue_id}"
            issues.add(issue_id)
            changes.append(
                _change(
                    issue_id,
                    changeId=change_id,
                    actionKind="ask_user",
                    generalValue=None,
                    targetedValue=None,
                    sourceRefs=[],
                )
            )
            questions.append(
                _question(
                    questionId=f"Q{index}",
                    affectsChangeIds=[change_id],
                )
            )
        self.assertRejected({"changes": changes, "questions": questions}, issues=issues)

    def test_rejects_oversized_strings_and_empty_rewrite_sources(self) -> None:
        self.assertRejected(
            {"changes": [_change(rationale="x" * 20_001)], "questions": []}
        )
        self.assertRejected(
            {"changes": [_change(sourceRefs=[])], "questions": []}
        )

    def test_rejects_fake_pointer_roots_and_planning_user_answer_refs(self) -> None:
        self.assertRejected(
            {
                "changes": [
                    _change(sourceRefs=["/currentResumeBogus/experiences/exp-selected/star/a"])
                ],
                "questions": [],
            }
        )
        self.assertRejected(
            {
                "changes": [_change(sourceRefs=["/userAnswers/Q1/value"])],
                "questions": [],
            }
        )

    def test_experience_sources_must_resolve_to_the_same_module(self) -> None:
        for source_ref in (
            f"/currentResume/experiences/{OTHER_ID}/star/a",
            f"/selectedSourceExperiences/{OTHER_ID}/star/a",
        ):
            with self.subTest(source_ref=source_ref):
                self.assertRejected(
                    {"changes": [_change(sourceRefs=[source_ref])], "questions": []}
                )

    def test_personal_summary_may_use_multiple_selected_sources(self) -> None:
        raw = {
            "changes": [
                _change(
                    moduleType="personal_summary",
                    moduleId="personal_summary",
                    fieldPath="personal_summary",
                    sourceRefs=[
                        f"/currentResume/experiences/{SELECTED_ID}/star/a",
                        f"/selectedSourceExperiences/{SECOND_SELECTED_ID}/star/r",
                    ],
                )
            ],
            "questions": [],
        }
        plan = normalize_optimization_plan(
            raw,
            known_issue_ids={"I1"},
            selected_master_ids={SELECTED_ID, SECOND_SELECTED_ID},
            selected_skill_ids={"skill-a", "skill-b"},
            current_section_order=["summary", "experience", "skills"],
        )
        self.assertEqual(plan.changes[0].module_type.value, "personal_summary")

    def test_rejects_any_model_generated_bank_suggestion(self) -> None:
        self.assertRejected(
            {
                "changes": [_change()],
                "questions": [],
                "bankSuggestions": [{"suggestionId": "MODEL_BANK"}],
            }
        )

    def test_rejects_both_bank_suggestion_root_aliases_even_when_empty(self) -> None:
        self.assertRejected(
            {
                "changes": [_change()],
                "questions": [],
                "bankSuggestions": [],
                "bank_suggestions": [],
            }
        )

    def test_rejects_invalid_order_arrays_or_new_ids(self) -> None:
        base = {
            "moduleType": "skills_order",
            "moduleId": "skills",
            "fieldPath": "skills.order",
            "beforeValue": ["skill-a", "skill-b"],
            "generalValue": ["skill-b", "skill-a"],
            "targetedValue": ["skill-b", "skill-a"],
            "sourceRefs": [],
        }
        new_target = {**base, "targetedValue": ["skill-a", "skill-new"]}
        self.assertRejected(
            {"changes": [_change(**new_target)], "questions": []}
        )
        invalid_before = {**base, "beforeValue": ["skill-a", "skill-new"]}
        self.assertRejected(
            {"changes": [_change(**invalid_before)], "questions": []}
        )

    def test_generates_deterministic_ids_only_when_missing_and_rejects_collisions(self) -> None:
        raw = {
            "changes": [_change(changeId=None)],
            "questions": [],
        }
        first = _normalize(raw)
        second = _normalize(raw)
        self.assertEqual(first.changes[0].change_id, second.changes[0].change_id)
        self.assertTrue(first.changes[0].change_id.startswith("CHG_"))

        ask_change = _change(
            changeId="CHG_I1",
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        question = _question(questionId=None)
        first_question = _normalize({"changes": [ask_change], "questions": [question]})
        second_question = _normalize({"changes": [ask_change], "questions": [question]})
        self.assertEqual(
            first_question.questions[0].question_id,
            second_question.questions[0].question_id,
        )

        generated = first.changes[0].change_id
        self.assertRejected(
            {
                "changes": [
                    _change(changeId=None),
                    _change("I2", changeId=generated),
                ],
                "questions": [],
            },
            issues={"I1", "I2"},
        )

    def test_accepts_safe_plan_and_keeps_no_questions_valid(self) -> None:
        plan = _normalize({"changes": [_change()], "questions": []})
        self.assertEqual([change.issue_ids for change in plan.changes], [["I1"]])
        self.assertEqual(plan.questions, [])
        self.assertEqual(plan.bank_suggestions, [])

    def test_accepts_read_only_sentinels_for_education_and_certification_issues(self) -> None:
        plan = _normalize(
            {
                "changes": [
                    _unsupported_change(
                        "I_EDUCATION",
                        dimension="教育背景",
                        rationale="教育课程描述不属于 Gate A 可改范围",
                    ),
                    _unsupported_change(
                        "I_CERTIFICATION",
                        dimension="证书完整性",
                        rationale="证书正文不属于 Gate A 可改范围",
                    ),
                ],
                "questions": [],
            },
            issues={"I_EDUCATION", "I_CERTIFICATION"},
        )
        self.assertEqual(len(plan.changes), 2)
        for change in plan.changes:
            self.assertEqual(change.module_type.value, "personal_summary")
            self.assertEqual(change.module_id, "current_resume")
            self.assertEqual(change.field_path, "unsupported")
            self.assertEqual(change.action_kind.value, "leave_unchanged")
            self.assertFalse(change.default_selected)

    def test_unsupported_sentinel_still_requires_exact_issue_coverage(self) -> None:
        self.assertRejected(
            {
                "changes": [_unsupported_change("I_EDUCATION")],
                "questions": [],
            },
            issues={"I_EDUCATION", "I_CERTIFICATION"},
        )

    def test_rejects_every_unsafe_unsupported_sentinel_variation(self) -> None:
        unsafe_variants = {
            "rewrite": {"actionKind": "rewrite_now"},
            "question": {"actionKind": "ask_user"},
            "before": {"beforeValue": "existing course"},
            "general": {"generalValue": "new course"},
            "targeted": {"targetedValue": "new certificate"},
            "source": {"sourceRefs": ["/currentResume/educations/0/major"]},
            "selected": {"defaultSelected": True},
            "gain": {"expectedScoreGain": 1},
        }
        for label, overrides in unsafe_variants.items():
            with self.subTest(label=label):
                self.assertRejected(
                    {
                        "changes": [
                            _unsupported_change("I_EDUCATION", **overrides)
                        ],
                        "questions": [],
                    },
                    issues={"I_EDUCATION"},
                )


class PlannerServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_plan_uses_bounded_json_transport_and_only_model_payload(self) -> None:
        context = _context()
        llm_result = {"changes": [_change()], "questions": []}
        transport = AsyncMock(return_value=llm_result)

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            plan = await plan_resume_optimization(context)

        self.assertEqual(len(plan.changes), 1)
        args, kwargs = transport.call_args
        self.assertTrue(kwargs["json_mode"])
        self.assertEqual(kwargs["request_label"], "resume_optimization_plan")
        self.assertEqual(len(args[0]), 2)
        payload = json.loads(args[0][1]["content"])
        self.assertEqual(payload["context"]["evaluation"], context.evaluation)
        self.assertEqual(
            payload["context"]["selectedSourceExperiences"],
            context.selected_source_experiences,
        )
        self.assertNotIn("profile", payload["context"]["currentResume"])
        self.assertEqual(
            payload["context"]["currentResume"]["educations"],
            context.current_resume["educations"],
        )
        self.assertEqual(
            payload["context"]["currentResume"]["certifications"],
            context.current_resume["certifications"],
        )
        self.assertEqual(
            [fact["fact_id"] for fact in payload["context"]["factMetadata"]],
            ["FACT_EXPERIENCE", "FACT_EDUCATION"],
        )
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("bankSuggestionCandidates", serialized)
        self.assertNotIn("UNSELECTED SECRET", serialized)
        for pii in (
            "Candidate Secret",
            "private@example.com",
            "+852 5555 0101",
            "linkedin.com/in/private-candidate",
            "Private Location",
        ):
            with self.subTest(pii=pii):
                self.assertNotIn(pii, serialized)
        self.assertEqual(
            payload["allowedSourceRoots"],
            ["/currentResume", "/selectedSourceExperiences", "/userAnswers"],
        )

    async def test_answer_rewrite_sends_and_accepts_only_affected_changes(self) -> None:
        context = _context()
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )
        rewritten = _change(
            actionKind="rewrite_now",
            generalValue="完成三轮迭代",
            targetedValue="完成三轮迭代",
            sourceRefs=["/userAnswers/Q1/value"],
        )
        transport = AsyncMock(return_value={"changes": [rewritten]})

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            changes = await rewrite_answered_modules(
                context=context,
                existing_plan=existing_plan,
                answers=[
                    OptimizationAnswer(
                        question_id="Q1",
                        state="answered",
                        value="完成三轮迭代",
                    )
                ],
            )

        self.assertEqual([item.change_id for item in changes], ["CHG_I1"])
        args, kwargs = transport.call_args
        self.assertTrue(kwargs["json_mode"])
        self.assertEqual(kwargs["request_label"], "resume_optimization_answer")
        payload = json.loads(args[0][1]["content"])
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertIn("CHG_I1", serialized)
        self.assertIn(SELECTED_ID, serialized)
        self.assertIn("完成三轮迭代", serialized)
        self.assertNotIn(OTHER_ID, serialized)
        self.assertNotIn("UNSELECTED SECRET", serialized)
        self.assertEqual(
            set(payload["sourceDocuments"]),
            {"currentResume", "selectedSourceExperiences", "userAnswers"},
        )
        self.assertEqual(
            set(payload["sourceDocuments"]["currentResume"]),
            {"experiences"},
        )
        self.assertEqual(
            set(payload["sourceDocuments"]["currentResume"]["experiences"]),
            {SELECTED_ID},
        )
        self.assertEqual(
            set(payload["sourceDocuments"]["selectedSourceExperiences"]),
            {SELECTED_ID},
        )
        self.assertEqual(
            payload["sourceDocuments"]["userAnswers"],
            {"Q1": {"state": "answered", "value": "完成三轮迭代"}},
        )
        self.assertNotIn("affectedContext", payload)

    async def test_answer_rewrite_rejects_new_or_unaffected_changes(self) -> None:
        context = _context()
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )
        transport = AsyncMock(
            return_value={"changes": [_change(changeId="CHG_NEW")]}
        )

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            with self.assertRaises(OptimizationPlanNormalizationError):
                await rewrite_answered_modules(
                    context=context,
                    existing_plan=existing_plan,
                    answers=[
                        OptimizationAnswer(
                            question_id="Q1",
                            state="no_data",
                        )
                    ],
                )

    async def test_answer_rewrite_rejects_unsubmitted_or_wrong_module_answer_refs(self) -> None:
        context = _context()
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )
        for source_ref in ("/userAnswers/Q2/value", "/userAnswers/Q1/state"):
            with self.subTest(source_ref=source_ref):
                transport = AsyncMock(
                    return_value={
                        "changes": [
                            _change(
                                sourceRefs=[source_ref],
                                generalValue="改写",
                                targetedValue="改写",
                            )
                        ]
                    }
                )
                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    transport,
                ):
                    with self.assertRaises(OptimizationPlanNormalizationError):
                        await rewrite_answered_modules(
                            context=context,
                            existing_plan=existing_plan,
                            answers=[
                                OptimizationAnswer(
                                    question_id="Q1",
                                    state="answered",
                                    value="已确认",
                                )
                            ],
                        )

        summary_change = _change(
            "I2",
            changeId="CHG_I2",
            moduleType="personal_summary",
            moduleId="personal_summary",
            fieldPath="personal_summary",
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        two_module_plan = _normalize(
            {
                "changes": [ask_change, summary_change],
                "questions": [
                    _question(),
                    _question(
                        questionId="Q2",
                        moduleId="personal_summary",
                        fieldPath="personal_summary",
                        affectsChangeIds=["CHG_I2"],
                    ),
                ],
            },
            issues={"I1", "I2"},
        )
        cross_module_transport = AsyncMock(
            return_value={
                "changes": [
                    _change(
                        sourceRefs=["/userAnswers/Q2/value"],
                        generalValue="越界改写",
                        targetedValue="越界改写",
                    ),
                    _change(
                        "I2",
                        changeId="CHG_I2",
                        moduleType="personal_summary",
                        moduleId="personal_summary",
                        fieldPath="personal_summary",
                        sourceRefs=["/userAnswers/Q2/value"],
                        generalValue="摘要改写",
                        targetedValue="摘要改写",
                    ),
                ]
            }
        )
        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            cross_module_transport,
        ):
            with self.assertRaises(OptimizationPlanNormalizationError):
                await rewrite_answered_modules(
                    context=context,
                    existing_plan=two_module_plan,
                    answers=[
                        OptimizationAnswer(
                            question_id="Q1", state="answered", value="经历回答"
                        ),
                        OptimizationAnswer(
                            question_id="Q2", state="answered", value="摘要回答"
                        ),
                    ],
                )

    async def test_answer_rewrite_rejects_identity_tampering(self) -> None:
        context = _context()
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )
        tampered_fields = {
            "dimension": "成果量化",
            "scope": "jd_targeted",
            "defaultSelected": False,
        }
        for field_name, field_value in tampered_fields.items():
            with self.subTest(field_name=field_name):
                rewritten = _change(
                    sourceRefs=["/userAnswers/Q1/value"],
                    generalValue="已确认改写",
                    targetedValue="已确认改写",
                    **{field_name: field_value},
                )
                transport = AsyncMock(return_value={"changes": [rewritten]})
                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    transport,
                ):
                    with self.assertRaises(OptimizationPlanNormalizationError):
                        await rewrite_answered_modules(
                            context=context,
                            existing_plan=existing_plan,
                            answers=[
                                OptimizationAnswer(
                                    question_id="Q1",
                                    state="answered",
                                    value="已确认",
                                )
                            ],
                        )

    async def test_answer_provenance_enforces_all_answer_states(self) -> None:
        context = _context()
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )

        answered_transport = AsyncMock(
            return_value={
                "changes": [
                    _change(sourceRefs=["/userAnswers/Q1/value"])
                ]
            }
        )
        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            answered_transport,
        ):
            answered = await rewrite_answered_modules(
                context=context,
                existing_plan=existing_plan,
                answers=[
                    OptimizationAnswer(
                        question_id="Q1", state="answered", value="确认事实"
                    )
                ],
            )
        self.assertEqual(answered[0].action_kind.value, "rewrite_now")

        for state in ("no_data", "unknown", "not_my_work", "skipped"):
            with self.subTest(state=state, result="rewrite_now"):
                invalid_rewrite = AsyncMock(
                    return_value={
                        "changes": [
                            _change(sourceRefs=["/userAnswers/Q1/value"])
                        ]
                    }
                )
                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    invalid_rewrite,
                ):
                    with self.assertRaises(OptimizationPlanNormalizationError):
                        await rewrite_answered_modules(
                            context=context,
                            existing_plan=existing_plan,
                            answers=[
                                OptimizationAnswer(question_id="Q1", state=state)
                            ],
                        )

            with self.subTest(state=state, result="leave_unchanged"):
                safe_leave = AsyncMock(
                    return_value={
                        "changes": [
                            _change(
                                actionKind="leave_unchanged",
                                generalValue=None,
                                targetedValue=None,
                                sourceRefs=[],
                            )
                        ]
                    }
                )
                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    safe_leave,
                ):
                    unchanged = await rewrite_answered_modules(
                        context=context,
                        existing_plan=existing_plan,
                        answers=[OptimizationAnswer(question_id="Q1", state=state)],
                    )
                self.assertEqual(unchanged[0].action_kind.value, "leave_unchanged")

        invented_leave = AsyncMock(
            return_value={
                "changes": [
                    _change(
                        actionKind="leave_unchanged",
                        generalValue="new candidate",
                        targetedValue=None,
                        sourceRefs=[],
                    )
                ]
            }
        )
        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            invented_leave,
        ):
            with self.assertRaises(OptimizationPlanNormalizationError):
                await rewrite_answered_modules(
                    context=context,
                    existing_plan=existing_plan,
                    answers=[OptimizationAnswer(question_id="Q1", state="no_data")],
                )

    async def test_mixed_answers_allow_only_linked_answered_sources(self) -> None:
        context = _context()
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {
                "changes": [ask_change],
                "questions": [
                    _question(),
                    _question(questionId="Q2", affectsChangeIds=["CHG_I1"]),
                ],
            }
        )
        answers = [
            OptimizationAnswer(question_id="Q1", state="answered", value="确认事实"),
            OptimizationAnswer(question_id="Q2", state="no_data"),
        ]
        valid = AsyncMock(
            return_value={
                "changes": [_change(sourceRefs=["/userAnswers/Q1/value"])]
            }
        )
        with patch(
            "app.domain.resume_optimization.planner_service._call_llm", valid
        ):
            changes = await rewrite_answered_modules(
                context=context,
                existing_plan=existing_plan,
                answers=answers,
            )
        self.assertEqual(changes[0].action_kind.value, "rewrite_now")

        invalid = AsyncMock(
            return_value={
                "changes": [_change(sourceRefs=["/userAnswers/Q2/value"])]
            }
        )
        with patch(
            "app.domain.resume_optimization.planner_service._call_llm", invalid
        ):
            with self.assertRaises(OptimizationPlanNormalizationError):
                await rewrite_answered_modules(
                    context=context,
                    existing_plan=existing_plan,
                    answers=answers,
                )


if __name__ == "__main__":
    unittest.main()
