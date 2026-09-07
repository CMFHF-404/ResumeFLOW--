import asyncio
import copy
import itertools
import json
import unittest
from unittest.mock import AsyncMock, patch
import httpx
from fastapi import HTTPException

from app.domain.ai import guidance_evaluation as guidance
from app.domain.ai.public_errors import ResumeEvaluationAuditError, ResumeEvaluationIntegrityError, AiProviderUnavailableError
from app.domain.ai.resume_evaluation import DIMENSION_SUBSCORES


def contract():
    tasks = []
    for index, (dimension, specs) in enumerate(DIMENSION_SUBSCORES):
        for offset, (criterion, maximum) in enumerate(specs):
            tasks.append(dict(taskId=f'T_{index}_{offset}', dimension=dimension,
                criterion=criterion, fieldPath='experiences[0].star.a',
                allowedSources=['SRC_001'], allowedAssessments=['met', 'generic'],
                assessmentBands={'met': 'strong', 'generic': 'needs_attention'},
                assessmentPoints={'met': 1, 'generic': .25}, maxScore=maximum, optional=False,
                assessmentDescriptions={'met': f'{criterion}有原文支持。', 'generic': f'{criterion}存在需要澄清的内容。'},
                allowedGuidance=[{'type': 'none', 'prompt': ''},
                    {'type': 'needs_information', 'prompt': '补充实际采取的动作及处理对象。'}]))
    return {'tasks': tasks, 'sources': {'SRC_001': {'factId': 'F1', 'content': '负责相关工作',
        'source': 'resume.experiences[0].star.a', 'verificationStatus': 'user_claimed'}},
        'deterministic': {}, 'generationSchema': {'type': 'object'}}


def judgments(c):
    return {t['taskId']: {'assessment': 'generic', 'sourceRefs': ['SRC_001'],
        'reason': '原文仅有泛化职责。', 'guidance': {'type': 'needs_information',
        'prompt': '补充实际采取的动作及处理对象。'}} for t in c['tasks']}


def verdicts(c):
    return {t['taskId']: dict(sourceSupported=True, assessmentSupported=True,
        guidanceActionable=True, guidanceSafe=True, verdict='approved', reason='与原文及量表一致。')
        for t in c['tasks']}


class GuidanceAssemblyTests(unittest.TestCase):
    def test_strong_star_cleanup_survives_without_receiving_other_experience_deductions(self):
        from test_guidance_tasks import realistic_input, valid_model_judgments, task
        c = guidance.build_task_contract(realistic_input())
        raw = valid_model_judgments(c)
        weak_id, strong_id = 'EXP_001_STAR_ACTION', 'EXP_002_STAR_ACTION'
        raw[weak_id]['assessment'] = 'generic_role_only'
        raw[weak_id]['guidance'] = next(g for g in task(c, weak_id)['allowedGuidance'] if g['type'] == 'needs_information')
        before_rows = guidance.validate_judgments(raw, c)
        _, before = guidance.assemble_guidance(c, before_rows, audit=verdicts(c))
        raw[strong_id]['guidance'] = next(g for g in task(c, strong_id)['allowedGuidance'] if g['type'] == 'safe_cleanup')
        rows = guidance.validate_judgments(raw, c)
        public, internal = guidance.assemble_guidance(c, rows, audit=verdicts(c))
        self.assertTrue(any(row['taskId'] == strong_id for row in public['safeCleanup']))
        cleanup = next(i for i in internal['issues'] if i['taskId'] == strong_id)
        self.assertEqual(cleanup['pointsNotEarned'], 0)
        self.assertEqual(cleanup['guidanceType'], 'safe_cleanup')
        self.assertEqual([d['score'] for d in internal['dimensions']], [d['score'] for d in before['dimensions']])
        self.assertEqual(next(i for i in internal['issues'] if i['taskId'] == weak_id)['pointsNotEarned'],
                         next(i for i in before['issues'] if i['taskId'] == weak_id)['pointsNotEarned'])

    def test_overall_band_depends_only_on_six_dimension_bands(self):
        low = contract(); high = copy.deepcopy(low)
        low_rows = judgments(low); high_rows = judgments(high)
        dimensions = [name for name, _specs in DIMENSION_SUBSCORES]
        for task in low['tasks']:
            task['assessmentPoints']['generic'] = .85 if task['dimension'] in dimensions[:5] else .65
        for task in high['tasks']:
            task['assessmentPoints']['generic'] = 1 if task['dimension'] in dimensions[:5] else .84
        low_public, low_private = guidance.assemble_guidance(low, low_rows)
        high_public, high_private = guidance.assemble_guidance(high, high_rows)
        low_vector = [row['status'] for row in low_public['dimensionGuidance']]
        high_vector = [row['status'] for row in high_public['dimensionGuidance']]
        self.assertEqual(low_vector, high_vector)
        self.assertNotEqual(low_private['overallScore'], high_private['overallScore'])
        self.assertEqual(low_public['overallBand'], high_public['overallBand'])
        self.assertEqual(low_private['overallLevel'], low_public['overallBand'])
        self.assertEqual(high_private['overallLevel'], high_public['overallBand'])

    def test_qualitative_aggregator_is_permutation_invariant_and_monotone(self):
        levels = list(guidance.BANDS)
        for vector in itertools.product(levels, repeat=6):
            expected = guidance.aggregate_overall_band(vector)
            self.assertEqual(expected, guidance.aggregate_overall_band(reversed(vector)))
            self.assertEqual(expected, guidance.aggregate_overall_band(vector[2:] + vector[:2]))
            for index, current in enumerate(vector):
                current_rank = levels.index(current)
                for improved in levels[current_rank + 1:]:
                    changed = list(vector); changed[index] = improved
                    self.assertGreaterEqual(
                        levels.index(guidance.aggregate_overall_band(changed)),
                        levels.index(expected),
                    )

    def test_qualitative_aggregator_requires_exactly_six_known_bands(self):
        for invalid in ([], ['strong'] * 5, ['strong'] * 7,
                        ['strong'] * 5 + ['unknown'], 'strong'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                guidance.aggregate_overall_band(invalid)
        rubric = guidance.guidance_rubric()
        self.assertEqual(rubric['overall_band_policy'], guidance.OVERALL_BAND_POLICY)

    def test_model_reason_cannot_publish_new_tools_or_responsibilities(self):
        c = contract(); rows = judgments(c)
        forbidden = '应补充模型搭建经验并展示领导职责'
        for row in rows.values():
            row['reason'] = forbidden
        public, internal = guidance.assemble_guidance(c, rows)
        self.assertNotIn(forbidden, json.dumps(public, ensure_ascii=False))
        self.assertNotIn(forbidden, json.dumps(internal, ensure_ascii=False))
        self.assertTrue(all(row['reason'] == forbidden for row in rows.values()))

    def test_declared_role_changes_tied_priority_without_changing_assessments(self):
        c = contract(); rows = judgments(c)
        chosen = []
        for task in c['tasks']:
            row = rows[task['taskId']]
            row['assessment'] = 'met'; row['guidance'] = {'type': 'none', 'prompt': ''}
            if task['dimension'] in {'STAR应用', '内容可读'} and task['dimension'] not in chosen:
                chosen.append(task['dimension']); row['assessment'] = 'generic'
                row['guidance'] = {'type': 'needs_information', 'prompt': '补充该项的真实信息：' + task['criterion']}
        original = copy.deepcopy(rows)
        product, _ = guidance.assemble_guidance(c, rows, target_role='产品经理')
        design, _ = guidance.assemble_guidance(c, rows, target_role='设计师')
        self.assertEqual(product['topPriorities'][0]['dimension'], 'STAR应用')
        self.assertEqual(design['topPriorities'][0]['dimension'], '内容可读')
        self.assertEqual(rows, original)
        self.assertEqual(guidance.role_relevance('未知岗位', 'STAR应用'), 1.)
    def test_optional_missing_evidence_does_not_outrank_concrete_core_issue(self):
        c = contract(); rows = judgments(c)
        optional = c['tasks'][0]; optional['optional'] = True
        optional['assessmentBands']['generic'] = 'insufficient_evidence'
        rows[optional['taskId']]['guidance']['prompt'] = '如有真实补充信息，可按实际情况提供。'
        public, _ = guidance.assemble_guidance(c, rows)
        self.assertNotEqual(public['topPriorities'][0]['taskId'], optional['taskId'])

    def test_server_punctuation_and_risk_caps_keep_internal_deduction_bindings(self):
        from test_guidance_tasks import realistic_input, valid_model_judgments
        c = guidance.build_task_contract(realistic_input())
        rows = guidance.validate_judgments(valid_model_judgments(c), c)
        risk = next(t for t in c['tasks'] if t['criterion'] == 'risk:exaggerated_claim')
        rows[risk['taskId']] = {'assessment': 'present', 'sourceRefs': risk['allowedSources'][:1],
            'reason': '个人总结存在无来源的夸大陈述。', 'guidance': {'type': 'safe_cleanup', 'prompt': '删除无来源的夸大陈述。'}}
        public, internal = guidance.assemble_guidance(c, rows)
        self.assertEqual(public['overallBand'], 'needs_attention')
        self.assertEqual(internal['overallLevel'], 'needs_attention')
        for d in internal['dimensions']:
            self.assertEqual(sum(i['pointsNotEarned'] for i in internal['issues']
                                 if i['primaryDimension'] == d['dimension']), 100 - d['score'], d['dimension'])

    def test_public_report_has_no_quality_numbers_or_internal_ids_generated_by_model(self):
        c = contract()
        public, private = guidance.assemble_guidance(c, judgments(c))
        self.assertEqual(public['evaluationVersion'], 'guidance_audit_v1')
        self.assertNotIn('overallScore', public)
        self.assertNotIn('dimensions', public)
        self.assertEqual(len(public['dimensionGuidance']), 6)
        self.assertTrue(public['informationNeeded'])
        self.assertTrue(private['issues'])
        self.assertTrue(all(i['issueId'].startswith('ISSUE_') for i in private['issues']))

    def test_optional_unactionable_guidance_is_omitted_without_removing_core_judgment(self):
        c = contract(); j = judgments(c); reviews = verdicts(c)
        c['tasks'][0]['optional'] = True
        identity = c['tasks'][0]['taskId']
        reviews[identity]['guidanceActionable'] = False
        approved = guidance.validate_audit(reviews, c)
        public, private = guidance.assemble_guidance(c, j, audit=approved)
        self.assertFalse(any(x['taskId'] == identity for x in public['informationNeeded']))
        self.assertTrue(any(x['taskId'] == identity for x in private['issues']))
        self.assertTrue(public['dimensionGuidance'][0]['issues'])

    def test_required_action_cannot_be_removed_to_rescue_a_report(self):
        c = contract(); raw = verdicts(c)
        raw[c['tasks'][0]['taskId']]['guidanceActionable'] = False
        with self.assertRaises(ResumeEvaluationAuditError): guidance.validate_audit(raw, c)

    def test_usage_api_never_exposes_private_guidance_basis(self):
        from app.domain.billing.billing_service import _to_usage_read
        from app.models import AITokenUsageEvent
        event = AITokenUsageEvent(user_id='test', metadata_json={'route': 'keep',
            'guidance_audit_attempt_id': 'private', 'guidance_receipt_id': 'private',
            'guidance_audit_receipts': [{'internal_report': {'overallScore': 91}, 'input': 'private'}]})
        self.assertEqual(_to_usage_read(event).metadata, {'route': 'keep'})

    def test_missing_unknown_uncertain_unsafe_or_unsupported_core_audit_fails_closed(self):
        c = contract(); identity = c['tasks'][0]['taskId']
        invalid = []
        missing = verdicts(c); missing.pop(identity); invalid.append(missing)
        extra = verdicts(c); extra['UNKNOWN'] = extra[identity]; invalid.append(extra)
        for key, value in [('sourceSupported', False), ('assessmentSupported', False),
                           ('guidanceSafe', False), ('verdict', 'uncertain')]:
            raw = verdicts(c); raw[identity][key] = value; invalid.append(raw)
        for raw in invalid:
            with self.subTest(raw=raw):
                with self.assertRaises(ResumeEvaluationAuditError): guidance.validate_audit(raw, c)


class GuidanceCallTests(unittest.IsolatedAsyncioTestCase):
    async def test_plain_text_is_rejected_before_model_calls_or_receipt_writes(self):
        from app.domain.ai.public_errors import resolve_ai_public_response
        from app.domain.ai.ai_router import _stream_error_event
        raw = 'Alex Chen | alex@example.invalid. Developer, 2022-2025. Built a billing system. Skills: SQL.'
        inputs = [
            raw,
            json.dumps({'raw_text': raw}),
            json.dumps({'evaluation_scope': 'full_resume', 'resume': {'raw_text': raw}}),
            json.dumps(raw),
        ]
        for resume_text in inputs:
            with (
                self.subTest(resume_text=resume_text),
                patch.object(guidance, '_call_llm', AsyncMock()) as model,
                patch.object(guidance, 'persist_guidance_receipt', AsyncMock()) as persist,
            ):
                with self.assertRaises(HTTPException) as caught:
                    await resolve_ai_public_response(guidance.generate_guidance('', resume_text))
                self.assertEqual(caught.exception.status_code, 422)
                error = caught.exception.detail['error']
                self.assertEqual(error['code'], 'resume_evaluation_structured_input_required')
                self.assertFalse(error['retryable'])
                self.assertIn('解析', error['message'])
                self.assertNotIn(raw, error['message'])
                stream_error = _stream_error_event(caught.exception)
                self.assertIn('resume_evaluation_structured_input_required', json.dumps(stream_error))
                model.assert_not_awaited()
                persist.assert_not_awaited()

    async def test_unscoped_live_advice_fails_before_audit_and_persistence(self):
        from test_guidance_tasks import realistic_input, valid_model_judgments
        data = realistic_input(); c = guidance.build_task_contract(data)
        rows = valid_model_judgments(c)
        rows['EXP_002_PROFESSIONAL_ACTION_VERBS'].update(
            assessment='minor:vague_action', reason='原文行动词需要澄清。',
            guidance={'type': 'needs_information',
                      'prompt': '将做周报替换为搭建模型、编写脚本等具体动词。'})
        llm = AsyncMock(side_effect=[rows, verdicts(c)])
        with (patch('app.domain.ai.resume_evaluation_service._build_full_resume_evaluation_input', return_value=data),
              patch.object(guidance, '_call_llm', llm),
              patch.object(guidance, 'persist_guidance_receipt', AsyncMock()) as persist):
            with self.assertRaises(ResumeEvaluationIntegrityError):
                await guidance.generate_guidance('', '{}')
        self.assertEqual(llm.await_count, 1)
        persist.assert_not_awaited()

    async def test_public_entrypoint_uses_guidance_without_entering_legacy_consensus(self):
        from app.domain.ai import resume_evaluation_service as service
        expected = {'resumeEvaluation': {'evaluationVersion': guidance.GUIDANCE_VERSION}}
        with (patch.object(guidance, 'generate_guidance', AsyncMock(return_value=expected)) as current,
              patch.object(service, '_analyze_resume_evaluation_once', AsyncMock(side_effect=AssertionError('legacy generation')))):
            self.assertEqual(await service.analyze_resume_evaluation('', '{}'), expected)
        current.assert_awaited_once_with('', '{}', None)

    async def test_real_task_contract_receipt_replays_and_rejects_internal_tampering(self):
        import json
        from test_guidance_tasks import realistic_input, valid_model_judgments
        data = realistic_input(); c = guidance.build_task_contract(data)
        with (patch.object(guidance, '_call_llm', AsyncMock(side_effect=[valid_model_judgments(c), verdicts(c)])),
              patch.object(guidance, 'persist_guidance_receipt', AsyncMock()) as persist,
              patch.object(guidance, '_diagnostic', wraps=guidance._diagnostic) as diagnostic):
            result = await guidance.generate_guidance('', json.dumps(data, ensure_ascii=False))
        public = result['resumeEvaluation']; receipt = persist.call_args.args[1]
        self.assertEqual(guidance.rebuild_guidance_receipt(public, receipt), receipt['internal_report'])
        advised = [tid for tid, row in receipt['judgments'].items() if row['guidance']['type'] != 'none']
        self.assertLess(len(advised), len(receipt['tasks']))
        received = [call for call in diagnostic.call_args_list
                    if call.args == ('rubric_audit', 'audit_received')]
        self.assertEqual(len(received), 1)
        self.assertEqual(received[0].kwargs['total_items'], len(advised))
        self.assertEqual(received[0].kwargs['safe_items'], len(advised))
        altered = copy.deepcopy(receipt); altered['internal_report']['overallScore'] += 1
        with self.assertRaises(ValueError): guidance.rebuild_guidance_receipt(public, altered)
        for key, value in (
            ('allowedGuidance', [{'type': 'needs_information', 'prompt': '补充未授权的新职责。'}]),
            ('assessmentDescriptions', {'met': '伪造的公开描述。'}),
        ):
            with self.subTest(task_policy=key):
                altered = copy.deepcopy(receipt); changed_public = copy.deepcopy(public)
                altered['tasks'][0][key] = value
                altered['tasks_hash'] = guidance.canonical_json_hash(altered['tasks'])
                changed_public['auditReceipt']['tasksHash'] = altered['tasks_hash']
                with self.assertRaises(ValueError):
                    guidance.rebuild_guidance_receipt(changed_public, altered)

    async def run_mock(self, responses):
        c = contract()
        with (patch.object(guidance, 'build_task_contract', return_value=c),
              patch.object(guidance, 'validate_judgments', side_effect=lambda raw, _: raw),
              patch.object(guidance, '_call_llm', AsyncMock(side_effect=responses)) as model,
              patch.object(guidance, 'persist_guidance_receipt', AsyncMock()) as persist):
            result = await guidance.generate_guidance('', json.dumps({
                'evaluation_scope': 'full_resume', 'resume': {'experiences': [{'star': {'a': '负责相关工作'}}]},
                'fact_metadata': [{'fact_id': 'F1', 'content': '负责相关工作',
                    'source': 'resume.experiences[0].star.a', 'verification_status': 'user_claimed'}]}))
        return result, model, persist

    async def test_exactly_generation_then_audit_and_private_receipt(self):
        c = contract()
        result, model, persist = await self.run_mock([judgments(c), verdicts(c)])
        self.assertEqual(model.await_count, 2)
        self.assertEqual([x.kwargs['request_label'] for x in model.await_args_list],
                         ['resume_guidance_generation', 'resume_guidance_audit'])
        self.assertIn('assessmentDescriptions', guidance.GENERATION_PROMPT)
        self.assertNotIn('assessmentDefinitions', guidance.GENERATION_PROMPT)
        generation_input = json.loads(model.await_args_list[0].args[0][1]['content'])
        self.assertTrue(generation_input['tasks'])
        self.assertTrue(all('assessmentDescriptions' in task for task in generation_input['tasks']))
        self.assertEqual(persist.await_count, 1)
        receipt = persist.call_args.args[1]
        self.assertIn('internal_report', receipt)
        self.assertEqual(result['resumeEvaluation']['auditReceipt']['receiptId'], receipt['receipt_id'])
        from app.domain.ai.guidance_receipts import validate_public_receipt_binding
        validate_public_receipt_binding(result['resumeEvaluation'], receipt)

    async def test_rejected_audit_has_no_third_call_or_publication(self):
        c = contract(); raw = verdicts(c); raw[c['tasks'][0]['taskId']]['assessmentSupported'] = False
        with (patch.object(guidance, 'build_task_contract', return_value=c),
              patch.object(guidance, 'validate_judgments', side_effect=lambda raw, _: raw),
              patch.object(guidance, '_call_llm', AsyncMock(side_effect=[judgments(c), raw])) as model,
              patch.object(guidance, 'persist_guidance_receipt', AsyncMock()) as persist):
            with self.assertRaises(ResumeEvaluationAuditError): await guidance.generate_guidance('', '{}')
        self.assertEqual(model.await_count, 2); persist.assert_not_awaited()

    async def test_generation_invalid_stops_before_audit(self):
        with (patch.object(guidance, 'build_task_contract', return_value=contract()),
              patch.object(guidance, 'validate_judgments', side_effect=ValueError('invalid')),
              patch.object(guidance, '_call_llm', AsyncMock(return_value={})) as model):
            with self.assertRaises(ResumeEvaluationIntegrityError): await guidance.generate_guidance('', '{}')
        self.assertEqual(model.await_count, 1)

    async def test_cancellation_propagates_without_retry(self):
        with (patch.object(guidance, 'build_task_contract', return_value=contract()),
              patch.object(guidance, '_call_llm', AsyncMock(side_effect=asyncio.CancelledError)) as model):
            with self.assertRaises(asyncio.CancelledError): await guidance.generate_guidance('', '{}')
        self.assertEqual(model.await_count, 1)

    async def test_auth_configuration_and_connection_errors_propagate_without_retry(self):
        for error in (HTTPException(status_code=401), HTTPException(status_code=400),
                      AiProviderUnavailableError('configuration unavailable'), httpx.ConnectError('offline')):
            with self.subTest(error=type(error).__name__):
                with (patch.object(guidance, 'build_task_contract', return_value=contract()),
                      patch.object(guidance, '_call_llm', AsyncMock(side_effect=error)) as model):
                    with self.assertRaises(type(error)) as caught:
                        await guidance.generate_guidance('', '{}')
                self.assertIs(caught.exception, error)
                self.assertEqual(model.await_count, 1)

    async def test_public_normalizer_rejects_scores_unknown_versions_and_missing_receipt(self):
        c = contract()
        result, _, _ = await self.run_mock([judgments(c), verdicts(c)])
        for key, value in [('overallScore', 100), ('evaluationVersion', 'guidance_audit_v2'), ('auditReceipt', {})]:
            raw = copy.deepcopy(result['resumeEvaluation']); raw[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): guidance.normalize_guidance_report(raw)
