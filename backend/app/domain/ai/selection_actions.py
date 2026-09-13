"""Resume-local action catalog. All destinations and choices are server-owned."""
from copy import deepcopy
import hashlib
import re

VERSION = 'review_json_schema_v4'
KINDS = ('education_courses','education_notes','certification_order','certification_hide',
         'experience_order','experience_hide','experience_restructure','skill_create')
STRATEGIES = ('information_selection','evidence_enrichment','technical_restructure','skill_creation','existing_edit')


def courses(text):
    # Preserve parenthesized course details and grades as part of each choice.
    parts=[];start=0;depth=0
    for i,ch in enumerate(text):
        if ch in '（([':depth+=1
        elif ch in '）)]':depth=max(0,depth-1)
        elif not depth and ch in ',，、;；\n':
            if text[start:i].strip():parts.append(text[start:i].strip())
            start=i+1
    if text[start:].strip():parts.append(text[start:].strip())
    return [dict(id=f'course-{i+1}',text=t) for i,t in enumerate(parts)]


def catalog(resume):
    result=[]
    def add(kind,identity,label,options=None):
        key='action_'+hashlib.sha256(f'{kind}:{identity}'.encode()).hexdigest()[:16]
        result.append(dict(targetId=key,moduleType=kind,moduleId=identity,fieldPath=kind,label=label,editable=True,
                           **({'options':options} if options is not None else {})))
    for i,e in enumerate(resume.get('educations',[])):
        if not e.get('id'):continue
        add('education_courses',e['id'],f'教育{i+1} · 课程取舍',courses(e.get('courses','')))
        add('education_notes',e['id'],f'教育{i+1} · 补充说明')
    certificates=resume.get('certifications',[])
    if certificates:add('certification_order','certifications','证书与奖项排序',[dict(id=c['id']) for c in certificates])
    for i,c in enumerate(certificates):add('certification_hide',c['id'],f'证书与奖项{i+1} · 从当前简历隐藏')
    experiences=resume.get('experiences',[])
    for category in ('work','project'):
        rows=[e for e in experiences if e.get('category','project')==category]
        if rows:add('experience_order',category,'实习排序' if category=='work' else '项目排序',[dict(id=e['id']) for e in rows])
    for i,e in enumerate(experiences):
        add('experience_hide',e['id'],f'经历{i+1} · 从当前简历隐藏')
        add('experience_restructure',e['id'],f'经历{i+1} · 整段正文重排')
    add('skill_create','new','从已有经历提炼专属技能')
    return result


def extend_schema(schema,sources):
    p=schema['properties']['suggestions']['items']
    p['properties'].update(strategyType=dict(type='string',enum=list(STRATEGIES)),
        selectedItems=dict(type='array',items=dict(type='string')),
        candidateText=dict(anyOf=[dict(type='string'),dict(type='null')]),
        candidateSourceRef=dict(anyOf=[dict(type='string',enum=[s['sourceId'] for s in sources if s['kind']=='text' and s['path']!='jd']),dict(type='null')]))
    p['required']+=['strategyType','selectedItems','candidateText','candidateSourceRef']
    return schema


def prepare(raw,sources,modules,context):
    raw=deepcopy(raw);by_source={s['sourceId']:s for s in sources}
    targets={m['targetId']:m for m in modules} if modules is not None else {s['targetId']:s for s in raw['suggestions']}
    for row in raw['suggestions']:
        if row.get('strategyType') not in STRATEGIES:raise ValueError('unknown strategy')
        selected=row.get('selectedItems')
        if not isinstance(selected,list) or any(not isinstance(x,str) for x in selected) or len(set(selected))!=len(selected):raise ValueError('invalid selection choices')
        target=targets[row['targetId']];kind=target['moduleType']
        if kind in ('education_courses','certification_order','experience_order'):
            options=[o['id'] for o in target.get('options',row.get('availableItems',[]))]
            if not set(selected)<=set(options) or (kind!='education_courses' and set(selected)!=set(options)):raise ValueError('selection outside frozen choices')
        elif selected:raise ValueError('unexpected selection choices')
        if kind=='skill_create':
            ref=row.get('candidateSourceRef');text=row.get('candidateText')
            if ref not in by_source or not isinstance(text,str) or not text.strip() or len(text)>120 or text not in by_source[ref]['text']:
                raise ValueError('new skill must quote existing content')
            path=by_source[ref]['path']
            if not path.startswith('resume.experiences[') or not ('.star.' in path or path.endswith('.title')):raise ValueError('new skill must originate in an existing experience')
            row.update(action='ask',handling='ask_user',skillAction=None,
                factGaps=[dict(kind='skill_confirmation',reason='确认原文已出现的技能名称、实际用途与程度，再创建当前简历专属条目。',sourceRefs=[ref])])
        elif row.get('candidateText') is not None or row.get('candidateSourceRef') is not None:raise ValueError('unexpected skill candidate')
        if kind in ('education_courses','certification_order','experience_order','experience_hide','certification_hide'):
            row.update(action='rewrite',handling='organize',factGaps=[],skillAction=None)
        if kind=='education_notes' and row.get('factGaps'):row.update(action='ask',handling='ask_user')
        if kind=='personal_summary' and not context.get('targetRole','').strip() and row.get('action') in ('rewrite','compress','ask'):
            gaps=row.get('factGaps',[])
            if not any(g.get('kind')=='target_role' for g in gaps):
                gaps=gaps+[dict(kind='target_role',reason='意向方向尚未提供，不能替用户确定岗位。',sourceRefs=row['sourceRefs'])]
            row.update(action='ask',handling='ask_user',factGaps=gaps)
        if kind in ('experience_hide','certification_hide'):
            row['direction']='从当前简历隐藏该项，保留资料库记录，可撤销恢复。'
        row['operations']=[dict(kind=kind,moduleId=target['moduleId'],fieldPath=target['fieldPath'],selectedItems=selected)]
        row['executionRequirements']=['确认技能信息'] if kind=='skill_create' else ['补充必要事实'] if row.get('factGaps') else []
        row['availableItems']=deepcopy(target.get('options',row.get('availableItems',[])))
    return raw


def finish(raw,normalized):
    by_path={s['path']:s for s in normalized['sources']}
    for original,row in zip(raw['suggestions'],normalized['suggestions']):
        for key in ('strategyType','selectedItems','candidateText','candidateSourceRef','operations','executionRequirements','availableItems'):
            row[key]=deepcopy(original[key])
        if row['moduleType'] in KINDS:row['editable']=True
        row['executionRequirements']=['确认技能信息'] if row['moduleType'] in ('skill_create','skill_text') else ['补充必要事实'] if row['needsFacts'] else []
        if row['moduleType']=='skill_create':
            row['moduleId']='new:'+hashlib.sha256((row['candidateSourceRef']+row['candidateText']).encode()).hexdigest()[:20]
            row['operations'][0]['moduleId']=row['moduleId']
        else:
            source=next((s for s in normalized['sources'] if s['path'].endswith('.id') and s['text']==row['moduleId']),None)
            if source and row['moduleType'] in KINDS:
                root=source['path'][:-3]
                name=next((by_path[root+'.'+key]['text'] for key in ('title','school','name') if root+'.'+key in by_path),'')
                if name:row['label']=name+' · '+{'experience_restructure':'正文重排','experience_hide':'隐藏','education_courses':'课程取舍','education_notes':'教育说明','certification_hide':'隐藏'}.get(row['moduleType'],'调整')
    return normalized
