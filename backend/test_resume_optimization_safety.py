import copy
import unittest

from app.domain.resume_optimization.safety import (
    causality_rank,
    resolve_source_ref,
    responsibility_rank,
    verify_plan_changes,
)
from app.domain.resume_optimization.schemas import (
    OptimizationChange,
    OptimizationPlan,
    OptimizationQuestion,
)


EXP_A = "exp-a"
EXP_B = "exp-b"


def _documents(
    *,
    current_a: str = "参与支付页面改版",
    current_b: str = "完成数据平台开发",
    selected_a: str = "参与支付页面改版",
    answers: dict | None = None,
) -> dict:
    return {
        "currentResume": {
            "personal_summary": "产品与研发协作经验",
            "experiences": {
                EXP_A: {"star": {"a": current_a, "r": "项目上线后转化率提高"}},
                EXP_B: {"star": {"a": current_b, "r": "按期交付"}},
            },
        },
        "selectedSourceExperiences": {
            EXP_A: {"star": {"a": selected_a, "r": "项目上线后转化率提高"}},
            EXP_B: {"star": {"a": current_b, "r": "按期交付"}},
        },
        "userAnswers": answers or {},
    }


def _change(**overrides) -> OptimizationChange:
    values = {
        "change_id": "CHG_A",
        "issue_ids": ["I1"],
        "dimension": "STAR应用",
        "module_type": "experience_star",
        "module_id": EXP_A,
        "field_path": "star.a",
        "action_kind": "rewrite_now",
        "scope": "general",
        "before_value": "参与支付页面改版",
        "general_value": "参与支付页面改版",
        "targeted_value": "参与支付页面改版",
        "source_refs": [f"/currentResume/experiences/{EXP_A}/star/a"],
        "introduced_terms": [],
        "rationale": "在已有事实范围内优化表达",
    }
    values.update(overrides)
    return OptimizationChange(**values)


def _question(
    *,
    question_id: str = "Q1",
    module_id: str = EXP_A,
    affects: list[str] | None = None,
) -> OptimizationQuestion:
    return OptimizationQuestion(
        question_id=question_id,
        module_id=module_id,
        field_path="star.r",
        text="是否有可确认的结果？",
        reason="需要确认结果边界",
        affects_change_ids=affects or ["CHG_A"],
    )


def _verify(change: OptimizationChange, documents: dict, *, questions=None):
    return verify_plan_changes(
        plan=OptimizationPlan(changes=[change], questions=questions or []),
        source_documents=documents,
    )


class SourceResolutionTests(unittest.TestCase):
    def test_resolves_strict_rfc6901_mapping_and_array_paths(self) -> None:
        documents = {
            "currentResume": {"a/b~c": [{"value": "ok"}]},
            "selectedSourceExperiences": {},
            "userAnswers": {},
        }
        self.assertEqual(
            resolve_source_ref(documents, "/currentResume/a~1b~0c/0/value"),
            "ok",
        )

    def test_rejects_malformed_unknown_parent_and_missing_pointers(self) -> None:
        documents = {
            "currentResume": {"items": ["first"], "..": "not traversable"},
            "selectedSourceExperiences": {},
            "userAnswers": {},
        }
        invalid = (
            "currentResume/items/0",
            "/resume/items/0",
            "/currentResume/items/~2",
            "/currentResume/items/~",
            "/currentResume/../items",
            "/currentResume/items/01",
            "/currentResume/items/-1",
            "/currentResume/items/2",
            "/currentResume/items/0/value",
            "/currentResume/missing",
            "/currentResume//value",
        )
        for source_ref in invalid:
            with self.subTest(source_ref=source_ref):
                with self.assertRaises(ValueError):
                    resolve_source_ref(documents, source_ref)


class RankTests(unittest.TestCase):
    def test_responsibility_hierarchy_and_negation_are_conservative(self) -> None:
        ranked = [
            responsibility_rank("协助支持交付 / assisted and supported delivery"),
            responsibility_rank("参与并跟进交付 / participated and followed"),
            responsibility_rank("执行并完成开发分析 / executed, developed and analyzed"),
            responsibility_rank("独立负责模块 / owned and was responsible for it"),
            responsibility_rank("主导推动项目 / led and drove the project"),
        ]
        self.assertEqual(ranked, [0, 1, 2, 3, 4])
        self.assertLess(responsibility_rank("并未主导，也不是我负责"), 3)
        self.assertLess(responsibility_rank("did not lead and was not responsible"), 3)

    def test_no_responsibility_signal_is_below_every_real_tier(self) -> None:
        self.assertEqual(responsibility_rank("支付页面改版"), -1)
        self.assertEqual(responsibility_rank("协助支付页面改版"), 0)

    def test_chinese_and_english_responsibility_negation_covers_every_tier(self) -> None:
        negated = (
            "未主导或推动项目",
            "没有负责，也未独立承担",
            "未执行、完成、开发或分析工作",
            "未参与或跟进项目",
            "没有协助/支持交付",
            "did not lead or drive the project",
            "was not responsible and did not own it",
            "did not execute, complete, develop, or analyze the work",
            "did not participate or follow up",
            "did not assist/support delivery",
        )
        for text in negated:
            with self.subTest(text=text):
                self.assertEqual(responsibility_rank(text), -1)

    def test_causality_hierarchy_and_negation_are_conservative(self) -> None:
        ranked = [
            causality_rank("上线后指标提高 / increased after launch"),
            causality_rank("与增长相关并共同贡献 / correlated and jointly contributed"),
            causality_rank("促进并助力增长 / contributed to the improvement"),
            causality_rank("通过优化使增长，直接导致提升 / caused the increase"),
        ]
        self.assertEqual(ranked, [0, 1, 2, 3])
        self.assertLess(causality_rank("并非由我的工作导致 / did not cause it"), 3)

    def test_no_causality_signal_is_below_explicit_temporal_signal(self) -> None:
        self.assertEqual(causality_rank("业务指标记录"), -1)
        self.assertEqual(causality_rank("上线后业务指标增长"), 0)
        self.assertEqual(causality_rank("growth after launch"), 0)

    def test_chinese_and_english_causality_negation_covers_every_tier(self) -> None:
        negated = (
            "并非上线后增长",
            "并不相关，也没有共同贡献",
            "没有促进或助力增长",
            "没有直接导致增长",
            "not after launch",
            "not correlated and did not jointly contribute",
            "did not contribute to the improvement",
            "did not directly cause the increase",
        )
        for text in negated:
            with self.subTest(text=text):
                self.assertEqual(causality_rank(text), -1)


class RequiredSafetyMatrixTests(unittest.TestCase):
    def assertBlocked(self, change: OptimizationChange, documents: dict, *, questions=None):
        changes, summary = _verify(change, documents, questions=questions)
        self.assertEqual(changes[0].safety_status, "blocked")
        self.assertEqual(changes[0].general_value, change.before_value)
        self.assertEqual(changes[0].targeted_value, change.before_value)
        self.assertFalse(changes[0].default_selected)
        self.assertEqual(summary.blocked_change_ids, [change.change_id])
        self.assertTrue(changes[0].safety_findings)
        return changes[0]

    def assertAllowed(self, change: OptimizationChange, documents: dict, *, questions=None):
        changes, summary = _verify(change, documents, questions=questions)
        self.assertEqual(changes[0].safety_status, "allowed")
        self.assertEqual(summary.allowed_change_ids, [change.change_id])
        self.assertEqual(summary.blocked_change_ids, [])
        return changes[0]

    def test_blocks_responsibility_upgrade(self) -> None:
        self.assertBlocked(
            _change(general_value="主导支付系统重构", targeted_value="主导支付系统重构"),
            _documents(),
        )

    def test_blocks_causality_upgrade(self) -> None:
        source = "项目上线后转化率提高"
        self.assertBlocked(
            _change(
                field_path="star.r",
                before_value=source,
                general_value="通过我的优化使转化率提高",
                targeted_value="通过我的优化使转化率提高",
                source_refs=[f"/currentResume/experiences/{EXP_A}/star/r"],
            ),
            _documents(),
        )

    def test_blocks_new_number_without_evidence(self) -> None:
        self.assertBlocked(
            _change(general_value="提升 30%", targeted_value="提升 30%"),
            _documents(),
        )

    def test_blocks_numeric_metric_substitution(self) -> None:
        source = "完成 3 次迭代"
        self.assertBlocked(
            _change(
                before_value=source,
                general_value="效率提升 30%",
                targeted_value="效率提升 30%",
            ),
            _documents(current_a=source),
        )

    def test_allows_unchanged_react_fact(self) -> None:
        source = "使用 React 开发表单"
        allowed = self.assertAllowed(
            _change(before_value=source, general_value=source, targeted_value=source),
            _documents(current_a=source),
        )
        self.assertEqual(allowed.general_value, source)

    def test_blocks_ownership_and_skill_upgrade(self) -> None:
        source = "项目采用 React"
        self.assertBlocked(
            _change(
                before_value=source,
                general_value="熟练使用 React 独立开发",
                targeted_value="熟练使用 React 独立开发",
            ),
            _documents(current_a=source),
        )

    def test_blocks_unproven_method_even_if_introduced_terms_omits_it(self) -> None:
        self.assertBlocked(
            _change(
                general_value="参与支付页面改版并开展 A/B测试",
                targeted_value="参与支付页面改版并开展 A/B测试",
                introduced_terms=[],
            ),
            _documents(),
        )

    def test_allows_linked_answer_number_with_same_metric_context(self) -> None:
        documents = _documents(
            current_a="参与转化率优化",
            answers={"Q1": {"state": "answered", "value": "转化率提升 30%"}},
        )
        change = _change(
            before_value="参与转化率优化",
            general_value="参与转化率优化，转化率提升 30%",
            targeted_value="参与转化率优化，转化率提升 30%",
            source_refs=[f"/currentResume/experiences/{EXP_A}/star/a", "/userAnswers/Q1/value"],
        )
        self.assertAllowed(change, documents, questions=[_question()])

    def test_no_data_answer_does_not_block_qualitative_rewrite_grounded_elsewhere(self) -> None:
        documents = _documents(
            current_a="参与优化交付流程",
            answers={"Q1": {"state": "no_data", "value": ""}},
        )
        change = _change(
            before_value="参与优化交付流程",
            general_value="参与并优化交付流程",
            targeted_value="参与并优化交付流程",
            source_refs=[f"/currentResume/experiences/{EXP_A}/star/a"],
        )
        self.assertAllowed(change, documents, questions=[_question()])

    def test_non_answered_states_cannot_contribute_malicious_factual_values(self) -> None:
        for state in ("no_data", "unknown", "not_my_work", "skipped"):
            with self.subTest(state=state):
                documents = _documents(
                    current_a="参与转化率优化",
                    answers={
                        "Q1": {
                            "state": state,
                            "value": "转化率提升 30%",
                        }
                    },
                )
                change = _change(
                    before_value="参与转化率优化",
                    general_value="参与转化率优化，转化率提升 30%",
                    targeted_value="参与转化率优化，转化率提升 30%",
                    source_refs=[
                        f"/currentResume/experiences/{EXP_A}/star/a",
                        "/userAnswers/Q1/value",
                    ],
                )
                blocked = self.assertBlocked(
                    change,
                    documents,
                    questions=[_question()],
                )
                self.assertTrue(
                    any("回答" in finding for finding in blocked.safety_findings)
                )

    def test_answer_evidence_requires_mapping_and_nonblank_string_value(self) -> None:
        invalid_answers = (
            {"Q1": {"state": "answered", "value": ""}},
            {"Q1": {"state": "answered", "value": "   "}},
            {"Q1": {"state": "answered", "value": 30}},
            {"Q1": "转化率提升 30%"},
        )
        for answers in invalid_answers:
            with self.subTest(answers=answers):
                documents = _documents(
                    current_a="参与转化率优化",
                    answers=answers,
                )
                change = _change(
                    before_value="参与转化率优化",
                    general_value="参与转化率优化，转化率提升 30%",
                    targeted_value="参与转化率优化，转化率提升 30%",
                    source_refs=[
                        f"/currentResume/experiences/{EXP_A}/star/a",
                        "/userAnswers/Q1/value",
                    ],
                )
                self.assertBlocked(change, documents, questions=[_question()])

    def test_invalid_source_pointer_blocks_rewrite(self) -> None:
        blocked = self.assertBlocked(
            _change(source_refs=[f"/currentResume/experiences/{EXP_A}/star/missing"]),
            _documents(),
        )
        self.assertTrue(any("引用" in finding for finding in blocked.safety_findings))

    def test_selected_source_version_can_restore_same_experience_fact(self) -> None:
        source_fact = "使用 SQL 完成漏斗分析"
        self.assertAllowed(
            _change(
                before_value="参与支付页面改版",
                general_value=source_fact,
                targeted_value=source_fact,
                source_refs=[f"/selectedSourceExperiences/{EXP_A}/star/a"],
            ),
            _documents(selected_a=source_fact),
        )

    def test_unselected_bank_content_is_never_evidence(self) -> None:
        documents = _documents()
        documents["experienceBank"] = {"bank-x": {"star": {"a": "使用 Tableau"}}}
        self.assertBlocked(
            _change(
                general_value="参与支付页面改版并使用 Tableau",
                targeted_value="参与支付页面改版并使用 Tableau",
                source_refs=["/experienceBank/bank-x/star/a"],
            ),
            documents,
        )


class SafetyBoundaryTests(unittest.TestCase):
    def assertBlocked(self, change, documents, *, questions=None):
        changes, _ = _verify(change, documents, questions=questions)
        self.assertEqual(changes[0].safety_status, "blocked")
        return changes[0]

    def assertAllowed(self, change, documents, *, questions=None):
        changes, _ = _verify(change, documents, questions=questions)
        self.assertEqual(changes[0].safety_status, "allowed")
        return changes[0]

    def test_experience_refs_must_stay_with_same_experience(self) -> None:
        self.assertBlocked(
            _change(
                general_value="完成数据平台开发",
                targeted_value="完成数据平台开发",
                source_refs=[f"/currentResume/experiences/{EXP_B}/star/a"],
            ),
            _documents(),
        )
        self.assertBlocked(
            _change(
                general_value="完成数据平台开发",
                targeted_value="完成数据平台开发",
                source_refs=[f"/selectedSourceExperiences/{EXP_B}/star/a"],
            ),
            _documents(),
        )

    def test_answer_ref_must_be_linked_to_same_change_and_module(self) -> None:
        documents = _documents(
            answers={"Q2": {"state": "answered", "value": "转化率提升 30%"}}
        )
        candidate = _change(
            general_value="参与支付页面改版，转化率提升 30%",
            targeted_value="参与支付页面改版，转化率提升 30%",
            source_refs=[f"/currentResume/experiences/{EXP_A}/star/a", "/userAnswers/Q2/value"],
        )
        self.assertBlocked(
            candidate,
            documents,
            questions=[_question(question_id="Q2", module_id=EXP_B)],
        )
        self.assertBlocked(
            candidate,
            documents,
            questions=[_question(question_id="Q2", affects=["OTHER_CHANGE"])],
        )

    def test_fullwidth_numbers_percent_decimals_and_units_are_normalized(self) -> None:
        source = "覆盖 １２ 家客户，处理时长从４分钟降至２．５分钟，转化率提升３０％"
        candidate = "覆盖12家客户，处理时长从 4 分钟降至 2.5 分钟，转化率提升 30%"
        self.assertAllowed(
            _change(before_value="参与优化", general_value=candidate, targeted_value=candidate),
            _documents(current_a=source),
        )

    def test_opposite_numeric_direction_is_not_supported_by_same_metric_value(self) -> None:
        source = "成本增加 30%"
        candidate = "成本降低 30%"
        blocked = self.assertBlocked(
            _change(
                before_value="参与成本优化",
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=source),
        )
        self.assertTrue(any("方向" in finding for finding in blocked.safety_findings))

    def test_numeric_sign_flips_are_blocked_after_nfkc_normalization(self) -> None:
        for source, candidate in (
            ("成本变化 -30%", "成本变化 +30%"),
            ("成本变化 ＋３０％", "成本变化 －３０％"),
        ):
            with self.subTest(source=source, candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与成本优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source),
                )
                self.assertTrue(
                    any("符号" in finding for finding in blocked.safety_findings)
                )

    def test_explicit_and_implicit_positive_signs_are_equivalent(self) -> None:
        for source, candidate in (
            ("转化率 +30%", "转化率 30%"),
            ("转化率 ＋３０％", "转化率 30%"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertAllowed(
                    _change(
                        before_value="参与转化率优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source),
                )

    def test_design_time_reduction_example_is_semantically_equivalent(self) -> None:
        source = "处理时长从 4 分钟降至 2.5 分钟"
        candidate = "处理时长由 4 分钟缩短至 2.5 分钟"
        self.assertAllowed(
            _change(
                before_value="参与处理流程优化",
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=source),
        )

    def test_ordered_time_pair_cannot_reverse_from_and_to_values(self) -> None:
        source = "处理时长从 4 分钟降至 2.5 分钟"
        candidate = "处理时长从 2.5 分钟降至 4 分钟"
        blocked = self.assertBlocked(
            _change(
                before_value=source,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=source),
        )
        self.assertTrue(
            any(
                "起点" in finding or "顺序" in finding
                for finding in blocked.safety_findings
            )
        )

    def test_target_first_chinese_transition_preserves_semantic_roles(self) -> None:
        source = "处理时长从 4 分钟降至 2.5 分钟"
        for candidate in (
            "处理时长降至 4 分钟，之前为 2.5 分钟",
            "处理时长降至 4 分钟，原为 2.5分钟",
        ):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source),
                )

        equivalent = "处理时长降至 2.5 分钟，之前为 4 分钟"
        self.assertAllowed(
            _change(
                before_value=source,
                general_value=equivalent,
                targeted_value=equivalent,
            ),
            _documents(current_a=source),
        )

    def test_common_chinese_target_and_origin_markers_preserve_roles(self) -> None:
        source = "处理时长从 4 分钟降至 2.5 分钟"
        for candidate in (
            "处理时长降低到 4 分钟，原先 2.5 分钟",
            "处理时长缩短到 4 分钟，原来 2.5 分钟",
        ):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source),
                )

        for equivalent in (
            "处理时长降低到 2.5 分钟，原先 4 分钟",
            "处理时长缩短到 2.5 分钟，此前 4 分钟",
        ):
            with self.subTest(equivalent=equivalent):
                self.assertAllowed(
                    _change(
                        before_value=source,
                        general_value=equivalent,
                        targeted_value=equivalent,
                    ),
                    _documents(current_a=source),
                )

    def test_english_from_to_transition_preserves_semantic_roles(self) -> None:
        source = "latency from 4 to 2.5"
        candidate = "latency from 2.5 to 4"
        self.assertBlocked(
            _change(
                before_value=source,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=source),
        )

    def test_english_target_first_from_to_preserves_roles(self) -> None:
        source = "latency dropped from 4 to 2.5"
        self.assertBlocked(
            _change(
                before_value=source,
                general_value="latency dropped to 4 from 2.5",
                targeted_value="latency dropped to 4 from 2.5",
            ),
            _documents(current_a=source),
        )

    def test_english_target_first_origin_adverbs_preserve_roles(self) -> None:
        source = "latency dropped from 4 to 2.5"
        for marker in ("previously", "originally", "formerly"):
            with self.subTest(marker=marker, direction="equivalent"):
                equivalent = f"latency dropped to 2.5, {marker} 4"
                self.assertAllowed(
                    _change(
                        before_value=source,
                        general_value=equivalent,
                        targeted_value=equivalent,
                    ),
                    _documents(current_a=source),
                )
            with self.subTest(marker=marker, direction="reversed"):
                reversed_candidate = f"latency dropped to 4, {marker} 2.5"
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=reversed_candidate,
                        targeted_value=reversed_candidate,
                    ),
                    _documents(current_a=source),
                )
        equivalent = "latency dropped to 2.5 from 4"
        self.assertAllowed(
            _change(
                before_value=source,
                general_value=equivalent,
                targeted_value=equivalent,
            ),
            _documents(current_a=source),
        )

    def test_negative_sign_and_decrease_word_are_semantically_equivalent(self) -> None:
        for source, candidate in (
            ("成本变化 -30%", "成本下降 30%"),
            ("成本下降 30%", "成本变化 -30%"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertAllowed(
                    _change(
                        before_value="参与成本优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source),
                )

    def test_contradictory_explicit_sign_and_direction_fail_closed(self) -> None:
        for contradictory in ("成本增加 -30%", "成本下降 +30%"):
            with self.subTest(contradictory=contradictory):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与成本优化",
                        general_value=contradictory,
                        targeted_value=contradictory,
                    ),
                    _documents(current_a=contradictory),
                )
                self.assertTrue(
                    any("矛盾" in finding for finding in blocked.safety_findings)
                )

    def test_changed_candidate_cannot_repair_contradictory_before_without_confirmation(self) -> None:
        for before, candidate in (
            ("成本增加 -30%", "成本下降 30%"),
            ("成本下降 +30%", "成本下降 30%"),
        ):
            with self.subTest(before=before):
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(
                    any(
                        "矛盾" in finding and "确认" in finding
                        for finding in blocked.safety_findings
                    )
                )

    def test_unchanged_contradictory_before_can_remain_unchanged(self) -> None:
        before = "成本增加 -30%"
        self.assertAllowed(
            _change(
                before_value=before,
                general_value=before,
                targeted_value=before,
            ),
            _documents(current_a=before),
        )

    def test_linked_answered_fact_can_resolve_contradictory_before(self) -> None:
        before = "成本增加 -30%"
        candidate = "成本下降 30%"
        documents = _documents(
            current_a=before,
            answers={
                "Q1": {
                    "state": "answered",
                    "value": "实际为成本下降 30%",
                }
            },
        )
        self.assertAllowed(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
                source_refs=[
                    f"/currentResume/experiences/{EXP_A}/star/a",
                    "/userAnswers/Q1/value",
                ],
            ),
            documents,
            questions=[_question()],
        )

    def test_answer_only_needs_to_resolve_corresponding_contradictory_fact(self) -> None:
        before = "服务 3 家客户，成本增加 -30%"
        candidate = "服务 3 家客户，成本下降 30%"
        documents = _documents(
            current_a=before,
            answers={
                "Q1": {
                    "state": "answered",
                    "value": "实际为成本下降 30%",
                }
            },
        )
        self.assertAllowed(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
                source_refs=[
                    f"/currentResume/experiences/{EXP_A}/star/a",
                    "/userAnswers/Q1/value",
                ],
            ),
            documents,
            questions=[_question()],
        )

    def test_negated_answer_does_not_resolve_contradictory_fact(self) -> None:
        before = "成本增加 -30%"
        candidate = "成本下降 30%"
        documents = _documents(
            current_a=before,
            answers={
                "Q1": {
                    "state": "answered",
                    "value": "实际并非成本下降 30%",
                }
            },
        )
        self.assertBlocked(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
                source_refs=[
                    f"/currentResume/experiences/{EXP_A}/star/a",
                    "/userAnswers/Q1/value",
                ],
            ),
            documents,
            questions=[_question()],
        )

    def test_negated_numeric_before_cannot_authorize_positive_claim(self) -> None:
        before = "成本并未下降 30%"
        candidate = "成本下降 30%"
        self.assertBlocked(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=before),
        )

    def test_negated_transition_cannot_authorize_positive_transition(self) -> None:
        before = "处理时长并未从 4 分钟降至 2.5 分钟"
        candidate = "处理时长从 4 分钟降至 2.5 分钟"
        self.assertBlocked(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=before),
        )

    def test_identical_negated_numeric_text_can_remain_unchanged(self) -> None:
        before = "成本并未下降 30%"
        self.assertAllowed(
            _change(
                before_value=before,
                general_value=before,
                targeted_value=before,
            ),
            _documents(current_a=before),
        )

    def test_english_cut_does_not_match_inside_execution(self) -> None:
        self.assertAllowed(
            _change(
                before_value="Supported users",
                general_value="Delivered to 30 users",
                targeted_value="Delivered to 30 users",
            ),
            _documents(current_a="Execution covered 30 users"),
        )

    def test_same_numeric_value_cannot_switch_business_metric(self) -> None:
        source = "留存率提升 30%"
        candidate = "转化率提升 30%"
        blocked = self.assertBlocked(
            _change(before_value="参与指标优化", general_value=candidate, targeted_value=candidate),
            _documents(current_a=source),
        )
        self.assertTrue(any("指标" in finding for finding in blocked.safety_findings))

    def test_same_numeric_value_and_metric_is_allowed(self) -> None:
        source = "转化率提升 30%"
        self.assertAllowed(
            _change(before_value="参与指标优化", general_value=source, targeted_value=source),
            _documents(current_a=source),
        )

    def test_metric_relabel_is_a_new_numeric_claim(self) -> None:
        before = "完成率 30%"
        candidate = "准确率 30%"
        blocked = self.assertBlocked(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=before),
        )
        self.assertTrue(any("指标" in finding for finding in blocked.safety_findings))

    def test_adding_metric_to_same_value_and_unit_is_a_new_claim(self) -> None:
        before = "提升 30%"
        candidate = "完成率提升 30%"
        blocked = self.assertBlocked(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=before),
        )
        self.assertTrue(any("指标" in finding for finding in blocked.safety_findings))

    def test_same_value_unit_and_metric_is_not_numerically_new(self) -> None:
        before = "完成率30%"
        candidate = "完成率 30%"
        self.assertAllowed(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a="没有数字"),
        )

    def test_only_new_numeric_expressions_need_source_evidence(self) -> None:
        before = "完成 3 次迭代"
        self.assertAllowed(
            _change(before_value=before, general_value="按期完成3次迭代", targeted_value="完成 3 次迭代"),
            _documents(current_a="没有数字"),
        )

    def test_both_general_and_targeted_candidates_are_checked(self) -> None:
        before = "参与支付页面改版"
        for general, targeted in (
            ("提升 30%", before),
            (before, "提升 30%"),
        ):
            with self.subTest(general=general, targeted=targeted):
                self.assertBlocked(
                    _change(general_value=general, targeted_value=targeted),
                    _documents(),
                )

    def test_actual_protected_and_ascii_technical_terms_are_extracted(self) -> None:
        for term in ("用户画像", "Power BI", "TensorFlow", "APIv2"):
            with self.subTest(term=term):
                self.assertBlocked(
                    _change(
                        general_value=f"参与支付页面改版并使用 {term}",
                        targeted_value=f"参与支付页面改版并使用 {term}",
                        introduced_terms=[],
                    ),
                    _documents(),
                )

    def test_technical_terms_use_exact_canonical_boundaries(self) -> None:
        blocked = self.assertBlocked(
            _change(
                before_value="参与数据存储",
                general_value="参与 SQL 数据存储",
                targeted_value="参与 SQL 数据存储",
                source_refs=[f"/currentResume/experiences/{EXP_A}/star/a"],
            ),
            _documents(current_a="参与 NoSQL 数据存储"),
        )
        self.assertTrue(any("SQL" in finding for finding in blocked.safety_findings))

        for term in ("C++", "C#"):
            with self.subTest(term=term):
                self.assertBlocked(
                    _change(
                        general_value=f"参与支付页面改版并使用 {term}",
                        targeted_value=f"参与支付页面改版并使用 {term}",
                    ),
                    _documents(),
                )

    def test_negated_term_occurrence_is_not_affirmative_evidence(self) -> None:
        self.assertBlocked(
            _change(
                before_value="项目未使用 SQL",
                general_value="项目使用 SQL",
                targeted_value="项目使用 SQL",
            ),
            _documents(current_a="项目未使用 SQL"),
        )
        self.assertBlocked(
            _change(
                before_value="参与项目",
                general_value="项目使用 React",
                targeted_value="项目使用 React",
            ),
            _documents(current_a="项目没有采用 React"),
        )

    def test_later_affirmative_term_occurrence_after_reset_is_evidence(self) -> None:
        for source in (
            "项目未使用 SQL，但后来使用 SQL 完成分析",
            "项目未使用 SQL 但后来使用 SQL 完成分析",
        ):
            with self.subTest(source=source):
                self.assertAllowed(
                    _change(
                        before_value="参与项目分析",
                        general_value="项目使用 SQL 完成分析",
                        targeted_value="项目使用 SQL 完成分析",
                    ),
                    _documents(current_a=source),
                )

    def test_reported_lowercase_docker_requires_exact_source_token(self) -> None:
        blocked = self.assertBlocked(
            _change(
                general_value="参与支付页面改版并使用 docker",
                targeted_value="参与支付页面改版并使用 docker",
                introduced_terms=["docker"],
            ),
            _documents(current_a="参与 Dockerized 流程"),
        )
        self.assertTrue(any("docker" in finding.casefold() for finding in blocked.safety_findings))

    def test_reported_arbitrary_terms_are_checked_directly_against_sources(self) -> None:
        for source, candidate, term in (
            ("参与表单交互", "参与表单交互", "表单交互"),
            ("使用 kubernetes 部署", "使用 kubernetes 部署", "kubernetes"),
        ):
            with self.subTest(term=term):
                self.assertAllowed(
                    _change(
                        before_value="参与交付",
                        general_value=candidate,
                        targeted_value=candidate,
                        introduced_terms=[term],
                    ),
                    _documents(current_a=source),
                )

    def test_reported_terms_still_require_exact_source_boundaries(self) -> None:
        for source, candidate, term in (
            ("参与 NoSQL 数据存储", "参与 SQL 数据存储", "SQL"),
            ("参与 Dockerized 流程", "参与 docker 流程", "docker"),
        ):
            with self.subTest(term=term):
                self.assertBlocked(
                    _change(
                        before_value="参与数据工作",
                        general_value=candidate,
                        targeted_value=candidate,
                        introduced_terms=[term],
                    ),
                    _documents(current_a=source),
                )

    def test_cplusplus_version_is_one_technical_token(self) -> None:
        blocked = self.assertBlocked(
            _change(
                before_value="参与系统开发",
                general_value="参与 C++20 系统开发",
                targeted_value="参与 C++20 系统开发",
            ),
            _documents(current_a="参与系统开发，版本号 20"),
        )
        self.assertTrue(
            any("C++20" in finding for finding in blocked.safety_findings)
        )

    def test_sentence_initial_titlecase_words_are_not_technical_terms(self) -> None:
        self.assertAllowed(
            _change(
                before_value="Built a dashboard",
                general_value="Created a dashboard",
                targeted_value="Created a dashboard",
            ),
            _documents(current_a="Built a dashboard"),
        )

    def test_term_comparison_is_nfkc_and_case_insensitive(self) -> None:
        source = "使用 Power BI 和 APIv2 分析"
        candidate = "使用 power bi 和 apiv2 分析"
        self.assertAllowed(
            _change(before_value="参与分析", general_value=candidate, targeted_value=candidate),
            _documents(current_a=source),
        )

    def test_text_changing_actions_fail_closed_on_non_string_values(self) -> None:
        cases = (
            _change(
                change_id="DICT_BEFORE",
                before_value={"text": "参与支付页面改版"},
                general_value="参与支付页面改版",
                targeted_value="参与支付页面改版",
            ),
            _change(
                change_id="LIST_GENERAL",
                module_type="personal_summary",
                module_id="personal_summary",
                field_path="personal_summary",
                before_value="产品与研发协作经验",
                general_value=["产品与研发协作经验"],
                targeted_value="产品与研发协作经验",
                source_refs=["/currentResume/personal_summary"],
            ),
            _change(
                change_id="INT_TARGETED",
                general_value="参与支付页面改版",
                targeted_value=30,
            ),
        )
        for change in cases:
            with self.subTest(change_id=change.change_id):
                blocked = self.assertBlocked(change, _documents())
                self.assertTrue(
                    any("文本" in finding or "字符串" in finding for finding in blocked.safety_findings)
                )

    def test_removing_negation_or_adding_lowest_real_signal_is_blocked(self) -> None:
        cases = (
            ("未参与支付页面改版", "参与支付页面改版"),
            ("支付页面改版", "协助支付页面改版"),
            ("并非上线后增长", "上线后增长"),
            ("业务指标记录", "上线后业务指标增长"),
        )
        for before, candidate in cases:
            with self.subTest(before=before, candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )

    def test_supported_negation_forms_block_when_removed_per_change(self) -> None:
        cases = (
            ("不负责模块", "负责模块"),
            ("不参与项目", "参与项目"),
            ("未能主导项目", "主导项目"),
            ("不能协助交付", "协助交付"),
            ("不曾完成开发", "完成开发"),
            ("was not executing the work", "executing the work"),
            ("never participated in the work", "participated in the work"),
            ("不相关", "相关"),
            (
                "没有通过我的优化使转化率提升",
                "通过我的优化使转化率提升",
            ),
            ("was not causing growth", "causing growth"),
            ("没有带来增长", "我的优化带来增长"),
        )
        for before, candidate in cases:
            with self.subTest(before=before, candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )

    def test_standalone_bring_about_is_direct_causality(self) -> None:
        self.assertEqual(causality_rank("我的优化带来转化率提升"), 3)
        self.assertEqual(causality_rank("没有带来转化率提升"), -1)
        self.assertBlocked(
            _change(
                before_value="转化率指标记录",
                general_value="我的优化带来转化率提升",
                targeted_value="我的优化带来转化率提升",
            ),
            _documents(current_a="转化率指标记录"),
        )

    def test_carrying_materials_is_not_causal_evidence_for_metric_growth(self) -> None:
        source = "参与会议，关注转化率并带来会议材料"
        candidate = "我的优化带来转化率提升"
        self.assertEqual(causality_rank(source), -1)
        self.assertEqual(causality_rank(candidate), 3)
        self.assertBlocked(
            _change(
                before_value=source,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=source),
        )

    def test_bring_about_requires_result_in_the_same_clause(self) -> None:
        source = "参与会议并带来材料，讨论转化率提升"
        candidate = "我的优化带来转化率提升"
        self.assertEqual(causality_rank(source), -1)
        self.assertEqual(causality_rank("带来会议材料"), -1)
        self.assertEqual(causality_rank(candidate), 3)
        self.assertEqual(causality_rank("我的优化带来 30 个用户"), 3)
        self.assertBlocked(
            _change(
                before_value=source,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=source),
        )

    def test_bring_about_does_not_cross_coordinating_clause_markers(self) -> None:
        source = "参与会议并带来材料并讨论转化率提升"
        candidate = "我的优化带来转化率提升"
        self.assertEqual(causality_rank(source), -1)
        self.assertBlocked(
            _change(
                before_value=source,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=source),
        )

    def test_bounded_negated_clauses_block_when_removed_per_change(self) -> None:
        cases = (
            ("without causing growth", "causing growth"),
            ("did not actually cause growth", "caused growth"),
            ("failed to cause growth", "caused growth"),
            ("没有给业务带来增长", "给业务带来增长"),
            ("did not independently develop it", "independently developed it"),
            ("并未真正主导项目", "真正主导项目"),
        )
        for before, candidate in cases:
            with self.subTest(before=before):
                self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )

    def test_generalized_negation_modifiers_block_when_removed(self) -> None:
        cases = (
            ("was not actively participating", "actively participating"),
            ("were not actively participating", "actively participating"),
            ("is not actively participating", "actively participating"),
            ("are not actively participating", "actively participating"),
            ("并未主要负责模块", "主要负责模块"),
        )
        for before, candidate in cases:
            with self.subTest(before=before):
                self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )

    def test_negation_mask_does_not_consume_later_positive_clause(self) -> None:
        self.assertEqual(
            responsibility_rank("没有参与前期讨论，后来主导项目"),
            4,
        )
        self.assertEqual(
            causality_rank("没有导致早期增长，后来优化直接导致提升"),
            3,
        )

    def test_negation_gap_stops_at_sequential_clause_boundaries(self) -> None:
        english = "did not attend meetings and later led the project"
        chinese = "没有参加讨论然后主导项目"
        self.assertEqual(responsibility_rank(english), 4)
        self.assertEqual(responsibility_rank(chinese), 4)

        for before, candidate in (
            (english, "later led the project"),
            (chinese, "然后主导项目"),
        ):
            with self.subTest(before=before):
                self.assertAllowed(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )

    def test_safe_rewrite_and_blocked_change_continue_independently_without_mutation(self) -> None:
        safe = _change(change_id="SAFE", general_value="参与支付页面改版及交付", targeted_value="参与支付页面改版及交付")
        blocked = _change(change_id="BLOCKED", general_value="主导支付系统重构", targeted_value="主导支付系统重构")
        plan = OptimizationPlan(changes=[safe, blocked])
        documents = _documents()
        original_plan = plan.model_dump(mode="python")
        original_documents = copy.deepcopy(documents)

        changes, summary = verify_plan_changes(plan=plan, source_documents=documents)

        self.assertEqual([change.safety_status for change in changes], ["allowed", "blocked"])
        self.assertEqual(summary.allowed_change_ids, ["SAFE"])
        self.assertEqual(summary.blocked_change_ids, ["BLOCKED"])
        self.assertEqual(plan.model_dump(mode="python"), original_plan)
        self.assertEqual(documents, original_documents)
        self.assertIsNot(changes[0], safe)

    def test_ask_user_without_candidates_and_leave_unchanged_are_not_applicable(self) -> None:
        ask = _change(
            change_id="ASK",
            action_kind="ask_user",
            general_value=None,
            targeted_value=None,
            source_refs=[],
            default_selected=True,
        )
        leave = _change(
            change_id="LEAVE",
            action_kind="leave_unchanged",
            general_value=None,
            targeted_value=None,
            source_refs=[],
            default_selected=False,
        )
        unsupported = _change(
            change_id="UNSUPPORTED",
            module_type="personal_summary",
            module_id="current_resume",
            field_path="unsupported",
            action_kind="leave_unchanged",
            before_value=None,
            general_value=None,
            targeted_value=None,
            source_refs=[],
            rationale="不支持的内容保持不变",
            default_selected=False,
        )
        changes, summary = verify_plan_changes(
            plan=OptimizationPlan(changes=[ask, leave, unsupported]),
            source_documents=_documents(),
        )
        self.assertEqual([change.safety_status for change in changes], ["pending"] * 3)
        self.assertEqual([change.default_selected for change in changes], [False] * 3)
        self.assertEqual(summary.pending_change_ids, ["ASK", "LEAVE", "UNSUPPORTED"])
        self.assertEqual(summary.allowed_change_ids, [])
        self.assertEqual(summary.blocked_change_ids, [])


if __name__ == "__main__":
    unittest.main()
