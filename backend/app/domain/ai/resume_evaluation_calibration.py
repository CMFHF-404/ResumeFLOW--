"""Deterministic field coverage and evidence coverage for newly generated reports.

This does not rescore historical reports and does not classify business vocabulary.
The model identifies semantic support; code counts distinct supported experiences.
"""
from __future__ import annotations
from copy import deepcopy
import re
from collections import Counter,defaultdict
from typing import Any
from .resume_evaluation import (
    _POSITIVE_EVIDENCE_STATUSES, _build_fact_index, normalize_resume_evaluation,
)

_CALENDAR_DATE = re.compile(
    r"\b\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?\b|"
    r"\d{4}年(?:\d{1,2}月)?(?:\d{1,2}[日号])?|"
    r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b",
    re.IGNORECASE,
)

# Only fixed-duration units are interchangeable here; calendar months and years
# are not fixed numbers of days. English sub-day units already parse as seconds.
_BASELINE_DURATION_UNITS = frozenset({
    "毫秒", "秒", "分钟", "小时", "天", "周", "seconds", "days", "weeks",
})


def _baseline_comparison_unit(unit: str) -> str:
    numerator, separator, period = unit.partition("/")
    if numerator in _BASELINE_DURATION_UNITS:
        # Preserve rate denominators: hours/week and minutes/day are not the
        # same observation basis merely because their numerators are durations.
        return "seconds" + separator + period
    return unit


def calibrate_evaluation(result: dict[str, Any], evaluation_input: dict[str, Any]) -> dict[str, Any]:
    resume=evaluation_input.get("resume")
    if not isinstance(resume,dict) or not isinstance(resume.get("experiences"),list):
        return result  # Legacy unstructured inputs have no reliable coverage denominator.
    experiences=resume["experiences"]
    if not all(isinstance(x,dict) for x in experiences):
        return result
    # Reuse the report validator's aliases and whitespace normalization so its
    # accepted fact IDs and verification statuses keep the same meaning here.
    facts = [{
        "fact_id": fact_id,
        "content": fact["content"],
        "source": fact["source"],
        "verification_status": fact["verificationStatus"],
    } for fact_id, fact in _build_fact_index(
        evaluation_input.get("fact_metadata", [])
    ).items()]
    positive=[f for f in facts if f.get("verification_status") in {"verified","user_claimed"}]
    e=deepcopy(result["resumeEvaluation"])
    evidence={x["evidenceId"]:x for x in e["evidence"]}
    facts_by_id={f["fact_id"]:f for f in facts}

    def matching(pattern):
        return [f for f in positive if re.fullmatch(pattern,str(f.get("source",""))) and str(f.get("content","")).strip()]

    def refs(items):
        ids=[]
        for f in items:
            existing=next((x for x in e["evidence"] if x["factId"]==f["fact_id"]),None)
            if existing is None:
                eid="RUBRIC_E_"+str(len(e["evidence"])+1)
                while eid in evidence:eid+="_"
                existing={"evidenceId":eid,"factId":f["fact_id"],"sourceText":f["content"],"location":f["source"],"verificationStatus":f["verification_status"],"supportedDimensions":[]}
                e["evidence"].append(existing);evidence[eid]=existing
            ids.append(existing["evidenceId"])
        return list(dict.fromkeys(ids))

    def replace_issues(dimension, descriptions, *, rebuild_priorities=False):
        removed=set(dimension["issues"])
        e["issues"]=[i for i in e["issues"] if i["issueId"] not in removed]
        e["topPriorities"]=[p for p in e["topPriorities"] if p["issueId"] not in removed]
        dimension["issues"]=[]
        used={i["issueId"] for i in e["issues"]}
        for index,(description,gap) in enumerate(descriptions):
            iid=f"RUBRIC_{dimension['dimension']}_{index}"
            while iid in used:iid+="_"
            used.add(iid);dimension["issues"].append(iid)
            e["issues"].append({"issueId":iid,"description":description,"primaryDimension":dimension["dimension"],"relatedDimensions":[],"evidenceIds":[],"severity":"medium","pointsNotEarned":gap})
            if rebuild_priorities and len(e["topPriorities"]) < 100:
                e["topPriorities"].append({"issueId": iid,
                    "priority": len(e["topPriorities"]) + 1,
                    "action": description, "expectedScoreGain": gap})

    complete=next(d for d in e["dimensions"] if d["dimension"]=="内容完整")
    fixed={}
    profile=[matching(r"resume\.profile\."+key) for key in ("name","email","phone")]
    fixed["基础信息"]=(round_ratio(10,sum(bool(x) for x in profile),3),sum(profile,[]))
    education=resume.get("educations",[])
    if not isinstance(education,list):education=[]
    education_fields=[matching(r"resume\.educations\["+str(i)+r"\]\."+key) for i in range(len(education)) for key in ("school","major","degree")]
    fixed["教育经历"]=(round_ratio(15,sum(bool(x) for x in education_fields),len(education_fields)),sum(education_fields,[]))
    core=matching(r"resume\.experiences\[\d+\]\.(title|org|star\.[star])")
    fixed["核心经历模块"]=(25 if core else 0,core)
    necessary=[matching(r"resume\.experiences\["+str(i)+r"\]\."+key) for i in range(len(experiences)) for key in ("title","org","start_date","end_date")]
    fixed["经历必要字段"]=(round_ratio(20,sum(bool(x) for x in necessary),len(necessary)),sum(necessary,[]))
    skills=matching(r"resume\.skills\[\d+\]\.name")
    certifications=matching(r"resume\.certifications\[\d+\]\.name")
    fixed["技能与资格"]=(15 if skills else (8 if certifications else 0),skills or certifications)
    supplemental=certifications or [f for i,x in enumerate(experiences) if x.get("category")=="project" for f in matching(r"resume\.experiences\["+str(i)+r"\]\.title")]
    fixed["补充信息"]=(5 if supplemental else 0,supplemental)
    # Rebuild deterministic gaps at field granularity instead of discarding
    # actionable locations when the calibration replaces model issue IDs.
    missing = {
        "基础信息": [f"基础信息缺少{label}，请补充。" for items, label in zip(profile, ("姓名", "邮箱", "电话")) if not items],
        "教育经历": [f"第{index // 3 + 1}条教育经历缺少{('学校', '专业', '学历')[index % 3]}，请补充。"
                     for index, items in enumerate(education_fields) if not items]
                    or (["未选择教育经历，请补充并选择真实教育信息。"] if not education else []),
        "核心经历模块": ["缺少可确认的核心经历，请补充并选择工作或项目经历。"],
        "经历必要字段": [f"第{index // 4 + 1}条经历缺少{('职位或项目名称', '组织名称', '开始日期', '结束日期或至今标记')[index % 4]}，请补充。"
                        for index, items in enumerate(necessary) if not items]
                       or (["未选择工作或项目经历，请补充并选择真实经历。"] if not experiences else []),
        "技能与资格": ["缺少已选技能，请补充并选择能够确认的技能。"],
        "求职方向": ["求职方向尚不明确，请补充具体目标岗位及方向。"],
        "补充信息": ["缺少补充信息，请按实际情况添加相关项目或证书。"],
    }
    gaps=[]
    for sub in complete["subscores"]:
        if sub["name"] in fixed:
            sub["score"],sources=fixed[sub["name"]]
            sub["evidenceIds"]=refs(sources) if sub["score"] else []
        if sub["score"]<sub["maxScore"]:
            descriptions = missing[sub["name"]]
            gap = sub["maxScore"] - sub["score"]
            points, remainder = divmod(gap, len(descriptions))
            gaps.extend((description, points + (index < remainder))
                        for index, description in enumerate(descriptions))
    replace_issues(complete,gaps,rebuild_priorities=True)
    if not sum(s["score"] for s in complete["subscores"]):complete["strengths"]=[]

    # Reuse the shared multilingual numeric parser, never business-keyword rules.
    from ..resume_optimization.safety import _numeric_expressions_from_visible, _fact_visible_text
    quant=next(d for d in e["dimensions"] if d["dimension"]=="成果量化")
    for sub in quant["subscores"]:
        # Zero-point citations may explain missing support. Numeric text alone
        # cannot overturn the evaluator's semantic verdict for this criterion.
        if sub["score"] == 0:
            sub["evidenceIds"] = []
            continue
        covered=set();kept=[]; units_by_experience=defaultdict(list); refs_by_experience=defaultdict(list); seen_facts=set()
        for eid in sub["evidenceIds"]:
            ev=evidence[eid];fact=facts_by_id[ev["factId"]]
            if (ev["verificationStatus"] not in _POSITIVE_EVIDENCE_STATUSES
                    or fact["verification_status"] not in _POSITIVE_EVIDENCE_STATUSES):
                continue
            if ev["factId"] in seen_facts:continue
            seen_facts.add(ev["factId"])
            match=re.fullmatch(r"resume\.experiences\[(\d+)\]\.star\.([star])",str(fact.get("source","")))
            if not match or int(match[1])>=len(experiences):continue
            # An achieved result may appear in any STAR field. Its semantic
            # support comes from the model, not the field's letter.
            if sub["name"]=="过程数量" and match[2] not in {"a","r"}:continue
            visible=_fact_visible_text(fact["content"])
            dates=list(_CALENDAR_DATE.finditer(visible))
            numbers=[n for n in _numeric_expressions_from_visible(visible)
                     if not (n.negated or n.conditional or n.contradictory)
                     and not any(n.start<d.end() and n.end>d.start() for d in dates)]
            if not numbers:continue
            covered.add(int(match[1]));kept.append(eid)
            units_by_experience[int(match[1])].extend(
                _baseline_comparison_unit(n.unit) for n in numbers
            )
            refs_by_experience[int(match[1])].append(eid)
        if sub["name"]=="基线与前后对比":
            covered={i for i,units in units_by_experience.items() if any(n>=2 for n in Counter(units).values())}
            kept=list(dict.fromkeys(eid for i in covered for eid in refs_by_experience[i]))
        sub["score"]=round_ratio(sub["maxScore"],len(covered),len(experiences))
        sub["evidenceIds"]=kept if sub["score"] else []
    quant_total=sum(s["score"] for s in quant["subscores"])
    if not quant_total:quant["strengths"]=[]
    if quant_total==100:replace_issues(quant,[])
    elif not quant["issues"]:
        replace_issues(quant,[("量化分项尚未获得覆盖全部经历的有效证据。",100-quant_total)])
    exaggerated=[r for r in e["riskFlags"] if r["type"]=="exaggerated_claim"]
    if exaggerated:
        professional=next(d for d in e["dimensions"] if d["dimension"]=="专业表达")
        objective=next(s for s in professional["subscores"] if s["name"]=="客观与可信")
        previous_score=objective["score"]
        objective["score"]=0;objective["evidenceIds"]=[]
        # Keep each existing issue; add an explicit grounded explanation for this
        # consistency constraint instead of spreading its gap over unrelated issues.
        iid="RUBRIC_EXAGGERATED_CLAIM"
        used={i["issueId"] for i in e["issues"]}
        while iid in used:iid+="_"
        if previous_score:
            professional["issues"].append(iid)
            e["issues"].append({"issueId":iid,"description":"存在已识别的夸大陈述，客观与可信分项不得获得正分。","primaryDimension":"专业表达","relatedDimensions":[],"evidenceIds":list(dict.fromkeys(x for r in exaggerated for x in r["evidenceIds"])),"severity":"high","pointsNotEarned":previous_score})
        if not sum(s["score"] for s in professional["subscores"]):professional["strengths"]=[]
    positive_ids={eid for d in e["dimensions"] for s in d["subscores"] if s["score"]>0 for eid in s["evidenceIds"]}
    if any(evidence[eid]["verificationStatus"]=="user_claimed" for eid in positive_ids):
        e["evaluationConfidence"]=min(e["evaluationConfidence"],0.89)
    normalized=normalize_resume_evaluation(e,jd_available=bool(evaluation_input.get("jd_text","")),fact_metadata=facts)
    return {"resumeEvaluation":normalized}


def round_ratio(maximum:int, covered:int, total:int)->int:
    return (maximum*covered*2+total)//(2*total) if total else 0
