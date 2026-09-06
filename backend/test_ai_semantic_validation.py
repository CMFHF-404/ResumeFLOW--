import copy
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from app.domain.ai.resume_evaluation import _normalize_issues, normalize_resume_evaluation
from app.domain.resume_optimization.schemas import OptimizationPlan
from app.domain.resume_optimization.safety import verify_plan_changes
from test_resume_evaluation import make_evaluation, TEST_FACT_METADATA
from test_resume_optimization_safety import _change, _documents


class EvaluationSemanticBoundaryTests(unittest.TestCase):
    def test_distinct_projects_and_evidence_survive_issue_normalization(self):
        issues = [dict(issueId=f'I{i}', description=description,
                       primaryDimension='成果量化', relatedDimensions=[],
                       severity='medium', evidenceIds=[f'E{i}'], pointsNotEarned=10)
                  for i, description in enumerate([
                      '支付项目缺少结果指标', '推荐项目缺少结果指标'])]
        normalized, aliases = _normalize_issues(issues, {'E0', 'E1'}, {})
        self.assertEqual([item['evidenceIds'] for item in normalized], [['E0'], ['E1']])
        self.assertEqual(aliases, {})
        issues[1]['description'] = issues[0]['description']
        self.assertEqual(len(_normalize_issues(issues, {'E0', 'E1'}, {})[0]), 2)

    def test_quantification_score_is_not_rejected_by_language_keywords(self):
        for text in ['Increased revenue by 30%', 'Reduced latency by 30%', '营收增长30%']:
            with self.subTest(text=text):
                facts = [dict(TEST_FACT_METADATA[0], content=text)]
                result = normalize_resume_evaluation(
                    make_evaluation(totals=[70, 70, 70, 70, 70, 85], source_text=text),
                    jd_available=True, fact_metadata=facts)
                self.assertEqual(result['dimensions'][-1]['score'], 85)


class SemanticReviewTests(unittest.IsolatedAsyncioTestCase):
    async def test_answer_review_contract_failures_preserve_retryable_draft(self):
        import test_resume_optimization_orchestrator as fixtures
        from app.domain.resume_optimization import orchestrator
        from app.domain.resume_optimization.router import _stream_error_event
        from app.domain.ai.public_errors import AiProviderPayloadError

        row = {'id': 'CHANGE_1', 'verdict': 'supported', 'reason': '来源支持'}
        for response in [{'reviews': []}, {'reviews': [row, row]},
                         {'reviews': [dict(row, extra=True)]},
                         {'reviews': [dict(row, reason=' ')]},
                         AiProviderPayloadError('invalid JSON')]:
            with self.subTest(response=response):
                context = fixtures._context()
                plan = OptimizationPlan(
                    changes=[fixtures._ask_change('CHG_1', issue_id='I1', module_id='exp-a')],
                    questions=[fixtures._question('Q1', module_id='exp-a', affects=['CHG_1'])],
                )
                store = fixtures._RunStore(fixtures._run(
                    status=fixtures.ResumeOptimizationStatus.AWAITING_ANSWERS,
                    context=context, plan=plan,
                ))
                original_plan = copy.deepcopy(store.run.plan_json)
                answer = fixtures.OptimizationAnswer(
                    question_id='Q1', state=fixtures.OptimizationAnswerState.ANSWERED,
                    value='本人负责两个页面',
                )
                with (
                    fixtures.ResumeOptimizationOrchestratorTests()._patch_store(store),
                    patch.object(orchestrator, 'build_frozen_optimization_context', AsyncMock(return_value=context)),
                    patch.object(orchestrator, 'rewrite_answered_modules', AsyncMock(return_value=[
                        fixtures._change(general='参与支付页面的改版', targeted='参与支付页面的改版'),
                    ])),
                    patch('app.domain.resume_optimization.semantic_review._call_llm',
                          AsyncMock(side_effect=response) if isinstance(response, Exception)
                          else AsyncMock(return_value=response)),
                ):
                    with self.assertRaises(ValueError) as raised:
                        await orchestrator.answer_optimization_questions(
                            session=fixtures._FakeSession(), user_id=fixtures.USER_ID,
                            run_id=str(fixtures.RUN_ID),
                            payload=fixtures.ResumeOptimizationAnswersRequest(answers=[answer]),
                        )
                self.assertEqual(store.run.status, 'awaiting_answers')
                self.assertEqual(store.run.plan_json, original_plan)
                self.assertEqual(store.run.answers_json['answers'][0]['question_id'], 'Q1')
                self.assertEqual(store.run.error_json['code'], 'resume_optimization_plan_invalid')
                self.assertTrue(store.run.error_json['retryable'])
                event = _stream_error_event(raised.exception, request_id='review-contract')
                self.assertTrue(event['retryable'])
                self.assertEqual(event['statusCode'], 502)

    async def test_generation_and_review_share_deadline_and_persist_timeout(self):
        import test_resume_optimization_orchestrator as fixtures
        from app.domain.ai import runtime_budget
        from app.domain.resume_optimization import orchestrator

        for operation in ['plan', 'answer']:
            with self.subTest(operation=operation):
                context = fixtures._context()
                pending = OptimizationPlan(
                    changes=[fixtures._ask_change('CHG_1', issue_id='I1', module_id='exp-a')],
                    questions=[fixtures._question('Q1', module_id='exp-a', affects=['CHG_1'])],
                )
                store = fixtures._RunStore(fixtures._run(
                    context=context, plan=pending,
                    status=(fixtures.ResumeOptimizationStatus.PLANNING if operation == 'plan'
                            else fixtures.ResumeOptimizationStatus.AWAITING_ANSWERS),
                ))
                deadlines = []

                @runtime_budget.ai_wall_clock_limited
                async def generate(*args, **kwargs):
                    deadlines.append(runtime_budget._ai_runtime_deadline.get())
                    generated = fixtures._change(general='参与支付页面的改版', targeted='参与支付页面的改版')
                    return OptimizationPlan(changes=[generated]) if operation == 'plan' else [generated]

                async def review_model(*args, **kwargs):
                    deadlines.append(runtime_budget._ai_runtime_deadline.get())
                    self.assertEqual(deadlines[0], deadlines[1])
                    await asyncio.Future()  # The shared budget must cancel this model call.

                answer = fixtures.OptimizationAnswer(
                    question_id='Q1', state=fixtures.OptimizationAnswerState.ANSWERED,
                    value='本人负责两个页面',
                )
                inherited_deadline = runtime_budget._ai_runtime_deadline.get()
                with (
                    fixtures.ResumeOptimizationOrchestratorTests()._patch_store(store),
                    patch.object(orchestrator, 'build_frozen_optimization_context', AsyncMock(return_value=context)),
                    patch.object(orchestrator, 'plan_resume_optimization' if operation == 'plan'
                                 else 'rewrite_answered_modules', generate),
                    patch('app.domain.resume_optimization.semantic_review._call_llm', review_model),
                    patch.object(runtime_budget, 'get_ai_runtime_budget', return_value=
                                 runtime_budget.AiRuntimeBudget(stream_total_timeout_seconds=0.1)),
                ):
                    with self.assertRaises(runtime_budget.AiRuntimeTimeoutError):
                        if operation == 'plan':
                            await orchestrator.create_optimization_plan(
                                session=fixtures._FakeSession(), user_id=fixtures.USER_ID,
                                payload=fixtures._start_request(), idempotency_key='shared-review-budget',
                            )
                        else:
                            await orchestrator.answer_optimization_questions(
                                session=fixtures._FakeSession(), user_id=fixtures.USER_ID,
                                run_id=str(fixtures.RUN_ID),
                                payload=fixtures.ResumeOptimizationAnswersRequest(answers=[answer]),
                            )
                self.assertEqual(len(deadlines), 2)
                self.assertEqual(runtime_budget._ai_runtime_deadline.get(), inherited_deadline)
                self.assertEqual(store.run.error_json['code'], 'ai_runtime_timeout')
                self.assertTrue(store.run.error_json['retryable'])
                self.assertEqual(store.run.status, 'failed' if operation == 'plan' else 'awaiting_answers')
                if operation == 'answer':
                    self.assertEqual(store.run.answers_json['answers'][0]['question_id'], 'Q1')

    async def test_orchestrator_persists_real_review_receipt_before_preview(self):
        from test_resume_optimization_orchestrator import (
            ResumeOptimizationOrchestratorTests, _context, _run, _RunStore,
            _FakeSession, _start_request, _change as planning_change, USER_ID,
        )
        from app.domain.resume_optimization import orchestrator
        context = _context()
        store = _RunStore(_run(context=context))
        harness = ResumeOptimizationOrchestratorTests()
        generated = OptimizationPlan(changes=[planning_change(
            general='参与支付页面的改版', targeted='参与支付页面的改版',
        )])
        with (
            harness._patch_store(store),
            patch.object(orchestrator, 'build_frozen_optimization_context', AsyncMock(return_value=context)),
            patch.object(orchestrator, 'plan_resume_optimization', AsyncMock(return_value=generated)),
            patch('app.domain.resume_optimization.semantic_review._call_llm', AsyncMock(return_value={
                'reviews': [{'id': 'CHANGE_1', 'verdict': 'supported', 'reason': '来源明确支持'}],
            })) as review_model,
        ):
            result = await orchestrator.create_optimization_plan(
                session=_FakeSession(), user_id=USER_ID, payload=_start_request(),
                idempotency_key='semantic-review-test',
            )
        review_model.assert_awaited_once()
        persisted = result.result_json['changes'][0]
        self.assertEqual(persisted['safety_status'], 'allowed')
        self.assertEqual(persisted['semantic_review']['verdict'], 'supported')
        self.assertEqual(len(persisted['semantic_review']['input_hash']), 64)

    async def test_receipt_binds_pre_await_evidence_and_both_candidates(self):
        from app.domain.resume_optimization.semantic_review import review_plan_semantics
        documents = _documents()
        plan = OptimizationPlan(changes=[_change(
            general_value='参与支付页面的改版', targeted_value='参与支付页面的改版',
            source_refs=['/selectedSourceExperiences/exp-a/star/a'])])
        original_documents = copy.deepcopy(documents)

        async def mutate_while_waiting(*args, **kwargs):
            documents['selectedSourceExperiences']['exp-a']['star']['a'] = '负责支付团队'
            return {'reviews': [{'id': 'CHANGE_1', 'verdict': 'supported', 'reason': '来源支持'}]}

        with patch('app.domain.resume_optimization.semantic_review._call_llm', side_effect=mutate_while_waiting):
            reviewed = await review_plan_semantics(plan=plan, source_documents=documents)
        self.assertEqual(verify_plan_changes(plan=reviewed, source_documents=documents)[0][0].safety_status, 'pending')
        self.assertEqual(verify_plan_changes(plan=reviewed, source_documents=original_documents)[0][0].safety_status, 'allowed')
        reviewed.changes[0].general_value = '负责支付团队'
        self.assertEqual(verify_plan_changes(plan=reviewed, source_documents=original_documents)[0][0].safety_status, 'pending')

    async def test_provider_failure_cancellation_and_bad_shapes_leave_no_receipt(self):
        from app.domain.resume_optimization.semantic_review import review_plan_semantics
        plan = OptimizationPlan(changes=[_change(general_value='参与支付页面的改版',
                                                 targeted_value='参与支付页面的改版')])
        for error in [RuntimeError('provider unavailable'), asyncio.CancelledError()]:
            with patch('app.domain.resume_optimization.semantic_review._call_llm', side_effect=error):
                with self.assertRaises(type(error)):
                    await review_plan_semantics(plan=plan, source_documents=_documents())
            self.assertIsNone(plan.changes[0].semantic_review)
        row = {'id': 'CHANGE_1', 'verdict': 'supported', 'reason': '来源支持'}
        for response in [{'reviews': [row, row]}, {'reviews': [dict(row, extra=True)]},
                         {'reviews': [row], 'extra': True}, {'reviews': [dict(row, reason=' ')]}]:
            with patch('app.domain.resume_optimization.semantic_review._call_llm', return_value=response):
                with self.assertRaises(ValueError):
                    await review_plan_semantics(plan=plan, source_documents=_documents())

    async def test_independent_verdicts_and_visible_only_minimal_sources(self):
        from app.domain.resume_optimization.semantic_review import review_plan_semantics
        documents = _documents(current_a='负责产品交付',
                               selected_a='负责产品交付<!--使用 Docker-->')
        documents['currentResume']['profile'] = {'phone': '13800138000'}
        first = _change(before_value='负责产品交付', general_value='使用Docker交付',
                        targeted_value='使用Docker交付',
                        source_refs=['/selectedSourceExperiences/exp-a/star/a'])
        second = _change(change_id='CHG_B', module_id='exp-b', before_value='完成数据平台开发',
                         general_value='完成数据平台的开发', targeted_value='完成数据平台的开发',
                         source_refs=['/currentResume/experiences/exp-b/star/a'])
        model = AsyncMock(return_value={'reviews': [
            {'id': 'CHANGE_2', 'verdict': 'supported', 'reason': '来源支持'},
            {'id': 'CHANGE_1', 'verdict': 'unsupported', 'reason': '可见来源未提到工具'}]})
        with patch('app.domain.resume_optimization.semantic_review._call_llm', model):
            reviewed = await review_plan_semantics(plan=OptimizationPlan(changes=[first, second]),
                                                    source_documents=documents)
        changes, _ = verify_plan_changes(plan=reviewed, source_documents=documents)
        self.assertEqual([c.safety_status for c in changes], ['blocked', 'allowed'])
        payload = json.loads(model.call_args.args[0][1]['content'])
        self.assertNotIn('Docker', json.dumps(payload['changes'][0]['sources']))
        self.assertNotIn('13800138000', json.dumps(payload))

    def test_apply_rejects_missing_or_changed_receipt_but_accepts_current_review(self):
        from test_resume_optimization_apply import _run, _change as apply_change, _base_config, _link, LINK_ID
        from app.domain.resume_optimization import apply_service
        run = _run([apply_change('CHG_A')])
        args = dict(run=run, accepted_change_ids={'CHG_A'}, current_resume_config=_base_config(),
                    current_link_overrides={str(LINK_ID): _link().overrides_json})
        apply_service.build_apply_patch(**args)
        original = copy.deepcopy(run.result_json)
        for mutate in [lambda c: c.update(semantic_review=None),
                       lambda c: c.update(targeted_value='由我负责全部工作'),
                       lambda c: c['semantic_review'].update(policy_version='obsolete')]:
            run.result_json = copy.deepcopy(original)
            mutate(run.result_json['changes'][0])
            with self.assertRaises(apply_service.OptimizationApplyValidationError):
                apply_service.build_apply_patch(**args)

    async def test_supported_paraphrases_are_decided_by_evidence_review(self):
        from app.domain.resume_optimization.semantic_review import review_plan_semantics
        for before, after in [
            ('负责跨部门沟通', '协调跨部门沟通'),
            ('熟悉SQL并使用SQL完成数据查询', '使用SQL完成数据查询'),
        ]:
            documents = _documents(current_a=before, selected_a=before)
            plan = OptimizationPlan(changes=[_change(before_value=before,
                general_value=after, targeted_value=after)])
            original = copy.deepcopy(documents)
            model = AsyncMock(return_value={'reviews': [
                {'id': 'CHANGE_1', 'verdict': 'supported', 'reason': '来源明确支持该改写'}]})
            with patch('app.domain.resume_optimization.semantic_review._call_llm', model):
                reviewed = await review_plan_semantics(plan=plan, source_documents=documents)
            changes, _ = verify_plan_changes(plan=reviewed, source_documents=documents)
            self.assertEqual(changes[0].safety_status, 'allowed')
            self.assertEqual(changes[0].targeted_value, after)
            self.assertEqual(documents, original)
            self.assertIsNone(plan.changes[0].semantic_review)
            model.assert_awaited_once()
            payload = json.loads(model.call_args.args[0][1]['content'])
            self.assertNotIn('exp-b', json.dumps(payload))

    async def test_missing_review_is_pending_and_changed_evidence_invalidates_receipt(self):
        from app.domain.resume_optimization.semantic_review import review_plan_semantics
        documents = _documents()
        plan = OptimizationPlan(changes=[_change(general_value='参与支付页面的改版',
                                                 targeted_value='参与支付页面的改版')])
        changes, _ = verify_plan_changes(plan=plan, source_documents=documents)
        self.assertEqual(changes[0].safety_status, 'pending')
        with patch('app.domain.resume_optimization.semantic_review._call_llm', AsyncMock(
            return_value={'reviews': [{'id': 'CHANGE_1', 'verdict': 'supported', 'reason': '有证据'}]})):
            reviewed = await review_plan_semantics(plan=plan, source_documents=documents)
        reviewed.changes[0].targeted_value = '负责支付页面改版'
        changes, _ = verify_plan_changes(plan=reviewed, source_documents=documents)
        self.assertEqual(changes[0].safety_status, 'pending')

    async def test_unsupported_uncertain_and_invalid_reviews_never_allow(self):
        from app.domain.resume_optimization.semantic_review import review_plan_semantics
        for verdict in ['unsupported', 'uncertain']:
            plan = OptimizationPlan(changes=[_change(general_value='统领支付团队',
                                                     targeted_value='统领支付团队')])
            with patch('app.domain.resume_optimization.semantic_review._call_llm', AsyncMock(
                return_value={'reviews': [{'id': 'CHANGE_1', 'verdict': verdict, 'reason': '缺少支持'}]})):
                reviewed = await review_plan_semantics(plan=plan, source_documents=_documents())
            changes, _ = verify_plan_changes(plan=reviewed, source_documents=_documents())
            self.assertEqual(changes[0].safety_status, 'blocked' if verdict == 'unsupported' else 'pending')
        for response in [{'reviews': []}, {'reviews': [{'id': 'other', 'verdict': 'supported', 'reason': 'ok'}]},
                         {'reviews': [{'id': 'CHANGE_1', 'verdict': 'yes', 'reason': 'ok'}]}]:
            with patch('app.domain.resume_optimization.semantic_review._call_llm', AsyncMock(return_value=response)):
                with self.assertRaises(ValueError):
                    await review_plan_semantics(plan=plan, source_documents=_documents())

    async def test_invalid_source_or_number_is_rejected_before_model_call(self):
        from app.domain.resume_optimization.semantic_review import review_plan_semantics
        for change in [_change(general_value='参与支付页面改版，提高30%', targeted_value='参与支付页面改版，提高30%'),
                       _change(source_refs=['/currentResume/experiences/exp-b/star/a'])]:
            with patch('app.domain.resume_optimization.semantic_review._call_llm', AsyncMock()) as model:
                await review_plan_semantics(plan=OptimizationPlan(changes=[change]), source_documents=_documents())
            model.assert_not_awaited()
