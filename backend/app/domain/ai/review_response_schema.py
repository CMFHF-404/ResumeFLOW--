"""Provider-side shape constraints for one review response; no content audits."""
from copy import deepcopy

VERSION = 'review_json_schema_v4'


def build_response_schema(sources, inventory, dimensions, actions, evidence_states, gap_kinds):
    definitions = {}
    ref_cache = {}
    string = {'type':'string'}
    def enum(values):return dict(type='string',enum=list(values))
    def obj(properties):
        return dict(type='object',properties={k:deepcopy(v) for k,v in properties.items()},required=list(properties),additionalProperties=False,
                    propertyOrdering=list(properties))
    def array(items,minimum=0,maximum=None):
        result=dict(type='array',items=items,minItems=minimum)
        if maximum is not None:result['maxItems']=maximum
        return result
    def fixed(items):return dict(type='array',prefixItems=items,minItems=len(items),maxItems=len(items))
    def reference_array(ids,required=False):
        key=(tuple(ids),required)
        if key not in ref_cache:
            name=f'references_{len(ref_cache)+1}'
            definitions[name]=array(enum(ids) if ids else string,1 if required else 0,None if ids else 0)
            ref_cache[key]=name
        return {'$ref':f'#/$defs/{ref_cache[key]}'}
    resume_sources=[s for s in sources if s['path']!='jd']
    all_refs=reference_array([s['sourceId'] for s in resume_sources],True)
    jd_refs=reference_array([s['sourceId'] for s in sources if s['path']=='jd'])
    criteria_ids=[f'{d}_{i+1}' for d,_,_,_ in dimensions for i in range(3)]
    definitions['fact_gap']=obj(dict(kind=enum(gap_kinds),reason=string,sourceRefs=all_refs))
    suggestion=obj(dict(diagnosticId=string,targetId=string,primaryCriterionId=enum(criteria_ids),
        severity=enum(['high','medium','low']),evidenceState=enum(evidence_states),sourceRefs=all_refs,jdSourceRefs=jd_refs,
        problem=string,impact=string,action=enum(actions),recommendationKind=enum(['fix','enhance']),direction=string,strategySteps=array(string,1,4),
        handling=enum(['organize','ask_user','manual_review']),factGaps=array({'$ref':'#/$defs/fact_gap'})))
    suggestion['anyOf']=[
        {'properties':{'handling':enum(['organize']),'action':enum([a for a in actions if a not in ('ask','verify')]),'factGaps':array({'$ref':'#/$defs/fact_gap'},0,0)}},
        {'properties':{'handling':enum(['ask_user']),'action':enum([a for a in actions if a!='verify']),'factGaps':array({'$ref':'#/$defs/fact_gap'},1)}},
        {'properties':{'handling':enum(['manual_review']),'action':enum([a for a in actions if a!='ask'])}},
    ]
    suggestion['anyOf']=[{'properties':dict(branch['properties'],recommendationKind=enum([kind]),severity=enum(['low'] if kind=='enhance' else ['high','medium','low']))}
                         for branch in suggestion['anyOf'] for kind in ('fix','enhance')]
    checks=[]
    by_id={s['sourceId']:s for s in sources}
    for item in inventory:
        paths=[by_id[x]['path'] for x in item['scopeRefs']]
        allowed=[s['sourceId'] for s in resume_sources if any(s['path']==p or s['path'].startswith(p+'.') or s['path'].startswith(p+'[') for p in paths)]
        check=obj(dict(checkId=enum([item['checkId']]),status=enum(['findings','clear','not_applicable']),reason=string,
                       sourceRefs=reference_array(allowed,True),diagnosticIds=array(string)))
        check['anyOf']=[{'properties':{'status':enum(['findings']),'diagnosticIds':array(string,1)}},
                        {'properties':{'status':enum(['clear','not_applicable']),'diagnosticIds':array(string,0,0)}}]
        checks.append(check)
    dimension_schemas=[]
    for identity,_,_,_ in dimensions:
        criteria=[]
        for i in range(3):
            cid=f'{identity}_{i+1}'
            def condition(levels):return obj(dict(conditionId=enum([f'{cid}:L{n}' for n in levels]),reason=string))
            criterion=obj(dict(criterionId=enum([cid]),level={'type':'integer','minimum':0,'maximum':4},
                anchorId=enum([f'{cid}:L{n}' for n in range(5)]),reason=string,
                unmetConditions=array(condition(range(1,5))),gapExplanation=string,sourceRefs=all_refs,jdSourceRefs=jd_refs))
            criterion['anyOf']=[{'properties':{'level':{'type':'integer','enum':[level]},'anchorId':enum([f'{cid}:L{level}']),
                'unmetConditions':array(condition(range(level+1,5)) if level<4 else condition(range(1,5)),1 if level<4 else 0,4-level)}} for level in range(5)]
            criteria.append(criterion)
        dimension_schemas.append(obj(dict(dimensionId=enum([identity]),comment=string,criteria=fixed(criteria))))
    requirement=obj(dict(requirement=string,reason=string,status=enum(['demonstrated','weak','not_demonstrated','unknown']),
                         jdSourceRefs=reference_array([s['sourceId'] for s in sources if s['path']=='jd'],True) if any(s['path']=='jd' for s in sources) else jd_refs,
                         sourceRefs=reference_array([s['sourceId'] for s in resume_sources])))
    # Generate object-level observations before an overall verdict. A positive
    # summary should not pre-empt useful improvement opportunities in each item.
    schema=obj(dict(reviewChecks=fixed(checks),suggestions=array(suggestion),
        requirements=array(requirement,0,None if any(s['path']=='jd' for s in sources) else 0),
        dimensions=fixed(dimension_schemas),
        strengths=array(obj(dict(text=string,reason=string,sourceRefs=all_refs,jdSourceRefs=jd_refs))),
        summary=string,focusRationale=string,contextNotice=string))
    schema['$defs']=definitions
    return deepcopy(schema)
