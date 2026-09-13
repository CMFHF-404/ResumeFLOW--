"""Typed resume-local transformations shared by planning, apply and rollback."""
from copy import deepcopy
import uuid
from ..ai.selection_actions import KINDS, courses
from . import skill_text

CONFIG_KINDS=set(KINDS)-{'experience_restructure'}
LOCAL_PREFIX='resume-skill:'


def local_skills(config):
    raw=config.get('localSkills',{})
    if not isinstance(raw,dict):raise ValueError('invalid local skills')
    result=[]
    for identity,item in raw.items():
        if not isinstance(identity,str) or not identity.startswith(LOCAL_PREFIX):raise ValueError('invalid local skill ID')
        uuid.UUID(identity[len(LOCAL_PREFIX):])
        result.append(dict(id=identity,**skill_text.value(item)))
    return result


def education(item,config):
    from .apply_service import _frontend_plain_text
    overlay=config.get('educationOverrides',{}).get(item['id'],{})
    if not isinstance(overlay,dict) or set(overlay)-{'courses','notes'}:raise ValueError('invalid education override')
    if any(not isinstance(v,str) for v in overlay.values()):raise ValueError('education override must be text')
    return dict(item,**{k:_frontend_plain_text(v) for k,v in overlay.items()})


def rows(resume,key):
    raw=resume.get(key,[])
    return list(raw.values()) if isinstance(raw,dict) else raw


def before(kind,identity,resume):
    if kind in ('education_courses','education_notes'):
        item=next((e for e in resume.get('educations',[]) if e['id']==identity),None)
        if item is None:raise ValueError('education missing')
        return item.get('courses' if kind=='education_courses' else 'notes','')
    if kind=='certification_order':return [c['id'] for c in resume.get('certifications',[])]
    if kind=='experience_order':return [e['id'] for e in rows(resume,'experiences') if e.get('category','project')==identity]
    if kind in ('experience_hide','certification_hide'):
        key='experiences' if kind=='experience_hide' else 'certifications'
        if not any(e['id']==identity for e in rows(resume,key)):raise ValueError('hidden item missing')
        return True
    if kind=='experience_restructure':
        item=next((e for e in rows(resume,'experiences') if e['id']==identity),None)
        if item is None:raise ValueError('experience missing')
        return {k:item['star'].get(k,'') for k in 'star'}
    if kind=='skill_create':return None
    raise ValueError('unknown local action')


def validate(kind,original,value,suggestion):
    if value is None:return
    if kind=='education_courses':
        by_id={c['id']:c['text'] for c in courses(original)}
        ids=suggestion['selectedItems']
        if any(x not in by_id for x in ids) or value!='、'.join(by_id[x] for x in ids):raise ValueError('courses must select existing names')
    elif kind in ('certification_order','experience_order'):
        if value!=suggestion['selectedItems'] or len(value)!=len(original) or set(value)!=set(original):raise ValueError('order must preserve membership')
    elif kind in ('experience_hide','certification_hide'):
        if value is not False:raise ValueError('visibility action only hides')
    elif kind in ('education_notes','experience_restructure'):
        if not isinstance(value,str) or (kind=='experience_restructure' and not value.strip()):raise ValueError('nonempty restructured text required')
    elif kind=='skill_create':skill_text.value(value)


def deterministic(target):
    kind=target['moduleType'];s=target['suggestions'][0]
    if kind=='education_courses':
        by_id={c['id']:c['text'] for c in courses(target['beforeValue'])}
        return '、'.join(by_id[x] for x in s['selectedItems'])
    if kind in ('certification_order','experience_order'):return s['selectedItems'][:]
    if kind in ('experience_hide','certification_hide'):return False
    raise ValueError('not deterministic')


def created_id(run_id,change_id):return LOCAL_PREFIX+str(uuid.uuid5(uuid.NAMESPACE_URL,f'{run_id}:{change_id}'))


def restructured_star(original,text):
    from .apply_service import _frontend_sanitized_html
    if not isinstance(text,str) or not text.strip():raise ValueError('body text required')
    result=deepcopy(original)
    result.update(s='',t='',a=_frontend_sanitized_html(text),r='')
    return result


def display(target,value):
    kind=target['moduleType']
    if value is None:return ['尚未创建']
    if kind in ('certification_order','experience_order'):return [target.get('itemLabels',{}).get(x,'条目') for x in value]
    if kind in ('experience_hide','certification_hide'):return [('显示：' if value else '隐藏：')+target.get('itemLabels',{}).get(target['moduleId'],'条目')]
    if kind=='skill_create':return [value['category'],value['name']]
    if kind=='experience_restructure' and isinstance(value,dict):return [value[k] for k in 'star' if value[k]]
    return [value]


def config_paths(kind):
    if kind in ('education_courses','education_notes'):return {'educationOverrides':('educationOverrides',)}
    if kind in ('certification_hide','experience_hide'):return {'selection':('selection',)}
    if kind in ('certification_order','experience_order'):return {'layout.orders':('layout','orders')}
    if kind=='skill_create':return {'localSkills':('localSkills',),'selection':('selection',)}
    return {}


def update_config(config,change,resume,run_id):
    kind=change.module_type;identity=change.module_id;value=deepcopy(change.targeted_value)
    if change.before_value!=before(kind,identity,resume):raise ValueError('frozen action value changed')
    if kind in ('education_courses','education_notes'):
        from .apply_service import _frontend_plain_text
        field='courses' if kind=='education_courses' else 'notes'
        overlay=config.setdefault('educationOverrides',{}).setdefault(identity,{})
        # Compare the same visible text used by the frozen scoring snapshot.
        # The apply journal still retains the raw override for exact rollback.
        if field in overlay and (
            not isinstance(overlay[field], str)
            or _frontend_plain_text(overlay[field]) != change.before_value
        ):
            raise ValueError('education override changed')
        overlay[field]=_frontend_plain_text(value)
    elif kind in ('experience_hide','certification_hide'):
        key='experienceIds' if kind=='experience_hide' else 'certificationIds'
        section='experiences' if kind=='experience_hide' else 'certifications'
        selected=config.setdefault('selection',{}).setdefault(key,[e['id'] for e in rows(resume,section)])
        if identity not in selected:raise ValueError('item already hidden')
        config['selection'][key]=[x for x in selected if x!=identity]
    elif kind in ('experience_order','certification_order'):
        field='certificationIds' if kind=='certification_order' else 'workExperienceIds' if identity=='work' else 'projectExperienceIds'
        old=config.setdefault('layout',{}).setdefault('orders',{}).get(field,[])
        # Keep unselected/archived ordering entries outside the frozen visible set.
        config['layout']['orders'][field]=value+[x for x in old if x not in value]
    elif kind=='skill_create':
        identity=created_id(run_id,change.change_id)
        store=config.setdefault('localSkills',{})
        if identity in store:raise ValueError('local skill already exists')
        store[identity]=skill_text.value(value)
        selected=config.setdefault('selection',{}).setdefault('skillIds',[s['id'] for s in resume.get('skills',[])])
        selected.append(identity)
    else:raise ValueError('not a config action')


async def check_current_sources(session,user_id,config,changes,frozen):
    from sqlmodel import select
    from ...models import MasterExperience,ExperienceVersion,Certification
    from .context_service import _frontend_plain_text,_frontend_star_value,_frontend_year_month
    edu_ids={c.module_id for c in changes if c.module_type in ('education_courses','education_notes')}
    for identity in edu_ids:
        result=await session.execute(select(MasterExperience,ExperienceVersion).join(ExperienceVersion,MasterExperience.latest_version_id==ExperienceVersion.id).where(
            MasterExperience.id==uuid.UUID(identity),MasterExperience.user_id==user_id,MasterExperience.is_archived==False,MasterExperience.category=='education').with_for_update(skip_locked=True))
        pair=result.first()
        if pair is None:raise ValueError('education no longer available')
        v=pair[1];star=v.star or {}
        item=dict(id=identity,school=_frontend_plain_text(v.org),major=_frontend_plain_text(v.title),
            **{k:_frontend_plain_text(_frontend_star_value(star.get(k))) for k in ('degree','gpa','courses','notes')})
        item=education(item,config)
        old=next((e for e in frozen.get('educations',[]) if e['id']==identity),None)
        if old is None or any(item.get(k,'')!=old.get(k,'') for k in ('school','major','degree','gpa','courses','notes')):raise ValueError('education changed')
    cert_ids={c.module_id for c in changes if c.module_type=='certification_hide'}
    if any(c.module_type=='certification_order' for c in changes):cert_ids.update(c['id'] for c in frozen.get('certifications',[]))
    for identity in cert_ids:
        result=await session.execute(select(Certification).where(Certification.id==uuid.UUID(identity),Certification.user_id==user_id).with_for_update(skip_locked=True))
        cert=result.scalars().first();old=next((c for c in frozen.get('certifications',[]) if c['id']==identity),None)
        if cert is None or old is None or cert.name!=old['name'] or (cert.issuer or '')!=old.get('issuer','') or _frontend_year_month(cert.issue_date)!=old.get('issue_date',''):
            raise ValueError('certificate changed or removed')
