import asyncio
import json
import os
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.setdefault('DATABASE_URL', 'postgresql+asyncpg://user:password@localhost:5432/resumeflow')
os.environ.setdefault('LOGTO_ISSUER', 'https://example.logto.app/oidc')
os.environ.setdefault('LOGTO_APP_ID', 'resume-spa-app-id')

from app.domain.ai import resume_score as score
from app.domain.ai.public_errors import ResumeEvaluationIntegrityError
from app.domain.resume_optimization import simple_planner as planner
from app.domain.resume_optimization import apply_service
from app.domain.resume_optimization.context_service import FrozenOptimizationContext
from app.domain.resume_optimization.normalizers import OptimizationPlanNormalizationError
from app.domain.resume_optimization.schemas import OptimizationAnswer


def raw_score():
    return dict(summary='简历可改进', dimensions=[dict(dimension=name, score=80, comment='建议明确成果') for name in score.DIMENSIONS],
        suggestions=[dict(moduleType='personal_summary', moduleId='current_resume', fieldPath='personal_summary',
            dimension='专业表达', problem='描述较泛', direction='说明具体工作和成果')])


def context():
    resume = dict(personal_summary='原摘要', experiences={}, skills=[], section_order=['summary'])
    evaluation = score.normalize_score(raw_score(), catalog=score.module_catalog(resume))
    evaluation['selectedSuggestionIds'] = ['suggestion-1']
    return FrozenOptimizationContext(resume_id='r', resume_updated_at='2026-09-07T00:00:00Z', evaluation_signature='s',
        jd_signature='', target_role='', evaluation=evaluation, current_resume=resume, selected_source_experiences={},
        selected_master_experience_ids=[], selected_experience_links={}, bank_suggestion_candidates=[], fact_metadata=[])


class SinglePassScoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_score_calls_once_without_reviewer_or_repair(self):
        mock = AsyncMock(return_value={'content': json.dumps(raw_score(), ensure_ascii=False)})
        with patch.object(score, '_call_llm', mock):
            result = await score.generate_score('', json.dumps({'personal_summary': '原摘要'}))
        mock.assert_awaited_once()
        report = result['resumeEvaluation']
        self.assertEqual(report['evaluationVersion'], 'resume_score_v2')
        self.assertEqual(report['overallScore'], 80)
        self.assertEqual(report['suggestions'][0]['suggestionId'], 'suggestion-1')
        self.assertNotIn('auditReceipt', report)
        self.assertFalse(mock.call_args.kwargs['gemini_stream'])

    async def test_json_failure_does_not_retry(self):
        for text in ['broken', '{"summary":"x",}', '[]', '{}', '```json\n{}\n```']:
            with self.subTest(text=text), patch.object(score, '_call_llm', AsyncMock(return_value={'content': text})) as call:
                with self.assertRaises(ResumeEvaluationIntegrityError):
                    await score.generate_score('', '{"personal_summary":"原文"}')
                call.assert_awaited_once()

    async def test_complete_markdown_json_envelope_is_decoded_without_repair(self):
        for fence in ('```json', '```JSON', '```'):
            with self.subTest(fence=fence), patch.object(score, '_call_llm', AsyncMock(
                return_value={'content': fence + '\n' + json.dumps(raw_score()) + '\n```'}
            )) as call:
                report = await score.generate_score('', '{"personal_summary":"原文"}')
                self.assertEqual(report['resumeEvaluation']['overallScore'], 80)
                call.assert_awaited_once()

    async def test_envelope_does_not_repair_json_or_extract_from_prose(self):
        for value in ('```json\n{"summary":"x",}\n```', '说明\n```json\n{}\n```',
                      '```json\n{}\n```\n说明', '{"summary":"x"}}', '{} {}'):
            with self.subTest(value=value), patch.object(score, '_call_llm', AsyncMock(return_value={'content':value})) as call:
                with self.assertRaises(ResumeEvaluationIntegrityError):
                    await score.generate_score('', '{"personal_summary":"原文"}')
                call.assert_awaited_once()

    async def test_planner_uses_same_envelope_without_additional_call(self):
        call = AsyncMock(return_value={'content':'```json\n{"changes":[]}\n```'})
        with patch.object(planner, '_call_llm', call):
            self.assertEqual(await planner.call_json([], 'test'), {'changes':[]})
        call.assert_awaited_once()

    def test_minimal_structure_and_rounding(self):
        raw = raw_score(); raw['extra'] = 'ignored'; raw['dimensions'][0]['score'] = 83
        self.assertEqual(score.normalize_score(raw)['overallScore'], 81)
        for modify in [lambda r: r['dimensions'].pop(), lambda r: r['dimensions'].__setitem__(0, r['dimensions'][1]),
                       lambda r: r['dimensions'][0].update(score=True), lambda r: r['dimensions'][0].update(score=101),
                       lambda r: r.update(summary=17)]:
            bad = raw_score(); modify(bad)
            with self.assertRaises(ValueError): score.normalize_score(bad)
        raw = raw_score(); raw.pop('suggestions')
        self.assertEqual(score.normalize_score(raw)['suggestions'], [])

    def test_no_content_fact_or_regex_checks(self):
        raw = raw_score(); raw['suggestions'][0]['direction'] = '新增工具 XYZ、提高 300%，任意标点!?'
        self.assertEqual(score.normalize_score(raw)['suggestions'][0]['direction'], raw['suggestions'][0]['direction'])
        raw['suggestions'][0]['moduleId'] = 'unselected'
        with self.assertRaises(ValueError): score.normalize_score(raw, catalog=score.module_catalog({}))

    async def test_cancellation_propagates_without_retry(self):
        call = AsyncMock(side_effect=asyncio.CancelledError())
        with patch.object(score, '_call_llm', call), self.assertRaises(asyncio.CancelledError):
            await score.generate_score('', '{}')
        call.assert_awaited_once()


class SinglePassPlannerTests(unittest.IsolatedAsyncioTestCase):
    async def test_current_context_matches_nullable_dates_and_only_scored_resume(self):
        import test_resume_optimization_context as fixtures
        from app.domain.resume_optimization import context_service as cs
        from app.domain.resume_optimization import apply_service as apply
        parsed = json.loads(fixtures._analysis_text())
        parsed['resume']['experiences'][0].pop('end_date', None)
        analysis_text = json.dumps(parsed)
        snapshot = fixtures._frontend_snapshot_from_analysis_text(analysis_text)
        snapshot['resume']['experiences'][0]['end_date'] = None
        # Legacy bank material was not sent to single-pass scoring.
        snapshot['experience_atoms'][0]['star']['s'] = 'legacy bank representation'
        snapshot['fact_metadata'] = apply._rebuild_frontend_fact_metadata(snapshot)
        for changed_date in (False, True):
            with self.subTest(changed_date=changed_date):
                signed = deepcopy(snapshot)
                if changed_date:
                    signed['resume']['experiences'][0]['end_date'] = '2026-09-01'
                    signed['fact_metadata'] = apply._rebuild_frontend_fact_metadata(signed)
                resume = fixtures._resume()
                report = score.normalize_score(raw_score(), catalog=score.module_catalog({}))
                report['jdMatch'] = 88
                resume.config['jdAnalysis']['result']['resumeEvaluation'] = report
                signature = fixtures._frontend_evaluation_signature(signed, result=resume.config['jdAnalysis']['result'])
                resume.config['jdAnalysis']['evaluationSignature'] = signature
                fixture = fixtures._ContextFixture(self, resume=resume, analysis_text=analysis_text, use_guidance_receipt_stub=False)
                request = fixtures._request(evaluation_signature=signature, selected_suggestion_ids=['suggestion-1'])
                with patch.object(cs, 'build_legacy_frozen_optimization_context', cs.build_frozen_optimization_context), \
                     patch.object(planner, '_call_llm', side_effect=AssertionError('context must not call AI')):
                    if changed_date:
                        with self.assertRaises(cs.OptimizationContextStaleError):
                            await fixture.build(request=request)
                    else:
                        frozen, _, _ = await fixture.build(request=request)
                        self.assertEqual(frozen.evaluation['selectedSuggestionIds'], ['suggestion-1'])

    def test_null_date_equivalence_does_not_hide_other_changes(self):
        from app.domain.resume_optimization.context_service import _first_snapshot_mismatch as mismatch
        for path in ('resume.experiences[0]', 'experience_atoms[1]'):
            self.assertIsNone(mismatch({}, {'end_date':None}, path=path))
            self.assertIsNone(mismatch({'start_date':None}, {}, path=path))
            self.assertIsNotNone(mismatch({}, {'end_date':'2026-09-01'}, path=path))
            self.assertIsNotNone(mismatch({'title':'old'}, {'title':'new'}, path=path))
        self.assertIsNotNone(mismatch({}, {'end_date':None}, path='resume.profile'))

    async def test_current_context_accepts_selected_score_without_receipt(self):
        import test_resume_optimization_context as fixtures
        from app.domain.resume_optimization import context_service
        resume = fixtures._resume()
        report = score.normalize_score(raw_score(), catalog=score.module_catalog({}))
        report['jdMatch'] = 88
        resume.config['jdAnalysis']['result']['resumeEvaluation'] = report
        fixture = fixtures._ContextFixture(self, resume=resume, use_guidance_receipt_stub=False)
        request = fixtures._request(evaluation_signature=resume.config['jdAnalysis']['evaluationSignature'], selected_suggestion_ids=['suggestion-1'])
        with patch.object(context_service, 'build_legacy_frozen_optimization_context', context_service.build_frozen_optimization_context), \
             patch.object(context_service, 'load_guidance_receipt', side_effect=AssertionError('no receipt')):
            frozen, _, _ = await fixture.build(request=request)
        self.assertEqual(frozen.evaluation['selectedSuggestionIds'], ['suggestion-1'])
        self.assertEqual(frozen.evaluation['scoringVersion'], 'single_pass_v1')

    async def test_public_apply_and_read_current_run_without_model(self):
        from test_resume_optimization_apply import _run, _change, _resume, _link, _request, _transaction_session, USER_ID, RUN_ID
        from app.domain.resume_optimization.run_service import hash_canonical_json
        from app.domain.resume_optimization.router import _run_to_read
        run = _run([_change('target-1', module_type='personal_summary', field_path='personal_summary', before_value='原摘要')])
        run.policy_version = 'json_structure_v1'
        run.before_snapshot['evaluation'] = context().evaluation
        run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)
        for plan in (run.plan_json, run.result_json):
            plan['changes'][0]['safety_status'] = 'not_reviewed'
            plan['changes'][0]['source_refs'] = []
        resume = _resume()
        resume.config['jdAnalysis']['result']['resumeEvaluation'] = context().evaluation
        link = _link()
        session = _transaction_session(run, resume, link)
        with patch.object(planner, '_call_llm', side_effect=AssertionError('apply must not call AI')):
            result = await apply_service.apply_resume_optimization(session=session, user_id=USER_ID, run_id=str(RUN_ID), payload=_request('target-1'))
        self.assertEqual(result.run.status, 'applied')
        self.assertTrue(resume.config['jdAnalysis']['evaluationIsOutdated'])
        public = _run_to_read(result.run)
        self.assertEqual(public.status, 'applied')
        from test_resume_optimization_finalize import _finalize_session, _revert_request
        reverted = await apply_service.revert_resume_optimization(session=_finalize_session(run, resume, link),
            user_id=USER_ID, run_id=str(RUN_ID), payload=_revert_request(resume.updated_at))
        self.assertEqual(reverted.run.status, 'reverted')
        self.assertEqual(resume.config['personalSummary'], '原摘要')

    async def test_one_plan_then_one_answer_rewrite_without_audit(self):
        row = dict(targetId='target-1', actionKind='ask_user', generalValue='初步整理', targetedValue='初步整理', rationale='改进方向',
            questions=[dict(text='请说明工作成果', reason='补充信息')])
        call = AsyncMock(return_value={'content': json.dumps({'changes': [row]})})
        with patch.object(planner, '_call_llm', call):
            result = await planner.plan(context())
        call.assert_awaited_once()
        self.assertEqual(result.changes[0].safety_status, 'not_reviewed')
        self.assertIsNone(result.changes[0].semantic_review)
        self.assertEqual(result.changes[0].source_refs, [])
        answer = OptimizationAnswer(question_id='question-1', state='answered', value='效率提高 300%')
        call = AsyncMock(return_value={'content': json.dumps({'changes': [dict(changeId='target-1', generalValue='使用新工具，提高 300%', targetedValue='提高 300%', rationale='简化')]})})
        with patch.object(planner, '_call_llm', call):
            changes = await planner.rewrite(context(), result, [answer])
        call.assert_awaited_once()
        self.assertIn('300%', changes[0].targeted_value)
        with patch.object(planner, '_call_llm', AsyncMock()) as call:
            for state in ('no_data', 'unknown', 'skipped', 'not_my_work'):
                self.assertEqual(await planner.rewrite(context(), result, [answer.model_copy(update={'state': state})]), [])
            call.assert_not_awaited()

    async def test_empty_selection_makes_no_call(self):
        ctx = context(); ctx._snapshot['evaluation']['selectedSuggestionIds'] = []
        with patch.object(planner, '_call_llm', AsyncMock()) as call:
            with self.assertRaises(OptimizationPlanNormalizationError): await planner.plan(ctx)
            call.assert_not_awaited()

    async def test_terminal_answers_discard_fallback_and_cannot_be_applied(self):
        import test_resume_optimization_orchestrator as fixtures
        import test_resume_optimization_apply as apply_fixtures
        from app.domain.resume_optimization import orchestrator
        from app.domain.resume_optimization.run_service import hash_canonical_json
        from app.domain.resume_optimization.schemas import (
            OptimizationPlan, ResumeOptimizationAnswersRequest, ResumeOptimizationStatus,
        )

        ctx = context()
        row = dict(targetId='target-1', actionKind='ask_user', generalValue='备用摘要',
                   targetedValue='备用摘要', questions=[dict(text='请说明你的工作成果')])
        with patch.object(planner, '_call_llm', AsyncMock(return_value={'content': json.dumps({'changes': [row]})})):
            plan = await planner.plan(ctx)
        for state in ('no_data', 'unknown', 'skipped', 'not_my_work'):
            with self.subTest(state=state):
                run = fixtures._run(status=ResumeOptimizationStatus.AWAITING_ANSWERS, context=ctx, plan=plan)
                run.policy_version = 'json_structure_v1'
                store = fixtures._RunStore(run)
                with fixtures.ResumeOptimizationOrchestratorTests()._patch_store(store), \
                     patch.object(orchestrator, 'build_frozen_optimization_context', AsyncMock(return_value=ctx)), \
                     patch.object(planner, '_call_llm', AsyncMock(side_effect=AssertionError('terminal answers must not call AI'))) as call:
                    result = await orchestrator.answer_optimization_questions(
                        session=fixtures._FakeSession(), user_id=fixtures.USER_ID, run_id=str(fixtures.RUN_ID),
                        payload=ResumeOptimizationAnswersRequest(answers=[OptimizationAnswer(question_id='question-1', state=state)]))
                call.assert_not_awaited()
                persisted = OptimizationPlan.model_validate(result.result_json)
                change = persisted.changes[0]
                self.assertEqual(change.action_kind, 'leave_unchanged')
                self.assertEqual(change.before_value, '原摘要')
                self.assertIsNone(change.general_value)
                self.assertIsNone(change.targeted_value)
                self.assertFalse(change.default_selected)

                # A stale/malicious client cannot select the discarded candidate.
                apply_run = apply_fixtures._run([])
                apply_run.policy_version = 'json_structure_v1'
                apply_run.before_snapshot['evaluation'] = ctx.evaluation
                apply_run.source_snapshot_hash = hash_canonical_json(apply_run.before_snapshot)
                apply_run.plan_json = plan.storage_dump()
                apply_run.result_json = persisted.storage_dump()
                apply_run.answers_json = result.answers_json
                resume = apply_fixtures._resume()
                resume.config['jdAnalysis']['result']['resumeEvaluation'] = ctx.evaluation
                link = apply_fixtures._link()
                before_config, before_link = deepcopy(resume.config), deepcopy(link.model_dump())
                with self.assertRaises(apply_service.OptimizationApplyValidationError):
                    await apply_service.apply_resume_optimization(
                        session=apply_fixtures._transaction_session(apply_run, resume, link),
                        user_id=apply_fixtures.USER_ID, run_id=str(apply_fixtures.RUN_ID),
                        payload=apply_fixtures._request('target-1'))
                self.assertEqual(resume.config, before_config)
                self.assertEqual(link.model_dump(), before_link)

    async def test_unknown_or_duplicate_target_rejected_once(self):
        for rows in [[dict(targetId='other')], [dict(targetId='target-1', actionKind='leave_unchanged')]*2]:
            with patch.object(planner, '_call_llm', AsyncMock(return_value={'content': json.dumps({'changes': rows})})) as call:
                with self.assertRaises(OptimizationPlanNormalizationError): await planner.plan(context())
                call.assert_awaited_once()

    async def test_public_apply_rejects_historical_unapplied_run(self):
        run = SimpleNamespace(policy_version='evidence_semantic_v2')
        with patch.object(apply_service, '_lock_run', AsyncMock(return_value=run)), patch.object(apply_service, '_lock_resume', AsyncMock()) as apply:
            with self.assertRaises(apply_service.OptimizationApplyStaleError):
                await apply_service.apply_resume_optimization(session=None, user_id='owner', run_id='id', payload=SimpleNamespace(expected_resume_updated_at=__import__('datetime').datetime.now(__import__('datetime').timezone.utc)))
            apply.assert_not_awaited()

    async def test_apply_sanitizes_html_and_preserves_new_facts_without_review(self):
        from test_resume_optimization_apply import _run, _change, _base_config, LINK_ID
        from app.domain.resume_optimization.run_service import hash_canonical_json
        run = _run([_change('target-1', module_type='personal_summary', field_path='personal_summary', before_value='原摘要',
            general_value='<b>新增工具 XYZ，增长300%</b><script>alert(1)</script>', targeted_value='<b>新增工具 XYZ，增长300%</b><script>alert(1)</script>')])
        run.policy_version = 'json_structure_v1'
        run.before_snapshot['evaluation'] = context().evaluation
        run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)
        with patch.object(apply_service, 'verify_plan_changes', side_effect=AssertionError('no fact checks')):
            result = apply_service.build_apply_patch(run=run, accepted_change_ids={'target-1'}, current_resume_config=_base_config(),
                current_link_overrides={str(LINK_ID): {}})
        self.assertIn('300%', result.next_resume_config['personalSummary'])
        self.assertNotIn('<script', result.next_resume_config['personalSummary'])
        self.assertIn('<b>', result.next_resume_config['personalSummary'])


if __name__ == '__main__': unittest.main()
