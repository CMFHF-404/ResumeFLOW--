import asyncio
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import qa_guidance_audit as qa
from app.domain.ai.resume_evaluation import DIMENSION_NAMES


def report(*, score=False, bands=None, priorities=None, safe=None, needed=None):
    bands = bands or ["adequate"] * 6
    value = {
        "resumeEvaluation": {
            "evaluationVersion": "guidance_audit_v1",
            "overallBand": "adequate",
            "confidence": "medium",
            "dimensionGuidance": [
                {"dimension": dimension, "status": band, "strengths": [], "issues": [], "actions": []}
                for dimension, band in zip(DIMENSION_NAMES, bands)
            ],
            "topPriorities": [{"taskId": task_id} for task_id in (["T1", "T2"] if priorities is None else priorities)],
            "safeCleanup": [{"taskId": task_id} for task_id in (["T1"] if safe is None else safe)],
            "informationNeeded": [{"taskId": task_id} for task_id in (["T2"] if needed is None else needed)],
            "riskFlags": [],
            "auditReceipt": {
                "receiptId": "a" * 32, "inputHash": "b" * 64, "tasksHash": "c" * 64,
                "judgmentsHash": "d" * 64, "rubricHash": "e" * 64, "schemaHash": "f" * 64,
                "auditVersion": "guidance_task_audit_v1",
            },
        }
    }
    if score:
        value["resumeEvaluation"]["overallScore"] = 88
    return value


def diagnostics():
    return [
        {"stage": "generation", "category": "attempt"},
        {"stage": "generation", "category": "generated"},
        {"stage": "rubric_audit", "category": "attempt"},
        {"stage": "rubric_audit", "category": "reviewed"},
        {"stage": "publication", "category": "approved"},
    ]


class GuidanceAuditContractTests(unittest.TestCase):
    def test_text_quality_validates_each_document_not_only_identifiers(self):
        valid = {'documents': [{'id': identity, 'unsupportedClaims': [], 'defects': [],
                               'reason': '有来源支持。'} for identity in ('A', 'B')], 'preferredId': 'tie'}
        self.assertEqual(qa._validate_text_judge(valid, ['A', 'B']), valid)
        invalid = []
        for key, value in (('unsupportedClaims', False), ('defects', [None]), ('reason', ''), ('extra', True)):
            altered = copy.deepcopy(valid); altered['documents'][0][key] = value; invalid.append(altered)
        for altered in invalid:
            with self.subTest(altered=altered), self.assertRaises(ValueError):
                qa._validate_text_judge(altered, ['A', 'B'])

    def test_anonymous_judges_receive_the_exact_schema_in_the_prompt(self):
        from app.domain.ai import llm_transport
        sample = {'id': 'A', 'resume': {}, 'sources': {}}
        public = report()['resumeEvaluation']

        async def answer(messages, **kwargs):
            system = messages[0]['content']
            self.assertIn('OUTPUT_JSON_SCHEMA:\n', system)
            supplied = json.loads(system.split('OUTPUT_JSON_SCHEMA:\n', 1)[1])
            self.assertEqual(supplied, kwargs['gemini_response_json_schema'])
            if 'accurate' in supplied['properties']:
                return {'accurate': True, 'actionable': True, 'safe': True,
                        'requiresAdvancedResponsibilities': False, 'introducesFacts': False,
                        'contradictoryAdvice': False, 'reason': '来源与指导一致。'}
            ids = supplied['properties']['preferredId']['enum'][:-1]
            return {'documents': [{'id': identity, 'unsupportedClaims': [], 'defects': [],
                                  'reason': '文本与来源一致。'} for identity in ids], 'preferredId': 'tie'}

        with patch.object(llm_transport, '_call_llm', side_effect=answer) as model:
            guided = asyncio.run(qa._judge_guidance(sample, public, [public] * 3))
            paired = asyncio.run(qa._judge_text_pair(sample, {'resume': {}}))
        self.assertEqual(model.await_count, 2)
        self.assertTrue(guided['safe'])
        self.assertEqual(paired['preferredId'], 'tie')

    def test_failed_quality_keeps_raw_synthetic_response_and_restores_sink(self):
        from app.domain.ai.response_normalizers import response_evidence_sink
        previous = []; token = response_evidence_sink.set(previous)
        async def invalid():
            response_evidence_sink.get().append({'raw': '{"unexpected": true}'})
            raise ValueError('anonymous guidance judge response violates schema')
        try:
            result = asyncio.run(qa._quality_call('guidance', invalid, sample_id='A'))
            self.assertIs(response_evidence_sink.get(), previous)
            self.assertEqual(previous, [])
        finally:
            response_evidence_sink.reset(token)
        self.assertFalse(result['ok'])
        self.assertEqual(result['providerResponses'], [{'raw': '{"unexpected": true}'}])

    def test_original_ten_samples_are_rebuilt_without_partial_acceptance_output(self):
        samples, keys = qa._source_samples()
        self.assertEqual([sample["id"] for sample in samples], list(qa.SAMPLE_IDS))
        self.assertEqual(set(keys), set(qa.SAMPLE_IDS))

    def test_public_contract_rejects_scores_and_third_call(self):
        self.assertEqual(qa.validate_public_guidance(report(), diagnostics())["overallBand"], "adequate")
        with self.assertRaisesRegex(ValueError, "scoring"):
            qa.validate_public_guidance(report(score=True), diagnostics())
        three_calls = diagnostics() + [{"stage": "generation", "category": "attempt"}]
        with self.assertRaisesRegex(ValueError, "exactly one"):
            qa.validate_public_guidance(report(), three_calls)

    def test_stability_requires_all_three_successes_and_shared_priorities(self):
        one = {"ok": True, "value": report()}
        self.assertEqual(qa._sample_stability([one, one])["status"], "insufficient_successes")
        stable = qa._sample_stability([copy.deepcopy(one) for _ in range(3)])
        self.assertEqual(stable["status"], "stable")
        unstable = copy.deepcopy(one)
        unstable["value"]["resumeEvaluation"]["overallBand"] = "needs_attention"
        self.assertEqual(qa._sample_stability([one, one, unstable])["status"], "unstable")
        missing = copy.deepcopy(one)
        missing["value"]["resumeEvaluation"]["safeCleanup"].append({"taskId": "T3"})
        result = qa._sample_stability([one, one, missing])
        self.assertFalse(result["classificationStable"])
        self.assertEqual(result["missingClassificationTaskIds"], ["T3"])
        self.assertEqual(result['advicePresenceVarianceTaskIds'], ['T3'])
        self.assertEqual(result['classificationFlipTaskIds'], [])
        flipped = copy.deepcopy(one)
        flipped['value']['resumeEvaluation']['safeCleanup'] = []
        flipped['value']['resumeEvaluation']['informationNeeded'].append({'taskId': 'T1'})
        self.assertEqual(qa._sample_stability([one, one, flipped])['classificationFlipTaskIds'], ['T1'])

    def test_quality_contract_probe_is_frozen_non_acceptance_and_never_retries_records(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            sample = {'id': 'A', 'resume': {}, 'sources': {}}
            guide = AsyncMock(return_value={'accurate': False})
            text = AsyncMock(return_value={'preferredId': 'tie'})
            with patch.object(qa, '_out', return_value=out), \
                 patch.object(qa, 'validate', return_value={'samples': [sample]}), \
                 patch.object(qa, '_judge_guidance', guide), patch.object(qa, '_judge_text_pair', text):
                first = asyncio.run(qa.run_quality_contract_probe('newtag'))
                second = asyncio.run(qa.run_quality_contract_probe('newtag'))
            self.assertEqual(first, second)
            self.assertTrue(first['schemaValid'])
            self.assertIn('not_product_or_quality_acceptance', first['purpose'])
            guide.assert_awaited_once(); text.assert_awaited_once()
            self.assertFalse((out / 'finished.json').exists())
            self.assertFalse(list(out.glob('evaluation-*.json')))
            with patch.object(qa, 'validate', side_effect=RuntimeError('changed')), \
                 patch.object(qa, '_judge_guidance') as no_call:
                with self.assertRaises(RuntimeError):
                    asyncio.run(qa.run_quality_contract_probe('changedtag'))
            no_call.assert_not_called()

    def test_frozen_manifest_rejects_changed_protocol_before_record_reuse(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "guidance"
            artifacts = {
                "fixtures.json": {"jd": "J", "target_role": "R", "samples": []},
                "protocol.json": {"repeats": 3},
                "algorithm-hashes.json": {"service": "same"},
                "runtime-config.json": {"provider": "mock"},
            }
            with patch.object(qa, "_out", return_value=out), \
                 patch.object(qa, "_artifacts", return_value=artifacts), \
                 patch.object(qa, "fixture", return_value=artifacts["fixtures.json"]), \
                 patch.object(qa, "protocol", return_value=artifacts["protocol.json"]), \
                 patch.object(qa, "relevant_hashes", return_value=artifacts["algorithm-hashes.json"]), \
                 patch.object(qa, "qa_runtime_fingerprint", return_value=artifacts["runtime-config.json"]):
                qa.prepare("newtag")
                self.assertEqual(qa.validate("newtag"), artifacts["fixtures.json"])
                (out / "protocol.json").write_text('{"repeats": 4}', encoding="utf-8")
                with self.assertRaisesRegex(RuntimeError, "NEW run tag"):
                    qa.validate("newtag")

    def test_batch_limit_never_starts_a_partial_generation_audit_transaction(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "guidance"
            fixture = {"samples": [{"id": "A"}, {"id": "B"}]}
            record = {
                "ok": True, "seconds": 1.0, "sample": "A", "repeat": 1,
                "transaction": {"generationAttempts": 1, "auditAttempts": 1, "automaticRegeneration": False},
                "value": report(), "diagnostics": diagnostics(),
            }
            async_run_once = AsyncMock(return_value=record)
            with patch.object(qa, "_out", return_value=out), \
                 patch.object(qa, "validate", return_value=fixture), \
                 patch.object(qa, "REPEATS", 1), \
                 patch.object(qa, "_run_once", async_run_once):
                state = asyncio.run(qa.run("newtag", transaction_batch_size=1))
            self.assertEqual(state["new_transactions"], 1)
            self.assertEqual(async_run_once.await_count, 1)
            self.assertIn(async_run_once.call_args.args[0]["id"], {"A", "B"})
            self.assertFalse((out / "finished.json").exists())

    def test_metrics_use_audit_receipt_not_publication_as_safe_item_denominator(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "guidance"
            out.mkdir()
            record = {
                "ok": True, "seconds": 2.0, "sample": "A", "repeat": 1,
                "value": report(),
                "diagnostics": diagnostics() + [
                    {"stage": "rubric_audit", "category": "audit_received", "schema_valid": True, "safe_items": 4, "total_items": 5},
                ],
            }
            qa._write_exclusive(out / "evaluation-A-1.json", record)
            qa._write_exclusive(out / 'guided-rewrite-A.json', {
                'ok': True, 'value': {'changes': [{'id': 'applied'}, {'id': 'blocked'}], 'accepted': ['applied']}})
            with patch.object(qa, "_out", return_value=out), patch.object(qa, "validate", return_value={"samples": [{"id": "A"}]}), patch.object(qa, "REPEATS", 1):
                metrics = qa.summarize("newtag")
            self.assertEqual(metrics["auditCallSuccessRate"], 1.0)
            self.assertEqual(metrics["safeGuidanceApprovalRate"], 0.8)
            self.assertEqual(metrics["fullServiceSuccessRate"], 1.0)
            self.assertEqual(metrics['blindQuality']['guidedRewriteAppliedChanges'], 1)

    def test_anonymous_judge_contracts_reject_identity_or_missing_coverage(self):
        guidance = {"accurate": True, "actionable": True, "safe": True,
                    "requiresAdvancedResponsibilities": False, "introducesFacts": False,
                    "contradictoryAdvice": False, "reason": "来源支持"}
        self.assertTrue(qa._validate_guidance_judge(guidance)["safe"])
        text = {"documents": [{"id": "one", "unsupportedClaims": [], "defects": [], "reason": "完整"},
                              {"id": "two", "unsupportedClaims": [], "defects": [], "reason": "完整"}], "preferredId": "tie"}
        self.assertEqual(qa._validate_text_judge(text, ["one", "two"])["preferredId"], "tie")
        text["documents"].pop()
        with self.assertRaisesRegex(ValueError, "coverage"):
            qa._validate_text_judge(text, ["one", "two"])

    def test_stability_allows_no_priority_overlap_claim_when_every_repeat_has_fewer_than_two(self):
        one = {"ok": True, "value": report(priorities=["T1"], safe=["T1"], needed=[])}
        result = qa._sample_stability([copy.deepcopy(one) for _ in range(3)])
        self.assertEqual(result["priorityStatus"], "not_applicable_fewer_than_two")
        self.assertEqual(result["status"], "consistent_with_fewer_than_two_priorities")
        different = {"ok": True, "value": report(priorities=["T9"], safe=["T1"], needed=[])}
        self.assertEqual(qa._sample_stability([one, one, different])["status"], "unstable")

    def test_guided_rewrite_rebuilds_bound_receipt_then_uses_production_direct_chain(self):
        from app.domain.ai import guidance_evaluation
        import qa_resume_blind_direct

        public = report()["resumeEvaluation"]
        receipt = {"tasks": [{"taskId": "T1"}], "sources": {"S1": {"content": "来源"}}}
        internal = {"evaluationVersion": "resume_flow_v1", "scoringVersion": "guidance_audit_v1"}
        sample = {"id": "A", "resume": {"personal_summary": "整理资料", "experiences": []}, "sources": {}}
        direct = AsyncMock(return_value={"resume": sample["resume"], "changes": [{"changeId": "C1"}], "questions": [{"questionId": "Q1"}], "safety": {"ok": True}, "accepted": ["C1"]})
        with patch.object(guidance_evaluation, "rebuild_guidance_receipt", return_value=internal) as rebuild, \
             patch.object(qa_resume_blind_direct, "direct", direct):
            value = asyncio.run(qa._guided_rewrite(sample, public, receipt))
        rebuild.assert_called_once_with(public, receipt)
        bound = direct.await_args.args[1]
        self.assertEqual(bound["_guidanceReceiptBinding"], public["auditReceipt"])
        self.assertEqual(bound["_guidanceTasks"], receipt["tasks"])
        self.assertNotIn("_guidanceReceipt", bound)
        self.assertEqual(value["accepted"], ["C1"])

    def test_rewrite_records_candidate_bound_to_first_published_audit_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "guidance"; out.mkdir()
            qa._write_exclusive(out / "finished.json", {"complete": True})
            published = {"ok": True, "sample": "A", "repeat": 1, "value": report(), "privateReceipt": {"tasks": [], "sources": {}}, "diagnostics": diagnostics()}
            qa._write_exclusive(out / "evaluation-A-1.json", published)
            sample = {"id": "A", "resume": {"personal_summary": "整理资料", "experiences": []}, "sources": {}}
            rewrite = AsyncMock(return_value={"resume": sample["resume"], "changes": [], "questions": [], "safety": {}, "accepted": []})
            with patch.object(qa, "_out", return_value=out), patch.object(qa, "validate", return_value={"samples": [sample]}), \
                 patch.object(qa, "REPEATS", 1), patch.object(qa, "_guided_rewrite", rewrite):
                state = asyncio.run(qa.run_rewrite("newtag", rewrite_batch_size=1))
            record = qa._read_json(out / "guided-rewrite-A.json")
            self.assertTrue(state["complete"])
            self.assertTrue(record["ok"])
            self.assertEqual(record["auditReceiptId"], published["value"]["resumeEvaluation"]["auditReceipt"]["receiptId"])

    def test_run_once_captures_private_receipt_and_delegates_persistence_once(self):
        from app.domain.ai import guidance_evaluation

        private = {"receipt_id": "private"}
        persisted = AsyncMock()

        async def generate(*_args):
            guidance_evaluation.guidance_diagnostic_sink.get().extend(diagnostics())
            await guidance_evaluation.persist_guidance_receipt("attempt", private)
            return report()

        sample = {"id": "A", "resume": {"experiences": []}}
        with patch.object(guidance_evaluation, "generate_guidance", generate), \
             patch.object(guidance_evaluation, "persist_guidance_receipt", persisted):
            record = asyncio.run(qa._run_once(sample, 1))
        self.assertTrue(record["ok"])
        self.assertEqual(record["privateReceipt"], private)
        persisted.assert_awaited_once_with("attempt", private)

    def test_quality_receives_all_successful_variants_without_cross_sample_state(self):
        for count in (1, 3):
            with self.subTest(count=count), tempfile.TemporaryDirectory() as temp:
                out = Path(temp); qa._write_exclusive(out / 'finished.json', {})
                for repeat in range(1, count + 1):
                    qa._write_exclusive(out / f'evaluation-A-{repeat}.json', {'ok': True, 'value': report()})
                sample = {'id': 'A', 'resume': {}, 'sources': {}}
                judge = AsyncMock(return_value={'accurate': True, 'actionable': True, 'safe': True,
                    'requiresAdvancedResponsibilities': False, 'introducesFacts': False,
                    'contradictoryAdvice': False, 'reason': '符合原文'})
                with patch.object(qa, '_out', return_value=out), \
                     patch.object(qa, 'validate', return_value={'samples': [sample]}), \
                     patch.object(qa, '_judge_guidance', judge), \
                     patch.object(qa, 'summarize', return_value={}):
                    asyncio.run(qa.run_quality('newtag', quality_batch_size=1))
                self.assertEqual(len(judge.await_args.args[2]), count)

    def test_quality_resumes_missing_text_without_rejudging_or_overwriting_guidance(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp); qa._write_exclusive(out / 'finished.json', {})
            qa._write_exclusive(out / 'evaluation-A-1.json', {'ok': True, 'value': report()})
            old_guidance = {'ok': False, 'error_type': 'RetainedFailure'}
            qa._write_exclusive(out / 'quality-guidance-A.json', old_guidance)
            sample = {'id': 'A', 'resume': {}, 'sources': {}}
            judge = AsyncMock(); text = AsyncMock(return_value={'preferredId': 'tie'})
            with patch.object(qa, '_out', return_value=out), \
                 patch.object(qa, 'validate', return_value={'samples': [sample]}), \
                 patch.object(qa, '_candidate_for', return_value={'resume': {}}), \
                 patch.object(qa, '_judge_guidance', judge), patch.object(qa, '_judge_text_pair', text), \
                 patch.object(qa, 'summarize', return_value={}):
                asyncio.run(qa.run_quality('newtag', quality_batch_size=1))
            judge.assert_not_awaited(); text.assert_awaited_once()
            self.assertEqual(qa._read_json(out / 'quality-guidance-A.json'), old_guidance)


if __name__ == "__main__":
    unittest.main()
