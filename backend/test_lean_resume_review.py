import asyncio
from copy import deepcopy
import json
import unittest
from unittest.mock import AsyncMock, patch
from jsonschema import validate

from test_resume_review_v4 import snapshot, raw_v4
from app.domain.ai import lean_review as rubric, evidence_rubric_v2 as history, resume_score, runtime_budget


def raw_lean(data=None):
    raw = raw_v4(data or snapshot())
    for key in ('reviewCoverage', 'reviewChecks', 'expressionPlan', 'metricReview'):
        raw.pop(key, None)
    for dim in raw['dimensions']:
        for c in dim['criteria']:
            for key in ('anchorId', 'unmetConditions', 'gapExplanation'):
                c.pop(key)
    for row in [*raw['suggestions'], *raw['strengths'], *[c for d in raw['dimensions'] for c in d['criteria']]]:
        row.setdefault('jdSourceRefs', [])
    for s in raw['suggestions']:
        for key in ('evidenceSpanIds', 'skillAction', 'dimensionId', 'needsFacts', 'strategyType', 'action'):
            s.pop(key, None)
        for gap in s['factGaps']:
            gap.pop('question', None)
    return raw


def normalize(raw=None, data=None):
    data = data or snapshot()
    return rubric.normalize(raw or raw_lean(data), sources=rubric.source_catalog(data['resume']),
        modules=rubric.modules_for(data['resume']), context=rubric.assessment_context(data, ''),
        metadata=dict(promptVersion=rubric.PROMPT_VERSION, rubricVersion=rubric.SCORING_VERSION,
            guideVersion=rubric.GUIDE_VERSION, responseSchemaVersion=rubric.RESPONSE_SCHEMA_VERSION,
            inputHash=rubric.binding(data, ''), model='test-double', provider='fixture', transport='mock',
            reasoning={'geminiThinkingLevel': 'medium'}))


class LeanReviewTests(unittest.IsolatedAsyncioTestCase):
    def test_shape_preserves_grades_actions_without_fabricated_check_receipts(self):
        data = snapshot(); raw = raw_lean(data)
        validate(raw, rubric.response_schema(rubric.source_catalog(data['resume']), [], rubric.modules_for(data['resume'])))
        report = normalize(raw, data)
        self.assertEqual(report['overallScore'], 75)
        self.assertEqual(report['reviewCoverage'], [])
        self.assertNotIn('reviewChecks', report)
        self.assertNotIn('metricReview', report)
        self.assertEqual(history.normalize(report), report)
        self.assertEqual(report['suggestions'][0]['factGaps'][0]['kind'], 'task_scope')
        self.assertTrue(report['suggestions'][0]['editable'])

    def test_payload_keeps_all_visible_facts_but_no_repeated_directories(self):
        data = snapshot(); sources = rubric.source_catalog(data['resume'])
        args = (data, '', sources, rubric.modules_for(data['resume']), rubric.assessment_context(data, ''))
        payload = rubric.model_payload(*args)
        old = history.model_payload(*args)
        self.assertEqual(payload['readingView'], old['readingView'])
        self.assertEqual(payload['modules'], old['modules'])
        self.assertNotIn('reviewInventory', payload)
        self.assertNotIn('evidenceSpans', payload)
        self.assertLess(len(rubric.prompt()), len(history.prompt()) / 3)

    def test_invalid_grades_references_and_unconfirmed_facts_still_rejected(self):
        for mutate in (
            lambda r: r['dimensions'][0]['criteria'][0].update(level=5),
            lambda r: r['suggestions'][0].update(sourceRefs=['unknown']),
            lambda r: r['suggestions'][0].update(targetId='target_6', sourceRefs=[rubric.source_catalog(snapshot()['resume'])[0]['sourceId']]),
            lambda r: r['suggestions'][0].update(handling='organize'),
            lambda r: r['suggestions'][0].update(targetId='invented'),
            lambda r: r['suggestions'][0]['factGaps'][0].update(sourceRefs=['unknown']),
        ):
            raw = raw_lean(); mutate(raw)
            with self.assertRaises((ValueError, KeyError)): normalize(raw)

    async def test_deadline_cancels_exactly_one_provider_call(self):
        cancelled = asyncio.Event()
        async def stalled(*args, **kwargs):
            try: await asyncio.Event().wait()
            finally: cancelled.set()
        call = AsyncMock(side_effect=stalled)
        with patch('app.domain.ai.object_review.TIMEOUT_SECONDS', .02), patch.object(resume_score, '_call_llm', call):
            with self.assertRaises(runtime_budget.AiRuntimeTimeoutError):
                await resume_score.generate_review_score('', json.dumps(snapshot()), model='gemini-3.5-flash-lite', thinking_level='medium')
        self.assertTrue(cancelled.is_set()); call.assert_awaited_once()

    async def test_transport_timeout_is_not_relabelled_json_failure(self):
        call = AsyncMock(side_effect=runtime_budget.AiRuntimeTimeoutError('timeout'))
        with patch.object(resume_score, '_call_llm', call):
            with self.assertRaises(runtime_budget.AiRuntimeTimeoutError):
                await resume_score.generate_review_score('', json.dumps(snapshot()), model='gemini-3.5-flash-lite', thinking_level='medium')
        call.assert_awaited_once()

    async def test_live_entry_uses_lean_shape_and_one_medium_call(self):
        from test_object_review import raw_object
        call = AsyncMock(return_value={'content': json.dumps(raw_object())})
        with patch.object(resume_score, '_call_llm', call), patch.object(
            runtime_budget, 'run_with_total_timeout', wraps=runtime_budget.run_with_total_timeout
        ) as deadline:
            out = await resume_score.generate_review_score('', json.dumps(snapshot()), model='gemini-3.5-flash-lite', thinking_level='medium')
        self.assertEqual(deadline.call_args.kwargs['budget'].stream_total_timeout_seconds, 115)
        call.assert_awaited_once()
        self.assertEqual(call.call_args.kwargs['gemini_thinking_level'], 'medium')
        self.assertEqual(out['resumeEvaluation']['metadata']['responseSchemaVersion'], 'review_json_schema_v6')
        self.assertNotIn('reviewInventory', json.loads(call.call_args.args[0][1]['content']))

    async def test_explicit_gpt_medium_uses_native_effort_and_never_silently_changes_model(self):
        from app.domain.ai import llm_transport
        from app.domain.ai.public_errors import ResumeEvaluationIntegrityError
        route = llm_transport.AIRoute('openai', None, 'https://provider.invalid/v1', 'gpt-5.6-luna', 'chat_completion')
        from test_object_review import raw_object
        call = AsyncMock(return_value={'content': json.dumps(raw_object())})
        with patch.object(llm_transport, '_resolve_ai_route', return_value=route), patch.object(resume_score, '_call_llm', call):
            result = await resume_score.generate_review_score('', json.dumps(snapshot()), model='gpt-5.6-luna', thinking_level='medium')
        self.assertEqual(result['resumeEvaluation']['metadata']['model'], 'gpt-5.6-luna')
        self.assertEqual(result['resumeEvaluation']['metadata']['reasoning'], {'reasoning_effort': 'medium'})
        call.assert_awaited_once()
        call.reset_mock()
        with patch.object(llm_transport, '_resolve_ai_route', return_value=route), patch.object(resume_score, '_call_llm', call):
            with self.assertRaises(ResumeEvaluationIntegrityError):
                await resume_score.generate_review_score('', json.dumps(snapshot()), model='gemini-3.5-flash-lite', thinking_level='medium')
        call.assert_not_called()
        with patch.object(llm_transport, '_resolve_ai_route', return_value=route), patch.object(resume_score, '_call_llm', call):
            result = await resume_score.generate_review_score('', json.dumps(snapshot()), model='gpt-5.6-luna', thinking_level='high')
        call.assert_awaited_once()
        self.assertEqual(call.call_args.kwargs['openai_reasoning_effort'], 'high')
        self.assertEqual(result['resumeEvaluation']['metadata']['reasoning'], {'reasoning_effort': 'high'})


if __name__ == '__main__': unittest.main()
