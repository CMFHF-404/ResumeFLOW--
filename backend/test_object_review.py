import asyncio
from copy import deepcopy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from jsonschema import validate

from test_lean_resume_review import raw_lean, snapshot
from app.domain.ai import object_review as rubric, review_objects, evidence_rubric_v2 as history, resume_score
from app.domain.resume_optimization import simple_planner, context_service


def raw_object(data=None):
    data=data or snapshot();raw=raw_lean(data)
    sources=rubric.source_catalog(data['resume']);modules=rubric.modules_for(data['resume'])
    objects=review_objects.catalog(sources,modules);aliases,_=review_objects.references(sources,objects)
    raw['focusObjectIds']=[o['objectId'] for o in objects if o['kind']=='experience']
    for d in raw['dimensions']:
        d['sourceRefs']=['R'];d['jdSourceRefs']=[]
        for c in d['criteria']:
            for key in ('reason','sourceRefs','jdSourceRefs'):c.pop(key,None)
    for row in raw['strengths']:row['sourceRefs']=[aliases[x] for x in row['sourceRefs']]
    for row in raw['suggestions']:
        row.pop('targetId');row.pop('diagnosticId',None)
        row.update(objectId='S',operationId='personal_summary',sourceRefs=['S'])
        for gap in row['factGaps']:gap['sourceRefs']=['S']
    return raw


def report_object(data=None, raw=None, jd=''):
    data=data or snapshot()
    return rubric.normalize(raw or raw_object(data),sources=rubric.source_catalog(data['resume'],jd),modules=rubric.modules_for(data['resume']),context=rubric.assessment_context(data,jd),
        metadata=dict(promptVersion=rubric.PROMPT_VERSION,rubricVersion=rubric.SCORING_VERSION,guideVersion=rubric.GUIDE_VERSION,
            responseSchemaVersion=rubric.RESPONSE_SCHEMA_VERSION,inputHash=rubric.binding(data,jd),model='test-double',provider='fixture',transport='mock',reasoning={'geminiThinkingLevel':'medium'}),jd_match=88 if jd else None)


class ObjectReviewTests(unittest.IsolatedAsyncioTestCase):
    def test_raw_contract_and_roundtrip_do_not_invent_criterion_notes(self):
        data=snapshot();raw=raw_object(data)
        validate(raw,rubric.response_schema(rubric.source_catalog(data['resume']),[],rubric.modules_for(data['resume'])))
        report=report_object(data,raw)
        self.assertEqual(report['overallScore'],75);self.assertEqual(report['reportStatus'],'complete')
        self.assertEqual(history.normalize(report),report)
        self.assertTrue(all('reason' not in c and 'sourceRefs' not in c for d in report['dimensions'] for c in d['criteria']))
        self.assertTrue(all(d['sourceRefs'] for d in report['dimensions']))

    def test_core_grade_or_evidence_failure_still_rejects_whole_report(self):
        for mutate in (lambda r:r['dimensions'][0]['criteria'][0].update(level=5),lambda r:r['dimensions'][0].update(sourceRefs=['UNKNOWN']),lambda r:r.update(focusObjectIds=['C1'])):
            raw=raw_object();mutate(raw)
            with self.assertRaises(ValueError):report_object(raw=raw)

    def test_bad_action_is_isolated_sanitized_and_cannot_be_unlocked(self):
        raw=raw_object();bad=deepcopy(raw['suggestions'][0]);bad.update(objectId='E1',operationId='experience_restructure',sourceRefs=['UNKNOWN'],problem='UNVERIFIED CLAIM',direction='UNVERIFIED CLAIM')
        raw['suggestions'].append(bad)
        report=report_object(raw=raw)
        self.assertEqual(report['overallScore'],75);self.assertTrue(report['suggestions'][0]['editable'])
        self.assertEqual(report['reportStatus'],'partial');self.assertFalse(report['suggestions'][1]['editable'])
        self.assertNotIn('UNVERIFIED CLAIM',json.dumps(report));self.assertEqual(rubric.normalize(report),report)
        report['suggestions'][1]['editable']=True
        reread=rubric.normalize(report);self.assertFalse(reread['suggestions'][1]['editable'])
        report['selectedSuggestionIds']=['suggestion-2']
        with self.assertRaises(ValueError):simple_planner.targets(SimpleNamespace(evaluation=report,current_resume={}))

    def test_unknown_object_only_produces_count_not_untrusted_details(self):
        raw=raw_object();raw['suggestions'].append(dict(objectId='FOREIGN',problem='UNVERIFIED CLAIM'))
        report=report_object(raw=raw)
        self.assertEqual(len(report['suggestions']),1);self.assertEqual(report['unavailableSuggestionCount'],1)
        self.assertEqual(rubric.normalize(report),report);self.assertNotIn('UNVERIFIED CLAIM',json.dumps(report))

    def test_object_text_and_equivalent_star_distribution_are_preserved(self):
        a=snapshot();b=deepcopy(a);b['resume']['experiences'][0]['star']=dict(s='',t='',a='核查费用\n对账清单获采纳',r='')
        views=[]
        for d in (a,b):
            view=rubric.model_payload(d,'',rubric.source_catalog(d['resume']),rubric.modules_for(d['resume']),rubric.assessment_context(d,''))
            exp=next(o for o in view['objects'] if o['objectId']=='E1');views.append('\n'.join(x['text'] for x in exp['body']))
            self.assertNotIn('sources',view);self.assertNotIn('modules',view)
            self.assertEqual(json.dumps(view,ensure_ascii=False).count('对账清单获采纳'),1)
            self.assertIn('planned_education_end',json.dumps(view))
        self.assertEqual(views[0],views[1])

    def test_dates_only_compute_known_relationships(self):
        f=review_objects.date_facts
        self.assertEqual(f('2026-06','2026-07','2026-09-12')['relation'],'ended_before_assessment')
        self.assertEqual(f('2025-09','2028-06','2026-09-12',education=True)['relation'],'planned_education_end')
        self.assertEqual(f('2025-11','','2026-09-12')['relation'],'past_or_current_single_date_or_open_end')
        self.assertEqual(f('2026-09','2026-08','2026-09-12')['relation'],'start_after_end')
        self.assertEqual(f('2026-13','2026-08','2026-09-12')['relation'],'unknown')
        self.assertEqual(f('2026-09-31','','2026-09-12')['relation'],'unknown')

    def test_skill_specificity_and_confirmation_do_not_upgrade_known_boundaries(self):
        data=snapshot();data['resume']['skills']=[dict(id='stata',name='Stata基础分析',category='工具')]
        raw=raw_object(data);row=raw['suggestions'][0]
        row.update(objectId='K1',operationId='skill_text',sourceRefs=['K1'],relatedObjectIds=['E1'],skillFocus='methods',
            handling='organize',factGaps=[],direction='熟练使用PyTorch',selectedItems=[])
        report=report_object(data,raw);s=report['suggestions'][0]
        self.assertTrue(s['editable']);self.assertTrue(s['needsFacts'])
        self.assertIn('实际采用的方法',s['direction']);self.assertIn('费用审核实习',s['direction'])
        self.assertNotIn('PyTorch',s['direction']);self.assertEqual(s['factGaps'][0]['kind'],'skill_confirmation')

    def test_deterministic_copy_names_actual_certificate_and_sort_targets(self):
        data=snapshot();data['resume']['certifications']=[dict(id='c4',name='CET-4'),dict(id='c6',name='CET-6')]
        raw=raw_object(data);row=raw['suggestions'][0]
        row.update(objectId='C2',operationId='certification_hide',sourceRefs=['C2'],handling='organize',factGaps=[],problem='隐藏CET-4',direction='隐藏CET-4')
        report=report_object(data,raw);s=report['suggestions'][0]
        self.assertEqual(s['moduleId'],'c6');self.assertIn('CET-6',s['problem']);self.assertNotIn('CET-4',json.dumps(s,ensure_ascii=False))
        row.update(objectId='CERTS',operationId='certification_order',sourceRefs=['CERTS'],selectedItems=['C2','C1'])
        s=report_object(data,raw)['suggestions'][0]
        self.assertEqual(s['selectedItems'],['c6','c4']);self.assertIn('CET-6 → CET-4',s['direction'])

    async def test_live_entry_is_one_call_and_uses_current_protocol(self):
        call=AsyncMock(return_value={'content':json.dumps(raw_object())})
        with patch.object(resume_score,'_call_llm',call):
            report=(await resume_score.generate_review_score('',json.dumps(snapshot())))['resumeEvaluation']
        call.assert_awaited_once();self.assertEqual(report['metadata']['responseSchemaVersion'],rubric.RESPONSE_SCHEMA_VERSION)
        self.assertEqual(call.call_args.kwargs['gemini_thinking_level'],'medium')
        self.assertIn('objects',json.loads(call.call_args.args[0][1]['content']))

    async def test_balanced_protocol_uses_existing_atomic_apply_and_revert(self):
        import test_selection_actions_v4 as fixtures
        original=fixtures.data_and_report
        def balanced(kind,selected=(),needs_facts=False):
            data,old,context=original(kind,selected,needs_facts)
            raw=raw_object(data);row=raw['suggestions'][0];before=old['suggestions'][0]
            sources=rubric.source_catalog(data['resume']);objects=review_objects.catalog(sources,rubric.modules_for(data['resume']))
            obj=next(o for o in objects if o['actions'].get(kind)==before['targetId'])
            aliases,_=review_objects.references(sources,objects)
            row.update(objectId=obj['objectId'],operationId=kind,sourceRefs=[obj['objectId']],handling=before['handling'],
                factGaps=[dict(kind=g['kind'],reason=g['reason'],sourceRefs=[obj['objectId']]) for g in before['factGaps']],
                selectedItems=[next((o['objectId'] for o in objects if o['moduleId']==x),x) for x in before['selectedItems']])
            if kind=='skill_create':row.update(candidateText=before['candidateText'],candidateSourceRef=aliases[before['candidateSourceRef']])
            report=report_object(data,raw);report['selectedSuggestionIds']=['suggestion-1'];context.evaluation=report
            self.assertTrue(report['suggestions'][0]['editable'],report['suggestions'][0])
            return data,report,context
        with patch.object(fixtures,'data_and_report',side_effect=balanced):
            for name in ('test_deterministic_selection_never_calls_model','test_new_skill_requires_confirmed_user_fragments','test_apply_revert_all_new_operations_in_isolated_resume'):
                case=fixtures.SelectionActionTests(name)
                await getattr(case,name)()

    def test_short_and_literal_field_addresses_resolve_only_to_visible_fields(self):
        raw=raw_object();raw['dimensions'][0]['sourceRefs']=['E1.labelRef','E1.fields.E1.org']
        report=report_object(raw=raw)
        paths={s['sourceId']:s['path'] for s in report['sources']}
        self.assertEqual([paths[x] for x in report['dimensions'][0]['sourceRefs']],['resume.experiences[0].title','resume.experiences[0].org'])
        raw['dimensions'][0]['sourceRefs']=['E1.fields.not_provided']
        with self.assertRaises(ValueError):report_object(raw=raw)

    def test_direction_can_stand_alone_without_repeating_it_as_a_step(self):
        raw=raw_object();raw['suggestions'][0].pop('strategySteps')
        raw['suggestions'][0].update(handling='organize',factGaps=[])
        report=report_object(raw=raw)
        self.assertTrue(report['suggestions'][0]['editable']);self.assertEqual(report['suggestions'][0]['strategySteps'],[])

    def test_display_aliases_do_not_rewrite_real_licence_class_c1(self):
        data=snapshot();data['resume']['certifications']=[dict(id='english',name='CET-4'),dict(id='licence',name='驾驶证C1')]
        raw=raw_object(data);raw['summary']='E1的经历可保留，驾驶证C1无需更名。'
        raw['suggestions'][0].update(objectId='CERTS',operationId='certification_order',sourceRefs=['CERTS'],selectedItems=['C2','C1'],handling='organize',factGaps=[])
        report=report_object(data,raw)
        self.assertIn('费用审核实习',report['summary']);self.assertIn('驾驶证C1',report['summary'])
        self.assertIn('驾驶证C1 → CET-4',report['suggestions'][0]['direction'])
        self.assertNotIn('驾驶证CET-4',json.dumps(report,ensure_ascii=False))


if __name__=='__main__':unittest.main()
