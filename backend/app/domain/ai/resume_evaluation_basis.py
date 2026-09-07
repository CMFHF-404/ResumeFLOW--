"""Internal evidence judgments; the server derives marks, never invents judgments."""
from __future__ import annotations

from copy import deepcopy
import re

from .resume_evaluation import _build_fact_index, _source_text_binds_fact
from .resume_evaluation_rubric import STAR_ASSESSMENTS

BASIS_VERSION = 'resume_evidence_basis_v4'
LEVEL_POINTS = {'met':20, 'minor':15, 'material':10, 'predominantly_vague':5, 'absent':0}
DEFECTS = {
    '行动动词': ['vague_action', 'missing_action'],
    '岗位术语': ['incorrect_term', 'no_identifiable_work_terms'],
    '表达精确度': ['ambiguous_action_or_object'],
    '贡献与责任边界': ['ambiguous_responsibility', 'inflated_ownership'],
    '客观与可信': ['exaggeration', 'contradiction', 'unsupported_causality'],
}
BASIS_PROMPT = """
Before assigning marks, fill evidenceBasis from the supplied evidence targets.
It is a private evidence checklist, not a job-fit or seniority assessment.
For EACH experience and professional criterion, first ask whether an OBSERVABLE
defect in that criterion exists. If none, use assessment=met. Cite the
supplied factIds; explain briefly why the actual words do/do not meet the criterion.
Missing sophisticated verbs, methodologies, JD terms, leadership or independent
verification are NOT defect types. Generic actions really can be vague; identify
that actual defect rather than demanding more impressive work. For a defect choose
one assessment enum combining its level and type, e.g. minor:vague_action. Never
return separate level/defect keys for professional criteria. A non-met assessment
must identify an allowed concrete defect with a reason and supporting facts.
The server maps met/minor/material/predominantly_vague/absent to 20/15/10/5/0,
averages each criterion across experiences, and rounds half up. Mirror these marks
and the corresponding evidence in the report; never invent a deduction when the
checklist finds no defect. Keep each subscore's deductionIssueId consistent with
its derived mark. Summary exaggeration remains in riskFlags for the existing cap;
the server applies that cap before deduction binding. Do not attribute a summary's
wording to an experience that does not contain it. For that global cap the server
can supply the objective deduction when its binding is empty; other deduction
bindings remain required and must match the derived marks.
For direction, classify ACTUAL RESUME evidence: function=10, domain=5, absent=0.
A clear current work function supported by titles/summary is function, without a
separate intention field. External target_role or JD alone is not resume evidence.
Write evidenceBasis first, then the complete resumeEvaluation. No extra model call.
For grammar, classify each server-listed punctuation candidate as prose or
label_or_fragment. These candidates already have mechanically verified missing
terminal marks. The server deducts one per prose item, capped at three points.
otherDefect.score concerns ONLY genuine non-punctuation grammar errors: kind=none
requires score=15, while grammar_error requires the actual factIds and specific
syntax defect. Vague work, lack of numbers, repetition and missing terminal marks
are NOT other grammar errors. no_text with score=0 is valid only without text facts.
Mirror the derived grammar mark in the report; do not freely grade punctuation.
For STAR, use the SAME experience-scoped facts listed for professional criteria.
Fill each component's assessment and factIds using the shared STAR definitions.
The server computes the mean of the fixed component points across experiences.
An empty matching field does not imply absent if its content exists in another
STAR field of that same experience. Qualitative outcomes do not require numbers.
Generic role placeholders are generic_role_only (10), never partial_action (18).
Mirror the derived scores and deductionIssueId bindings in the full report.
""".strip()


def _object(properties):
    return {'type':'object','properties':properties,'required':list(properties),'additionalProperties':False}


def _assessments(defects):
    return {'met':20, **{f'{level}:{defect}':points for level,points in LEVEL_POINTS.items()
                        if level!='met' for defect in defects}}


def _targets(data):
    facts = _build_fact_index(data.get('fact_metadata', []))
    positive = {identity:fact for identity,fact in facts.items()
                if fact['verificationStatus'] in {'verified','user_claimed'}}
    resume = data.get('resume', {})
    experiences = resume.get('experiences', []) if isinstance(resume,dict) else []
    targets = {}
    if isinstance(experiences,list) and experiences:
        for i in range(len(experiences)):
            targets[f'EXP_{i+1:03d}'] = [identity for identity,fact in positive.items()
                if re.fullmatch(r'resume\.experiences\['+str(i)+r'\]\.star\.[star]',fact['source'])]
    else:
        targets['TEXT'] = [identity for identity,fact in positive.items()
            if fact['source'] in {'resume.personal_summary','resume.raw_text'}]
    direction = [identity for identity,fact in positive.items() if re.fullmatch(
        r'resume\.(?:personal_summary|profile\.summary|raw_text|target_role|experiences\[\d+\]\.title)',fact['source'])]
    return facts, targets, direction


def _grammar_targets(facts):
    from ..resume_optimization.normalizers import _action_boundary_parts, _normalize_action_paragraph_segment
    from ..resume_optimization.safety import _fact_visible_text
    ids = [identity for identity,fact in facts.items()
           if fact['verificationStatus'] in {'verified','user_claimed'} and re.fullmatch(
               r'resume\.(?:personal_summary|raw_text|experiences\[\d+\]\.star\.[ar])',fact['source'])]
    punctuation = {}
    terminals = frozenset('.。!?！？;；:：…')
    for identity in ids:
        for segment,boundary in _action_boundary_parts(facts[identity]['content']):
            if boundary:
                continue
            normalized = _normalize_action_paragraph_segment(segment)
            before = _fact_visible_text(segment)
            after = _fact_visible_text(normalized)
            inserted = sum(c in terminals for c in after) - sum(c in terminals for c in before)
            if inserted > 0:
                punctuation[f'PUNC_{len(punctuation)+1:03d}'] = {
                    'factId':identity,'text':before,'missingMarks':inserted}
    return ids, punctuation


def build_basis_contract(data):
    facts, targets, direction = _targets(data)
    grammar_ids, punctuation = _grammar_targets(facts)
    def refs(ids):
        items = {'type':'string'}
        if ids:items['enum'] = ids
        value = {'type':'array','items':items,'maxItems':len(ids)}
        return value
    def row(ids, defects=None):
        properties = ({'assessment':{'type':'string','enum':list(_assessments(defects))}}
                      if defects is not None else {'level':{'type':'string','enum':['function','domain','absent']}})
        properties.update(factIds=refs(ids),reason={'type':'string','minLength':1,'maxLength':500})
        return _object(properties)
    grammar = _object({'punctuation':_object({identity:{'type':'string','enum':['prose','label_or_fragment']}
                                             for identity in punctuation}),
        'otherDefect':_object({'kind':{'type':'string','enum':['none','grammar_error','no_text']},
            'score':{'type':'integer','minimum':0,'maximum':15},'factIds':refs(grammar_ids),
            'reason':{'type':'string','minLength':1,'maxLength':500}})})
    star = _object({identity:_object({name:_object({
        'assessment':{'type':'string','enum':list(choices)}, 'factIds':refs(ids),
        'reason':{'type':'string','minLength':1,'maxLength':500}})
        for name,choices in STAR_ASSESSMENTS.items()}) for identity,ids in targets.items()})
    schema = _object({'professional':_object({identity:_object({name:row(ids,DEFECTS[name])
        for name in DEFECTS}) for identity,ids in targets.items()}), 'direction':row(direction), 'grammar':grammar, 'star':star})
    def documents(ids):
        return [{'factId':identity,'text':facts[identity]['content']} for identity in ids]
    return schema, {'professional':{identity:documents(ids) for identity,ids in targets.items()},
                    'direction':documents(direction),
                    'grammar':{'punctuation':punctuation,'facts':documents(grammar_ids)}}


def materialize_basis(result, data):
    facts, targets, direction = _targets(data)
    output = deepcopy(result)
    def fail(message):
        error = ValueError('resumeEvaluation.evidenceBasis ' + message)
        # Every message at this boundary is a fixed code-owned phrase, never
        # provider text, a quote or an unknown field/fact identifier.
        error.basis_diagnostic_code = 'basis_' + message.replace(' ', '_')
        raise error
    basis = output.pop('evidenceBasis', None)
    if not isinstance(basis,dict) or set(basis) != {'professional','direction','grammar','star'}:fail('missing complete assessment')
    professional = basis['professional']
    if not isinstance(professional,dict) or set(professional) != set(targets):fail('target coverage')
    evaluation = output.get('resumeEvaluation', {})
    if not isinstance(evaluation,dict):fail('report contract')
    if 'evidence' not in evaluation:fail('missing evidence reference container')
    evidence = evaluation.get('evidence', [])
    if not isinstance(evidence,list) or any(not isinstance(e,dict) for e in evidence):fail('invalid evidence reference container')
    dimensions = evaluation.get('dimensions', [])
    if not isinstance(dimensions,list) or any(not isinstance(d,dict) for d in dimensions):fail('dimension contract')
    for d in dimensions:
        subs = d.get('subscores', [])
        if not isinstance(subs,list) or any(not isinstance(s,dict) for s in subs):fail('subscore contract')
    for name in ('issues','riskFlags'):
        rows = evaluation.get(name, [])
        if not isinstance(rows,list) or any(not isinstance(row,dict) for row in rows):fail('issue or risk contract')
    ids = [e.get('evidenceId') for e in evidence]
    if any(not isinstance(i,str) for i in ids) or len(ids)!=len(set(ids)):fail('duplicate evidence reference')
    # Derived bindings must not rescue an already broken model reference.
    referenced = [s for d in evaluation.get('dimensions',[]) for s in d.get('subscores',[])]
    referenced += evaluation.get('issues',[]) + evaluation.get('riskFlags',[])
    for item in referenced:
        refs = item.get('evidenceIds',[])
        if not isinstance(refs,list) or any(not isinstance(x,str) or x not in ids for x in refs):fail('unknown evidence reference')
    def bind(fact_ids, dimension):
        bound=[]
        for identity in fact_ids:
            fact=facts[identity]
            existing=[e for e in evidence if e.get('factId')==identity]
            for item in existing:
                if (not isinstance(item.get('sourceText'),str)
                    or not _source_text_binds_fact(item['sourceText'],fact['content'])
                    or item.get('location')!=fact['source']
                    or item.get('verificationStatus')!=fact['verificationStatus']
                    or not isinstance(item.get('supportedDimensions'),list)):fail('conflicting evidence reference')
            found=next((e for e in existing if e['sourceText']==fact['content']),None)
            if found is None:
                eid=f'BASIS_E_{len(evidence)+1:03d}'
                while eid in ids:eid+='_'
                ids.append(eid)
                found={'evidenceId':eid,'factId':identity,'sourceText':fact['content'],'location':fact['source'],
                       'verificationStatus':fact['verificationStatus'],'supportedDimensions':[]}
                evidence.append(found)
            if dimension not in found['supportedDimensions']:found['supportedDimensions'].append(dimension)
            bound.append(found['evidenceId'])
        return list(dict.fromkeys(bound))
    def validate_row(row, allowed, name=None, choices=None):
        field='assessment' if name is not None or choices is not None else 'level'
        keys={field,'factIds','reason'}
        if not isinstance(row,dict) or set(row)!=keys:fail('row contract')
        levels=choices if choices is not None else (_assessments(DEFECTS[name]) if name is not None else {'function':10,'domain':5,'absent':0})
        choice=row[field]
        if not isinstance(choice,str) or choice not in levels:fail('unknown assessment')
        refs=row['factIds']
        if (not isinstance(refs,list) or any(not isinstance(x,str) or x not in allowed for x in refs)
                or len(refs)!=len(set(refs))):fail('out of scope fact reference')
        if levels[choice]>0 and not refs:fail('positive assessment missing evidence reference')
        if not isinstance(row['reason'],str) or not 0<len(row['reason'].strip())<=500:fail('reason contract')
        return levels[choice], refs
    scores={name:[] for name in DEFECTS}; selected={name:[] for name in DEFECTS}
    for identity,allowed in targets.items():
        rows=professional[identity]
        if not isinstance(rows,dict) or set(rows)!=set(DEFECTS):fail('criterion coverage')
        for name in DEFECTS:
            points,refs=validate_row(rows[name],allowed,name)
            scores[name].append(points)
            if points:selected[name].extend(refs)
    dims=evaluation.get('dimensions',[])
    prof=[d for d in dims if d.get('dimension')=='专业表达']
    complete=[d for d in dims if d.get('dimension')=='内容完整']
    if len(prof)!=1 or len(complete)!=1:fail('dimension coverage')
    subs=prof[0].get('subscores',[])
    if len(subs)!=5 or {s.get('name') for s in subs}!=set(DEFECTS):fail('subscore coverage')
    for sub in subs:
        values=scores[sub['name']];n=len(values)
        sub['score']=(2*sum(values)+n)//(2*n)
        sub['evidenceIds']=bind(selected[sub['name']],'专业表达') if sub['score'] else []
    star=basis['star']
    if not isinstance(star,dict) or set(star)!=set(targets):fail('star target coverage')
    star_scores={name:[] for name in STAR_ASSESSMENTS};star_refs={name:[] for name in STAR_ASSESSMENTS}
    for identity,allowed in targets.items():
        rows=star[identity]
        if not isinstance(rows,dict) or set(rows)!=set(STAR_ASSESSMENTS):fail('star component coverage')
        for name,choices in STAR_ASSESSMENTS.items():
            points,refs=validate_row(rows[name],allowed,choices=choices)
            star_scores[name].append(points)
            if points:star_refs[name].extend(refs)
    star_dims=[d for d in dims if d.get('dimension')=='STAR应用']
    if len(star_dims)!=1:fail('star dimension coverage')
    star_subs=star_dims[0].get('subscores',[])
    if len(star_subs)!=4 or {s.get('name') for s in star_subs}!=set(STAR_ASSESSMENTS):fail('star subscore coverage')
    for sub in star_subs:
        values=star_scores[sub['name']];n=len(values)
        sub['score']=(2*sum(values)+n)//(2*n)
        sub['evidenceIds']=bind(star_refs[sub['name']],'STAR应用') if sub['score'] else []
    points,refs=validate_row(basis['direction'],direction)
    directions=[s for s in complete[0].get('subscores',[]) if s.get('name')=='求职方向']
    if len(directions)!=1:fail('direction coverage')
    directions[0].update(score=points,evidenceIds=bind(refs,'内容完整') if points else [])
    grammar_ids, punctuation = _grammar_targets(facts)
    grammar = basis['grammar']
    if not isinstance(grammar,dict) or set(grammar)!={'punctuation','otherDefect'}:fail('grammar contract')
    verdicts=grammar['punctuation']
    if (not isinstance(verdicts,dict) or set(verdicts)!=set(punctuation)
            or any(v not in ['prose','label_or_fragment'] for v in verdicts.values())):fail('punctuation coverage')
    other=grammar['otherDefect']
    if not isinstance(other,dict) or set(other)!={'kind','score','factIds','reason'}:fail('grammar defect contract')
    score=other['score'];kind=other['kind'];refs=other['factIds']
    if (type(score) is not int or not 0<=score<=15 or not isinstance(refs,list)
            or any(not isinstance(r,str) or r not in grammar_ids for r in refs)
            or len(refs)!=len(set(refs)) or not isinstance(other['reason'],str)
            or not 0<len(other['reason'].strip())<=500):fail('grammar defect reference')
    if not ((kind=='none' and score==15 and grammar_ids) or
            (kind=='grammar_error' and score<15 and refs) or
            (kind=='no_text' and score==0 and not grammar_ids and not refs)):
        fail('grammar level conflict')
    gap=min(3,sum(punctuation[key]['missingMarks'] for key,v in verdicts.items() if v=='prose'))
    readability=[d for d in dims if d.get('dimension')=='内容可读']
    if len(readability)!=1:fail('readability coverage')
    grammar_subs=[s for s in readability[0].get('subscores',[]) if s.get('name')=='语法与自然度']
    if len(grammar_subs)!=1:fail('grammar subscore coverage')
    score=max(0,score-gap)
    grammar_subs[0].update(score=score,evidenceIds=bind(grammar_ids,'内容可读') if score else [])
    exaggerated=[r for r in evaluation.get('riskFlags',[]) if r.get('type')=='exaggerated_claim']
    if exaggerated:
        # The existing post-normalization calibration already forces this score
        # to zero. Apply the SAME rule before validating deduction bindings, so a
        # valid global-risk deduction is not mistaken for a full-score defect.
        # This is not a semantic endorsement of a risk flag; audit still checks it.
        objective=next(s for s in prof[0]['subscores'] if s['name']=='客观与可信')
        objective.update(score=0,evidenceIds=[])
        if objective.get('deductionIssueId')=='':
            issues=evaluation.setdefault('issues',[])
            used={i.get('issueId') for i in issues}
            identity='RUBRIC_EXAGGERATED_CLAIM'
            while identity in used:
                identity = f'{identity}_'
            issues.append({'issueId':identity,'description':'存在已识别的夸大陈述，客观与可信分项不得获得正分。',
                'primaryDimension':'专业表达','relatedDimensions':[],
                'evidenceIds':list(dict.fromkeys(eid for risk in exaggerated for eid in risk['evidenceIds'])),
                'severity':'high','pointsNotEarned':20})
            prof[0].setdefault('issues',[]).append(identity)
            objective['deductionIssueId']=identity
    evaluation['evidence']=evidence
    return output
