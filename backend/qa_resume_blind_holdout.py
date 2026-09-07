"""Unseen content, fixed before inspecting its scores; separate from tuning cases."""
import asyncio,copy,json,sys
import qa_resume_blind_benchmark as b
b.reject_retired_numeric_run()

original=b.OUT
suffix=sys.argv[1] if len(sys.argv)>1 else ''
if suffix and not suffix.isalnum():raise SystemExit('Use an alphanumeric wave suffix')
b.OUT=original.with_name(original.name+'-holdout'+suffix)
b.IDS=['H4Q1','H9S2']
base=json.loads((original/'fixtures.json').read_text(encoding='utf-8'))['samples'][2]
samples=[]
artifacts={}
for index,bid in enumerate(b.IDS):
    r=copy.deepcopy(base['resume'])
    e=r['experiences'][0];e['id']=b.uid(bid+'/experience');e['org']='岚舟协作软件（虚构）'
    if index==0:
        r['personal_summary']='具备企业协作软件产品经验，负责审批流程调研、需求说明与交付验收，能够使用SQL核对流程数据。'
        e['star']={'s':'企业权限申请需要多级确认，2024年1月平均等待时间为72小时。','t':'负责梳理审批需求和验收标准，协助项目负责人推进流程改版，不承担项目整体管理。','a':'访谈15名管理员，用SQL核对审批流转记录并梳理阻塞节点。<br>编写需求说明，与设计研发共同验证分级审批方案并完成验收。','r':'上线后连续4周记录30家企业的申请，平均等待时间从72小时降至24小时。结果由团队协作实现，个人负责需求与验收环节。'}
        label='未见过的高证据样本';defects=[]
    else:
        r['personal_summary']='有企业协作软件的产品需求与交付经验。'
        e['star']={'s':'企业管理员反馈权限申请流程难以理解。','t':'负责梳理权限申请需求及验收规则。','a':'访谈15名管理员，整理20条反馈需求并完成需求说明','r':'交付的新流程通过验收并部署到内部试用环境。'}
        label='未见过的定性结果与过程计数样本';defects=['行动句缺少句号','只有过程计数，不能虚构业务结果或把定性结果判为缺失']
    r['experiences']=[e]
    sources={e['id']:copy.deepcopy(e)}
    samples.append({'id':bid,'resume':r,'sources':sources})
    artifacts['key-'+bid+'.json']={'tier':label,'defects':defects}
artifacts['fixtures.json']={'jd':b.JD,'target_role':b.ROLE,'samples':samples}
artifacts['protocol.json']={'blinding':'Unseen content; labels and defects excluded from all scoring/planning calls','repeats':3,'optimizations':2,'post_repeats':3,'expected':'H4Q1 must retain shared ownership; H9S2 must not invent numeric business results','original_call_boundary':'same production core services, not HTTP apply'}
b.prepare_frozen_wave_output(b.qa_algorithm_hashes(__file__),artifacts)
asyncio.run(b.run('qa-blind-20260906'))
