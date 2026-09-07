"""New v4 holdouts, excluded from tuning and from the rubric gate."""
import copy
import uuid


def make_holdouts(base):
    cases, keys = [], {}
    for identity in ('P5L2', 'P8C6'):
        resume = copy.deepcopy(base['resume'])
        resume['personal_summary'] = '参与企业软件需求梳理和交付验收。'
        for index, experience in enumerate(resume['experiences']):
            experience['id'] = str(uuid.uuid5(uuid.NAMESPACE_URL, f'resumeflow-v4/{identity}/{index}'))
            experience['org'] = '望川企业服务（虚构）'
        if identity == 'P5L2':
            texts = [('运营人员反馈客户资料字段含义不统一。', '负责整理字段定义及验收规则。',
                      '核对字段定义并编写说明', '新说明通过运营验收并在试用环境使用。'),
                     ('客服人员需要统一处理工单交接。', '负责整理交接规则。',
                      '整理交接规则并完成验收', '交接说明已交付客服试用。')]
            for experience, text in zip(resume['experiences'], texts):
                experience['star'] = dict(zip(('s', 't', 'a', 'r'), text))
            sources = {e['id']: copy.deepcopy(e) for e in resume['experiences']}
            keys[identity] = {'tier': 'v4新留出：同类问题涉及两字段', 'defects': ['两段行动均缺标点'],
                              'boundary': '不得添加业务数字或新工具经历'}
        else:
            resume['experiences'] = resume['experiences'][:1]
            experience = resume['experiences'][0]
            experience['star'] = {'s': '企业客户的批量导入任务经常需要排队。', 't': '负责导入状态提示需求和验收。',
                'a': '梳理等待状态和错误反馈，与研发核对提示文案及验收规则。',
                'r': '上线后连续5周观察60家企业，平均重复提交次数从4次降至2次。同期后台任务容量也增加，结果不能单独归因于状态提示改版。'}
            sources = {experience['id']: copy.deepcopy(experience)}
            experience['star']['r'] = '系统上线了。'
            keys[identity] = {'tier': 'v4新留出：完整成果与并行措施', 'defects': ['成果与归因说明遗漏'],
                              'boundary': '保留5周、60家、4次到2次和后台容量增加的说明'}
        cases.append({'id': identity, 'resume': resume, 'sources': sources})
    return cases, keys
