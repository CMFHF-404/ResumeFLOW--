import copy
import unittest
from unittest.mock import AsyncMock, patch

from test_resume_optimization_planner import _context
from app.domain.resume_optimization.context_service import FrozenOptimizationContext
from app.domain.resume_optimization.schemas import OptimizationPlan, OptimizationAnswer
from app.domain.resume_optimization.planner_service import _plan_resume_optimization_v3 as plan_resume_optimization, rewrite_answered_modules
from app.domain.resume_optimization.coverage import coverage_targets, reconcile_coverage, refresh_coverage
from app.domain.resume_optimization.planner_tasks import build_tasks


def context():
    data = copy.deepcopy(_context()._snapshot)
    data['current_resume']['experiences'] = {
        'one': {'id': 'one', 'star': {'s': '', 't': '', 'a': '访谈客户并编写需求说明', 'r': '产品上线了。'}},
        'two': {'id': 'two', 'star': {'s': '', 't': '', 'a': '用SQL和Excel制作周报', 'r': '周报做好了。'}},
    }
    data['selected_master_experience_ids'] = ['one', 'two']
    data['selected_source_experiences'] = copy.deepcopy(data['current_resume']['experiences'])
    data['selected_source_experiences']['two']['star']['r'] = '连续4周记录，周报耗时从4小时降至1.5小时，由5名同事使用。结果由团队共同实现。'
    data['evaluation'] = {'issues': [
        {'issueId': 'punct', 'primaryDimension': '内容可读', 'description': '行动缺少句末标点', 'evidenceIds': ['a1', 'a2']},
        {'issueId': 'result', 'primaryDimension': '成果量化', 'description': '遗漏成果', 'evidenceIds': ['r2']},
    ], 'evidence': [
        {'evidenceId': 'a1', 'location': 'resume.experiences[0].star.a', 'sourceText': '访谈客户并编写需求说明'},
        {'evidenceId': 'a2', 'location': 'resume.experiences[1].star.a', 'sourceText': '用SQL和Excel制作周报'},
        {'evidenceId': 'r2', 'location': 'resume.experiences[1].star.r', 'sourceText': '周报做好了。'},
    ]}
    return FrozenOptimizationContext(**data)


class CoverageTests(unittest.TestCase):
    def test_guidance_quantification_tasks_route_to_owned_star_leaves(self):
        data = copy.deepcopy(context()._snapshot)
        criteria = (
            ('RESULT_METRIC', '结果指标', 'star.r'),
            ('BASELINE_COMPARISON', '基线与前后对比', 'star.r'),
            ('COVERAGE_SCALE', '覆盖规模', 'star.r'),
            ('TIME_WINDOW', '时间窗口', 'star.r'),
            ('DATA_CREDIBILITY', '数据可信度', 'star.r'),
            ('PROCESS_QUANTITY', '过程数量', 'star.a'),
        )
        data['evaluation'] = {
            'issues': [
                {
                    'issueId': f'ISSUE_EXP_002_QUANT_{slug}',
                    'taskId': f'EXP_002_QUANT_{slug}',
                    'fieldPath': 'experiences[1].star',
                    'primaryDimension': '成果量化',
                    'description': f'当前正文没有{criterion}。',
                    'evidenceIds': [],
                    'severity': 'low',
                }
                for slug, criterion, _field in criteria
            ],
            'evidence': [],
            'topPriorities': [],
            '_guidanceTasks': [
                {
                    'taskId': f'EXP_002_QUANT_{slug}',
                    'dimension': '成果量化',
                    'criterion': criterion,
                    'fieldPath': 'experiences[1].star',
                    'allowedSources': [],
                }
                for slug, criterion, _field in criteria
            ],
        }
        ctx = FrozenOptimizationContext(**data)

        self.assertEqual(
            {
                (target['issue_id'], target['module_id'], target['field_path'])
                for target in coverage_targets(ctx)
            },
            {
                (f'ISSUE_EXP_002_QUANT_{slug}', 'two', field)
                for slug, _criterion, field in criteria
            },
        )

        tasks, retained = build_tasks(ctx)
        self.assertEqual(retained, [])
        routed = {
            (task['module_id'], task['field_path']): task
            for task in tasks.values()
        }
        result_sources = routed['two', 'star.r']['sources'].values()
        self.assertTrue(
            any('连续4周' in str(source['text']) for source in result_sources)
        )
        self.assertTrue(
            all('/two/' in source['pointer'] for source in result_sources)
        )

    def test_guidance_task_field_path_routes_absent_star_issue_without_evidence(self):
        data = copy.deepcopy(context()._snapshot)
        data['evaluation'] = {
            'issues': [{
                'issueId': 'ISSUE_EXP_002_STAR_ACTION',
                'taskId': 'EXP_002_STAR_ACTION',
                'fieldPath': 'experiences[1].star.a',
                'primaryDimension': 'STAR应用',
                'description': '缺少可确认的具体行动。',
                'evidenceIds': [],
            }],
            'evidence': [],
            '_guidanceTasks': [{
                'taskId': 'EXP_002_STAR_ACTION',
                'dimension': 'STAR应用',
                'criterion': 'Action行动',
                'fieldPath': 'experiences[1].star.a',
                'allowedSources': [],
            }],
        }

        self.assertEqual(
            coverage_targets(FrozenOptimizationContext(**data)),
            [{
                'issue_id': 'ISSUE_EXP_002_STAR_ACTION',
                'dimension': 'STAR应用',
                'module_id': 'two',
                'field_path': 'star.a',
                'status': 'uncovered',
            }],
        )

    def test_every_affected_field_is_covered_and_second_result_is_restored(self):
        ctx = context()
        plan = reconcile_coverage(OptimizationPlan(), ctx)
        candidates = {(c.module_id, c.field_path): c for c in plan.changes}
        self.assertEqual(set(candidates), {('one', 'star.a'), ('two', 'star.a'), ('two', 'star.r')})
        self.assertEqual(candidates['two', 'star.r'].general_value, ctx.selected_source_experiences['two']['star']['r'])
        self.assertTrue(candidates['two', 'star.a'].general_value.endswith('。'))
        repeated = reconcile_coverage(plan, ctx)
        self.assertEqual(repeated.model_dump(), plan.model_dump())

    def test_result_with_unique_facts_is_not_overwritten(self):
        data = copy.deepcopy(context()._snapshot)
        data['current_resume']['experiences']['two']['star']['r'] = '周报由8名同事使用。'
        data['evaluation']['evidence'][2]['sourceText'] = '周报由8名同事使用。'
        plan = reconcile_coverage(OptimizationPlan(), FrozenOptimizationContext(**data))
        self.assertFalse(any(c.field_path == 'star.r' for c in plan.changes))
        self.assertTrue(any(c['status'] == 'preserved' and c.get('reason') for c in plan.coverage))

    def test_blocked_candidates_never_count_as_repaired(self):
        plan = reconcile_coverage(OptimizationPlan(), context())
        for c in plan.changes:
            c.safety_status = 'blocked'
        refresh_coverage(plan)
        self.assertTrue(all(c['status'] == 'blocked' for c in plan.coverage))

    def test_internal_metadata_is_persisted_but_not_public(self):
        plan = reconcile_coverage(OptimizationPlan(), context())
        self.assertNotIn('coverage', plan.model_dump())
        restored = OptimizationPlan.model_validate(plan.storage_dump())
        self.assertEqual(restored.coverage, plan.coverage)
        self.assertEqual(OptimizationPlan.model_validate({}).coverage, [])


class CleanupTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_data_uses_current_text_fallback_without_generation(self):
        from test_resume_optimization_planner import _change, _question, SELECTED_ID
        ctx = _context()
        raw = {'changes': [_change(actionKind='ask_user', generalValue=None, targetedValue=None)],
               'questions': [_question(fieldPath='star.a')],
               'safeCleanupCandidates': [{'changeId': 'CHG_I1', 'value': '参与交付。'}]}
        with patch('app.domain.resume_optimization.planner_service._call_llm', AsyncMock(return_value=raw)):
            plan = await plan_resume_optimization(ctx)
        plan = OptimizationPlan.model_validate(plan.storage_dump())
        with patch('app.domain.resume_optimization.planner_service._call_llm', AsyncMock()) as model:
            changes = await rewrite_answered_modules(context=ctx, existing_plan=plan, answers=[OptimizationAnswer(question_id='Q1', state='no_data')])
        model.assert_not_awaited()
        self.assertEqual(changes[0].action_kind.value, 'rewrite_now')
        self.assertEqual(changes[0].source_refs, [f'/currentResume/experiences/{SELECTED_ID}/star/a'])
        with patch('app.domain.resume_optimization.planner_service._call_llm', AsyncMock()) as model:
            denied = await rewrite_answered_modules(context=ctx, existing_plan=plan, answers=[OptimizationAnswer(question_id='Q1', state='not_my_work')])
        self.assertEqual(denied[0].action_kind.value, 'leave_unchanged')
        model.assert_not_awaited()
