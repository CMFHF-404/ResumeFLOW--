import json
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
from test_resume_review_v4 import raw_v4,report_v4,snapshot
from app.domain.ai import evidence_rubric_v2 as rubric
from app.domain.resume_optimization import simple_planner as planner,local_actions,apply_service,context_service
from app.domain.resume_optimization.schemas import OptimizationAnswer
from app.domain.resume_optimization.normalizers import OptimizationPlanNormalizationError

EDU='77777777-7777-7777-7777-777777777777'
CERT='88888888-8888-8888-8888-888888888888'
CERT2='99999999-9999-9999-9999-999999999999'


def data_and_report(kind,selected=(),needs_facts=False):
    from test_resume_optimization_apply import MASTER_ID
    data=snapshot();e=data['resume']['experiences'][0];e.update(id=str(MASTER_ID),category='work')
    e['star']=dict(s='数据任务',t='本人处理样本',a='使用Python清洗数据，保留验证条件。',r='交付分析报告，供组内使用。')
    data['resume']['educations']=[dict(id=EDU,school='测试大学',degree='本科',major='数理',courses='高等数学、材料力学、程序设计（C/C++）',notes='已发表论文，研究方法尚需说明。')]
    data['resume']['certifications']=[dict(id=CERT,name='专业资格',issuer='',issue_date='')]
    if kind=='certification_order' and len(selected)>1:data['resume']['certifications'].append(dict(id=CERT2,name='代表性荣誉',issuer='',issue_date=''))
    raw=raw_v4(data);sources=rubric.source_catalog(data['resume']);modules=rubric.modules_for(data['resume'])
    target=next(m for m in modules if m['moduleType']==kind)
    s=raw['suggestions'][0];s.update(targetId=target['targetId'],strategyType='information_selection',selectedItems=list(selected))
    if not needs_facts:s.update(handling='organize',action='rewrite',factGaps=[])
    if kind=='skill_create':s.update(strategyType='skill_creation',candidateText='Python',candidateSourceRef=next(s['sourceId'] for s in sources if s['path'].endswith('.star.a')))
    r=rubric.normalize(raw,sources=sources,modules=modules,context=rubric.assessment_context(data,''),metadata=report_v4(data)['metadata'],inventory=rubric.review_inventory(data['resume'],sources))
    r['selectedSuggestionIds']=['suggestion-1']
    current=context_service._allowlist_current_resume(data['resume'],target_role=data['target_role'])
    return data,r,SimpleNamespace(evaluation=r,current_resume=current,selected_source_experiences={},target_role=data['target_role'])


class SelectionActionTests(unittest.IsolatedAsyncioTestCase):
    async def test_education_whitespace_applies_and_reverts_exact_config_without_accepting_real_changes(self):
        from test_object_review import raw_object, report_object
        from test_resume_optimization_apply import _run, _resume, _link, _transaction_session, _request, USER_ID, RUN_ID, MASTER_ID
        from test_resume_optimization_finalize import _finalize_session, _revert_request
        from app.domain.resume_optimization.run_service import hash_canonical_json

        for kind, field in [('education_courses', 'courses'), ('education_notes', 'notes')]:
            for left, right in [(' ', ' '), ('\n', '\r\n'), ('\u00a0', '\u00a0')]:
                with self.subTest(kind=kind, whitespace=(left, right)):
                    data, _, _ = data_and_report(kind, ['course-1'] if field == 'courses' else [])
                    raw = raw_object(data)
                    raw['suggestions'][0].update(objectId='ED1', operationId=kind, sourceRefs=['ED1'],
                        handling='organize', factGaps=[], selectedItems=['course-1'] if field == 'courses' else [])
                    report = report_object(data, raw)
                    self.assertEqual(report['reportStatus'], 'complete')
                    report['selectedSuggestionIds'] = ['suggestion-1']
                    ctx = SimpleNamespace(evaluation=report,
                        current_resume=context_service._allowlist_current_resume(data['resume'], target_role=data['target_role']),
                        selected_source_experiences={}, target_role=data['target_role'])
                    response = {'changes': [dict(targetId='target-1', actionKind='rewrite_now',
                        generalValue='已发表论文，保留现有研究说明。', rationale='整理现有说明', questions=[])]}
                    with patch.object(planner, '_call_llm', AsyncMock(return_value={'content': json.dumps(response)})):
                        plan = await planner.plan(ctx)
                    change = plan.changes[0]
                    original = left + change.before_value + right
                    run = _run([])
                    run.policy_version = 'json_structure_v3'
                    run.before_snapshot['evaluation'] = report
                    run.before_snapshot['current_resume'] = ctx.current_resume
                    run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)
                    run.plan_json = plan.storage_dump()
                    run.result_json = plan.storage_dump()
                    run.answers_json = {'answers': []}
                    resume = _resume()
                    resume.config['selection'].update(experienceIds=[str(MASTER_ID)], educationIds=[EDU], certificationIds=[CERT], skillIds=[])
                    resume.config['jdAnalysis']['result']['resumeEvaluation'] = report
                    resume.config['educationOverrides'] = {EDU: {field: original}, 'unselected': {'notes': '保持原样'}}
                    before = deepcopy(resume.config)
                    link = _link()
                    link.overrides_json['star'] = deepcopy(ctx.current_resume['experiences'][str(MASTER_ID)]['star'])
                    old_link = deepcopy(link.overrides_json)

                    education = data['resume']['educations'][0]
                    source = SimpleNamespace(org=education['school'], title=education['major'],
                        star={key: education[key] for key in ('degree', 'courses', 'notes')})
                    source_session = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(first=lambda: (SimpleNamespace(id=EDU), source))))
                    await local_actions.check_current_sources(source_session, USER_ID, resume.config, [change], ctx.current_resume)
                    for invalid in (original + '实际新增内容', None, 123):
                        conflicting = deepcopy(resume.config)
                        conflicting['educationOverrides'][EDU][field] = invalid
                        untouched = deepcopy(conflicting)
                        with self.assertRaisesRegex(ValueError, 'education override changed'):
                            local_actions.update_config(conflicting, change, ctx.current_resume, str(RUN_ID))
                        self.assertEqual(conflicting, untouched)
                    with patch.object(local_actions, 'check_current_sources', AsyncMock()), patch.object(planner, '_call_llm', side_effect=AssertionError('apply/revert cannot call model')):
                        await apply_service.apply_resume_optimization(session=_transaction_session(run, resume, link),
                            user_id=USER_ID, run_id=str(RUN_ID), payload=_request('target-1'))
                        self.assertEqual(resume.config['educationOverrides'][EDU][field], change.targeted_value)
                        await apply_service.revert_resume_optimization(session=_finalize_session(run, resume, link),
                            user_id=USER_ID, run_id=str(RUN_ID), payload=_revert_request(resume.updated_at))
                    self.assertEqual(resume.config['educationOverrides'], before['educationOverrides'])
                    self.assertEqual(link.overrides_json, old_link)

    async def test_restructure_restores_exact_rich_text_and_rejects_modified_journal(self):
        from test_object_review import raw_object, report_object
        from test_resume_optimization_apply import _run, _resume, _link, _transaction_session, _request, USER_ID, RUN_ID, MASTER_ID, LINK_ID
        from test_resume_optimization_finalize import _finalize_session, _revert_request
        from app.domain.resume_optimization.run_service import hash_canonical_json

        cases = [
            ('<strong>整理数据</strong>', '整理数据'),
            ('<ul><li>整理数据</li><li>核对样本</li></ul>', '整理数据\n核对样本'),
            ('<p>第一行</p><p>第二行</p>', '第一行\n第二行'),
            ('<a href="https://example.com/report">结果说明</a>', '结果说明'),
            ('A &amp; B', 'A & B'),
            ('**整理数据**', '整理数据'),
        ]
        for original_html, visible in cases:
            with self.subTest(original_html=original_html):
                data, _, _ = data_and_report('experience_restructure')
                data['resume']['experiences'][0]['star']['a'] = visible
                raw = raw_object(data)
                raw['suggestions'][0].update(objectId='E1', operationId='experience_restructure',
                    sourceRefs=['E1'], handling='organize', factGaps=[])
                report = report_object(data, raw)
                self.assertEqual(report['reportStatus'], 'complete')
                report['selectedSuggestionIds'] = ['suggestion-1']
                ctx = SimpleNamespace(evaluation=report,
                    current_resume=context_service._allowlist_current_resume(data['resume'], target_role=data['target_role']),
                    selected_source_experiences={}, target_role=data['target_role'])
                response = {'changes': [dict(targetId='target-1', actionKind='rewrite_now',
                    generalValue='<p>问题与结果。</p><p><strong>个人行动。</strong></p>', rationale='整理已有内容', questions=[])]}
                with patch.object(planner, '_call_llm', AsyncMock(return_value={'content': json.dumps(response)})):
                    plan = await planner.plan(ctx)
                run = _run([])
                run.policy_version = 'json_structure_v3'
                run.before_snapshot['evaluation'] = report
                run.before_snapshot['current_resume'] = ctx.current_resume
                run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)
                run.plan_json = plan.storage_dump()
                run.result_json = plan.storage_dump()
                run.answers_json = {'answers': []}
                resume = _resume()
                resume.config['selection'].update(experienceIds=[str(MASTER_ID)], educationIds=[EDU], certificationIds=[CERT], skillIds=[])
                resume.config['jdAnalysis']['result']['resumeEvaluation'] = report
                link = _link()
                star = deepcopy(ctx.current_resume['experiences'][str(MASTER_ID)]['star'])
                star.update(a=original_html, s=f"<em>{star['s']}</em>", t=f"<p>{star['t']}</p>", r=f"<b>{star['r']}</b>")
                star['editorMetadata'] = {'keep': True}
                link.overrides_json['star'] = star
                original_overrides = deepcopy(link.overrides_json)
                self.assertEqual(apply_service._frontend_plain_text(original_html), visible)
                with patch.object(planner, '_call_llm', side_effect=AssertionError('apply/revert cannot call the model')):
                    await apply_service.apply_resume_optimization(session=_transaction_session(run, resume, link),
                        user_id=USER_ID, run_id=str(RUN_ID), payload=_request('target-1'))
                    self.assertEqual(run.status, 'applied')
                    self.assertEqual(link.overrides_json['star']['s'], '')
                    self.assertEqual(link.overrides_json['star']['editorMetadata'], {'keep': True})

                    # Even formatting-only edits of the raw rollback record must
                    # still fail its signature check when copies are synchronized.
                    for replacement in ('Different facts', original_html + '<b></b>'):
                        tampered = deepcopy(run)
                        touched = tampered.after_snapshot['touched_links'][str(LINK_ID)]
                        touched['before_overrides_json']['star']['a'] = replacement
                        touched['before_star']['value']['a'] = replacement
                        duplicate = tampered.after_snapshot['before']['touched_links'][str(LINK_ID)]
                        duplicate['overrides_json'] = deepcopy(touched['before_overrides_json'])
                        duplicate['star'] = deepcopy(touched['before_star'])
                        with self.assertRaisesRegex(apply_service.OptimizationRunDataInvalidError, 'rollback-before journal signature'):
                            await apply_service.revert_resume_optimization(session=_finalize_session(tampered, resume, link),
                                user_id=USER_ID, run_id=str(RUN_ID), payload=_revert_request(resume.updated_at))
                    await apply_service.revert_resume_optimization(session=_finalize_session(run, resume, link),
                        user_id=USER_ID, run_id=str(RUN_ID), payload=_revert_request(resume.updated_at))
                self.assertEqual(run.status, 'reverted')
                self.assertEqual(link.overrides_json, original_overrides)

    async def test_skipped_local_fallback_keeps_other_changes_previewable_and_applicable(self):
        from test_object_review import raw_object, report_object
        from test_resume_optimization_apply import _run, _resume, _link, _transaction_session, _request, USER_ID, RUN_ID, MASTER_ID
        from test_resume_optimization_finalize import _finalize_session, _revert_request
        from app.domain.resume_optimization import orchestrator
        from app.domain.resume_optimization.run_service import hash_canonical_json

        for kind, object_id in [('education_notes', 'ED1'), ('experience_restructure', 'E1')]:
            for fallback in (None, '仅重组已经写明的事实。'):
                with self.subTest(kind=kind, fallback=fallback):
                    data, _, _ = data_and_report(kind)
                    raw = raw_object(data)
                    first = raw['suggestions'][0]
                    first.update(objectId=object_id, operationId=kind, sourceRefs=[object_id], handling='ask_user',
                        factGaps=[dict(kind='task_scope', reason='确认本人承担的范围', sourceRefs=[object_id])])
                    second = deepcopy(first)
                    second.update(objectId='ED1', operationId='education_courses', sourceRefs=['ED1'],
                        handling='organize', factGaps=[], selectedItems=['course-1'])
                    raw['suggestions'] = [first, second]
                    report = report_object(data, raw)
                    self.assertEqual(report['reportStatus'], 'complete')
                    self.assertEqual(report['metadata']['responseSchemaVersion'], 'review_json_schema_v6')
                    report['selectedSuggestionIds'] = [s['suggestionId'] for s in report['suggestions']]
                    ctx = SimpleNamespace(evaluation=report,
                        current_resume=context_service._allowlist_current_resume(data['resume'], target_role=data['target_role']),
                        selected_source_experiences={}, target_role=data['target_role'])
                    response = {'changes': [dict(targetId='target-1', actionKind='ask_user', generalValue=fallback,
                        rationale='等待必要事实确认', questions=[dict(gapId=g['gapId']) for g in report['suggestions'][0]['factGaps']])]}
                    with patch.object(planner, '_call_llm', AsyncMock(return_value={'content': json.dumps(response)})) as call:
                        plan = await planner.plan(ctx)
                        call.assert_awaited_once()
                    stored_plan = plan.storage_dump()
                    skipped = orchestrator._terminal_answer_change(plan.changes[0])
                    final = plan.model_copy(deep=True, update={'changes': [skipped, plan.changes[1]]})
                    self.assertEqual(plan.storage_dump(), stored_plan, 'terminal conversion must not mutate the original plan')
                    self.assertEqual(skipped.display_before, plan.changes[0].display_before)
                    self.assertEqual(skipped.display_after, ['保留原文'])
                    self.assertIsNone(skipped.targeted_value)
                    self.assertFalse(skipped.default_selected)

                    run = _run([])
                    run.policy_version = 'json_structure_v3'
                    run.before_snapshot['evaluation'] = report
                    run.before_snapshot['current_resume'] = ctx.current_resume
                    run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)
                    run.plan_json = stored_plan
                    run.result_json = final.storage_dump()
                    run.answers_json = {'answers': [OptimizationAnswer(question_id=q.question_id, state='skipped').model_dump(mode='json') for q in plan.questions]}
                    projected = apply_service.project_plan_with_current_safety(run, plan=final)
                    self.assertEqual(projected.changes[1].targeted_value, '高等数学')
                    resume = _resume()
                    resume.config['selection'].update(experienceIds=[str(MASTER_ID)], educationIds=[EDU], certificationIds=[CERT], skillIds=[])
                    resume.config['jdAnalysis']['result']['resumeEvaluation'] = report
                    original_config = deepcopy(resume.config)
                    link = _link()
                    link.overrides_json = {'star': deepcopy(ctx.current_resume['experiences'][str(MASTER_ID)]['star'])}
                    original_link = deepcopy(link.overrides_json)
                    with patch.object(local_actions, 'check_current_sources', AsyncMock()), patch.object(planner, '_call_llm', side_effect=AssertionError('skip/apply/revert cannot call the model')):
                        await apply_service.apply_resume_optimization(session=_transaction_session(run, resume, link),
                            user_id=USER_ID, run_id=str(RUN_ID), payload=_request('target-2'))
                        self.assertEqual(resume.config['educationOverrides'][EDU], {'courses': '高等数学'})
                        self.assertEqual(link.overrides_json, original_link)
                        await apply_service.revert_resume_optimization(session=_finalize_session(run, resume, link),
                            user_id=USER_ID, run_id=str(RUN_ID), payload=_revert_request(resume.updated_at))
                    self.assertEqual(resume.config.get('educationOverrides'), original_config.get('educationOverrides'))
                    self.assertEqual(link.overrides_json, original_link)

    def test_cleared_course_override_matches_frontend_snapshot_without_restoring_bank_text(self):
        bank = {'experiences': [(SimpleNamespace(id=EDU, category='education'),
            SimpleNamespace(org='Test University', title='CS', star={'degree': 'Bachelor', 'courses': 'A,B'}))],
            'skills': [], 'certifications': []}
        original = deepcopy(bank['experiences'][0][1].star)
        for value in ('', 'A'):
            config = {'selection': {'educationIds': [EDU]}, 'educationOverrides': {EDU: {'courses': value}}}
            actual = context_service._actual_frontend_collections(resume=SimpleNamespace(config=config),
                resume_items=[], bank=bank, category_by_master_id={})['selected_educations']
            signed = [{'id': EDU, 'school': 'Test University', 'major': 'CS', 'degree': 'Bachelor',
                       **({'courses': value} if value else {})}]
            self.assertIsNone(context_service._first_snapshot_mismatch(actual, signed, path='resume.educations'))
            self.assertEqual(config['educationOverrides'][EDU]['courses'], value)
        self.assertEqual(bank['experiences'][0][1].star, original)

    def test_course_choices_do_not_split_parentheses_and_cannot_invent_names(self):
        from app.domain.ai.selection_actions import courses
        self.assertEqual([c['text'] for c in courses('课程A（理论,实践）、课程B；C/C++')],['课程A（理论,实践）','课程B','C/C++'])
        with self.assertRaises(ValueError):data_and_report('education_courses',['unknown'])

    def test_compact_input_keeps_body_once_and_education_notes(self):
        data,r,_=data_and_report('education_courses',['course-1'])
        sources=rubric.source_catalog(data['resume']);payload=rubric.model_payload(data,'',sources,rubric.modules_for(data['resume']),rubric.assessment_context(data,''))
        wire=json.dumps(payload,ensure_ascii=False)
        self.assertEqual(wire.count('使用Python清洗数据，保留验证条件。'),1)
        self.assertEqual(wire.count('已发表论文，研究方法尚需说明。'),1)
        self.assertTrue(all('text' not in s for s in payload['sources']))
        self.assertTrue(all('text' not in s for s in payload['evidenceSpans']))
        self.assertEqual([c['text'] for c in payload['readingView']['educations'][0]['courses']],['高等数学','材料力学','程序设计（C/C++）'])

    async def test_deterministic_selection_never_calls_model(self):
        for kind,items in [('education_courses',['course-3','course-1']),('certification_order',[CERT2,CERT]),('certification_hide',[]),('experience_hide',[])]:
            data,r,ctx=data_and_report(kind,items)
            with patch.object(planner,'_call_llm',AsyncMock()) as call:
                plan=await planner.plan(ctx);call.assert_not_called()
            self.assertEqual(len(plan.changes),1);self.assertEqual(plan.changes[0].action_kind,'rewrite_now')
            if kind=='education_courses':self.assertEqual(plan.changes[0].targeted_value,'程序设计（C/C++）、高等数学')
            if kind.endswith('hide'):self.assertIs(plan.changes[0].targeted_value,False)

    async def test_new_skill_requires_confirmed_user_fragments(self):
        data,r,ctx=data_and_report('skill_create')
        with patch.object(planner,'_call_llm',AsyncMock()) as call:
            plan=await planner.plan(ctx);q=plan.questions[0]
            self.assertEqual(q.skill_original['name'],'Python')
            self.assertEqual(await planner.rewrite(ctx,plan,[OptimizationAnswer(question_id=q.question_id,state='unknown')]),[])
            answer=OptimizationAnswer(question_id=q.question_id,state='answered',value=json.dumps(dict(fragments=['Python用于已完成的数据清洗'],category='分析工具',confirmed=True)))
            changed=await planner.rewrite(ctx,plan,[answer]);call.assert_not_called()
        self.assertEqual(changed[0].targeted_value['name'],'Python用于已完成的数据清洗')
        self.assertNotIn('localSkills',data['resume'])

    async def test_apply_revert_all_new_operations_in_isolated_resume(self):
        from test_resume_optimization_apply import _run,_resume,_link,_transaction_session,_request,USER_ID,RUN_ID
        from test_resume_optimization_finalize import _finalize_session,_revert_request
        from app.domain.resume_optimization.run_service import hash_canonical_json
        for kind,items in [('education_courses',['course-1']),('education_notes',[]),('certification_order',[CERT2,CERT]),('certification_hide',[]),('experience_hide',[]),('experience_restructure',[]),('skill_create',[])]:
            with self.subTest(kind=kind):
                from test_resume_optimization_apply import MASTER_ID
                data,r,ctx=data_and_report(kind,[str(MASTER_ID)] if items is None else items)
                response={'changes':[dict(targetId='target-1',actionKind='rewrite_now',generalValue='问题与结果。个人方法。验证条件。',rationale='仅重排已选正文',questions=[])]}
                with patch.object(planner,'_call_llm',AsyncMock(return_value={'content':json.dumps(response)})):
                    plan=await planner.plan(ctx)
                answers=[];final=plan
                if kind=='skill_create':
                    answers=[OptimizationAnswer(question_id=plan.questions[0].question_id,state='answered',value=json.dumps(dict(fragments=['Python数据清洗'],category='工具',confirmed=True)))]
                    final=plan.model_copy(update={'changes':await planner.rewrite(ctx,plan,answers)})
                run=_run([]);run.policy_version='json_structure_v3';run.before_snapshot['evaluation']=r;run.before_snapshot['current_resume']=ctx.current_resume
                run.source_snapshot_hash=hash_canonical_json(run.before_snapshot);run.plan_json=plan.storage_dump();run.result_json=final.storage_dump();run.answers_json={'answers':[a.model_dump(mode='json') for a in answers]}
                resume=_resume();resume.config['selection'].update(experienceIds=[str(MASTER_ID)],educationIds=[EDU],certificationIds=[c['id'] for c in ctx.current_resume['certifications']],skillIds=[])
                resume.config['jdAnalysis']['result']['resumeEvaluation']=r
                # Ensure reorder operations actually alter the stored explicit order.
                if kind.endswith('order'):resume.config.setdefault('layout',{}).setdefault('orders',{})['unrelated']=['keep']
                original=deepcopy(resume.config);link=_link();link.overrides_json={'star':deepcopy(ctx.current_resume['experiences'][str(MASTER_ID)]['star'])};original_link=deepcopy(link.overrides_json)
                session=_transaction_session(run,resume,link)
                with patch.object(local_actions,'check_current_sources',AsyncMock()),patch.object(planner,'_call_llm',side_effect=AssertionError('apply/revert cannot call model')):
                    applied=await apply_service.apply_resume_optimization(session=session,user_id=USER_ID,run_id=str(RUN_ID),payload=_request('target-1'))
                    if kind=='experience_restructure':self.assertEqual(link.overrides_json['star'],dict(s='',t='',a='问题与结果。个人方法。验证条件。',r=''))
                    if kind=='experience_hide':self.assertEqual(resume.config['selection']['experienceIds'],[])
                    if kind=='skill_create':self.assertEqual(len(resume.config['localSkills']),1)
                    reverted=await apply_service.revert_resume_optimization(session=_finalize_session(run,resume,link),user_id=USER_ID,run_id=str(RUN_ID),payload=_revert_request(resume.updated_at))
                for field in ('selection','educationOverrides','localSkills'):
                    self.assertEqual(resume.config.get(field),original.get(field))
                self.assertEqual(link.overrides_json,original_link)

    def test_experience_order_only_changes_its_category_and_keeps_other_orders(self):
        frozen={'experiences':{'a':{'id':'a','category':'work'},'b':{'id':'b','category':'work'},'c':{'id':'c','category':'project'}}}
        config={'layout':{'orders':{'workExperienceIds':['a','b','archived'],'projectExperienceIds':['c']}}}
        change=SimpleNamespace(module_type='experience_order',module_id='work',before_value=['a','b'],targeted_value=['b','a'])
        local_actions.update_config(config,change,frozen,'test')
        self.assertEqual(config['layout']['orders'],{'workExperienceIds':['b','a','archived'],'projectExperienceIds':['c']})

    async def test_deleted_or_foreign_education_rejected(self):
        _,r,ctx=data_and_report('education_notes')
        change=SimpleNamespace(module_type='education_notes',module_id=EDU)
        session=SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(first=lambda:None)))
        with self.assertRaises(ValueError):await local_actions.check_current_sources(session,'owner',{},[change],ctx.current_resume)


if __name__=='__main__':unittest.main()
