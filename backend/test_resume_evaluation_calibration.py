import copy
import json
import unittest
from unittest.mock import AsyncMock, patch
from app.domain.ai.resume_evaluation_calibration import calibrate_evaluation,round_ratio
from app.domain.ai.resume_evaluation import normalize_resume_evaluation
from test_resume_evaluation import make_evaluation


class CalibrationTests(unittest.TestCase):
    def test_baseline_recognizes_convertible_duration_units(self):
        for text in (
            "处理耗时由2小时降至30分钟。",
            "处理耗时由120分钟降至30分钟。",
            "Processing time decreased from 2 hours to 30 minutes.",
            "处理耗时由2 hours降至30分钟。",
            "响应耗时由1秒降至500毫秒。",
            "处理耗时由2天降至12小时。",
            "Processing time decreased from 2 days to 12 hours.",
        ):
            with self.subTest(text=text):
                result, context = self.result(text, "resume.experiences[0].star.r")
                # One of two experiences supplies a valid before/after pair.
                original = copy.deepcopy(result)
                output = calibrate_evaluation(result, context)["resumeEvaluation"]
                sub = next(s for s in output["dimensions"][-1]["subscores"]
                           if s["name"] == "基线与前后对比")
                self.assertEqual(sub["score"], 13)
                self.assertEqual(sub["evidenceIds"], ["E001"])
                self.assertEqual(result, original)

    def test_baseline_duration_grouping_keeps_evidence_boundaries(self):
        for text in (
            "用2小时处理30次请求。",
            "每周耗时2小时，每天耗时30分钟。",
            "如果处理耗时由2小时降至30分钟，则推广。",
            "处理耗时没有从2小时降至30分钟。",
            "2024年1月到2024年2月。",
        ):
            with self.subTest(text=text):
                result, context = self.result(text, "resume.experiences[0].star.r")
                output = calibrate_evaluation(result, context)["resumeEvaluation"]
                sub = next(s for s in output["dimensions"][-1]["subscores"]
                           if s["name"] == "基线与前后对比")
                self.assertEqual(sub["score"], 0)
                self.assertEqual(sub["evidenceIds"], [])
        result, context = self.result("处理耗时由2小时降至30分钟。")
        sub = next(s for s in result["resumeEvaluation"]["dimensions"][-1]["subscores"]
                   if s["name"] == "基线与前后对比")
        sub["score"] = 0
        output = calibrate_evaluation(result, context)["resumeEvaluation"]
        sub = next(s for s in output["dimensions"][-1]["subscores"]
                   if s["name"] == "基线与前后对比")
        self.assertEqual(sub["score"], 0)
        self.assertEqual(sub["evidenceIds"], [])

    def test_fact_aliases_and_whitespace_preserve_scores_and_evidence(self):
        result, context = self.result("Delivered 20 documents.")
        context["fact_metadata"].append({
            "fact_id": "PROFILE", "content": "Candidate",
            "source": "resume.profile.name", "verification_status": "user_claimed",
        })
        expected = calibrate_evaluation(result, context)
        for id_key in ("fact_id", "factId"):
            for status_key in ("verification_status", "verificationStatus"):
                with self.subTest(id_key=id_key, status_key=status_key):
                    aliased = copy.deepcopy(context)
                    aliased["fact_metadata"] = [{
                        id_key: " " + fact["fact_id"] + " ",
                        status_key: " " + fact["verification_status"] + " ",
                        "content": " " + fact["content"] + " ",
                        "source": " " + fact["source"] + " ",
                    } for fact in context["fact_metadata"]]
                    original = copy.deepcopy(aliased)
                    normalize_resume_evaluation(
                        result["resumeEvaluation"], jd_available=True,
                        fact_metadata=aliased["fact_metadata"],
                    )
                    self.assertEqual(calibrate_evaluation(result, aliased), expected)
                    self.assertEqual(aliased, original)

    def test_unresolved_completeness_gaps_keep_specific_actions(self):
        result, context = self.result("Delivered the project")
        context["resume"]["educations"] = [{"school": "", "major": "", "degree": "Bachelor"}]
        context["fact_metadata"].append({"fact_id": "EDU", "content": "Bachelor",
            "source": "resume.educations[0].degree", "verification_status": "user_claimed"})
        result["resumeEvaluation"]["topPriorities"] = [{"issueId": "ISSUE_004", "priority": 1,
            "action": "Fill in the school and major", "expectedScoreGain": 10}]
        out = calibrate_evaluation(result, context)["resumeEvaluation"]
        descriptions = [i["description"] for i in out["issues"]]
        actions = [i["action"] for i in out["topPriorities"]]
        self.assertTrue(any("学校" in x for x in descriptions))
        self.assertTrue(any("专业" in x for x in descriptions))
        self.assertTrue(any("学校" in x for x in actions))
        self.assertTrue(any("专业" in x for x in actions))
        self.assertFalse(any("学历" in x for x in descriptions))
        ids = {i["issueId"] for i in out["issues"]}
        self.assertTrue(all(p["issueId"] in ids for p in out["topPriorities"]))
        context["resume"]["educations"][0].update(school="School", major="Engineering")
        for key, content in (("school", "School"), ("major", "Engineering")):
            context["fact_metadata"].append({"fact_id": key, "content": content,
                "source": f"resume.educations[0].{key}", "verification_status": "user_claimed"})
        solved = calibrate_evaluation(result, context)["resumeEvaluation"]
        self.assertFalse(any("教育经历" in p["action"] for p in solved["topPriorities"]))
        self.assertTrue(any(i["issueId"] == "ISSUE_001" for i in solved["issues"]))

    def result(self,text,source="resume.experiences[0].star.a"):
        facts=[{"fact_id":"F1","content":text,"source":source,"verification_status":"user_claimed"}]
        raw=make_evaluation(fact_id="F1",source_text=text,totals=[70,70,70,70,70,100])
        evaluation=normalize_resume_evaluation(raw,jd_available=True,fact_metadata=facts)
        return {"resumeEvaluation":evaluation},{"resume":{"experiences":[{"star":{"a":text}},{"star":{"a":"second"}}]},"fact_metadata":facts,"jd_text":"JD"}

    def test_generic_text_cannot_earn_numeric_credit(self):
        r,i=self.result("参与相关工作，负责相关工作")
        original=copy.deepcopy(r)
        out=calibrate_evaluation(r,i)["resumeEvaluation"]
        self.assertEqual(out["dimensions"][-1]["score"],0)
        self.assertTrue(all(not s["evidenceIds"] for s in out["dimensions"][-1]["subscores"]))
        self.assertEqual(r,original)

    def test_zero_point_references_do_not_establish_numeric_support(self):
        text = "Delivered 20 requirement documents; no business outcome was measured."
        result, evaluation_input = self.result(text, "resume.experiences[0].star.r")
        quant = result["resumeEvaluation"]["dimensions"][-1]
        for sub in quant["subscores"]:
            # A citation can explain a zero score without supporting any credit.
            sub["score"] = 5 if sub["name"] == "过程数量" else 0
        quant["strengths"] = []
        result["resumeEvaluation"] = normalize_resume_evaluation(
            result["resumeEvaluation"], jd_available=True,
            fact_metadata=evaluation_input["fact_metadata"],
        )
        original = copy.deepcopy(result)
        out = calibrate_evaluation(result, evaluation_input)["resumeEvaluation"]
        for sub in out["dimensions"][-1]["subscores"]:
            if sub["name"] == "过程数量":
                self.assertEqual(sub["score"], 5)
                self.assertEqual(sub["evidenceIds"], ["E001"])
            else:
                self.assertEqual(sub["score"], 0)
                self.assertEqual(sub["evidenceIds"], [])
        self.assertEqual(result, original)

    def test_zero_point_unverified_references_remain_valid_without_credit(self):
        for status in ("unverified", "inferred"):
            with self.subTest(status=status):
                result, evaluation_input = self.result("Delivered the project")
                fact = {
                    "fact_id": "F2", "content": "Conversion increased 20 percent.",
                    "source": "resume.experiences[0].star.r",
                    "verification_status": status,
                }
                evaluation_input["fact_metadata"].append(fact)
                evaluation = result["resumeEvaluation"]
                evaluation["evidence"].append({
                    "evidenceId": "E002", "factId": "F2",
                    "sourceText": fact["content"], "location": fact["source"],
                    "verificationStatus": status, "supportedDimensions": [],
                })
                quant = evaluation["dimensions"][-1]
                for sub in quant["subscores"]:
                    sub.update(score=0, evidenceIds=["E002"])
                quant["strengths"] = []
                result["resumeEvaluation"] = normalize_resume_evaluation(
                    evaluation, jd_available=True,
                    fact_metadata=evaluation_input["fact_metadata"],
                )
                out = calibrate_evaluation(result, evaluation_input)["resumeEvaluation"]
                self.assertEqual(out["dimensions"][-1]["score"], 0)
                self.assertTrue(all(not s["evidenceIds"] for s in out["dimensions"][-1]["subscores"]))

    def test_coverage_counts_distinct_experiences_not_model_points(self):
        r,i=self.result("访谈12家客户")
        # The model identifies this as a process count, not an achieved outcome.
        r["resumeEvaluation"]["dimensions"][-1]["subscores"][0]["score"] = 0
        out=calibrate_evaluation(r,i)["resumeEvaluation"]
        subs={s["name"]:s for s in out["dimensions"][-1]["subscores"]}
        self.assertEqual(subs["过程数量"]["score"],5)
        self.assertEqual(subs["结果指标"]["score"],0)
        self.assertEqual(subs["基线与前后对比"]["score"],0)

    def test_supported_results_keep_credit_in_every_selected_star_field(self):
        text = "Implemented a workflow and increased conversion from 40% to 52%."
        for field in "star":
            with self.subTest(field=field):
                result, context = self.result(text, f"resume.experiences[0].star.{field}")
                context["resume"]["experiences"] = [{"star": {field: text}}]
                out = calibrate_evaluation(result, context)["resumeEvaluation"]
                self.assertEqual(out["dimensions"][-1]["subscores"][0]["score"], 30)

    def test_process_only_result_stays_zero_in_action_and_result_fields(self):
        for field in ("a", "r"):
            with self.subTest(field=field):
                result, context = self.result("Delivered 20 requirement documents.", f"resume.experiences[0].star.{field}")
                quant = result["resumeEvaluation"]["dimensions"][-1]
                quant["subscores"][0]["score"] = 0
                out = calibrate_evaluation(result, context)["resumeEvaluation"]
                self.assertEqual(out["dimensions"][-1]["subscores"][0]["score"], 0)

    def test_numeric_profile_or_employment_date_is_not_quantity_evidence(self):
        for source in ("resume.profile.phone","resume.experiences[0].start_date"):
            r,i=self.result("2024-01-01",source)
            self.assertEqual(calibrate_evaluation(r,i)["resumeEvaluation"]["dimensions"][-1]["score"],0)

    def test_ratio_rounds_half_up_and_handles_empty_resume(self):
        self.assertEqual(round_ratio(15,1,2),8)
        self.assertEqual(round_ratio(15,0,0),0)

    def test_calendar_dates_conditional_and_negated_claims_do_not_earn_credit(self):
        for value in ("2024年1月", "2024-01-01", "January 2024", "如果效率提升30%，则继续试点", "效率未提升30%"):
            r,i=self.result(value)
            with self.subTest(value=value):
                self.assertEqual(calibrate_evaluation(r,i)["resumeEvaluation"]["dimensions"][-1]["score"],0)

    def test_exaggeration_and_objectivity_credit_cannot_coexist(self):
        r,i=self.result("精通所有业务")
        e=r["resumeEvaluation"]
        e["riskFlags"]=[{"type":"exaggerated_claim","description":"绝对化表述","evidenceIds":["E001"]}]
        e["dimensions"][4]["subscores"][-1].update(score=20,evidenceIds=["E001"])
        out=calibrate_evaluation(r,i)["resumeEvaluation"]
        self.assertEqual(out["dimensions"][4]["subscores"][-1]["score"],0)
        self.assertTrue(any(x["issueId"].startswith("RUBRIC_EXAGGERATED") for x in out["issues"]))


class CalibrationServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_consensus_accepts_camel_case_fact_metadata(self):
        from app.domain.ai import resume_evaluation_service as service
        from app.domain.ai.resume_evaluation import SCORING_VERSION

        result, context = CalibrationTests().result("Delivered 20 documents.")
        expected = calibrate_evaluation(result, context)
        expected["resumeEvaluation"]["scoringVersion"] = SCORING_VERSION
        context["evaluation_scope"] = "full_resume"
        context["fact_metadata"] = [{
            "factId": fact["fact_id"],
            "verificationStatus": fact["verification_status"],
            "content": fact["content"], "source": fact["source"],
        } for fact in context["fact_metadata"]]
        provider = AsyncMock(return_value=result)
        with patch.object(service, "_call_llm", provider):
            generated = await service.analyze_resume_evaluation("JD", json.dumps(context))
        self.assertEqual(generated, expected)
        self.assertEqual(provider.await_count, 3)
