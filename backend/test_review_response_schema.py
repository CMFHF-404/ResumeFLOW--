import unittest
from copy import deepcopy
from jsonschema import Draft202012Validator

from test_resume_review_v4 import raw_v4,report_v4,snapshot
from app.domain.ai import evidence_rubric_v2 as rubric


def schema_and_response(jd=''):
    data=snapshot();sources=rubric.source_catalog(data['resume'],jd)
    inventory=rubric.review_inventory(data['resume'],sources)
    schema=rubric.response_schema(sources,inventory,rubric.modules_for(data['resume']))
    raw=raw_v4(data,jd);raw.pop('reviewCoverage')
    for row in raw['suggestions']:
        row.pop('dimensionId',None);row.pop('needsFacts',None);row['jdSourceRefs']=[]
        for gap in row['factGaps']:gap.pop('question',None)
    for row in raw['strengths']:row['jdSourceRefs']=[]
    for d in raw['dimensions']:
        for c in d['criteria']:c['jdSourceRefs']=[]
    return schema,raw,sources


class ReviewResponseSchemaTests(unittest.TestCase):
    def test_provider_grammar_is_small_but_server_still_rejects_unknown_evidence(self):
        import json
        from app.domain.ai.provider_review_schema import compact
        schema,raw,sources=schema_and_response()
        small=compact(schema);Draft202012Validator.check_schema(small)
        self.assertTrue(Draft202012Validator(small).is_valid(raw))
        self.assertLess(len(json.dumps(small)),len(json.dumps(schema))//2)
        raw['dimensions'][0]['criteria'][0]['sourceRefs']=['src_not_real']
        self.assertTrue(Draft202012Validator(small).is_valid(raw))
        data=snapshot()
        with self.assertRaises(ValueError):rubric.normalize(raw,sources=sources,modules=rubric.modules_for(data['resume']),
            context=rubric.assessment_context(data,''),metadata=report_v4()['metadata'],inventory=rubric.review_inventory(data['resume'],sources))
    def test_prompt_example_has_every_required_top_level_field(self):
        import json
        prompt=rubric.prompt();start=prompt.index('{"expressionPlan":')
        example,_=json.JSONDecoder().raw_decode(prompt[start:])
        schema,_,_=schema_and_response()
        self.assertEqual(set(example),set(schema['required']))
        self.assertEqual({a['aspect'] for a in example['metricReview'][0]['aspects']},set(rubric.review_actions.METRIC_ASPECTS))
    def test_schema_accepts_full_response_and_rejects_contract_mistakes_before_normalization(self):
        schema,raw,sources=schema_and_response('JD context')
        Draft202012Validator.check_schema(schema)
        validator=Draft202012Validator(schema)
        self.assertTrue(validator.is_valid(raw),list(validator.iter_errors(raw)))
        for mutation in [lambda r:r['suggestions'][0].update(action='invent_action'),
                         lambda r:r['suggestions'][0].update(targetId='arbitrary_target'),
                         lambda r:r['reviewChecks'].pop(),
                         lambda r:r['reviewChecks'][1].update(sourceRefs=[sources[0]['sourceId']]),
                         lambda r:r['dimensions'][0]['criteria'][0].update(level=4,anchorId='logic_1:L4'),
                         lambda r:r['suggestions'][0].update(handling='organize'),
                         lambda r:r['suggestions'][0].update(strategySteps=[])]:
            bad=deepcopy(raw);mutation(bad)
            self.assertFalse(validator.is_valid(bad))
        jd_id=next(s['sourceId'] for s in sources if s['path']=='jd')
        raw['dimensions'][0]['criteria'][0]['sourceRefs']=[jd_id]
        self.assertFalse(validator.is_valid(raw))

    def test_new_suggestions_need_steps_but_old_reports_remain_readable(self):
        r=report_v4();r['suggestions'][0]['strategySteps']=[]
        with self.assertRaises(ValueError):rubric.normalize(r)
        r=report_v4();r['metadata'].pop('responseSchemaVersion')
        for row in r['suggestions']:row.pop('strategySteps')
        self.assertEqual(rubric.normalize(r)['overallScore'],r['overallScore'])

    def test_new_fact_questions_are_neutral_server_templates(self):
        r=report_v4();gap=r['suggestions'][0]['factGaps'][0]
        gap['kind']='award_details';gap['question']='是否获得过全国一等奖？'
        result=rubric.normalize(r)
        self.assertEqual(result['suggestions'][0]['factGaps'][0]['question'],rubric.FACT_QUESTIONS['award_details'])
        self.assertNotIn('一等奖',result['suggestions'][0]['factGaps'][0]['question'])
        r['suggestions'][0]['recommendationKind']='enhance'
        with self.assertRaises(ValueError):rubric.normalize(r)
        r['suggestions'][0]['severity']='low'
        self.assertEqual(rubric.normalize(r)['overallScore'],r['overallScore'])

    def test_awards_review_includes_honors_found_in_skill_section(self):
        data=snapshot();sources=rubric.source_catalog(data['resume'])
        award=next(c for c in rubric.review_inventory(data['resume'],sources) if c['checkId']=='awards_credentials')
        path_by_id={s['sourceId']:s['path'] for s in sources}
        self.assertIn('resume.skills',[path_by_id[x] for x in award['scopeRefs']])


if __name__=='__main__':unittest.main()
