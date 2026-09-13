"""Source-bound review actions. No semantic scoring or provider calls."""
import hashlib
import re
from copy import deepcopy

SKILL_ACTIONS = ('reorder', 'regroup', 'clarify_existing', 'add_tool', 'change_proficiency')
SKILL_LABELS = dict(reorder='调整技能顺序', regroup='调整技能分类', clarify_existing='整理技能描述',
                    add_tool='确认实际使用的工具', change_proficiency='确认实际掌握程度')
METRIC_ASPECTS = ('meaning', 'scope', 'comparison', 'validation', 'conclusion')
METRIC_LABELS = dict(zip(METRIC_ASPECTS, ('指标含义', '观察范围', '比较条件', '验证方式', '结论边界')))


def in_experience(path, root, *, metric=False):
    return path.startswith(root+'.star.') or (metric and path in {
        root+'.title',root+'.org',root+'.start_date',root+'.end_date'})


def fragments(sources):
    result = []
    for source in sources:
        text = source['text']
        if source['kind'] != 'text' or not text.strip() or source['path'] == 'jd':
            continue
        # Segmentation creates addresses only; it never classifies or scores text.
        intervals = {(0, len(text))}
        intervals.update((m.start(), m.end()) for m in re.finditer(r'[^\n。；]+[。；]?', text) if m.group().strip())
        for start, end in sorted(intervals):
            identity = hashlib.sha256(f"{source['sourceId']}:{start}:{end}:{text[start:end]}".encode()).hexdigest()[:20]
            result.append(dict(spanId='span_'+identity, sourceRef=source['sourceId'], start=start, end=end, text=text[start:end]))
    return result


def skill_modules(resume):
    return [dict(targetId='skill_'+s['id'], moduleType='skill_text', moduleId=s['id'], fieldPath='skill.text',
                 label='技能 · '+s['name'], editable=True) for s in resume.get('skills', [])]


def schema_extensions(schema, sources, modules):
    spans = fragments(sources)
    enum = lambda xs: dict(type='string', enum=list(xs))
    def obj(**properties):
        return dict(type='object', properties=properties, required=list(properties), additionalProperties=False, propertyOrdering=list(properties))
    def ids(values):
        return dict(type='array', items=enum(values) if values else dict(type='string'), **({} if values else dict(maxItems=0)))
    string = dict(type='string')
    links = dict(type='array', items=string)
    suggestion = schema['properties']['suggestions']['items']['properties']
    suggestion['skillAction'] = dict(anyOf=[enum(SKILL_ACTIONS), dict(type='null')])
    suggestion['evidenceSpanIds'] = ids([s['spanId'] for s in spans])
    schema['properties']['suggestions']['items']['required'] += ['skillAction', 'evidenceSpanIds']
    exps = []
    for module in modules:
        if module['moduleType'] == 'read_only' and module['fieldPath'] == 'experience':
            exps.append(module['moduleId'])
    source_paths = {s['sourceId']: s['path'] for s in sources}
    def scoped(identity, *, metric=False):
        # The ID source identifies the containing experience; spans stay there.
        root = next((s['path'][:-3] for s in sources if s['path'].endswith('.id') and s['text'] == identity and s['path'].startswith('resume.experiences[')), None)
        return [s['spanId'] for s in spans if root and in_experience(source_paths[s['sourceRef']],root,metric=metric)]
    expression, metrics = [], []
    for identity in exps:
        span_ids = scoped(identity)
        part = obj(status=enum(('retain','adjust','not_applicable')), reason=string, spanIds=ids(span_ids))
        retain=deepcopy(part);retain['properties']['spanIds']=ids(scoped(identity,metric=True))
        expression.append(obj(moduleId=enum([identity]), retain=retain, compress=deepcopy(part), lead=deepcopy(part),
                              readingOrder=dict(type='array', items=enum(('problem_result','personal_actions','validation'))), diagnosticIds=links))
        aspects = [obj(aspect=enum([a]), status=enum(('stated','explain','confirm','not_applicable')), reason=string,
                       spanIds=ids(scoped(identity,metric=True)), diagnosticIds=links) for a in METRIC_ASPECTS]
        metrics.append(obj(moduleId=enum([identity]), aspects=dict(type='array', prefixItems=aspects,minItems=5,maxItems=5)))
    for name, items in [('expressionPlan',expression),('metricReview',metrics)]:
        schema['properties'][name]=dict(type='array',minItems=len(items),maxItems=len(items),**({'prefixItems':items} if items else {}))
        schema['required'].append(name)
    schema['propertyOrdering']=['expressionPlan','metricReview',*schema['propertyOrdering']]
    return schema


def prepare(raw, sources, modules, *, specific_skills=False):
    """Resolve spans and replace skill action copy before general normalization."""
    raw = deepcopy(raw)
    by_span = {s['spanId']:s for s in fragments(sources)}
    by_target = {m['targetId']:m for m in modules} if modules is not None else {s['targetId']:s for s in raw['suggestions']}
    for row in raw['suggestions']:
        span_ids = row.get('evidenceSpanIds')
        if not isinstance(span_ids,list) or any(x not in by_span for x in span_ids) or len(set(span_ids))!=len(span_ids):
            raise ValueError('invalid evidence span')
        target=by_target[row['targetId']]
        operation=row.get('skillAction')
        if target['moduleType'] not in ('skill_text','skills_order'):
            if operation is not None: raise ValueError('skill action requires skill target')
            continue
        if operation not in SKILL_ACTIONS: raise ValueError('skill operation required')
        if target['moduleType']=='skills_order':
            if operation!='reorder': raise ValueError('skill text action requires individual target')
            row.update(action='move_forward',handling='organize',factGaps=[])
        else:
            if operation=='reorder': raise ValueError('reorder requires order target')
            row.update(action='ask',handling='ask_user',factGaps=[dict(kind='skill_confirmation',reason='只使用本人确认的技能文字与分类。',sourceRefs=row['sourceRefs'])])
        label=SKILL_LABELS[operation]
        row.update(problem=label,impact='让技能内容及能力边界与本人确认的信息一致。',
                   direction='确认实际使用的技能、用途和掌握程度，再整理当前简历的技能文字与分类。' if operation!='reorder' else '只调整已选技能的展示顺序。',
                   strategySteps=['确认需要保留或调整的技能文字与分类。','按确认信息生成当前简历的修改预览。','选择应用；不确认的内容保留原样。'] if operation!='reorder' else ['选择已存在的技能顺序，不新增或改写技能事实。'])
        if specific_skills and operation!='reorder':
            focus=row.get('skillFocus','usage')
            if focus not in ('usage','methods','proficiency','category'):raise ValueError('invalid skill focus')
            aims={'usage':'说明实际使用场景','methods':'说明实际采用的方法与对应任务','proficiency':'核对实际掌握程度','category':'按实际用途调整分类'}
            contexts=row.get('_relatedLabels',[])
            context='结合'+ '、'.join(contexts)+'，' if contexts else ''
            row.update(problem='技能需要'+aims[focus],impact='让技能描述对应已有实践，同时保留本人确认的能力边界。',
                direction=context+aims[focus]+'；只使用本轮确认的信息整理技能文字与分类。',
                strategySteps=[context+'确认'+aims[focus]+'所需的真实信息，不确定的部分保持原样。','将确认的信息写入当前技能项，保留原有基础或了解等程度边界，除非本人明确确认调整。'])
    return raw


def normalize_details(raw, normalized):
    sources=normalized['sources']; spans=fragments(sources); by_span={s['spanId']:s for s in spans}
    paths={s['sourceId']:s['path'] for s in sources}
    roots={s['text']:s['path'][:-3] for s in sources if s['path'].startswith('resume.experiences[') and s['path'].endswith('.id')}
    diagnostics={s['diagnosticId']:s for s in normalized['suggestions']}
    def links(value):
        if not isinstance(value,list) or len(set(value))!=len(value) or any(x not in diagnostics for x in value): raise ValueError('invalid detail diagnostic link')
        return value
    def fragment_ids(value, identity, *, metric=False):
        if not isinstance(value,list) or len(set(value))!=len(value) or any(x not in by_span or not in_experience(paths[by_span[x]['sourceRef']],roots[identity],metric=metric) for x in value): raise ValueError('detail span outside experience')
    for name in ('expressionPlan','metricReview'):
        rows=raw.get(name)
        if not isinstance(rows,list) or len(rows)!=len(roots) or {r.get('moduleId') for r in rows}!=set(roots): raise ValueError('missing experience details')
        for row in rows:
            identity=row['moduleId']
            if name=='expressionPlan':
                linked=links(row.get('diagnosticIds'))
                order=row.get('readingOrder')
                if not isinstance(order,list) or not order or len(order)!=len(set(order)) or any(x not in ('problem_result','personal_actions','validation') for x in order): raise ValueError('invalid reading sequence')
                for key in ('retain','compress','lead'):
                    part=row[key]
                    if part.get('status') not in ('retain','adjust','not_applicable') or not isinstance(part.get('reason'),str) or not part['reason'].strip(): raise ValueError('invalid expression action')
                    fragment_ids(part.get('spanIds'),identity,metric=key=='retain' and part['status']=='retain')
                    if (part['status']=='adjust' or (key=='retain' and part['status']=='retain')) and not part['spanIds']: raise ValueError('expression needs evidence')
                    if part['status']=='adjust' and not linked: raise ValueError('expression adjustment needs diagnosis')
            else:
                aspects=row.get('aspects')
                if not isinstance(aspects,list) or len(aspects)!=5 or {a.get('aspect') for a in aspects}!=set(METRIC_ASPECTS): raise ValueError('five metric aspects required')
                for a in aspects:
                    if a.get('status') not in ('stated','explain','confirm','not_applicable') or not isinstance(a.get('reason'),str) or not a['reason'].strip(): raise ValueError('invalid metric assessment')
                    fragment_ids(a.get('spanIds'),identity,metric=True); linked=links(a.get('diagnosticIds'))
                    if a['status']!='not_applicable' and not a['spanIds']: raise ValueError('metric needs evidence')
                    if a['status'] in ('explain','confirm') and not linked: raise ValueError('metric gap needs diagnosis')
                    if a['status']=='confirm' and not any(diagnostics[x]['needsFacts'] for x in linked): raise ValueError('metric confirmation needs facts')
        normalized[name]=deepcopy(rows)
    for before,after in zip(raw['suggestions'],normalized['suggestions']):
        after.update(skillAction=before.get('skillAction'),evidenceSpanIds=before['evidenceSpanIds'])
    normalized['evidenceSpans']=spans
    return normalized
