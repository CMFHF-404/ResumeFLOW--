"""Confirmed skill fragments, scoped to a resume config; never writes the bank."""
import json
from copy import deepcopy


def value(raw):
    from .apply_service import _frontend_plain_text
    if not isinstance(raw,dict) or set(raw)!={'name','category'}:
        raise ValueError('skill text requires name and category')
    result={k:_frontend_plain_text(v).strip() if isinstance(v,str) else '' for k,v in raw.items()}
    if not result['name'] or not result['category'] or len(result['name'])>4000 or len(result['category'])>100:
        raise ValueError('invalid skill text')
    return result


def creations(raw):
    if isinstance(raw,dict) and set(raw)=={'skills'}:
        items=raw['skills']
        if not isinstance(items,list) or not 1<=len(items)<=5:raise ValueError('invalid skill batch')
        result=[value(item) for item in items]
        if len({item['name'].casefold() for item in result})!=len(result):raise ValueError('duplicate skills')
        return result
    return [value(raw)]


def confirmed(answer, *, allow_batch=False):
    raw=json.loads(answer)
    if allow_batch and isinstance(raw,dict) and set(raw)=={'skills'}:
        if not isinstance(raw['skills'],list) or not 1<=len(raw['skills'])<=5:raise ValueError('invalid confirmed skill batch')
        indexes=[item.get('candidateIndex') for item in raw['skills'] if isinstance(item,dict) and 'candidateIndex' in item]
        if any(type(index) is not int or not 0<=index<5 for index in indexes) or len(set(indexes))!=len(indexes):raise ValueError('invalid candidate indexes')
        result={'skills':[confirmed(json.dumps({k:v for k,v in item.items() if k!='candidateIndex'})) if isinstance(item,dict) else confirmed(json.dumps(item)) for item in raw['skills']]}
        creations(result)
        return result
    if not isinstance(raw,dict) or set(raw)!={'fragments','category','confirmed'} or raw['confirmed'] is not True:
        raise ValueError('explicit skill confirmation required')
    parts=raw['fragments']
    if not isinstance(parts,list) or not 1<=len(parts)<=20 or any(not isinstance(p,str) or not p.strip() for p in parts):
        raise ValueError('confirmed skill fragments required')
    return value(dict(name='；'.join(p.strip() for p in parts),category=raw['category']))


def effective(skill, config):
    overrides=config.get('skillOverrides',{})
    if not isinstance(overrides,dict):raise ValueError('invalid skill overrides')
    override=overrides.get(skill['id'])
    return dict(skill,**value(override)) if override is not None else deepcopy(skill)
