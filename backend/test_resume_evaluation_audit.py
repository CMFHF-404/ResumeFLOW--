import asyncio
import copy
import unittest
from unittest.mock import AsyncMock, patch

from app.domain.ai import resume_evaluation_service as service
from app.domain.ai.resume_evaluation_audit import audit_reports, reviewed_evaluation, audit_binding, AUDIT_VERSION
from app.domain.ai.public_errors import ResumeEvaluationAuditError
from app.domain.ai.resume_evaluation import DIMENSION_SUBSCORES
from test_resume_evaluation_consensus import report
from test_resume_evaluation import make_evaluation


def verdicts(count=2, verdict='符合'):
    return {'reports': [{'id': f'REPORT_{i+1:03d}', 'dimensions': [
        {'dimension': name, 'verdict': verdict, 'subscores': [], 'evidenceIds': [], 'reason': '符合给定量表和原文。'}
        for name, _ in DIMENSION_SUBSCORES]} for i in range(count)]}


class AuditTests(unittest.IsolatedAsyncioTestCase):
    async def test_audit_text_contract_matches_transport_schema(self):
        import json
        reports = [{'resumeEvaluation': make_evaluation()}]
        with patch('app.domain.ai.resume_evaluation_audit._call_llm', AsyncMock(return_value=verdicts(1))) as model:
            await audit_reports(reports, {'resume': 'synthetic'})
        prompt = model.call_args.args[0][0]['content']
        marker = 'OUTPUT_JSON_SCHEMA:\n'
        self.assertIn(marker, prompt)
        self.assertEqual(json.loads(prompt.split(marker, 1)[1]), model.call_args.kwargs['gemini_response_json_schema'])

    async def test_receipts_bind_report_input_rubric_and_never_rewrite_score(self):
        reports = [{'resumeEvaluation': make_evaluation()}]
        original = copy.deepcopy(reports)
        with patch('app.domain.ai.resume_evaluation_audit._call_llm', AsyncMock(return_value=verdicts(1))):
            receipts = await audit_reports(reports, {'resume': 'synthetic'})
        self.assertEqual(reports, original)
        self.assertTrue(receipts[0]['approved'])
        self.assertEqual(receipts[0]['input_hash'], audit_binding(reports[0], {'resume': 'synthetic'}))
        changed = copy.deepcopy(reports[0]); changed['resumeEvaluation']['targetRole'] = 'changed'
        self.assertNotEqual(receipts[0]['input_hash'], audit_binding(changed, {'resume': 'synthetic'}))

    async def test_missing_duplicate_and_unknown_review_items_are_rejected(self):
        reports = [{'resumeEvaluation': make_evaluation()}]
        invalid = [verdicts(0), verdicts(2)]
        duplicated = verdicts(1); duplicated['reports'][0]['dimensions'][1] = duplicated['reports'][0]['dimensions'][0]
        invalid.append(duplicated)
        unknown = verdicts(1); unknown['reports'][0]['dimensions'][0]['evidenceIds'] = ['UNKNOWN']
        invalid.append(unknown)
        for raw in invalid:
            with patch('app.domain.ai.resume_evaluation_audit._call_llm', AsyncMock(return_value=raw)):
                with self.assertRaises(ResumeEvaluationAuditError):
                    await audit_reports(reports, {})

    async def test_normal_flow_has_two_generations_and_one_audit(self):
        values = [report([70]*6, 'one'), report([71]*6, 'two')]
        async def approve(reports, data):
            return [{'approved': True, 'input_hash': audit_binding(r, data)} for r in reports]
        with (patch.object(service, '_analyze_resume_evaluation_once', AsyncMock(side_effect=values)) as generate,
             patch('app.domain.ai.resume_evaluation_audit.audit_reports', AsyncMock(side_effect=approve)) as audit):
            result = await reviewed_evaluation('JD', '{}')
        self.assertEqual(generate.await_count, 2); self.assertEqual(audit.await_count, 1)
        self.assertTrue(all(call.kwargs['_evidence_basis'] for call in generate.await_args_list))
        self.assertIn(result, values)

    async def test_disagreement_uses_one_new_report_and_one_audit_within_five(self):
        values = [report([70]*6, 'one'), report([90]*6, 'outlier'), report([71]*6, 'three')]
        async def approve(reports, data):
            return [{'approved': True, 'input_hash': audit_binding(r, data)} for r in reports]
        with (patch.object(service, '_analyze_resume_evaluation_once', AsyncMock(side_effect=values)) as generate,
             patch('app.domain.ai.resume_evaluation_audit.audit_reports', AsyncMock(side_effect=approve)) as audit):
            result = await reviewed_evaluation('JD', '{}')
        self.assertEqual(generate.await_count + audit.await_count, 5)
        self.assertNotEqual(result, values[1])

    async def test_two_rejected_reports_fail_early_and_never_publish(self):
        values = [report([70]*6, 'one'), report([71]*6, 'two')]
        with (patch.object(service, '_analyze_resume_evaluation_once', AsyncMock(side_effect=values)) as generate,
             patch('app.domain.ai.resume_evaluation_audit.audit_reports', AsyncMock(return_value=[{'approved':False}, {'approved':False}])) as audit):
            with self.assertRaises(ResumeEvaluationAuditError):
                await reviewed_evaluation('JD', '{}')
        self.assertEqual(generate.await_count + audit.await_count, 3)

    async def test_dispersion_records_only_audited_score_vectors_and_binding_hashes(self):
        import json
        from app.domain.ai.resume_evaluation_consensus import diagnostic_sink
        values = [report([70]*6, 'private-text-one'), report([85]*6, 'private-text-two'),
                  report([100]*6, 'private-text-three')]
        async def approve(reports, data):
            return [{'approved': True, 'input_hash': audit_binding(r, data)} for r in reports]
        records=[];token=diagnostic_sink.set(records)
        try:
            with (patch.object(service, '_analyze_resume_evaluation_once', AsyncMock(side_effect=values)),
                  patch('app.domain.ai.resume_evaluation_audit.audit_reports', AsyncMock(side_effect=approve))):
                with self.assertRaises(ResumeEvaluationAuditError):
                    await reviewed_evaluation('JD', '{}')
        finally:
            diagnostic_sink.reset(token)
        profile=next(r for r in records if r['category']=='audited_score_profile')
        self.assertEqual(profile['vectors'],[[70]*6,[85]*6,[100]*6])
        self.assertEqual(profile['total_range'],30)
        self.assertEqual(profile['dimension_ranges'],[30]*6)
        self.assertEqual(len(profile['report_hashes']),3)
        self.assertNotIn('private-text',json.dumps(records))

    async def test_rejected_report_scores_do_not_enter_approved_profile(self):
        from app.domain.ai.resume_evaluation_consensus import diagnostic_sink
        values=[report([70]*6,'one'),report([99]*6,'rejected'),report([71]*6,'extra')]
        async def approve_some(reports,data):
            return [{'approved':r['resumeEvaluation']['dimensions'][0]['score']!=99,
                     'input_hash':audit_binding(r,data)} for r in reports]
        records=[];token=diagnostic_sink.set(records)
        try:
            with (patch.object(service,'_analyze_resume_evaluation_once',AsyncMock(side_effect=values)),
                  patch('app.domain.ai.resume_evaluation_audit.audit_reports',AsyncMock(side_effect=approve_some))):
                await reviewed_evaluation('JD','{}')
        finally:
            diagnostic_sink.reset(token)
        profile=next(r for r in records if r['category']=='audited_score_profile')
        self.assertEqual(profile['vectors'],[[70]*6,[71]*6])
        self.assertEqual(profile['dimension_ranges'],[1]*6)

    async def test_cancel_propagates_without_retry(self):
        with patch.object(service, '_analyze_resume_evaluation_once', AsyncMock(side_effect=asyncio.CancelledError())) as generate:
            with self.assertRaises(asyncio.CancelledError):
                await reviewed_evaluation('JD', '{}')
        self.assertEqual(generate.await_count, 1)

    async def test_invalid_scoring_contract_consumes_one_attempt_then_recovers(self):
        from app.domain.ai.public_errors import ResumeEvaluationIntegrityError
        values = [report([70]*6, 'one'), report([71]*6, 'two')]
        async def approve(reports, data):
            return [{'approved': True, 'input_hash': audit_binding(r, data)} for r in reports]
        with (patch.object(service, '_analyze_resume_evaluation_once', AsyncMock(side_effect=[ResumeEvaluationIntegrityError('invalid evidence binding'), *values])) as generate,
              patch('app.domain.ai.resume_evaluation_audit.audit_reports', AsyncMock(side_effect=approve)) as audit):
            result = await reviewed_evaluation('JD', '{}')
        self.assertIn(result, values)
        self.assertEqual(generate.await_count + audit.await_count, 4)

    async def test_reserves_audit_slot_and_stops_impossible_recovery(self):
        from app.domain.ai.public_errors import AiProviderPayloadError
        with (patch.object(service, '_analyze_resume_evaluation_once', AsyncMock(side_effect=AiProviderPayloadError('bad structure'))) as generate,
              patch('app.domain.ai.resume_evaluation_audit.audit_reports', AsyncMock()) as audit):
            with self.assertRaises(ResumeEvaluationAuditError):
                await reviewed_evaluation('JD', '{}')
        self.assertEqual(generate.await_count, 3)
        audit.assert_not_awaited()

    async def test_transport_retry_counts_toward_shared_budget(self):
        import httpx
        values = [report([70]*6, 'one'), report([71]*6, 'two')]
        async def approve(reports, data):
            return [{'approved': True, 'input_hash': audit_binding(r, data)} for r in reports]
        calls = 0
        async def transport_then_approve(reports, data):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise httpx.ConnectError('private endpoint')
            return await approve(reports, data)
        with (patch.object(service, '_analyze_resume_evaluation_once', AsyncMock(side_effect=values)) as generate,
              patch('app.domain.ai.resume_evaluation_audit.audit_reports', AsyncMock(side_effect=transport_then_approve)) as audit):
            await reviewed_evaluation('JD', '{}')
        self.assertEqual(generate.await_count + audit.await_count, 4)

    async def test_malformed_audit_consumes_slot_without_publishing_or_rescoring(self):
        from app.domain.ai.public_errors import AiProviderPayloadError
        values = [report([70]*6, 'one'), report([71]*6, 'two')]
        count = 0
        async def audit_once_invalid(reports, data):
            nonlocal count
            count += 1
            if count == 1:
                raise AiProviderPayloadError('invalid response structure')
            return [{'approved': True, 'input_hash': audit_binding(r, data)} for r in reports]
        with (patch.object(service, '_analyze_resume_evaluation_once', AsyncMock(side_effect=values)) as generate,
              patch('app.domain.ai.resume_evaluation_audit.audit_reports', AsyncMock(side_effect=audit_once_invalid)) as audit):
            result = await reviewed_evaluation('JD', '{}')
        self.assertIn(result, values)
        self.assertEqual(generate.await_count, 2)
        self.assertEqual(audit.await_count, 2)

    async def test_malformed_audits_stop_at_shared_five_attempt_limit(self):
        from app.domain.ai.public_errors import AiProviderPayloadError
        values = [report([70]*6, 'one'), report([71]*6, 'two')]
        with (patch.object(service, '_analyze_resume_evaluation_once', AsyncMock(side_effect=values)) as generate,
              patch('app.domain.ai.resume_evaluation_audit.audit_reports', AsyncMock(side_effect=AiProviderPayloadError('bad structure'))) as audit):
            with self.assertRaises(ResumeEvaluationAuditError):
                await reviewed_evaluation('JD', '{}')
        self.assertEqual(generate.await_count, 2)
        self.assertEqual(audit.await_count, 3)

    def test_audit_error_is_public_and_receipts_are_not_public_usage_metadata(self):
        from app.domain.ai.public_errors import translate_ai_public_exception
        from app.domain.billing.billing_service import _to_usage_read
        from types import SimpleNamespace
        from datetime import datetime, timezone
        error = translate_ai_public_exception(ResumeEvaluationAuditError('internal reason'))
        self.assertEqual(error.detail['error']['code'], 'resume_evaluation_rubric_unconfirmed')
        self.assertTrue(error.detail['error']['retryable'])
        event = SimpleNamespace(id='event', entrypoint='test', request_label='test', provider='test', model='test', status='success',
            prompt_tokens=1, completion_tokens=1, total_tokens=2, created_at=datetime.now(timezone.utc),
            metadata_json={'route': 'keep', 'evaluation_audit_id': 'private', 'evaluation_audit_receipts': [{'private': True}]})
        self.assertEqual(_to_usage_read(event).metadata, {'route': 'keep'})

    async def test_budgeted_transport_has_no_hidden_retry(self):
        import httpx
        from app.domain.ai import llm_transport, runtime_budget
        from app.domain.ai.public_errors import AiProviderUnavailableError
        cause = httpx.HTTPStatusError('transient', request=httpx.Request('POST', 'https://example.invalid'), response=httpx.Response(503))
        error = AiProviderUnavailableError('transient'); error.__cause__ = cause
        token = runtime_budget.provider_retries_managed.set(True)
        try:
            with patch.object(llm_transport, '_stream_gemini_json_response_once', AsyncMock(side_effect=error)) as model:
                with self.assertRaises(AiProviderUnavailableError):
                    await llm_transport._stream_gemini_json_response_legacy(system_prompt='test', user_parts=[{'text':'test'}], error_message='test', request_label='test')
            self.assertEqual(model.await_count, 1)
            self.assertFalse(model.call_args.kwargs['defer_retryable_http_failure'])
        finally:
            runtime_budget.provider_retries_managed.reset(token)
