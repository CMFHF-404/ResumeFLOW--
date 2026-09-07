import copy
import unittest

from app.domain.ai.resume_evaluation_basis import build_basis_contract, materialize_basis
from app.domain.ai.resume_evaluation import DIMENSION_SUBSCORES


def fixture():
    facts = [{'fact_id':f'F{i}', 'source':f'resume.experiences[{i}].star.a',
              'content':'访谈客户并编写需求说明。', 'verification_status':'user_claimed'} for i in range(2)]
    facts.append({'fact_id':'S', 'source':'resume.personal_summary', 'content':'从事产品需求与交付工作。', 'verification_status':'user_claimed'})
    data = {'resume':{'experiences':[{'star':{'a':f['content']}} for f in facts[:2]],'personal_summary':facts[-1]['content']}, 'fact_metadata':facts}
    names = list(dict(dict(DIMENSION_SUBSCORES)['专业表达']))
    report = {'resumeEvaluation':{'dimensions':[
        {'dimension':'专业表达','subscores':[{'name':n,'score':0,'maxScore':20,'evidenceIds':[],'deductionIssueId':''} for n in names]},
        {'dimension':'内容完整','subscores':[{'name':'求职方向','score':0,'maxScore':10,'evidenceIds':[],'deductionIssueId':''}]},
        {'dimension':'内容可读','subscores':[{'name':'语法与自然度','score':10,'maxScore':15,'evidenceIds':[],'deductionIssueId':''}]},
        {'dimension':'STAR应用','subscores':[{'name':name,'score':20,'maxScore':maximum,'evidenceIds':[],'deductionIssueId':''}
            for name,maximum in dict(DIMENSION_SUBSCORES)['STAR应用']]},
    ],'evidence':[]}}
    report['evidenceBasis'] = {'professional':{f'EXP_{i+1:03d}':{
        n:{'assessment':'met','factIds':[f'F{i}'],'reason':'具体动作及对象明确，术语准确且责任客观。'} for n in names} for i in range(2)},
        'direction':{'level':'function','factIds':['S'],'reason':'总结明确产品需求与交付职能。'},
        'grammar':{'punctuation':{},'otherDefect':{'kind':'none','score':15,'factIds':[],'reason':'无其他语法错误。'}}}
    report['evidenceBasis']['star']={f'EXP_{i+1:03d}':{name:{'assessment':'concrete_action' if name=='Action行动' else 'absent',
        'factIds':[f'F{i}'] if name=='Action行动' else [],'reason':'动作明确，未提供其他要素。'}
        for name,_ in dict(DIMENSION_SUBSCORES)['STAR应用']} for i in range(2)}
    return report, data


class BasisTests(unittest.IsolatedAsyncioTestCase):
    def test_star_generic_role_and_missing_facts_do_not_receive_substantive_credit(self):
        report,data=fixture()
        names=[name for name,_ in dict(DIMENSION_SUBSCORES)['STAR应用']]
        report['evidenceBasis']['star']={key:{name:{'assessment':'generic_role_only' if name=='Action行动' else 'absent',
            'factIds':[f'F{i}'] if name=='Action行动' else [],'reason':'只有泛化职能表述，其他要素缺失。'}
            for name in names} for i,key in enumerate(['EXP_001','EXP_002'])}
        for fact in data['fact_metadata'][:2]:fact['content']='参与产品工作，负责相关工作。'
        result=materialize_basis(report,data)
        star=next(d for d in result['resumeEvaluation']['dimensions'] if d['dimension']=='STAR应用')
        self.assertEqual([s['score'] for s in star['subscores']],[0,0,10,0])
        self.assertEqual([s['score'] for s in report['resumeEvaluation']['dimensions'][-1]['subscores']],[20]*4)

    def test_professional_assessment_encodes_level_and_defect_as_one_choice(self):
        _,data=fixture()
        schema,_=build_basis_contract(data)
        row=schema['properties']['professional']['properties']['EXP_001']['properties']['行动动词']
        self.assertEqual(set(row['properties']),{'assessment','factIds','reason'})
        choices=row['properties']['assessment']['enum']
        self.assertIn('met',choices)
        self.assertIn('minor:vague_action',choices)
        self.assertNotIn('met:vague_action',choices)
        self.assertNotIn('minor:none',choices)

    def test_server_derives_scores_from_complete_evidence_assessments(self):
        report, data = fixture(); original = copy.deepcopy(report)
        result = materialize_basis(report,data)
        self.assertNotIn('evidenceBasis',result)
        self.assertEqual(report,original)
        self.assertEqual([s['score'] for s in result['resumeEvaluation']['dimensions'][0]['subscores']],[20]*5)
        self.assertEqual(result['resumeEvaluation']['dimensions'][1]['subscores'][0]['score'],10)
        self.assertTrue(all(s['evidenceIds'] for d in result['resumeEvaluation']['dimensions'] for s in d['subscores'] if s['score']>0))

    def test_one_field_has_per_experience_scores_and_half_up_average(self):
        report,data=fixture()
        row=report['evidenceBasis']['professional']['EXP_002']['行动动词']
        row.update(assessment='minor:vague_action',reason='一处行动对象不够具体。')
        result=materialize_basis(report,data)
        self.assertEqual(result['resumeEvaluation']['dimensions'][0]['subscores'][0]['score'],18)

    def test_missing_target_unknown_fact_and_cross_experience_fact_rejected(self):
        for mode in ('missing','unknown','cross','conflicting_level'):
            report,data=fixture()
            if mode=='missing':report['evidenceBasis']['professional'].pop('EXP_002')
            else:
                row=report['evidenceBasis']['professional']['EXP_001']['行动动词']
                if mode=='unknown':row['factIds']=['UNKNOWN']
                if mode=='cross':row['factIds']=['F1']
                if mode=='conflicting_level':row['assessment']='met:vague_action'
            with self.subTest(mode=mode), self.assertRaises(ValueError):materialize_basis(report,data)

    def test_malformed_report_containers_are_contract_failures(self):
        for field, value in [('evidence',[None]),('dimensions',[None]),('issues',[None]),('riskFlags',None)]:
            report,data=fixture();report['resumeEvaluation'][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):materialize_basis(report,data)

    def test_unsupported_credential_or_external_target_cannot_supply_direction(self):
        report,data=fixture()
        report['evidenceBasis']['direction']['factIds']=['F0']
        with self.assertRaises(ValueError):materialize_basis(report,data)

    def test_basis_diagnostic_reports_rule_without_model_values(self):
        from app.domain.ai.resume_evaluation_service import _validation_diagnostic
        report,data=fixture()
        report['evidenceBasis']['direction']['factIds']=['private-unknown-provider-value']
        with self.assertRaises(ValueError) as caught:materialize_basis(report,data)
        code,path=_validation_diagnostic(caught.exception)
        self.assertEqual(code,'basis_out_of_scope_fact_reference')
        self.assertEqual(path,'resumeEvaluation.evidenceBasis')
        self.assertNotIn('private',str(caught.exception))
        self.assertEqual(_validation_diagnostic(ValueError('resumeEvaluation.dimensions.subscores full score has deduction'))[0],
                         'deduction_full_score_has_issue')
        report,data=fixture();data['fact_metadata'][-1]['verification_status']='unverified'
        with self.assertRaises(ValueError):materialize_basis(report,data)

    def test_dynamic_schema_fixes_targets_criteria_and_fact_scope(self):
        _,data=fixture();schema,payload=build_basis_contract(data)
        self.assertEqual(schema['properties']['professional']['required'],['EXP_001','EXP_002'])
        row=schema['properties']['professional']['properties']['EXP_001']['properties']['行动动词']
        self.assertEqual(row['properties']['factIds']['items']['enum'],['F0'])
        self.assertEqual(payload['professional']['EXP_001'][0]['factId'],'F0')

    def test_existing_excerpt_is_preserved_but_broken_reference_is_not_repaired(self):
        report,data=fixture()
        e={'evidenceId':'E1','factId':'F0','sourceText':'访谈客户','location':'resume.experiences[0].star.a',
           'verificationStatus':'user_claimed','supportedDimensions':['专业表达']}
        report['resumeEvaluation']['evidence']=[e]
        result=materialize_basis(report,data)
        self.assertEqual(result['resumeEvaluation']['evidence'][0],e)
        self.assertTrue(any(x['sourceText']==data['fact_metadata'][0]['content'] for x in result['resumeEvaluation']['evidence']))
        report['resumeEvaluation']['evidence'][0]['sourceText']='无来源的工作事实'
        with self.assertRaises(ValueError):materialize_basis(report,data)
        report,data=fixture()
        report['resumeEvaluation']['dimensions'][0]['subscores'][0]['evidenceIds']=['NONEXISTENT']
        with self.assertRaises(ValueError):materialize_basis(report,data)

    async def test_generation_sends_unambiguous_private_contract_without_extra_call(self):
        from unittest.mock import patch, AsyncMock
        from app.domain.ai import resume_evaluation_service as service
        import json
        _,data=fixture()
        with patch.object(service,'_call_llm',AsyncMock(side_effect=RuntimeError('stop before generation'))) as model:
            with self.assertRaises(RuntimeError):
                await service._analyze_resume_evaluation_once('',json.dumps({'evaluation_scope':'full_resume',**data}),_repair=False,_evidence_basis=True)
        self.assertEqual(model.await_count,1)
        prompt=model.call_args.args[0][0]['content']
        self.assertNotIn('a single top-level key',prompt)
        self.assertEqual(model.call_args.kwargs['gemini_response_json_schema']['required'],['evidenceBasis','resumeEvaluation'])

    async def test_complete_generation_calibration_keeps_private_basis_out_of_public_report(self):
        import json
        from pathlib import Path
        from unittest.mock import patch, AsyncMock
        from app.domain.ai import resume_evaluation_service as service
        from qa_resume_blind_benchmark import JD, ROLE
        source=Path(__file__).resolve().parents[1]/'docs/qa/2026-09-06-resume-blind-v4accept20260907b'
        read=lambda name:json.loads((source/name).read_text(encoding='utf-8'))
        sample=next(s for s in read('fixtures.json')['samples'] if s['id']=='R8P4')
        resume_text=json.dumps({'evaluation_scope':'full_resume','target_role':ROLE,'resume':sample['resume']},ensure_ascii=False)
        data=service._build_full_resume_evaluation_input(JD,resume_text)
        raw=copy.deepcopy(read('baseline-R8P4-2.json')['value'])
        for dimension in raw['resumeEvaluation']['dimensions']:
            for sub in dimension['subscores']:
                if sub['score'] < sub['maxScore']:
                    self.assertEqual(len(dimension['issues']),1)
                    sub['deductionIssueId']=dimension['issues'][0]
                else:
                    sub['deductionIssueId']=''
        _,targets=build_basis_contract(data)
        facts={f['fact_id']:f for f in data['fact_metadata']}
        professional={}
        for identity,entries in targets['professional'].items():
            fact=next(e['factId'] for e in entries if facts[e['factId']]['source'].endswith('.star.a'))
            professional[identity]={name:{'assessment':'met','factIds':[fact],'reason':'当前行动与对象明确，表述准确且客观。'}
                                    for name in dict(dict(DIMENSION_SUBSCORES)['专业表达'])}
        direction=next(e['factId'] for e in targets['direction'] if facts[e['factId']]['source']=='resume.personal_summary')
        raw['evidenceBasis']={'professional':professional,'direction':{'level':'function','factIds':[direction],'reason':'简历内总结与岗位明确指向产品职能。'}}
        raw['evidenceBasis']['grammar']={'punctuation':{},'otherDefect':{'kind':'none','score':15,'factIds':[],'reason':'无语法错误。'}}
        raw['evidenceBasis']['star']={identity:{name:{'assessment':assessment,
            'factIds':[next(e['factId'] for e in entries if facts[e['factId']]['source'].endswith('.star.'+field))],
            'reason':'该要素在当前经历的原文中完整提供。'}
            for name,field,assessment in [('Situation情境','s','clear_context'),('Task任务','t','clear_task'),
                                         ('Action行动','a','concrete_action'),('Result结果','r','clear_result')]}
            for identity,entries in targets['professional'].items()}
        with patch.object(service,'_call_llm',AsyncMock(return_value=raw)) as model:
            result=await service._analyze_resume_evaluation_once(JD,resume_text,_repair=False,_evidence_basis=True)
        self.assertEqual(model.await_count,1)
        self.assertEqual(result['resumeEvaluation']['overallScore'],100)
        self.assertEqual(set(result),{'resumeEvaluation'})
        self.assertNotIn('evidenceBasis',result['resumeEvaluation'])
        # This tests arithmetic/graph sequencing only; the independent auditor
        # still has to determine whether this model-declared risk is supported.
        summary_ref=next(e['evidenceId'] for e in raw['resumeEvaluation']['evidence']
                         if e['location']=='resume.personal_summary')
        raw['resumeEvaluation']['riskFlags'].append({'type':'exaggerated_claim',
            'description':'模型声明的风险，语义依据另行审核。','evidenceIds':[summary_ref]})
        with patch.object(service,'_call_llm',AsyncMock(return_value=raw)) as model:
            capped=await service._analyze_resume_evaluation_once(JD,resume_text,_repair=False,_evidence_basis=True)
        self.assertEqual(model.await_count,1)
        prof=next(d for d in capped['resumeEvaluation']['dimensions'] if d['dimension']=='专业表达')
        self.assertEqual(prof['score'],80)
        self.assertEqual(capped['resumeEvaluation']['overallScore'],96)
        self.assertEqual(capped['resumeEvaluation']['scoreCalculation']['dimensionSum'],
                         result['resumeEvaluation']['scoreCalculation']['dimensionSum']-20)
        self.assertEqual(sum(i['pointsNotEarned'] for i in capped['resumeEvaluation']['issues']
                             if i['issueId'] in prof['issues']),20)

    def test_punctuation_only_marks_are_counted_not_freely_graded(self):
        report,data=fixture()
        data['fact_metadata'][0]['content']='访谈客户<br>整理需求'
        schema,targets=build_basis_contract(data)
        punctuation=targets['grammar']['punctuation']
        self.assertEqual(len(punctuation),2)
        report['evidenceBasis']['grammar']['punctuation']={key:'prose' for key in punctuation}
        result=materialize_basis(report,data)
        self.assertEqual(result['resumeEvaluation']['dimensions'][2]['subscores'][0]['score'],13)
        report['evidenceBasis']['grammar']['otherDefect']['score']=10
        with self.assertRaises(ValueError):materialize_basis(report,data)

    def test_label_classification_and_actual_grammar_defect_remain_distinct(self):
        report,data=fixture();data['fact_metadata'][0]['content']='技能清单'
        _,targets=build_basis_contract(data)
        report['evidenceBasis']['grammar']['punctuation']={key:'label_or_fragment' for key in targets['grammar']['punctuation']}
        result=materialize_basis(report,data)
        self.assertEqual(result['resumeEvaluation']['dimensions'][2]['subscores'][0]['score'],15)
        report['evidenceBasis']['grammar']['otherDefect']={'kind':'grammar_error','score':12,'factIds':['F1'],'reason':'指出另一个引用文本中的具体语法错误。'}
        result=materialize_basis(report,data)
        self.assertEqual(result['resumeEvaluation']['dimensions'][2]['subscores'][0]['score'],12)

    def test_rich_text_punctuation_cap_and_already_normalized_text(self):
        from app.domain.resume_optimization.normalizers import normalize_action_paragraph_endings
        report,data=fixture()
        content='<p><strong>访谈客户</strong></p><p>整理需求</p><p>提交方案</p><p>完成验收</p>'
        data['fact_metadata'][0]['content']=content
        _,targets=build_basis_contract(data)
        report['evidenceBasis']['grammar']['punctuation']={key:'prose' for key in targets['grammar']['punctuation']}
        result=materialize_basis(report,data)
        self.assertEqual(result['resumeEvaluation']['dimensions'][2]['subscores'][0]['score'],12)
        self.assertEqual(data['fact_metadata'][0]['content'],content)
        data['fact_metadata'][0]['content']=normalize_action_paragraph_endings(content)
        _,targets=build_basis_contract(data)
        self.assertEqual(targets['grammar']['punctuation'],{})

    def test_star_qualitative_result_in_action_preserves_attribution_and_scope(self):
        report,data=fixture()
        content='访谈客户并提交需求说明；上线后三周该方案通过业务方验收，同期培训可能共同影响试用，个人仅负责需求整理。'
        data['fact_metadata'][0]['content']=content
        report['evidenceBasis']['star']['EXP_001']['Result结果']={
            'assessment':'clear_result','factIds':['F0'],'reason':'已通过验收的定性成果，保留观察期、同期干预和个人范围。'}
        result=materialize_basis(report,data)
        sub=next(d for d in result['resumeEvaluation']['dimensions'] if d['dimension']=='STAR应用')['subscores'][3]
        self.assertEqual(sub['score'],18)  # (35 + 0) / 2, half up
        self.assertTrue(any(e['sourceText']==content for e in result['resumeEvaluation']['evidence'] if e['evidenceId'] in sub['evidenceIds']))
        report['evidenceBasis']['star']['EXP_002']['Result结果']={
            'assessment':'clear_result','factIds':['F0'],'reason':'跨经历借用成果。'}
        with self.assertRaises(ValueError):materialize_basis(report,data)

    def test_star_requires_complete_components_and_supported_assessments(self):
        for invalid in ('missing','unknown','positive_without_evidence'):
            report,data=fixture();rows=report['evidenceBasis']['star']['EXP_001']
            if invalid=='missing':rows.pop('Result结果')
            if invalid=='unknown':rows['Action行动']['assessment']='arbitrary_20_points'
            if invalid=='positive_without_evidence':rows['Action行动']['factIds']=[]
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):materialize_basis(report,data)

    def test_exaggeration_cap_precedes_deduction_binding_without_discarding_issues(self):
        report,data=fixture()
        report['resumeEvaluation']['evidence']=[{'evidenceId':'SUMMARY','factId':'S',
            'sourceText':data['fact_metadata'][-1]['content'],'location':'resume.personal_summary',
            'verificationStatus':'user_claimed','supportedDimensions':['专业表达']}]
        report['resumeEvaluation']['riskFlags']=[{'type':'exaggerated_claim','description':'声明夸大风险，真实性仍需独立审核。','evidenceIds':['SUMMARY']}]
        report['resumeEvaluation']['issues']=[]
        result=materialize_basis(report,data)['resumeEvaluation']
        objective=result['dimensions'][0]['subscores'][-1]
        self.assertEqual(objective['score'],0)
        issue=next(i for i in result['issues'] if i['issueId']==objective['deductionIssueId'])
        self.assertEqual(issue['evidenceIds'],['SUMMARY'])
        self.assertEqual(issue['pointsNotEarned'],20)
        report['resumeEvaluation']['dimensions'][0]['subscores'][-1]['deductionIssueId']='EXISTING'
        report['resumeEvaluation']['issues']=[{'issueId':'EXISTING','primaryDimension':'专业表达',
            'description':'原有夸大问题','evidenceIds':['SUMMARY'],'pointsNotEarned':20}]
        result=materialize_basis(report,data)['resumeEvaluation']
        self.assertEqual(len(result['issues']),1)
        self.assertEqual(result['dimensions'][0]['subscores'][-1]['deductionIssueId'],'EXISTING')
