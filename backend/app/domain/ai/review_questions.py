"""Code-owned contextual questions; no semantic audits or extra model calls.

Literal percentages only provide source-grounded display hints. They never
decide factual validity, grades, or write permissions.
"""
import re

from . import evidence_rubric_v2 as history

VERSION = 'contextual_fact_questions_v1'

QUESTIONS = {
    'metric_definition': '请只补充尚未说明的指标含义、统计范围、计算口径和比较基准。已提供的口径无需重填。',
    'engineering_measurement': '测量的是哪项工作或结果？请补充尚未说明的统计范围、比较基准和测量或复核方式；没有记录的部分可以保留未知。',
    'validation_setup': '这项工作或结果经过了什么复核、验收或验证？请补充尚未说明的流程、范围和比较条件；已明确未做的验证无需重复确认。',
    'delivery_feedback': '交付后由谁使用或验收，是否有进一步反馈？请沿用简历已写明的使用事实，只补充尚未交代的反馈或范围。',
    'task_scope': '请沿用已写明的角色和分工，只补充尚不清楚的本人负责范围、交付及协作边界。',
}
_PERCENT = re.compile(r'(?<![A-Za-z0-9_.])[-+]?\d+(?:\.\d+)?[%％]')


def remove_known_role(gaps, context):
    """Only the structured target role is authoritative; never infer from prose."""
    if context.get('targetRole', '').strip():
        return [gap for gap in gaps if gap['kind'] != 'target_role']
    return gaps


def confirmation_strategy(row, obj):
    """Render fresh fact-confirmation instructions from checked gap kinds.

    The model still diagnoses the problem. It does not supply possible answers
    in the execution steps. Existing-fact organization and historical reports
    keep their original strategies; this does not grant rewrite permission.
    """
    if row['handling']!='ask_user' or not row['factGaps'] or row['moduleType']=='skill_text':
        return
    row['direction']=f'先确认「{obj["label"]}」中尚未明确的事实，再依据确认内容修改本项；已提供的事实无需重填，不确定或跳过时保留原文。'
    row['strategySteps']=list(dict.fromkeys(gap['question'] for gap in row['factGaps']))


def render(gap, obj, sources):
    by_id = {source['sourceId']: source for source in sources}
    root = obj['path']
    scoped = [source for source in sources if source['path'] == root or source['path'].startswith(root + '.') or source['path'].startswith(root + '[')]
    label = obj['label']
    org = next((source['text'] for source in scoped if source['path'] == root + '.org'), '')
    if org and org != label:
        label += ' · ' + org
    # A checked scope may include text children, but a specific field only
    # contributes its own text. Foreign-object references are never copied.
    text = []
    for identity in gap['sourceRefs']:
        source = by_id[identity]
        path = source['path']
        if source not in scoped:
            continue
        if source['kind'] == 'text':
            text.append(source['text'])
        else:
            text.extend(s['text'] for s in scoped if s['kind'] == 'text' and (s['path'].startswith(path + '.') or s['path'].startswith(path + '[')))
    literal_values = {match.group() for value in text for match in _PERCENT.finditer(value)}
    focus = []
    if gap['kind'] in ('metric_definition', 'engineering_measurement', 'validation_setup'):
        for match in _PERCENT.finditer(gap['reason']):
            value = match.group()
            if value in literal_values and value not in focus:
                focus.append(value)
    suffix = '中的' + '、'.join('“' + value + '”' for value in focus[:3]) if focus else ''
    return f'「{label}」{suffix}：' + QUESTIONS.get(gap['kind'], history.FACT_QUESTIONS[gap['kind']])
