"""Small provider grammar; authoritative identity/scope checks remain server-side."""
import re

VERSION='resume_review_provider_shape_v1'
OPENAI_VERSION='resume_review_openai_shape_v7'


def compact(schema):
    def visit(node):
        if isinstance(node,list):return [visit(x) for x in node]
        if not isinstance(node,dict):return node
        result={}
        for key,value in node.items():
            if key=='prefixItems':
                if value:result['items']=visit(value[0])
                continue
            if key=='enum' and (len(value)==1 or any(isinstance(x,str) and (re.fullmatch(r'(?:src|span|target|action|skill)_[0-9a-f]+',x) or ':L' in x) for x in value)):
                continue
            if key=='anyOf' and value and all(isinstance(x,dict) and 'properties' in x for x in value):
                # Cross-property relationships are checked after parsing, once.
                continue
            result[key]=visit(value)
        return result
    return visit(schema)


def openai_strict(schema):
    """Adapt the compact grammar to OpenAI's all-required nullable convention."""
    def visit(node):
        if isinstance(node,list):return [visit(x) for x in node]
        if not isinstance(node,dict):return node
        result={k:visit(v) for k,v in node.items() if k!='propertyOrdering'}
        if result.get('type')=='object':
            required=set(result.get('required',[]))
            properties=result.get('properties',{})
            for key,value in list(properties.items()):
                nullable=value.get('type')=='null' or any(branch.get('type')=='null' for branch in value.get('anyOf',[]))
                if key not in required and not nullable:
                    properties[key]={'anyOf':[value,{'type':'null'}]}
            result['required']=list(properties)
            result['additionalProperties']=False
        return result
    return visit(schema)


def openai_review(schema, payload):
    """Bound addresses to the snapshot with a compact, flat provider grammar.

    Cross-field operation rules remain authoritative on the server. Full
    action unions produced empty suggestions in two real low-effort trials;
    do not hide those failures by requiring an arbitrary suggestion count.
    """
    result=openai_strict(compact(schema))
    objects=payload['objects']
    experiences=[o['objectId'] for o in objects if o['kind']=='experience']
    references=list(dict.fromkeys(ref for o in objects for ref in
        [o['objectId'],o.get('labelRef'),*o.get('fields',{}),*[b['ref'] for b in o.get('body',[])]] if ref))
    # One shared enum bounds every evidence address without duplicating a long
    # source catalog at each field. JD evidence remains a separate namespace.
    def bind_references(node):
        if isinstance(node,list):
            for value in node:bind_references(value)
        elif isinstance(node,dict):
            for key,value in node.items():
                if key in ('sourceRefs','jdSourceRefs') and isinstance(value,dict):
                    target=value
                    if '$ref' in value:
                        target=result
                        for part in value['$ref'].removeprefix('#/').split('/'):target=target[part]
                    if target.get('type')=='array':
                        if key=='sourceRefs':target['items']={'$ref':'#/$defs/resume_ref'}
                        else:
                            target['items']=dict(type='string',enum=['JD']) if payload.get('jd') else dict(type='string')
                            if not payload.get('jd'):target['maxItems']=0
                else:bind_references(value)
    bind_references(result)
    result['$defs']['resume_ref']=dict(type='string',enum=references)
    if payload['assessmentContext'].get('targetRole','').strip():
        kinds=result['$defs']['fact_gap']['properties']['kind']['enum']
        result['$defs']['fact_gap']['properties']['kind']['enum']=[k for k in kinds if k!='target_role']

    def choices(values):
        values=list(dict.fromkeys(values))
        return dict(type='array',items=dict(type='string',enum=values),maxItems=len(values)) if values else dict(type='array',items=dict(type='string'),maxItems=0)

    result['properties']['focusObjectIds']=choices(experiences)
    item=result['properties']['suggestions']['items'];props=item['properties']
    props['objectId']=dict(type='string',enum=[o['objectId'] for o in objects],description='选择本条方案的对象。')
    actions=[a for o in objects for a in o['actions']]
    props['operationId']=dict(type='string',enum=list(dict.fromkeys(a['operationId'] for a in actions)),description='必须属于所选objectId的actions；manual仅人工核查，编辑和补充事实选择该对象的编辑操作。')
    props['selectedItems']=choices([x['id'] for a in actions for x in a.get('options',[])])
    props['selectedItems']['description']='只允许所选操作options中的ID。没有options必须[]；课程为保留子集，排序为完整排列。不是正文引用或字段路径。'
    props['relatedObjectIds']={'anyOf':[choices(experiences),{'type':'null'}], 'description':'仅skill_text关联实际经历，其他操作为null或[]。'}
    refs=[ref for o in objects if o['kind']=='experience' for ref in [o.get('labelRef'),*[b['ref'] for b in o.get('body',[])]] if ref]
    props['candidateSourceRef']={'anyOf':[dict(type='string',enum=refs),{'type':'null'}]} if refs else {'type':'null'}
    props['candidateSourceRef']['description']='仅skill_create引用工具名称所在的经历原文；其他操作必须null。'
    props['candidateText']={'anyOf':[dict(type='string',minLength=1,maxLength=120),{'type':'null'}], 'description':'仅skill_create复制原文连续的工具或方法名称；其他操作必须null。严禁参考改写、句子模板或数字占位。'} if refs else {'type':'null'}
    props['direction']['description']='具体修改策略及理由；只描述如何组织或确认，不写参考改写，不列未知工具或理想答案。'
    item['properties']={k:props[k] for k in ['objectId','operationId',*props]}
    result['properties']['suggestions']['description']='主要交付：将点评中需要修改或确认的问题落实为可独立选择的具体方案；只有无须修改且已说明保留理由时才返回空数组。'
    properties=result['properties']
    result['properties']={k:properties[k] for k in ['focusObjectIds','suggestions',*properties]}
    return result


def omit_optional_nulls(value, server_schema):
    """Decode nullable optionals; never repair required data or actual choices."""
    def visit(value,node):
        if '$ref' in node:
            target=server_schema
            for part in node['$ref'].removeprefix('#/').split('/'):
                target=target[part.replace('~1','/').replace('~0','~')]
            node=target
        if isinstance(value,dict):
            properties=node.get('properties',{})
            required=set(node.get('required',[]))
            return {key:visit(item,properties.get(key,{})) for key,item in value.items()
                    if not (key in properties and key not in required and item is None)}
        if isinstance(value,list):
            positional=node.get('prefixItems',[])
            return [visit(item,positional[i] if i<len(positional) else node.get('items',{})) for i,item in enumerate(value)]
        return value
    return visit(value,server_schema)
