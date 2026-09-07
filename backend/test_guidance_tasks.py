import copy
import json
import unittest

from app.domain.ai.guidance_tasks import (
    TASK_RUBRIC_VERSION,
    TASK_RULES,
    build_task_contract,
    judgment_description,
    validate_judgments,
)
from app.domain.ai.guidance_evaluation import assemble_guidance
from app.domain.ai.resume_evaluation import DIMENSION_SUBSCORES
from app.domain.ai.resume_evaluation_service import (
    _build_full_resume_evaluation_input,
)


def realistic_input():
    resume = {
        "profile": {
            "name": "林晨",
            "email": "lin@example.invalid",
            "phone": "",
        },
        "personal_summary": "负责所有产品增长，独立推动公司业绩翻倍",
        "section_order": ["summary", "work", "education", "skills"],
        "skills": [{"id": "skill-1", "name": "SQL"}],
        "educations": [
            {
                "school": "示例大学",
                "major": "信息管理",
                "degree": "本科",
                "start_date": "2017-09-01",
                "end_date": "2021-06-30",
            }
        ],
        "certifications": [],
        "experiences": [
            {
                "category": "work",
                "title": "产品经理",
                "org": "甲公司",
                "start_date": "2022-07-01",
                "end_date": "2025-06-30",
                "star": {
                    "s": "新客户七日激活率为40%。",
                    "t": "改善新客户激活流程。",
                    "a": "参与产品工作，负责相关工作",
                    "r": "上线后8周覆盖200家企业，七日激活率从40%升至52%。",
                },
            },
            {
                "category": "project",
                "title": "运营周报自动化",
                "org": "乙公司",
                "start_date": "2024-04-01",
                "end_date": "2024-06-30",
                "star": {
                    "s": "团队每周人工整理数据。",
                    "t": "减少重复劳动。",
                    "a": "访谈同事并编写SQL查询。",
                    "r": "完成周报模板并投入使用。",
                },
            },
        ],
    }
    return _build_full_resume_evaluation_input(
        "招聘产品经理，负责需求分析。",
        json.dumps(
            {
                "evaluation_scope": "full_resume",
                "target_role": "产品经理",
                "resume": resume,
            },
            ensure_ascii=False,
        ),
    )


def task(contract, task_id):
    return next(row for row in contract["tasks"] if row["taskId"] == task_id)


def source_path(contract, source_id):
    return contract["sources"][source_id]["source"]


def valid_model_judgments(contract):
    result = {}
    for item in contract["tasks"]:
        if item["taskId"] in contract["deterministic"]:
            continue
        assessment = item["allowedAssessments"][0]
        refs = item["allowedSources"][:1]
        if not refs:
            assessment = item["allowedAssessments"][-1]
        result[item["taskId"]] = {
            "assessment": assessment,
            "sourceRefs": refs,
            "reason": "判断由当前允许来源支持。",
            "guidance": {"type": "none", "prompt": ""},
        }
    return result


class GuidanceTaskContractTests(unittest.TestCase):
    def test_skill_and_certificate_combinations_produce_valid_guidance(self):
        cases = (
            ([], [{"name": "PMP"}], "certifications_only", "needs_information"),
            ([{"name": "SQL"}], [{"name": "PMP"}], "skills_present", "none"),
            ([], [], "absent", "needs_information"),
        )
        for skills, certifications, assessment, guidance_type in cases:
            with self.subTest(assessment=assessment):
                resume = realistic_input()["resume"]
                resume["skills"] = skills
                resume["certifications"] = certifications
                evaluation_input = _build_full_resume_evaluation_input(
                    "",
                    json.dumps({"evaluation_scope": "full_resume", "resume": resume}),
                )
                contract = build_task_contract(evaluation_input)
                judgments = validate_judgments(valid_model_judgments(contract), contract)
                identity = "GLOBAL_COMPLETENESS_SKILLS"
                judgment = judgments[identity]
                self.assertEqual(judgment["assessment"], assessment)
                self.assertEqual(judgment["guidance"]["type"], guidance_type)
                public, _ = assemble_guidance(contract, judgments)
                actions = [row for row in public["informationNeeded"] if row["taskId"] == identity]
                self.assertEqual(len(actions), 0 if guidance_type == "none" else 1)
                if assessment == "certifications_only":
                    self.assertIn("技能", actions[0]["action"])
                    self.assertTrue(judgment["sourceRefs"])
                    self.assertTrue(all(
                        source_path(contract, ref).startswith("resume.certifications[")
                        for ref in judgment["sourceRefs"]
                    ))

    def test_human_rules_preserve_professional_level_and_criterion_boundaries(self):
        level_anchors = {
            "met": "该项没有可观察缺陷",
            "minor": "局部轻微缺陷",
            "material": "满足标准的内容与真实缺陷并存",
            "predominantly_vague": "几乎全部是泛化占位表述",
            "absent": "没有该项合格证据或存在矛盾",
        }
        for level, anchor in level_anchors.items():
            with self.subTest(level=level):
                self.assertIn(level, TASK_RULES)
                self.assertIn(anchor, TASK_RULES)
        criterion_anchors = (
            "术语是否准确",
            "术语密度",
            "明确的行动和对象",
            "不要求数字",
            "协作或支持职责",
            "不要求领导职责",
            "边界清楚且不自相矛盾",
            "用户陈述可以支持",
            "STAR行动不应降级",
            "表达精确度可以标记局部缺陷",
            "重复与冗余",
            "信息密度只判断不同的拥挤或低价值信息",
        )
        for anchor in criterion_anchors:
            self.assertIn(anchor, TASK_RULES)
        for anchor in ('understandable but generic duty is not an unclear sentence',
                       'earlier problem or baseline is not an achieved result metric',
                       '数据可信度 also accepts a clearly scoped process count'):
            self.assertIn(anchor, TASK_RULES)

    def test_information_order_scope_includes_chronology_facts(self):
        contract = build_task_contract(realistic_input())
        order = task(contract, "GLOBAL_LOGIC_ORDER")
        paths = {source_path(contract, ref) for ref in order["allowedSources"]}
        self.assertIn("resume.experiences[0].start_date", paths)
        self.assertIn("resume.experiences[0].end_date", paths)
        self.assertIn("resume.educations[0].start_date", paths)
        self.assertIn("resume.educations[0].end_date", paths)

    def test_every_deterministic_assessment_is_allowed_for_empty_inputs(self):
        inputs = [
            {"resume": {}, "fact_metadata": []},
            {
                "resume": {
                    "experiences": [
                        {
                            "title": "产品助理",
                            "org": "示例公司",
                            "start_date": "2024-01-01",
                            "end_date": "2024-06-01",
                            "star": {},
                        }
                    ]
                },
                "fact_metadata": [],
            },
        ]
        for evaluation_input in inputs:
            with self.subTest(evaluation_input=evaluation_input):
                contract = build_task_contract(evaluation_input)
                by_id = {row["taskId"]: row for row in contract["tasks"]}
                self.assertTrue(contract["deterministic"])
                for task_id, judgment in contract["deterministic"].items():
                    self.assertIn(
                        judgment["assessment"],
                        by_id[task_id]["allowedAssessments"],
                        task_id,
                    )

    def test_contract_uses_strict_task_root_schema_and_covers_rubric(self):
        contract = build_task_contract(realistic_input())
        self.assertEqual(
            set(contract), {"tasks", "sources", "deterministic", "generationSchema"}
        )
        self.assertTrue(TASK_RUBRIC_VERSION.startswith("guidance_task_rubric_"))
        self.assertNotIn("20=", TASK_RULES)
        self.assertNotIn("35", TASK_RULES)
        self.assertNotIn("score", TASK_RULES.casefold())

        expected = {
            (dimension, criterion)
            for dimension, criteria in DIMENSION_SUBSCORES
            for criterion, _maximum in criteria
        }
        actual = {(row["dimension"], row["criterion"]) for row in contract["tasks"]}
        self.assertTrue(expected <= actual)
        self.assertEqual(
            set(contract["sources"]["SRC_001"]),
            {"factId", "content", "source", "verificationStatus"},
        )
        required_task_keys = {
            "taskId",
            "dimension",
            "criterion",
            "fieldPath",
            "allowedSources",
            "allowedAssessments",
            "assessmentBands",
            "assessmentPoints",
            "maxScore",
            "optional",
            "allowedGuidance",
            "assessmentDescriptions",
        }
        self.assertTrue(all(set(row) == required_task_keys for row in contract["tasks"]))

        schema = contract["generationSchema"]
        model_ids = [
            row["taskId"]
            for row in contract["tasks"]
            if row["taskId"] not in contract["deterministic"]
        ]
        self.assertEqual(schema["required"], model_ids)
        self.assertEqual(set(schema["properties"]), set(model_ids))
        self.assertFalse(schema["additionalProperties"])
        star_schema = schema["properties"]["EXP_001_STAR_ACTION"]
        self.assertEqual(
            star_schema["properties"]["sourceRefs"]["items"]["enum"],
            task(contract, "EXP_001_STAR_ACTION")["allowedSources"],
        )
        self.assertFalse(star_schema["additionalProperties"])
        self.assertNotIn("score", json.dumps(schema).casefold())
        self.assertNotIn("fieldPath", json.dumps(schema))

        self.assertIn(
            "safe_cleanup",
            schema["properties"]["EXP_001_STAR_ACTION"]["properties"]["guidance"]
            ["properties"]["type"]["enum"],
        )
        self.assertIn(
            "safe_cleanup",
            schema["properties"]["EXP_001_PROFESSIONAL_PRECISION"]["properties"]
            ["guidance"]["properties"]["type"]["enum"],
        )
        self.assertIn(
            "safe_cleanup",
            schema["properties"]["GLOBAL_READABILITY_DENSITY"]["properties"]
            ["guidance"]["properties"]["type"]["enum"],
        )
        self.assertNotIn(
            "safe_cleanup",
            schema["properties"]["EXP_001_QUANT_RESULT_METRIC"]["properties"]
            ["guidance"]["properties"]["type"]["enum"],
        )

    def test_star_and_professional_tasks_are_experience_local(self):
        contract = build_task_contract(realistic_input())
        for prefix, index in (("EXP_001", 0), ("EXP_002", 1)):
            expected_paths = {
                f"resume.experiences[{index}].star.{letter}"
                for letter in "star"
            }
            scoped = [
                row
                for row in contract["tasks"]
                if row["taskId"].startswith(prefix + "_STAR_")
                or row["taskId"].startswith(prefix + "_PROFESSIONAL_")
            ]
            self.assertEqual(len(scoped), 9)
            for row in scoped:
                self.assertEqual(
                    {source_path(contract, ref) for ref in row["allowedSources"]},
                    expected_paths,
                )
        action = task(contract, "EXP_001_STAR_ACTION")
        self.assertEqual(
            action["assessmentBands"]["generic_role_only"], "needs_attention"
        )
        self.assertLess(
            action["assessmentPoints"]["generic_role_only"],
            action["assessmentPoints"]["partial_action"],
        )
        generic_data = realistic_input()
        for fact in generic_data["fact_metadata"]:
            if fact["source"] == "resume.experiences[1].star.r":
                fact["content"] = "工作已经完成。"
        result = task(build_task_contract(generic_data), "EXP_002_STAR_RESULT")
        self.assertIn("clear_result", result["allowedAssessments"])
        self.assertIn("generic_completion", result["allowedAssessments"])

    def test_clear_qualitative_result_floor_is_same_experience_and_ignores_plans(self):
        for text in ("产品已上线。", "需求文档已交付。", "系统成功通过验收。", "方案已通过验收。", "模板已投入使用。", "产品上线了。"):
            data = realistic_input()
            for fact in data["fact_metadata"]:
                if fact["source"] == "resume.experiences[1].star.r":
                    fact["content"] = text
            row = task(build_task_contract(data), "EXP_002_STAR_RESULT")
            self.assertEqual(row["allowedAssessments"], ["clear_result"], text)
        for text in ("产品尚未上线。", "计划下月交付文档。", "若获批准再投入使用。", "预计通过验收。"):
            data = realistic_input()
            for fact in data["fact_metadata"]:
                if fact["source"] == "resume.experiences[1].star.r":
                    fact["content"] = text
            row = task(build_task_contract(data), "EXP_002_STAR_RESULT")
            self.assertIn("generic_completion", row["allowedAssessments"], text)
            self.assertIn("absent", row["allowedAssessments"], text)
        for source, text in (
            ("s", "上线前沟通存在障碍。"),
            ("t", "负责推进产品交付。"),
            ("a", "设计部署方案。"),
            ("r", "负责验收与上线。"),
            ("r", "上线后继续观察业务效果。"),
            ("r", "系统通过验收后再上线。"),
            ("r", "系统验收通过后再发布。"),
            ("r", "产品已上线的演示方案。"),
            ("r", "系统通过验收。"),
            ("r", "一旦系统通过验收。"),
            ("r", "只要系统通过验收。"),
            ("r", "假如系统通过验收。"),
            ("r", "除非系统通过验收。"),
            ("r", "系统应已上线。"),
            ("r", "系统应该已上线。"),
            ("r", "系统将已上线。"),
            ("r", "系统将会已上线。"),
            ("r", "如果项目获批，系统已上线。"),
            ("r", "系统已上线？"),
            ("r", "系统已上线……"),
        ):
            data = realistic_input()
            for fact in data["fact_metadata"]:
                if fact["source"].startswith("resume.experiences[1].star."):
                    fact["content"] = "工作内容。"
                if fact["source"] == f"resume.experiences[1].star.{source}":
                    fact["content"] = text
            row = task(build_task_contract(data), "EXP_002_STAR_RESULT")
            self.assertIn("generic_completion", row["allowedAssessments"], text)
            self.assertIn("absent", row["allowedAssessments"], text)

    def test_empty_fields_and_punctuation_are_code_owned(self):
        contract = build_task_contract(realistic_input())
        schema_ids = set(contract["generationSchema"]["properties"])
        self.assertNotIn("GLOBAL_COMPLETENESS_BASIC", schema_ids)
        basic = contract["deterministic"]["GLOBAL_COMPLETENESS_BASIC"]
        self.assertEqual(basic["assessment"], "partial")
        self.assertEqual(basic["guidance"]["type"], "needs_information")
        self.assertIn("phone", task(contract, "GLOBAL_COMPLETENESS_BASIC")["fieldPath"])

        punctuation = task(contract, "GLOBAL_READABILITY_PUNCTUATION_001")
        self.assertEqual(punctuation["criterion"], "标点")
        self.assertEqual(punctuation["maxScore"], 0)
        self.assertNotIn(punctuation["taskId"], schema_ids)
        judgment = contract["deterministic"][punctuation["taskId"]]
        self.assertEqual(judgment["assessment"], "missing_terminal_punctuation")
        self.assertEqual(judgment["guidance"]["type"], "safe_cleanup")
        punctuation_tasks = [
            row
            for row in contract["tasks"]
            if row["criterion"] == "标点"
            and contract["deterministic"][row["taskId"]]["assessment"]
            == "missing_terminal_punctuation"
        ]
        for row in punctuation_tasks:
            self.assertEqual(len(row["allowedSources"]), 1)
            expected_path = source_path(
                contract, row["allowedSources"][0]
            ).removeprefix("resume.")
            self.assertEqual(row["fieldPath"], expected_path)
            self.assertNotEqual(row["fieldPath"], "resume")

        # The assembler counts deterministic punctuation tasks and caps the
        # deduction. Each detected missing mark therefore has its own task.
        modified = realistic_input()
        for fact in modified["fact_metadata"]:
            if fact["source"] == "resume.experiences[0].star.r":
                fact["content"] = "完成第一项<br>完成第二项<br>完成第三项"
        repeated = build_task_contract(modified)
        missing = [
            row
            for row in repeated["tasks"]
            if row["criterion"] == "标点"
            and repeated["deterministic"][row["taskId"]]["assessment"]
            == "missing_terminal_punctuation"
        ]
        self.assertGreaterEqual(len(missing), 3)
        judgments = validate_judgments(valid_model_judgments(repeated), repeated)
        _public, internal = assemble_guidance(repeated, judgments)
        readability = next(
            row for row in internal["dimensions"] if row["dimension"] == "内容可读"
        )
        grammar = next(
            row for row in readability["subscores"] if row["name"] == "语法与自然度"
        )
        self.assertEqual(grammar["score"], 12)

    def test_deterministic_public_copy_uses_user_terms_and_specific_optional_steps(self):
        contract = build_task_contract(realistic_input())
        forbidden = ("服务器", "候选", "schema", "Schema")
        for task_id, judgment in contract["deterministic"].items():
            visible = judgment["reason"] + judgment["guidance"]["prompt"]
            for term in forbidden:
                self.assertNotIn(term, visible, task_id)

        basic = contract["deterministic"]["GLOBAL_COMPLETENESS_BASIC"]
        self.assertIn("电话", basic["reason"])
        self.assertIn("电话", basic["guidance"]["prompt"])
        self.assertNotIn("姓名", basic["guidance"]["prompt"])
        self.assertNotIn("邮箱", basic["guidance"]["prompt"])

        quant_rows = [
            row
            for row in contract["tasks"]
            if row["taskId"].startswith("EXP_002_QUANT_")
        ]
        self.assertEqual(len(quant_rows), 6)
        for row in quant_rows:
            judgment = contract["deterministic"][row["taskId"]]
            visible = judgment["reason"] + judgment["guidance"]["prompt"]
            self.assertIn(row["criterion"], visible, row["taskId"])
            self.assertIn("如有真实记录", judgment["guidance"]["prompt"])
            self.assertIn("没有则保留原文", judgment["guidance"]["prompt"])

    def test_quantification_only_exposes_server_parsed_numeric_candidates(self):
        data = realistic_input()
        contract = build_task_contract(data)
        first = task(contract, "EXP_001_QUANT_RESULT_METRIC")
        self.assertTrue(first["allowedSources"])
        self.assertTrue(
            all(
                source_path(contract, ref).startswith("resume.experiences[0].star.")
                for ref in first["allowedSources"]
            )
        )
        second_ids = [
            row["taskId"]
            for row in contract["tasks"]
            if row["taskId"].startswith("EXP_002_QUANT_")
        ]
        self.assertEqual(len(second_ids), 6)
        self.assertTrue(all(identity in contract["deterministic"] for identity in second_ids))
        self.assertTrue(
            all(
                contract["deterministic"][identity]["assessment"] == "absent"
                for identity in second_ids
            )
        )
        self.assertTrue(
            all(
                contract["deterministic"][identity]["guidance"]["type"]
                == "needs_information"
                for identity in second_ids
            )
        )

        # Calendar dates in STAR prose are parser matches but never quantitative evidence.
        modified = copy.deepcopy(data)
        for fact in modified["fact_metadata"]:
            if fact["source"] == "resume.experiences[1].star.r":
                fact["content"] = "项目于2024年6月完成。"
        rebuilt = build_task_contract(modified)
        self.assertTrue(
            all(
                row["taskId"] in rebuilt["deterministic"]
                for row in rebuilt["tasks"]
                if row["taskId"].startswith("EXP_002_QUANT_")
            )
        )

    def test_risk_tasks_separate_code_owned_status_and_semantic_risks(self):
        data = realistic_input()
        data["fact_metadata"].append(
            {
                "fact_id": "UNVERIFIED_1",
                "content": "推测主导公司战略。",
                "source": "resume.personal_summary",
                "verification_status": "unverified",
            }
        )
        contract = build_task_contract(data)
        known = next(
            row
            for row in contract["tasks"]
            if row["criterion"] == "risk:unverified_fact"
        )
        self.assertIn(known["taskId"], contract["deterministic"])
        self.assertEqual(
            contract["deterministic"][known["taskId"]]["assessment"], "present"
        )
        exaggerated = task(contract, "RISK_EXAGGERATED_CLAIM")
        conflict = task(contract, "RISK_CONFLICTING_DATE")
        self.assertEqual(exaggerated["maxScore"], 0)
        self.assertEqual(conflict["maxScore"], 0)
        self.assertIn(exaggerated["taskId"], contract["generationSchema"]["properties"])
        self.assertTrue(
            all(
                source_path(contract, ref).startswith("resume.")
                for ref in conflict["allowedSources"]
            )
        )


class GuidanceJudgmentValidationTests(unittest.TestCase):
    def setUp(self):
        self.contract = build_task_contract(realistic_input())
        self.raw = valid_model_judgments(self.contract)

    def test_complete_strict_judgments_merge_with_deterministic_tasks(self):
        merged = validate_judgments(self.raw, self.contract)
        self.assertEqual(list(merged), [row["taskId"] for row in self.contract["tasks"]])
        self.assertEqual(
            merged["GLOBAL_COMPLETENESS_BASIC"],
            self.contract["deterministic"]["GLOBAL_COMPLETENESS_BASIC"],
        )

    def test_missing_unknown_duplicate_sources_and_unknown_fields_are_rejected(self):
        first = next(iter(self.raw))
        mutations = []
        value = copy.deepcopy(self.raw)
        value.pop(first)
        mutations.append(value)
        value = copy.deepcopy(self.raw)
        value["UNKNOWN_TASK"] = value[first]
        mutations.append(value)
        value = copy.deepcopy(self.raw)
        value[first]["sourceRefs"] *= 2
        mutations.append(value)
        value = copy.deepcopy(self.raw)
        value[first]["unexpected"] = True
        mutations.append(value)
        value = copy.deepcopy(self.raw)
        value[first]["guidance"]["unexpected"] = True
        mutations.append(value)
        for invalid in mutations:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_judgments(invalid, self.contract)

    def test_cross_experience_and_positive_without_evidence_are_rejected(self):
        identity = "EXP_001_STAR_ACTION"
        cross = copy.deepcopy(self.raw)
        cross[identity]["sourceRefs"] = task(
            self.contract, "EXP_002_STAR_ACTION"
        )["allowedSources"][:1]
        with self.assertRaises(ValueError):
            validate_judgments(cross, self.contract)

        no_evidence = copy.deepcopy(self.raw)
        no_evidence[identity]["assessment"] = "concrete_action"
        no_evidence[identity]["sourceRefs"] = []
        with self.assertRaises(ValueError):
            validate_judgments(no_evidence, self.contract)

    def test_missing_factual_components_cannot_be_safe_cleanup(self):
        identity = "EXP_001_STAR_ACTION"
        invalid = copy.deepcopy(self.raw)
        invalid[identity] = {
            "assessment": "absent",
            "sourceRefs": [],
            "reason": "没有可识别的具体动作。",
            "guidance": {"type": "safe_cleanup", "prompt": "补写具体动作。"},
        }
        with self.assertRaises(ValueError):
            validate_judgments(invalid, self.contract)

        invalid[identity]["guidance"] = {
            "type": "needs_information",
            "prompt": next(
                pair["prompt"]
                for pair in task(self.contract, identity)["allowedGuidance"]
                if pair["type"] == "needs_information"
            ),
        }
        merged = validate_judgments(invalid, self.contract)
        self.assertEqual(
            merged[identity]["guidance"]["type"], "needs_information"
        )

    def test_source_supported_cleanup_is_allowed_for_strong_star_precision_and_density(self):
        cases = (
            (
                "EXP_001_STAR_ACTION",
                "concrete_action",
            ),
            (
                "EXP_001_PROFESSIONAL_PRECISION",
                "minor:ambiguous_action_or_object",
            ),
            (
                "GLOBAL_READABILITY_DENSITY",
                "minor_issues",
            ),
        )
        for identity, assessment in cases:
            with self.subTest(identity=identity):
                raw = copy.deepcopy(self.raw)
                row = task(self.contract, identity)
                pair = next(
                    pair
                    for pair in row["allowedGuidance"]
                    if pair["type"] == "safe_cleanup"
                )
                raw[identity] = {
                    "assessment": assessment,
                    "sourceRefs": row["allowedSources"][:1],
                    "reason": "原文有具体内容，也有可直接删除的重复或模糊短语。",
                    "guidance": copy.deepcopy(pair),
                }
                merged = validate_judgments(raw, self.contract)
                self.assertEqual(merged[identity]["guidance"]["type"], "safe_cleanup")

    def test_partial_and_absent_star_still_reject_safe_cleanup(self):
        cases = (
            ("EXP_001_STAR_SITUATION", "partial_context"),
            ("EXP_001_STAR_TASK", "absent"),
            ("EXP_001_STAR_ACTION", "generic_role_only"),
            ("EXP_001_STAR_RESULT", "partial_result"),
        )
        for identity, assessment in cases:
            with self.subTest(identity=identity, assessment=assessment):
                raw = copy.deepcopy(self.raw)
                raw[identity] = {
                    "assessment": assessment,
                    "sourceRefs": (
                        []
                        if assessment == "absent"
                        else task(self.contract, identity)["allowedSources"][:1]
                    ),
                    "reason": "当前要素缺少事实内容。",
                    "guidance": {"type": "safe_cleanup", "prompt": "直接补写该要素。"},
                }
                with self.assertRaises(ValueError):
                    validate_judgments(raw, self.contract)

    def test_none_guidance_has_empty_prompt_and_deterministic_input_cannot_be_overridden(self):
        identity = next(iter(self.raw))
        invalid = copy.deepcopy(self.raw)
        invalid[identity]["guidance"]["prompt"] = "不应出现"
        with self.assertRaises(ValueError):
            validate_judgments(invalid, self.contract)

    def test_required_non_strong_judgment_must_offer_actionable_guidance(self):
        identity = "EXP_001_STAR_ACTION"
        invalid = copy.deepcopy(self.raw)
        invalid[identity] = {
            "assessment": "generic_role_only",
            "sourceRefs": task(self.contract, identity)["allowedSources"][:1],
            "reason": "原文只有泛化职责，没有可识别的动作和对象。",
            "guidance": {"type": "none", "prompt": ""},
        }
        with self.assertRaises(ValueError):
            validate_judgments(invalid, self.contract)

        invalid[identity]["guidance"] = {
            "type": "needs_information",
            "prompt": next(
                pair["prompt"]
                for pair in task(self.contract, identity)["allowedGuidance"]
                if pair["type"] == "needs_information"
            ),
        }
        merged = validate_judgments(invalid, self.contract)
        self.assertEqual(
            merged[identity]["guidance"]["type"], "needs_information"
        )

    def test_optional_non_strong_judgment_may_omit_advice(self):
        identity = "EXP_001_QUANT_COVERAGE_SCALE"
        optional = copy.deepcopy(self.raw)
        optional[identity] = {
            "assessment": "absent",
            "sourceRefs": [],
            "reason": "现有数字没有表达业务或服务覆盖范围。",
            "guidance": {"type": "none", "prompt": ""},
        }
        merged = validate_judgments(optional, self.contract)
        self.assertEqual(merged[identity]["guidance"], {"type": "none", "prompt": ""})

    def test_merge_validates_server_owned_required_guidance(self):
        contract = build_task_contract({"resume": {}, "fact_metadata": []})
        by_id = {row["taskId"]: row for row in contract["tasks"]}
        for task_id, judgment in contract["deterministic"].items():
            row = by_id[task_id]
            if not row["optional"] and row["assessmentBands"][judgment["assessment"]] != "strong":
                self.assertNotEqual(judgment["guidance"]["type"], "none", task_id)
                self.assertTrue(judgment["guidance"]["prompt"].strip(), task_id)
        broken = copy.deepcopy(contract)
        identity = "GLOBAL_COMPLETENESS_BASIC"
        broken["deterministic"][identity]["guidance"] = {"type": "none", "prompt": ""}
        with self.assertRaises(ValueError):
            validate_judgments({}, broken)

    def test_task_owned_guidance_pairs_reject_live_unbounded_suggestions(self):
        bad = (
            (
                "EXP_001_PROFESSIONAL_ACTION_VERBS",
                "met",
                "needs_information",
                "建议搭建模型并编写脚本。",
            ),
            (
                "EXP_001_PROFESSIONAL_TERMINOLOGY",
                "minor:no_identifiable_work_terms",
                "needs_information",
                "补充SQL脚本、看板搭建和指标体系。",
            ),
            (
                "GLOBAL_READABILITY_SCAN",
                "minor_issues",
                "safe_cleanup",
                "扩展经历正文并增加更多要点。",
            ),
        )
        for identity, assessment, guidance_type, prompt in bad:
            with self.subTest(identity=identity):
                row = task(self.contract, identity)
                schema = self.contract["generationSchema"]["properties"][identity]
                self.assertNotIn(
                    prompt,
                    schema["properties"]["guidance"]["properties"]["prompt"]["enum"],
                )
                raw = copy.deepcopy(self.raw)
                raw[identity] = {
                    "assessment": assessment,
                    "sourceRefs": row["allowedSources"][:1],
                    "reason": "模型私有判断。",
                    "guidance": {"type": guidance_type, "prompt": prompt},
                }
                with self.assertRaises(ValueError):
                    validate_judgments(raw, self.contract)

    def test_registered_pair_is_required_and_public_description_ignores_model_reason(self):
        identity = "EXP_001_PROFESSIONAL_PRECISION"
        row = task(self.contract, identity)
        pair = next(
            pair
            for pair in row["allowedGuidance"]
            if pair["type"] == "safe_cleanup"
        )
        raw = copy.deepcopy(self.raw)
        raw[identity] = {
            "assessment": "minor:ambiguous_action_or_object",
            "sourceRefs": row["allowedSources"][:1],
            "reason": "不应出现在公开报告的模型自由文本。",
            "guidance": copy.deepcopy(pair),
        }
        merged = validate_judgments(raw, self.contract)
        description = judgment_description(row, merged[identity])
        self.assertNotIn("模型自由文本", description)
        self.assertTrue(
            description.endswith(
                row["assessmentDescriptions"][merged[identity]["assessment"]]
            )
        )

        mismatched = copy.deepcopy(raw)
        needs_prompt = next(
            item["prompt"]
            for item in row["allowedGuidance"]
            if item["type"] == "needs_information"
        )
        mismatched[identity]["guidance"] = {
            "type": "safe_cleanup",
            "prompt": needs_prompt,
        }
        with self.assertRaises(ValueError):
            validate_judgments(mismatched, self.contract)

    def test_deterministic_guidance_and_descriptions_are_registered(self):
        for task_id, judgment in self.contract["deterministic"].items():
            row = task(self.contract, task_id)
            self.assertIn(judgment["guidance"], row["allowedGuidance"], task_id)
            self.assertTrue(
                judgment_description(row, judgment).endswith(judgment["reason"]),
                task_id,
            )

        invalid = copy.deepcopy(self.raw)
        invalid["GLOBAL_COMPLETENESS_BASIC"] = self.contract["deterministic"][
            "GLOBAL_COMPLETENESS_BASIC"
        ]
        with self.assertRaises(ValueError):
            validate_judgments(invalid, self.contract)


if __name__ == "__main__":
    unittest.main()
