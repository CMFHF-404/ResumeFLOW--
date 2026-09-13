"""Frozen object addresses for model reading; never model-owned write paths."""
from copy import deepcopy
from datetime import date
import re

from . import selection_actions

KINDS = {'educations': ('ED', 'education'), 'experiences': ('E', 'experience'),
         'skills': ('K', 'skill'), 'certifications': ('C', 'certification')}


def date_interval(value):
    if not isinstance(value, str): return None
    match = re.fullmatch(r'(\d{4})[-./](\d{1,2})(?:[-./](\d{1,2}))?', value.strip())
    if not match: return None
    import calendar
    year, month, day = (int(x) if x else None for x in match.groups())
    try:
        first = date(year, month, day or 1)
        last = first if day else date(year, month, calendar.monthrange(year, month)[1])
        return first, last
    except ValueError: return None


def date_facts(start, end, as_of, *, education=False):
    a, b, today = date_interval(start), date_interval(end), date_interval(as_of)
    result = dict(start=start, end=end, assessmentAsOf=as_of,
                  presentation='range' if start and end else 'single_date_or_open_end' if start or end else 'not_provided')
    if not today or (start and not a) or (end and not b):
        return dict(result, relation='unknown')
    if a and b and a[0] > b[1]: return dict(result, relation='start_after_end')
    if b and b[1] < today[0]: return dict(result, relation='ended_before_assessment')
    if b and b[0] > today[1]:
        return dict(result, relation='planned_education_end' if education else 'end_after_assessment')
    if a and a[0] > today[1]: return dict(result, relation='start_after_assessment')
    if a and not b: return dict(result, relation='past_or_current_single_date_or_open_end')
    return dict(result, relation='current_or_unspecified')


def catalog(sources, modules):
    by_path = {s['path']: s for s in sources}
    objects = [dict(objectId='R', kind='resume', label='整份简历', moduleId='resume', path='resume'),
               dict(objectId='S', kind='summary', label='个人总结', moduleId='current_resume', path='resume.personal_summary'),
               dict(objectId='P', kind='profile', label='基础信息', moduleId='profile', path='resume.profile')]
    for collection, (prefix, kind) in KINDS.items():
        for s in sources:
            match = re.fullmatch(rf'resume\.{collection}\[(\d+)\]', s['path'])
            if not match: continue
            root = s['path']; index = int(match[1])
            fields = {k: by_path.get(root+'.'+k, {}).get('text', '') for k in ('id', 'title', 'school', 'name')}
            objects.append(dict(objectId=f'{prefix}{index+1}', kind=kind,
                moduleId=fields['id'], label=fields['title'] or fields['school'] or fields['name'] or f'{kind} {index+1}', path=root))
    for oid, kind, path, label, identity in (
        ('CERTS', 'certification_order', 'resume.certifications', '证书与奖项排序', 'certifications'),
        ('SKILLS', 'skills_order', 'resume.skills', '技能排序', 'skills'),
        ('SECTIONS', 'section_order', 'resume.section_order', '章节排序', 'sections'),
        ('WORK', 'experience_order', 'resume.experiences', '实习排序', 'work'),
        ('PROJECTS', 'experience_order', 'resume.experiences', '项目排序', 'project')):
        if path in by_path: objects.append(dict(objectId=oid, kind=kind, label=label, moduleId=identity, path=path))
    objects = [o for o in objects if o['path'] in by_path]
    for o in objects:
        o['sourceRef'] = by_path[o['path']]['sourceId']; o['actions'] = {}
        for m in modules:
            kind = m['moduleType']; identity = m['moduleId']
            operation = None
            if o['kind']=='experience':
                if identity==o['moduleId'] and kind=='experience_star': operation=m['fieldPath']
                elif identity==o['moduleId'] and kind in ('experience_hide','experience_restructure'): operation=kind
                elif kind=='skill_create': operation=kind
                elif identity==o['moduleId'] and kind=='read_only': operation='manual'
            elif o['kind']=='education' and identity==o['moduleId'] and kind in ('education_courses','education_notes'): operation=kind
            elif o['kind']=='skill' and identity==o['moduleId'] and kind=='skill_text': operation=kind
            elif o['kind']=='certification' and identity==o['moduleId'] and kind=='certification_hide': operation=kind
            elif o['kind']=='summary' and kind=='personal_summary': operation=kind
            elif o['kind']==kind and identity==o['moduleId']: operation=kind
            elif kind=='read_only' and identity==o['moduleId']: operation='manual'
            if operation: o['actions'][operation] = m['targetId']
        if 'manual' not in o['actions']:
            target = next((m for m in modules if m['moduleType']=='read_only' and m['moduleId']=='resume'), None)
            if target: o['actions']['manual'] = target['targetId']
    return objects


def references(sources, objects):
    result = {}; by_path = {s['path']: s for s in sources}
    # More specific objects take precedence over collection containers.
    for o in sorted(objects, key=lambda o: len(o['path'])):
        root = o['path']
        for path, s in by_path.items():
            if path==root or path.startswith(root+'.') or path.startswith(root+'['):
                suffix=path[len(root):]
                result[s['sourceId']]=o['objectId']+suffix
    if 'jd' in by_path: result[by_path['jd']['sourceId']]='JD'
    # Every object itself is also a valid checked-scope reference.
    reverse = {alias: identity for identity, alias in result.items()}
    reverse.update({o['objectId']: o['sourceRef'] for o in objects})
    for o in objects:
        label_source=next((by_path.get(o['path']+'.'+key) for key in ('title','school','name')
                           if by_path.get(o['path']+'.'+key,{}).get('text')==o['label']),None)
        if label_source:reverse[o['objectId']+'.labelRef']=label_source['sourceId']
        if o['kind'] in ('education','experience','skill','certification','profile','summary'):
            for path,s in by_path.items():
                if s['kind']!='text' or not s['text'] or not (path==o['path'] or path.startswith(o['path']+'.')):continue
                if path.endswith('.id') or s is label_source or (o['kind']=='experience' and '.star.' in path):continue
                # This is the literal address of a field actually present in the reading card.
                # It is an exact alias, not fuzzy matching or model-output repair.
                reverse[o['objectId']+'.fields.'+result[s['sourceId']]]=s['sourceId']
    return result, reverse


def model_view(data, jd, sources, modules, context):
    objects = catalog(sources, modules)
    aliases, _ = references(sources, objects)
    by_path={s['path']:s for s in sources}; by_target={m['targetId']:m for m in modules}
    source_by_id={s['sourceId']:s for s in sources}
    object_for_identity={o['moduleId']:o for o in objects if o['kind'] in ('experience','skill','certification','education') and o['moduleId']}
    cards=[]
    for o in objects:
        card={k:deepcopy(o[k]) for k in ('objectId','kind','label')}
        card['actions']=[]
        for operation, identity in o['actions'].items():
            target=by_target[identity]; action={'operationId':operation}
            if 'options' in target:
                action['options']=[dict(id=object_for_identity[x['id']]['objectId'] if x['id'] in object_for_identity else x['id'],
                    **({'name':object_for_identity[x['id']]['label']} if x['id'] in object_for_identity else {'index':i})) for i,x in enumerate(target['options'])]
            card['actions'].append(action)
        if o['kind'] in ('education','experience','skill','certification','profile','summary'):
            fields={}
            for s in sources:
                if s['kind']!='text' or not (s['path']==o['path'] or s['path'].startswith(o['path']+'.')): continue
                if s['path'].endswith('.id') or not s['text']: continue
                fields[aliases[s['sourceId']]]=s['text']
            # Keep literal text once, including all nonempty STAR fields in original reading order.
            if o['kind']=='experience':
                body=[]
                for k in 'star':
                    source=by_path.get(o['path']+'.star.'+k)
                    if source and source['text']:
                        alias=aliases[source['sourceId']]; body.append(dict(ref=alias,text=fields.pop(alias)))
                card['body']=body
            if o['kind']=='education':
                source=by_path.get(o['path']+'.courses')
                if source and source['text']:
                    alias=aliases[source['sourceId']]
                    fields[alias]=selection_actions.courses(source['text'])
            # Label is the actual title/name, so do not repeat it as body text.
            for alias,text in list(fields.items()):
                if text==o['label'] and source_by_id[next(k for k,v in aliases.items() if v==alias)]['path'].endswith(('.title','.school','.name')):
                    card['labelRef']=o['objectId']+'.labelRef'; fields.pop(alias)
            card['fields']=fields
            if o['kind'] in ('education','experience'):
                a=by_path.get(o['path']+'.start_date',{}).get('text','');b=by_path.get(o['path']+'.end_date',{}).get('text','')
                card['dateFacts']=date_facts(a,b,context['assessmentAsOf'],education=o['kind']=='education')
        cards.append(card)
    return dict(assessmentContext=context,sectionOrder=deepcopy(data['resume'].get('section_order',[])),objects=cards,jd=dict(ref='JD',text=jd) if jd else None)
