import copy
import unittest
from unittest.mock import AsyncMock, patch

from test_resume_optimization_coverage import context
from app.domain.resume_optimization.planner_tasks import build_tasks, task_schema, assemble_plan
from app.domain.resume_optimization.planner_service import plan_resume_optimization
from app.domain.resume_optimization.normalizers import OptimizationPlanNormalizationError


def unchanged(tasks):
    return {key: {'action': 'leave_unchanged', 'generalValue': None, 'targetedValue': None,
                  'sourceIds': [], 'introducedTerms': [], 'question': None,
                  'cleanupValue': None, 'rationale': '保留已有事实。'} for key in tasks}


class TaskPlanTests(unittest.IsolatedAsyncioTestCase):
    async def test_planner_receives_scrubbed_target_role_as_context_not_evidence(self):
        import json
        from app.domain.resume_optimization.context_service import FrozenOptimizationContext
        messages = []
        for role in ('产品经理', '数据分析师'):
            data = copy.deepcopy(context()._snapshot)
            data['target_role'] = role
            ctx = FrozenOptimizationContext(**data)
            tasks, _ = build_tasks(ctx)
            with patch('app.domain.resume_optimization.planner_service._bounded_model_call',
                       AsyncMock(return_value=unchanged(tasks))) as model:
                await plan_resume_optimization(ctx)
            payload = json.loads(model.call_args.args[0][1]['content'])
            self.assertEqual(payload['targetRole'], role)
            self.assertEqual(set(payload['tasks']), set(tasks))
            messages.append(payload)
        self.assertEqual(messages[0]['tasks'], messages[1]['tasks'])
        self.assertNotEqual(messages[0]['targetRole'], messages[1]['targetRole'])

        data = copy.deepcopy(context()._snapshot)
        data['current_resume']['profile'] = {'email': 'private-role@example.invalid'}
        data['target_role'] = '产品经理 private-role@example.invalid'
        ctx = FrozenOptimizationContext(**data)
        tasks, _ = build_tasks(ctx)
        with patch('app.domain.resume_optimization.planner_service._bounded_model_call',
                   AsyncMock(return_value=unchanged(tasks))) as model:
            await plan_resume_optimization(ctx)
        sent = model.call_args.args[0][1]['content']
        self.assertNotIn('private-role@example.invalid', sent)
        self.assertIn('产品经理', json.loads(sent)['targetRole'])

    def test_current_audited_order_task_routes_without_description_keywords(self):
        from test_guidance_tasks import realistic_input, valid_model_judgments, task
        from test_guidance_evaluation import verdicts
        from app.domain.ai import guidance_evaluation as guidance
        from app.domain.resume_optimization.context_service import FrozenOptimizationContext
        c = guidance.build_task_contract(realistic_input())
        raw = valid_model_judgments(c)
        tid = 'GLOBAL_LOGIC_ORDER'
        raw[tid]['assessment'] = 'needs_revision'
        raw[tid]['guidance'] = next(g for g in task(c, tid)['allowedGuidance'] if g['type'] == 'safe_cleanup')
        _, evaluation = guidance.assemble_guidance(c, guidance.validate_judgments(raw, c), audit=verdicts(c))
        issue = next(i for i in evaluation['issues'] if i['taskId'] == tid)
        data = copy.deepcopy(context()._snapshot)
        data['evaluation'] = {**evaluation, 'issues': [issue], 'topPriorities': [], '_guidanceTasks': c['tasks']}
        data['current_resume']['section_order'] = ['summary', 'work', 'education', 'skills']
        for action, expected_count in [('safe_cleanup', 1), ('needs_information', 0), ('none', 0)]:
            with self.subTest(action=action):
                issue['guidanceType'] = action
                tasks, retained = build_tasks(FrozenOptimizationContext(**data))
                orders = [t for t in tasks.values() if t['field_path'] == 'section_order']
                self.assertEqual(len(orders), expected_count)
                if orders:
                    self.assertEqual(orders[0]['issue_ids'], [issue['issueId']])
                    self.assertNotIn(issue['issueId'], retained)
                    patches = unchanged(tasks)
                    key = next(k for k, t in tasks.items() if t['field_path'] == 'section_order')
                    item_ids = list(reversed(tasks[key]['order_items']))
                    patches[key].update(action='rewrite_now', generalValue=item_ids,
                                        targetedValue=item_ids, sourceIds=['SOURCE_001'])
                    plan = assemble_plan(patches, tasks, retained, FrozenOptimizationContext(**data))
                    change = next(c for c in plan.changes if c.field_path == 'section_order')
                    self.assertEqual(change.general_value, ['skills', 'education', 'work', 'summary'])

    def test_server_fixes_identities_and_local_repairs_precede_generation(self):
        ctx = context()
        tasks, retained = build_tasks(ctx)
        schema = task_schema(tasks)
        self.assertEqual(set(schema['required']), set(tasks))
        for item in schema['properties'].values():
            self.assertFalse({'moduleId', 'beforeValue', 'issueIds', 'sourceRefs', 'dimension'} & set(item['properties']))
        plan = assemble_plan(unchanged(tasks), tasks, retained, ctx)
        edits = {(c.module_id, c.field_path): c for c in plan.changes if c.action_kind.value == 'rewrite_now'}
        self.assertEqual(set(edits), {('one', 'star.a'), ('two', 'star.a'), ('two', 'star.r')})
        self.assertIn('团队共同实现', edits['two', 'star.r'].general_value)

    def test_missing_task_or_unknown_source_is_rejected_without_partial_acceptance(self):
        ctx = context()
        tasks, retained = build_tasks(ctx)
        raw = unchanged(tasks)
        raw.pop(next(iter(raw)))
        with self.assertRaises(OptimizationPlanNormalizationError):
            assemble_plan(raw, tasks, retained, ctx)
        raw = unchanged(tasks)
        raw[next(iter(raw))]['sourceIds'] = ['SOURCE_NOT_OWNED']
        with self.assertRaises(OptimizationPlanNormalizationError):
            assemble_plan(raw, tasks, retained, ctx)
        raw = unchanged(tasks)
        raw[next(iter(raw))]['moduleId'] = 'another-experience'
        with self.assertRaises(OptimizationPlanNormalizationError):
            assemble_plan(raw, tasks, retained, ctx)

    def test_multiple_dimensions_on_one_field_have_one_mutable_candidate(self):
        from app.domain.resume_optimization.context_service import FrozenOptimizationContext
        data = copy.deepcopy(context()._snapshot)
        data['evaluation']['issues'].append({'issueId': 'professional', 'primaryDimension': '专业表达',
            'description': '行动句缺少句号', 'evidenceIds': ['a1']})
        ctx = FrozenOptimizationContext(**data)
        tasks, retained = build_tasks(ctx)
        plan = assemble_plan(unchanged(tasks), tasks, retained, ctx)
        self.assertEqual(sum(c.module_id == 'one' and c.field_path == 'star.a' and c.action_kind.value == 'rewrite_now' for c in plan.changes), 1)
        self.assertTrue(any('professional' in c.issue_ids for c in plan.changes))

    def test_question_and_local_punctuation_share_one_field_and_cleanup(self):
        ctx = context(); tasks, retained = build_tasks(ctx); raw = unchanged(tasks)
        key = next(k for k, t in tasks.items() if t['field_path'] == 'star.a')
        raw[key].update(action='ask_user', question='还有哪些可确认的行动细节？')
        plan = assemble_plan(raw, tasks, retained, ctx)
        question = plan.questions[0]
        self.assertEqual(len(question.affects_change_ids), 1)
        ask_id = question.affects_change_ids[0]
        self.assertIn(ask_id, plan.cleanup_fallbacks)
        cleanup = plan.cleanup_fallbacks[ask_id]
        self.assertEqual(cleanup.action_kind.value, 'rewrite_now')
        self.assertEqual(cleanup.general_value, '访谈客户并编写需求说明。')
        self.assertEqual(cleanup.general_value, cleanup.targeted_value)
        self.assertEqual(cleanup.source_refs, ['/currentResume/experiences/one/star/a'])
        restored = type(plan).model_validate(plan.storage_dump())
        self.assertEqual(restored.cleanup_fallbacks[ask_id].general_value, cleanup.general_value)

    def test_existing_skill_order_capability_uses_only_server_item_ids(self):
        from app.domain.resume_optimization.context_service import FrozenOptimizationContext
        data = copy.deepcopy(context()._snapshot)
        data['evaluation']['issues'].append({'issueId': 'ordering', 'primaryDimension': '逻辑清晰', 'description': '技能排序应突出相关项'})
        data['current_resume']['skills'] = [{'id': 'skill-a', 'name': 'SQL'}, {'id': 'skill-b', 'name': '需求分析'}]
        ctx = FrozenOptimizationContext(**data); tasks, retained = build_tasks(ctx); raw = unchanged(tasks)
        key = next(k for k, t in tasks.items() if t['field_path'] == 'skills.order')
        ids = list(reversed(tasks[key]['order_items']))
        raw[key].update(action='rewrite_now', generalValue=ids, targetedValue=ids, sourceIds=['SOURCE_001'])
        plan = assemble_plan(raw, tasks, retained, ctx)
        change = next(c for c in plan.changes if c.field_path == 'skills.order')
        self.assertEqual(change.general_value, ['skill-b', 'skill-a'])
        raw[key]['generalValue'] = ['UNKNOWN', ids[0]]
        with self.assertRaises(OptimizationPlanNormalizationError):
            assemble_plan(raw, tasks, retained, ctx)

    def test_unlocated_issues_are_server_retained_not_model_omissions(self):
        ctx = context()
        data = copy.deepcopy(ctx._snapshot)
        data['evaluation']['issues'].append({'issueId': 'unlocated', 'primaryDimension': '内容完整', 'description': '缺少电话'})
        from app.domain.resume_optimization.context_service import FrozenOptimizationContext
        ctx = FrozenOptimizationContext(**data)
        tasks, retained = build_tasks(ctx)
        plan = assemble_plan(unchanged(tasks), tasks, retained, ctx)
        self.assertTrue(any('unlocated' in c.issue_ids and c.field_path == 'unsupported' for c in plan.changes))

    async def test_production_entry_uses_required_task_keys(self):
        ctx = context()
        tasks, _ = build_tasks(ctx)
        model = AsyncMock(return_value=unchanged(tasks))
        with patch('app.domain.resume_optimization.planner_service._call_llm', model):
            plan = await plan_resume_optimization(ctx)
        self.assertEqual(model.await_count, 1)
        self.assertEqual(set(model.call_args.kwargs['gemini_response_json_schema']['required']), set(tasks))
        self.assertNotIn('planning_tasks', plan.model_dump())
        self.assertTrue(plan.storage_dump()['planning_tasks'])

    async def test_text_contract_contains_exact_transport_schema(self):
        import json
        ctx = context(); tasks, _ = build_tasks(ctx)
        with patch('app.domain.resume_optimization.planner_service._call_llm', AsyncMock(return_value=unchanged(tasks))) as model:
            await plan_resume_optimization(ctx)
        prompt = model.call_args.args[0][0]['content']
        self.assertIn('OUTPUT_JSON_SCHEMA:\n', prompt)
        self.assertEqual(json.loads(prompt.split('OUTPUT_JSON_SCHEMA:\n', 1)[1]), model.call_args.kwargs['gemini_response_json_schema'])

    def test_patch_failure_diagnostics_do_not_echo_unknown_fields(self):
        ctx = context(); tasks, retained = build_tasks(ctx); raw = unchanged(tasks)
        key = next(iter(tasks)); raw[key].pop('cleanupValue'); raw[key]['private-provider-content'] = 'secret'
        with self.assertRaises(OptimizationPlanNormalizationError) as caught:
            assemble_plan(raw, tasks, retained, ctx)
        self.assertEqual(caught.exception.field_path, 'tasks.' + key)
        self.assertEqual(caught.exception.missing_fields, ['cleanupValue'])
        self.assertEqual(caught.exception.unexpected_field_count, 1)


class CoverageReviewTests(unittest.IsolatedAsyncioTestCase):
    def test_selected_skill_name_does_not_authorize_new_proficiency(self):
        from test_resume_optimization_safety import _change, _documents, _verify
        docs = _documents(); docs['currentResume']['skills'] = [{'name':'SQL'}, {'name':'Excel'}]
        change = _change(module_type='personal_summary', module_id='current_resume', field_path='personal_summary',
            before_value=docs['currentResume']['personal_summary'], general_value='熟练运用SQL、Excel工具。',
            targeted_value='熟练运用SQL、Excel工具。', source_refs=['/currentResume/personal_summary','/currentResume/skills'])
        verified, _ = _verify(change, docs)
        self.assertEqual(verified[0].safety_status, 'blocked')
        docs['selectedSourceExperiences']['exp-a']['star']['a'] = '熟练运用Python工具。'
        change = change.model_copy(update={'source_refs': [*change.source_refs, '/selectedSourceExperiences/exp-a/star/a']})
        verified, _ = _verify(change, docs)
        self.assertEqual(verified[0].safety_status, 'blocked')
        docs['selectedSourceExperiences']['exp-a']['star']['a'] = '熟练运用SQL、Excel工具。'
        verified, _ = _verify(change, docs)
        self.assertEqual(verified[0].safety_status, 'allowed')

    async def test_safe_candidate_can_still_leave_the_defect_unrepaired(self):
        from test_resume_optimization_safety import _change, _documents
        from app.domain.resume_optimization.schemas import OptimizationPlan
        from app.domain.resume_optimization.semantic_review import review_plan_semantics, OptimizationSemanticReviewNormalizationError
        from app.domain.resume_optimization.safety import verify_plan_changes
        from app.domain.resume_optimization.coverage import refresh_coverage
        docs = _documents(current_a='整理需求', selected_a='整理需求并编写验收清单。')
        plan = OptimizationPlan(changes=[_change(before_value='整理需求', general_value='整理需求并编写验收清单。',
            targeted_value='整理需求并编写验收清单。', source_refs=['/selectedSourceExperiences/exp-a/star/a'])],
            coverage=[{'issue_id': 'I1', 'module_id': 'exp-a', 'field_path': 'star.a', 'dimension': 'STAR应用', 'description': '缺少行动细节'}])
        raw = {'reviews': [{'id': 'CHANGE_1', 'verdict': 'supported', 'reason': '来源支持。'}],
               'coverageReviews': [{'id': 'COVERAGE_001', 'verdict': 'partial', 'reason': '只补回部分细节。'}]}
        with patch('app.domain.resume_optimization.semantic_review._call_llm', AsyncMock(return_value=raw)) as model:
            reviewed = await review_plan_semantics(plan=plan, source_documents=docs)
        self.assertEqual(model.await_count, 1)
        self.assertIn('OUTPUT_JSON_SCHEMA:', model.call_args.args[0][0]['content'])
        schema = model.call_args.kwargs['gemini_response_json_schema']
        self.assertEqual(schema['$defs']['_Verdict']['properties']['id']['enum'], ['CHANGE_1'])
        self.assertEqual(schema['$defs']['_CoverageVerdict']['properties']['id']['enum'], ['COVERAGE_001'])
        self.assertEqual(schema['properties']['coverageReviews']['minItems'], 1)
        reviewed.changes, _ = verify_plan_changes(plan=reviewed, source_documents=docs)
        refresh_coverage(reviewed)
        self.assertEqual(reviewed.changes[0].safety_status, 'allowed')
        self.assertEqual(reviewed.coverage[0]['status'], 'unrepaired')
        self.assertTrue(reviewed.coverage[0]['coverage_input_hash'])
        raw.pop('coverageReviews')
        with patch('app.domain.resume_optimization.semantic_review._call_llm', AsyncMock(return_value=raw)):
            with self.assertRaises(OptimizationSemanticReviewNormalizationError):
                await review_plan_semantics(plan=plan, source_documents=docs)
