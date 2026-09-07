"""Field-level coverage, with bounded local candidates that still require safety review."""
from __future__ import annotations

import re
from collections.abc import Mapping

from .normalizers import normalize_action_paragraph_endings
from .schemas import OptimizationChange, OptimizationPlan


_GUIDANCE_QUANTIFICATION_FIELD = {
    '结果指标': 'star.r',
    '基线与前后对比': 'star.r',
    '覆盖规模': 'star.r',
    '时间窗口': 'star.r',
    '数据可信度': 'star.r',
    '过程数量': 'star.a',
}

def _pointer(token: str) -> str:
    return token.replace('~', '~0').replace('/', '~1')


def _fields(context):
    current = context.current_resume
    fields = {('current_resume', 'personal_summary'): current.get('personal_summary', '')}
    for identity, experience in current.get('experiences', {}).items():
        if identity not in context.selected_master_experience_ids or not isinstance(experience, Mapping):
            continue
        for key, value in experience.get('star', {}).items():
            if key in 'star' and len(key) == 1 and isinstance(value, str):
                fields[identity, 'star.' + key] = value
    return fields


def coverage_targets(context):
    """Expand issue evidence into owned fields, rather than counting routed issue IDs."""
    fields = _fields(context)
    evidence = {e['evidenceId']: e for e in context.evaluation.get('evidence', [])}
    # Optimization snapshots also contain legacy source descriptors without
    # scoring verification metadata. Only use their location after matching
    # the complete content to the owned frozen field; do not reclassify truth.
    facts = {}
    ambiguous = set()
    for fact in context.fact_metadata:
        if not isinstance(fact, Mapping):
            continue
        identity = fact.get('fact_id', fact.get('factId'))
        if not isinstance(identity, str):
            continue
        if identity in facts:
            ambiguous.add(identity)
        facts[identity] = fact
    for identity in ambiguous:
        facts.pop(identity, None)
    identities = list(context.current_resume.get('experiences', {}))
    raw_guidance_tasks = context.evaluation.get('_guidanceTasks', [])
    guidance_tasks = {
        task.get('taskId'): task
        for task in raw_guidance_tasks
        if isinstance(task, Mapping) and isinstance(task.get('taskId'), str)
    } if isinstance(raw_guidance_tasks, list) else {}
    targets = {}
    for issue in context.evaluation.get('issues', []):
        addresses = set()
        task = guidance_tasks.get(issue.get('taskId'))
        if (
            isinstance(task, Mapping)
            and task.get('dimension') == issue.get('primaryDimension')
            and task.get('fieldPath') == issue.get('fieldPath')
        ):
            task_path = task.get('fieldPath')
            task_match = re.fullmatch(
                r'experiences\[(\d+)\]\.star\.([star])',
                task_path,
            ) if isinstance(task_path, str) else None
            if task_match and int(task_match[1]) < len(identities):
                task_address = (
                    identities[int(task_match[1])],
                    'star.' + task_match[2],
                )
                if task_address in fields:
                    addresses.add(task_address)
            else:
                broad_star_match = re.fullmatch(
                    r'experiences\[(\d+)\]\.star',
                    task_path,
                ) if isinstance(task_path, str) else None
                quantification_field = _GUIDANCE_QUANTIFICATION_FIELD.get(
                    task.get('criterion')
                )
                if (
                    task.get('dimension') == '成果量化'
                    and broad_star_match
                    and quantification_field is not None
                    and int(broad_star_match[1]) < len(identities)
                ):
                    task_address = (
                        identities[int(broad_star_match[1])],
                        quantification_field,
                    )
                    if task_address in fields:
                        addresses.add(task_address)
            if task_path == 'personal_summary' and (
                'current_resume', 'personal_summary'
            ) in fields:
                addresses.add(('current_resume', 'personal_summary'))
        for eid in issue.get('evidenceIds', []):
            item = evidence.get(eid, {})
            fact = facts.get(item.get('factId'), {})
            location = fact.get('source') or item.get('location', '')
            if not isinstance(location, str):
                location = item.get('location', '')
            match = re.fullmatch(r'resume\.experiences\[(\d+)\]\.star\.([star])', location)
            if match and int(match[1]) < len(identities):
                address = (identities[int(match[1])], 'star.' + match[2])
                if address in fields and (fact.get('content') == fields[address] or item.get('sourceText') == fields[address]):
                    addresses.add(address)
            # Supports canonical source-ID locations without trusting arbitrary paths.
            text = item.get('sourceText')
            matching = [address for address, value in fields.items() if value and value == text]
            if len(matching) == 1:
                addresses.add(matching[0])
        if re.search(r'标点|句号|punctuation', issue.get('description', ''), re.I):
            addresses.update(address for address, value in fields.items()
                             if address[1] == 'star.a' and value != normalize_action_paragraph_endings(value))
        for identity, field in sorted(addresses):
            key = (issue['issueId'], identity, field)
            targets[key] = {'issue_id': issue['issueId'], 'dimension': issue['primaryDimension'],
                            'module_id': identity, 'field_path': field, 'status': 'uncovered'}
    return list(targets.values())


def _candidate(target, before, after, source, identity):
    return OptimizationChange(
        change_id=identity, issue_ids=[target['issue_id']], dimension=target['dimension'],
        module_type='personal_summary' if target['field_path'] == 'personal_summary' else 'experience_star',
        module_id=target['module_id'], field_path=target['field_path'], action_kind='rewrite_now',
        scope='general', before_value=before, general_value=after, targeted_value=after,
        source_refs=[source], rationale='仅整理现有表达或补回同一已选来源的完整成果，保留事实与归因边界。',
        expected_score_gain=0, default_selected=True,
    )


def reconcile_coverage(plan: OptimizationPlan, context) -> OptimizationPlan:
    plan = plan.model_copy(deep=True)
    plan.coverage = coverage_targets(context)
    fields = _fields(context)
    owned = context.selected_source_experiences
    ids = {c.change_id for c in plan.changes}
    for target in plan.coverage:
        address = target['module_id'], target['field_path']
        before = fields[address]
        active = [c for c in plan.changes if (c.module_id, c.field_path) == address
                  and c.action_kind.value in {'rewrite_now', 'ask_user'}]
        if active:
            continue
        after = before
        source = f'/currentResume/experiences/{_pointer(address[0])}/star/{address[1][-1]}'
        if address[1] == 'star.a':
            after = normalize_action_paragraph_endings(before)
        elif address[1] == 'star.r':
            # This predicate never creates a STAR defect: a qualitative launch is
            # already a valid result. It only permits a separately audited issue
            # (for example, an optional quantification gap) to restore a richer
            # result from the same selected experience. Any unique assertion,
            # markup, number, qualifier or negation stays intact.
            generic = re.fullmatch(r'(?:产品|项目|系统|功能|流程|周报|报告|模板)?(?:已|已经)?(?:上线|交付|完成|做好|发布|落地)了?[。.!！]?', before.strip())
            selected = owned.get(address[0], {})
            value = selected.get('star', {}).get('r') if isinstance(selected, Mapping) else None
            if generic and isinstance(value, str) and value.strip() and value != before:
                after = value
                source = f'/selectedSourceExperiences/{_pointer(address[0])}/star/r'
            else:
                target['reason'] = '缺少可无损替换的同一来源成果，保留独有事实或等待明确候选。'
        if after == before:
            continue
        number = 1
        while f'COVERAGE_{number}' in ids:
            number += 1
        identity = f'COVERAGE_{number}'
        ids.add(identity)
        # Replace the passive route for this exact issue/field, not unrelated issues.
        for old in list(plan.changes):
            if ((old.module_id, old.field_path) == address and old.action_kind.value == 'leave_unchanged'
                    and target['issue_id'] in old.issue_ids):
                old.issue_ids = [i for i in old.issue_ids if i != target['issue_id']]
                if not old.issue_ids:
                    plan.changes.remove(old)
        plan.changes.append(_candidate(target, before, after, source, identity))
    refresh_coverage(plan)
    return plan


def refresh_coverage(plan: OptimizationPlan) -> None:
    for item in plan.coverage:
        changes = [c for c in plan.changes
                   if (c.module_id, c.field_path) == (item['module_id'], item['field_path'])]
        rewrites = [c for c in changes if c.action_kind.value == 'rewrite_now'
                    and (c.general_value != c.before_value or c.targeted_value != c.before_value)]
        if rewrites:
            item['status'] = ('candidate' if any(c.safety_status == 'allowed' for c in rewrites)
                              else 'blocked' if all(c.safety_status == 'blocked' for c in rewrites)
                              else 'pending_review')
            if item['status'] == 'candidate' and item.get('repair_verdict') in {'partial', 'unresolved'}:
                item['status'] = 'unrepaired'
            elif item['status'] == 'candidate' and item.get('repair_verdict') == 'repaired':
                item['status'] = 'repaired'
        elif any(c.action_kind.value == 'ask_user' for c in changes):
            item['status'] = 'needs_facts'
        else:
            # A generic leave_unchanged route does not establish defect repair.
            item['status'] = 'preserved' if item.get('reason') else 'uncovered'


def bind_cleanup_fallbacks(plan: OptimizationPlan, raw, context) -> None:
    if not isinstance(raw, list):
        return
    fields = _fields(context)
    changes = {c.change_id: c for c in plan.changes if c.action_kind.value == 'ask_user'}
    duplicates = {x.get('changeId') for x in raw if isinstance(x, dict)
                  and sum(isinstance(y, dict) and y.get('changeId') == x.get('changeId') for y in raw) > 1}
    for item in raw:
        if not isinstance(item, dict) or item.get('changeId') in duplicates:
            continue
        original = changes.get(item.get('changeId'))
        value = item.get('value')
        if original is None or not isinstance(value, str) or not value.strip() or len(value) > 6000:
            continue
        before = fields.get((original.module_id, original.field_path))
        if before is None or original.before_value != before or value == before:
            continue
        # No protected information may be restored from the model's minimized view.
        from .planner_service import _private_target_original_value
        if _private_target_original_value(context, original) is not None:
            continue
        ref = ('/currentResume/personal_summary' if original.field_path == 'personal_summary'
               else f'/currentResume/experiences/{_pointer(original.module_id)}/star/{original.field_path[-1]}')
        fallback = original.model_copy(deep=True, update={
            'action_kind': type(original.action_kind).REWRITE_NOW,
            'general_value': value, 'targeted_value': value,
            'source_refs': [ref], 'introduced_terms': [], 'expected_score_gain': 0,
            'default_selected': False, 'safety_status': 'pending', 'semantic_review': None,
            'safety_findings': [], 'rationale': '没有补充事实，仅整理原文表达；仍需安全审核及用户采纳。',
        })
        plan.cleanup_fallbacks[original.change_id] = fallback
