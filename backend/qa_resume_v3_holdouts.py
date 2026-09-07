"""Two fixed unseen cases for the v3 acceptance wave; not used by unit tests."""
import copy
import uuid


def make_holdouts(base):
    result = []
    keys = {}
    for identity in ('N6D2', 'N4T8'):
        resume = copy.deepcopy(base['resume'])
        experience = resume['experiences'][0]
        experience['id'] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'resumeflow-v3/' + identity))
        experience['org'] = '青屿企业软件（虚构）'
        experience['title'] = '产品经理'
        resume['experiences'] = [experience]
        if identity == 'N6D2':
            resume['personal_summary'] = '具备企业软件产品需求梳理和验收经验。'
            experience['star'] = {
                's': '客户服务人员反馈工单转交说明不清晰。',
                't': '负责整理工单转交需求和验收规则。',
                'a': '访谈客服同事，梳理转交场景并编写需求说明',
                'r': '新说明通过业务验收，并用于客服试用。',
            }
            sources = {experience['id']: copy.deepcopy(experience)}
            keys[identity] = {'tier': '新留出：定性成果', 'defects': ['行动末尾缺句号'],
                              'boundary': '保留定性成果，不增加数字或未提供的工具使用事实'}
        else:
            resume['personal_summary'] = '参与企业软件需求分析与上线验收。'
            experience['star'] = {
                's': '企业试用客户的资料提交流程存在反复补件。',
                't': '负责资料字段需求梳理与验收，配合研发改进提交提示。',
                'a': '整理补件原因，编写字段说明及验收清单，与研发核对提示规则。',
                'r': '上线后连续6周记录80家试用企业，平均补件次数从3次降至2次。同期客服增加了说明培训，结果由多项措施共同产生，不能全部归因于提示改版。',
            }
            sources = {experience['id']: copy.deepcopy(experience)}
            experience['star']['r'] = '流程上线了。'
            keys[identity] = {'tier': '新留出：成果遗漏与归因限制', 'defects': ['来源已有完整成果但当前遗漏'],
                              'boundary': '保留6周、80家、3次到2次及客服培训归因限制'}
        result.append({'id': identity, 'resume': resume, 'sources': sources})
    return result, keys
