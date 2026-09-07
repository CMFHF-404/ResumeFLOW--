"""Fixed positive/negative rubric cases, never used as acceptance holdouts."""
import copy
import json

from app.domain.ai.resume_evaluation import normalize_resume_evaluation
from app.domain.ai.resume_evaluation_service import _build_full_resume_evaluation_input


def make_cases(source, jd, role):
    read = lambda name: json.loads((source / name).read_text(encoding='utf-8'))
    resume = next(s['resume'] for s in read('fixtures.json')['samples'] if s['id'] == 'H9S2')
    data = _build_full_resume_evaluation_input(jd, json.dumps({
        'evaluation_scope': 'full_resume', 'target_role': role, 'resume': resume}, ensure_ascii=False))
    # Earlier frozen report supplies unrelated dimensions; target criteria below
    # have explicit gold labels. Rebind every quote to the same current input.
    report = copy.deepcopy(read('post-H9S2-1.json')['value'])
    evaluation = report['resumeEvaluation']
    by_location = {f['source']: f for f in data['fact_metadata']}
    for evidence in evaluation['evidence']:
        fact = by_location[evidence['location']]
        evidence.update(sourceText=fact['content'], factId=fact['fact_id'], verificationStatus=fact['verification_status'])
    action_refs = [e['evidenceId'] for e in evaluation['evidence'] if e['location'].endswith('.star.a')]
    direction_refs = [e['evidenceId'] for e in evaluation['evidence'] if e['location'].endswith(('personal_summary', '.title'))]

    def variant(identity, dimension, replacements, expected):
        value = copy.deepcopy(report); e = value['resumeEvaluation']
        d = next(d for d in e['dimensions'] if d['dimension'] == dimension)
        removed = set(d['issues'])
        e['issues'] = [i for i in e['issues'] if i['issueId'] not in removed]
        e['topPriorities'] = [i for i in e['topPriorities'] if i['issueId'] not in removed]
        d['issues'] = []
        for sub in d['subscores']:
            if sub['name'] in replacements:
                score, reason, refs = replacements[sub['name']]
                sub['score'] = score; sub['evidenceIds'] = refs if score else []
            else:
                reason = {
                    '基础信息':'基础信息有姓名和邮箱，但缺少电话。',
                    '补充信息':'缺少已选项目或证书等补充信息。',
                    '结果指标':'当前只有定性验收交付，缺少已实现的业务结果数字。',
                    '基线与前后对比':'缺少同一业务结果的前后对比数值。',
                    '覆盖规模':'访谈样本数量不等于产品实际服务覆盖规模；缺少后者的数字。',
                    '时间窗口':'缺少结果测量或观察周期；任职日期不算观察周期。',
                }.get(sub['name'], '')
                refs = sub['evidenceIds']
                if sub['score'] < sub['maxScore'] and not reason:
                    raise ValueError('Gold fixture requires a specific preserved deduction reason')
            for item in e['evidence']:
                if item['evidenceId'] in refs and dimension not in item['supportedDimensions']:
                    item['supportedDimensions'].append(dimension)
            if sub['score'] < sub['maxScore']:
                iid = f'GOLD_{len(e["issues"]):03d}'
                d['issues'].append(iid)
                e['issues'].append({'issueId': iid, 'description': reason, 'primaryDimension': dimension,
                    'relatedDimensions': [], 'evidenceIds': refs, 'severity': 'low',
                    'pointsNotEarned': sub['maxScore'] - sub['score']})
        # Normalizer derives totals; explicit totals are kept consistent too.
        d['score'] = sum(s['score'] for s in d['subscores'])
        if d['score'] == 0:
            d['strengths'] = []
        from app.domain.ai.resume_evaluation import _level as _score_level
        d['level'] = _score_level(d['score'])
        total = sum(d['score'] for d in e['dimensions']); score = (total * 2 + 6) // 12
        e.update(overallScore=score, overallLevel=_score_level(score),
            scoreCalculation={'dimensionSum': total, 'rawAverage': total / 6, 'roundingRule':'round_half_up', 'finalScore': score})
        e = normalize_resume_evaluation(e, jd_available=True, fact_metadata=data['fact_metadata'])
        return {'id': identity, 'report': {'resumeEvaluation': e}, 'target_dimension': dimension, 'expected': expected}

    professional = next(d for d in evaluation['dimensions'] if d['dimension'] == '专业表达')
    correct_prof = {s['name']:(20, '', s['evidenceIds']) for s in professional['subscores']}
    wrong_prof = {s['name']:(10, '缺少高级职责、更多专业术语或独立验证，故该分项扣分。', s['evidenceIds']) for s in professional['subscores']}
    name_ref = next(e['evidenceId'] for e in evaluation['evidence'] if e['location'].endswith('profile.name'))
    return data, [
        variant('K7J2', '专业表达', correct_prof, '符合'),
        variant('K3F8', '专业表达', wrong_prof, '不符合'),
        variant('K9B5', '专业表达', {s['name']:(20, '', [name_ref]) for s in professional['subscores']}, '不符合'),
        variant('D1A4', '内容完整', {'求职方向':(10, '', direction_refs)}, '符合'),
        variant('D8C2', '内容完整', {'求职方向':(0, '虽有产品经理职称和产品需求交付总结，但没有独立求职意向字段，扣除全部10分。', direction_refs)}, '不符合'),
        variant('P1A4', '内容可读', {'语法与自然度':(14, '一条完整行动句缺少句末标点，扣1分。', action_refs)}, '符合'),
        variant('P8C2', '内容可读', {'语法与自然度':(0, '一条完整行动句缺少句末标点，扣除全部15分。', action_refs)}, '不符合'),
        variant('Q1A4', '成果量化', {'过程数量':(10, '', action_refs), '数据可信度':(10, '', action_refs)}, '符合'),
        variant('Q8C2', '成果量化', {'过程数量':(0, '虽有15名管理员访谈及20条反馈，但没有业务结果数字，过程数量不得分。', action_refs), '数据可信度':(0, '过程数字缺少独立验证和业务结果，数据可信度不得分。', action_refs)}, '不符合'),
    ]
