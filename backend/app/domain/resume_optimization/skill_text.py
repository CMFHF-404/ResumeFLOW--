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


def confirmed(answer):
    raw=json.loads(answer)
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
