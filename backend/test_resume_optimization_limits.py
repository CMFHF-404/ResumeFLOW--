"""Environment-to-runtime regressions; all model and persistence calls are mocked."""
import copy
import unittest
from unittest.mock import AsyncMock, patch

from app import config
from app.domain.resume_optimization import planner_service, orchestrator
from app.domain.resume_optimization.normalizers import OptimizationPlanNormalizationError
from app.domain.resume_optimization.planner_tasks import build_tasks
from app.domain.resume_optimization.schemas import OptimizationPlan
import test_resume_optimization_config as config_tests
import test_resume_optimization_orchestrator as orchestrator_tests
import test_resume_optimization_planner as planner_tests
from test_resume_optimization_coverage import context
from test_resume_optimization_tasks import unchanged


def settings(**values):
    return config_tests.ResumeOptimizationConfigTests()._load_with(**values)


class OptimizationRuntimeLimitsTests(unittest.IsolatedAsyncioTestCase):
    async def test_task_planner_honors_question_budget_in_schema_and_result(self):
        ctx = context()
        tasks, _ = build_tasks(ctx)
        for limit in (0, 1, 2, 5):
            with self.subTest(limit=limit):
                async def model(messages, **kwargs):
                    schema = kwargs['gemini_response_json_schema']['properties']
                    allowed = [key for key, item in schema.items()
                               if 'ask_user' in item['properties']['action']['enum']]
                    self.assertEqual(allowed, list(tasks)[:limit])
                    raw = unchanged(tasks)
                    for key in allowed:
                        raw[key].update(action='ask_user', question='还有哪些可确认的细节？')
                    return raw

                with (
                    patch.object(config, '_settings', settings(RESUME_OPTIMIZATION_MAX_QUESTIONS=str(limit))),
                    patch.object(planner_service, '_bounded_model_call', side_effect=model),
                ):
                    plan = await planner_service.plan_resume_optimization(ctx)
                self.assertLessEqual(len(plan.questions), limit)
                if limit == 0:
                    self.assertFalse(any(c.action_kind.value == 'ask_user' for c in plan.changes))
                    self.assertTrue(any(c.action_kind.value == 'rewrite_now' for c in plan.changes))

    async def test_task_planner_rejects_model_ignoring_question_budget(self):
        ctx = context()
        tasks, _ = build_tasks(ctx)
        for limit in (0, 1):
            raw = unchanged(tasks)
            raw[list(tasks)[limit]].update(action='ask_user', question='还有哪些细节？')
            with (
                self.subTest(limit=limit),
                patch.object(config, '_settings', settings(RESUME_OPTIMIZATION_MAX_QUESTIONS=str(limit))),
                patch.object(planner_service, '_bounded_model_call', AsyncMock(return_value=raw)),
                self.assertRaises(OptimizationPlanNormalizationError),
            ):
                await planner_service.plan_resume_optimization(ctx)

    async def test_flat_planner_uses_configured_schema_without_mutating_defaults(self):
        original = copy.deepcopy(planner_service._PLAN_RESPONSE_SCHEMA)
        for limit in (0, 1, 5):
            model = AsyncMock(return_value={'changes': [planner_tests._change()], 'questions': []})
            with (
                patch.object(config, '_settings', settings(RESUME_OPTIMIZATION_MAX_QUESTIONS=str(limit))),
                patch.object(planner_service, '_bounded_model_call', model),
            ):
                await planner_service._plan_resume_optimization_v3(planner_tests._context())
            self.assertEqual(model.call_args.kwargs['gemini_response_json_schema']
                             ['properties']['questions']['maxItems'], limit)
            self.assertIn(f'Maximum {limit} questions', model.call_args.args[0][0]['content'])
        self.assertEqual(planner_service._PLAN_RESPONSE_SCHEMA, original)

    async def test_flat_planner_rejects_questions_when_disabled(self):
        raw = {'changes': [planner_tests._change(actionKind='ask_user', generalValue=None,
                                                targetedValue=None, sourceRefs=[])],
               'questions': [planner_tests._question()]}
        with (
            patch.object(config, '_settings', settings(RESUME_OPTIMIZATION_MAX_QUESTIONS='0')),
            patch.object(planner_service, '_bounded_model_call', AsyncMock(return_value=raw)),
            self.assertRaises(OptimizationPlanNormalizationError),
        ):
            await planner_service._plan_resume_optimization_v3(planner_tests._context())

    async def test_configured_bank_limit_controls_ranked_persisted_suggestions(self):
        fixture = orchestrator_tests
        ctx = fixture._context(bank_candidates=[
            {'master_experience_id': f'bank-{score}', 'category': 'project',
             'title': 'Project', 'org': 'Org', 'match_score': score, 'reason': 'Relevant evidence'}
            for score in (70, 90, 80, 60)
        ])
        for limit in (0, 1, 2, 3):
            model_plan = OptimizationPlan(changes=[fixture._change()])
            store = fixture._RunStore(fixture._run(context=ctx))
            harness = fixture.ResumeOptimizationOrchestratorTests()
            with (
                self.subTest(limit=limit),
                patch.object(config, '_settings', settings(RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS=str(limit))),
                harness._patch_store(store),
                patch.object(orchestrator, 'build_frozen_optimization_context', AsyncMock(side_effect=[ctx, ctx])),
                patch.object(orchestrator, 'plan_resume_optimization', AsyncMock(return_value=model_plan)),
                patch.object(orchestrator, 'verify_plan_changes', return_value=fixture._allowed(model_plan.changes)),
            ):
                result = await orchestrator.create_optimization_plan(
                    session=fixture._FakeSession(), user_id=fixture.USER_ID,
                    payload=fixture._start_request(), idempotency_key=None,
                )
            persisted = OptimizationPlan.from_storage(result.result_json)
            self.assertEqual([s.master_experience_id for s in persisted.bank_suggestions],
                             ['bank-90', 'bank-80', 'bank-70'][:limit])


if __name__ == '__main__':
    unittest.main()
