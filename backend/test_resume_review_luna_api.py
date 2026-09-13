import json
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from jsonschema import Draft202012Validator
from test_object_review import raw_object, report_object, snapshot
from app.domain.ai import llm_transport as transport, resume_score, object_review, provider_review_schema as shapes
from app.domain.ai.public_errors import ResumeEvaluationIntegrityError


def settings():
    return SimpleNamespace(ai_route_profile='gemini_primary',ai_api_key='review-fixture-key',ai_base_url='https://review.invalid/v1',
        ai_model='gemini-3.5-flash-lite',ai_fast_api_key='unrelated-fast-key',ai_fast_base_url='https://fast.invalid/v1',
        ai_fast_model='unrelated-model',gemini_api_key='gemini-fixture-key',gemini_base_url='https://gemini.invalid/v1beta',
        gemini_model='gemini-3.5-flash-lite',ai_timeout_seconds=300)


def review_schema(data):
    sources=object_review.source_catalog(data['resume']);modules=object_review.modules_for(data['resume'])
    server=object_review.response_schema(sources,[],modules)
    payload=object_review.model_payload(data,'',sources,modules,object_review.assessment_context(data,''))
    return server,shapes.openai_review(server,payload)


def nullable_row(raw, strict):
    row=raw['suggestions'][0]
    for field in strict['properties']['suggestions']['items']['required']:row.setdefault(field,None)
    return raw


class LunaReviewTests(unittest.IsolatedAsyncioTestCase):
    def test_review_route_is_independent_and_blank_or_gemini_retains_rollback(self):
        with patch.object(transport,'settings',settings()):
            normal=transport._resolve_ai_route()
            review=transport._resolve_ai_route(lane=transport.LANE_RESUME_REVIEW,model='gpt-5.6-luna')
            self.assertEqual(normal.provider,'gemini')
            self.assertEqual(review.model,'gpt-5.6-luna')
            self.assertEqual(review.base_url,'https://review.invalid/v1')
            self.assertEqual(review.api_key,'review-fixture-key')
            self.assertEqual(transport._resolve_ai_route(lane=transport.LANE_RESUME_REVIEW),normal)
            self.assertEqual(transport._resolve_ai_route(lane=transport.LANE_RESUME_REVIEW,model='gemini-3.5-flash-lite'),normal)

    def test_strict_shape_keeps_business_enums_and_requires_nullable_optionals(self):
        data=snapshot()
        schema=object_review.response_schema(object_review.source_catalog(data['resume']),[],object_review.modules_for(data['resume']))
        schema,strict=review_schema(data)
        Draft202012Validator.check_schema(strict)
        self.assertEqual(strict['$defs']['fact_gap']['properties']['kind']['enum'],[k for k in object_review.history.FACT_QUESTIONS if k!='target_role'])
        def check(node):
            if isinstance(node,list):
                for item in node:check(item)
            elif isinstance(node,dict):
                self.assertNotIn('propertyOrdering',node)
                if node.get('type')=='object':
                    self.assertEqual(set(node['required']),set(node['properties']))
                    self.assertFalse(node['additionalProperties'])
                for value in node.values():check(value)
        check(strict)
        raw=nullable_row(raw_object(data),strict)
        self.assertTrue(Draft202012Validator(strict).is_valid(raw))
        restored=shapes.omit_optional_nulls(raw,schema)
        self.assertTrue(report_object(data,restored)['suggestions'][0]['editable'])
        self.assertIn('skillAction',raw['suggestions'][0])
        self.assertNotIn('skillAction',restored['suggestions'][0])

    def test_snapshot_action_grammar_rejects_low_failure_parameters(self):
        data=snapshot();server,strict=review_schema(data)
        good=nullable_row(raw_object(data),strict)
        validator=Draft202012Validator(strict)
        self.assertTrue(validator.is_valid(good))
        mutations=[
            lambda r:r.update(focusObjectIds=['S']),
            lambda r:r['suggestions'][0].update(selectedItems=['S.text']),
            lambda r:r['suggestions'][0].update(candidateSourceRef='S'),
            lambda r:r['suggestions'][0].update(relatedObjectIds=['ED1']),
            lambda r:r['suggestions'][0].update(operationId='UNKNOWN'),
            lambda r:r['suggestions'][0].update(objectId='UNKNOWN'),
        ]
        for mutate in mutations:
            bad=deepcopy(good);mutate(bad)
            self.assertFalse(validator.is_valid(bad),bad)
        self.assertTrue(report_object(data,shapes.omit_optional_nulls(good,server))['suggestions'][0]['editable'])
        # Flat provider grammar deliberately leaves operation relationships
        # to the server; candidate prose must still block an ordinary action.
        for fields in [dict(candidateText='参考改写'),dict(skillAction='add_tool'),dict(operationId='experience_restructure')]:
            bad=deepcopy(good);bad['suggestions'][0].update(fields)
            self.assertFalse(report_object(data,shapes.omit_optional_nulls(bad,server))['suggestions'][0]['editable'])

    def test_choice_options_are_snapshot_bound_and_empty_courses_explicit(self):
        data=snapshot();data['resume']['educations'][0].update(id='edu1',courses='统计学、体育')
        server,strict=review_schema(data);validator=Draft202012Validator(strict)
        raw=raw_object(data);raw['suggestions'][0].update(objectId='ED1',operationId='education_courses',sourceRefs=['ED1'],handling='organize',factGaps=[],selectedItems=[])
        nullable_row(raw,strict)
        self.assertTrue(validator.is_valid(raw))
        self.assertTrue(report_object(data,shapes.omit_optional_nulls(raw,server))['suggestions'][0]['editable'])
        for value in [None,['ED1.courses'],['course-foreign']]:
            bad=deepcopy(raw);bad['suggestions'][0]['selectedItems']=value
            self.assertFalse(validator.is_valid(bad))
        raw['suggestions'][0]['selectedItems']=['course-1']
        self.assertTrue(validator.is_valid(raw))
        self.assertTrue(report_object(data,shapes.omit_optional_nulls(raw,server))['suggestions'][0]['editable'])

    def test_no_experiences_has_empty_focus_without_empty_enum(self):
        data=snapshot();data['resume']['experiences']=[]
        _,strict=review_schema(data)
        raw=nullable_row(raw_object(data),strict)
        self.assertTrue(Draft202012Validator(strict).is_valid(raw))
        self.assertEqual(strict['properties']['focusObjectIds']['maxItems'],0)
        self.assertNotIn('"enum": []',json.dumps(strict))

    def test_all_snapshot_actions_remain_available_to_business_normalization(self):
        data=snapshot()
        data['resume']['experiences'][0]['star']['a']='使用Excel整理记录'
        data['resume']['educations'][0].update(id='edu1',courses='统计学、体育')
        data['resume']['skills']=[dict(id='skill1',name='Excel基础',category='数据整理')]
        data['resume']['certifications']=[dict(id='cert1',name='校级荣誉')]
        server,strict=review_schema(data);validator=Draft202012Validator(strict)
        self.assertEqual(next(iter(strict['properties'])),'focusObjectIds')
        sources=object_review.source_catalog(data['resume']);modules=object_review.modules_for(data['resume'])
        payload=object_review.model_payload(data,'',sources,modules,object_review.assessment_context(data,''))
        self.assertEqual(list(strict['properties']['suggestions']['items']['properties'])[:2],['objectId','operationId'])
        for obj in payload['objects']:
            identity=obj['objectId']
            for action in obj['actions']:
                operation=action['operationId']
                with self.subTest(operation=operation,object=identity):
                    raw=raw_object(data);row=raw['suggestions'][0]
                    row.update(objectId=identity,operationId=operation,sourceRefs=[identity],handling='organize',factGaps=[],selectedItems=[])
                    nullable_row(raw,strict)
                    row['selectedItems']=[x['id'] for x in action.get('options',[])]
                    if operation=='manual':row['handling']='manual_review'
                    if operation=='skills_order':row['skillAction']='reorder'
                    if operation=='skill_create':row.update(candidateText='Excel',candidateSourceRef=identity+'.star.a',skillAction='add_tool')
                    self.assertTrue(validator.is_valid(raw),list(validator.iter_errors(raw)))
                    report=report_object(data,shapes.omit_optional_nulls(raw,server))
                    self.assertEqual(report['reportStatus'],'complete',report['suggestions'])

    def test_provider_grammar_does_not_replace_factual_source_validation(self):
        data=snapshot();server,strict=review_schema(data)
        raw=nullable_row(raw_object(data),strict)
        raw['suggestions'][0].update(objectId='E1',operationId='star.r',sourceRefs=['ED1'])
        self.assertTrue(Draft202012Validator(strict).is_valid(raw))
        report=report_object(data,shapes.omit_optional_nulls(raw,server))
        self.assertEqual(report['reportStatus'],'partial')
        self.assertFalse(report['suggestions'][0]['editable'])

    def test_all_evidence_addresses_and_jd_namespace_are_bounded(self):
        data=snapshot();_,strict=review_schema(data)
        for mutate in [lambda r:r['dimensions'][0].update(sourceRefs=['E1.not_provided']),
                       lambda r:r['strengths'][0].update(sourceRefs=['FOREIGN']),
                       lambda r:r['suggestions'][0]['factGaps'][0].update(sourceRefs=['S.fake']),
                       lambda r:r['dimensions'][0].update(jdSourceRefs=['JD'])]:
            raw=nullable_row(raw_object(data),strict);mutate(raw)
            self.assertFalse(Draft202012Validator(strict).is_valid(raw))

    def test_known_target_is_excluded_but_missing_target_can_be_asked(self):
        data=snapshot();_,strict=review_schema(data)
        raw=nullable_row(raw_object(data),strict)
        raw['suggestions'][0]['factGaps']=[dict(kind='target_role',reason='确认方向',sourceRefs=['S'])]
        self.assertFalse(Draft202012Validator(strict).is_valid(raw))
        data['target_role']='';_,strict=review_schema(data)
        self.assertTrue(Draft202012Validator(strict).is_valid(raw))

    def test_null_selection_cannot_clear_courses_and_required_null_stays_invalid(self):
        data=snapshot();data['resume']['educations'][0].update(id='edu1',courses='统计学、体育')
        schema=object_review.response_schema(object_review.source_catalog(data['resume']),[],object_review.modules_for(data['resume']))
        raw=raw_object(data);raw['suggestions'][0].update(objectId='ED1',operationId='education_courses',sourceRefs=['ED1'],handling='organize',factGaps=[],selectedItems=None)
        report=report_object(data,shapes.omit_optional_nulls(raw,schema))
        self.assertFalse(report['suggestions'][0]['editable'])
        raw=raw_object(data);raw['summary']=None
        self.assertIsNone(shapes.omit_optional_nulls(raw,schema)['summary'])
        with self.assertRaises(ValueError):report_object(data,shapes.omit_optional_nulls(raw,schema))

    async def exercise(self, *, effort='medium', status=200, body=None):
        data=snapshot();requests=[];real_client=httpx.AsyncClient
        async def handler(request):
            requests.append(request)
            payload=json.loads(request.content)
            if status!=200:return httpx.Response(status,json={'error':{'message':'Fixture schema unsupported'}})
            raw=nullable_row(raw_object(data),payload['response_format']['json_schema']['schema'])
            return httpx.Response(200,json={'model':'gpt-5.6-luna','choices':[{'message':{'content':body if body is not None else json.dumps(raw)},'finish_reason':'stop'}],
                'usage':{'prompt_tokens':10,'completion_tokens':10,'total_tokens':20}})
        def factory(*args,**kwargs):return real_client(*args,**kwargs,transport=httpx.MockTransport(handler))
        with patch.object(transport,'settings',settings()),patch.object(transport.httpx,'AsyncClient',factory):
            if status!=200:
                with self.assertRaises(httpx.HTTPStatusError):
                    await resume_score.generate_review_score('',json.dumps(data),model='gpt-5.6-luna',thinking_level=effort)
                result=None
            elif body is not None:
                with self.assertRaises(ResumeEvaluationIntegrityError):
                    await resume_score.generate_review_score('',json.dumps(data),model='gpt-5.6-luna',thinking_level=effort)
                result=None
            else:
                result=await resume_score.generate_review_score('',json.dumps(data),model='gpt-5.6-luna',thinking_level=effort)
        self.assertEqual(len(requests),1)
        sent=json.loads(requests[0].content)
        self.assertEqual(str(requests[0].url),'https://review.invalid/v1/chat/completions')
        self.assertEqual(sent['model'],'gpt-5.6-luna')
        self.assertEqual(sent['reasoning_effort'],effort)
        self.assertNotIn('temperature',sent)
        self.assertTrue(sent['response_format']['json_schema']['strict'])
        if result:
            report=result['resumeEvaluation']
            self.assertEqual(report['metadata']['model'],'gpt-5.6-luna')
            self.assertEqual(report['metadata']['reasoning'],{'reasoning_effort':effort})
            self.assertEqual(report['metadata']['providerSchemaVersion'],shapes.OPENAI_VERSION)
            self.assertEqual(report['reportStatus'],'complete')

    async def test_full_review_sends_one_native_schema_request_with_matching_effort(self):
        for effort in ['low','medium','high']:
            with self.subTest(effort=effort):await self.exercise(effort=effort)

    async def test_unsupported_schema_never_retries_or_falls_back_to_gemini(self):
        await self.exercise(status=400)

    async def test_provider_ignoring_schema_is_rejected_without_repair(self):
        await self.exercise(body='## A Markdown report instead of JSON')


if __name__=='__main__':unittest.main()
