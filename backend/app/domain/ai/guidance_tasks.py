"""Server-owned task contract for the guidance_audit_v1 evaluator.

The language model fills only semantic judgments. Task identity, source scope,
deterministic coverage, internal bands, and internal normalized points stay under
server control.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
import re
from typing import Any, Dict, Iterable, Mapping, Sequence

from .resume_evaluation import DIMENSION_SUBSCORES, _build_fact_index
from .public_errors import ResumeEvaluationInputError
from .resume_evaluation_basis import DEFECTS, LEVEL_POINTS, _grammar_targets
from .resume_evaluation_calibration import (
    _CALENDAR_DATE,
    _baseline_comparison_unit,
)
from .resume_evaluation_rubric import RUBRIC_VERSION, STAR_ASSESSMENTS


TASK_RUBRIC_VERSION = f"guidance_task_rubric_v1__{RUBRIC_VERSION}"

# This prompt deliberately contains no numeric marks. The server-owned task
# metadata carries internal normalized values for assembly and regression checks.
TASK_RULES = """
Complete every supplied semantic task once, using only that task's allowed source
references. Judge the named criterion from the resume evidence itself. Do not add
facts, task identities, source paths, priorities, issue identities, or arithmetic.

Ordinary concrete work can be fully supported without senior ownership, named
methods, fashionable terminology, or business metrics. Accurate everyday work
terms are valid professional language. Collaboration and support work are valid
responsibility boundaries. User claims can support wording judgments when they
are bounded and internally consistent.

Professional assessment levels have fixed semantic boundaries. met means 该项没有可观察缺陷。
minor means 局部轻微缺陷 while the remaining evidence meets the criterion. material
means 满足标准的内容与真实缺陷并存. predominantly_vague means 几乎全部是泛化占位表述,
not merely one localized weakness. absent means 没有该项合格证据或存在矛盾. For action
verbs, ordinary concrete actions are sufficient. For terminology, judge 术语是否准确,
not 术语密度 or sophistication. An 明确的行动和对象 can satisfy precision and 不要求数字
or length. A clearly bounded 协作或支持职责 can satisfy responsibility and 不要求领导职责
or sole ownership. For objectivity, 边界清楚且不自相矛盾 is sufficient; 用户陈述可以支持
the judgment without external verification when the wording stays bounded.
When concrete actions and objects remain after deleting duplicate or filler words,
STAR行动不应降级; a harmless safe cleanup may accompany the strong STAR judgment.
表达精确度可以标记局部缺陷 when a removable vague phrase sits beside concrete work.
A repeated sentence or phrase belongs to 重复与冗余. 信息密度只判断不同的拥挤或低价值信息;
do not report the same repetition again as a density defect.
句子清晰度 checks whether the existing sentence can be understood. A grammatical,
understandable but generic duty is not an unclear sentence merely because it lacks
execution detail: evaluate that gap under STAR or professional precision instead.
Deleting repetition or filler is not a request for new facts. Request clarification
only when a distinct necessary subject, reference or meaning truly cannot be resolved
from the existing same-experience text.

For STAR, read all allowed STAR facts from the same experience. A qualitative
deliverable, acceptance, launch, or use is a result. A concrete action states what
was done and to what or whom. Generic role labels and unspecified related work are
generic actions rather than partial concrete actions. Never borrow facts from a
different experience.
For Result, clear_result names an actual delivered, launched, accepted, deployed,
or used outcome; numbers are not required. partial_result names an actual outcome
whose meaning is incomplete. generic_completion only says work was completed
without naming what resulted. A negated, planned, conditional, expected, or hoped
future event is not an achieved result.

For quantitative criteria, an allowed source is only a server-detected numeric
candidate. Decide whether its meaning supports the named criterion. A process
count is not automatically a business result or rollout reach. Observation time
is distinct from employment dates. Before and after values must be comparable.
Missing metrics do not invalidate qualitative work. When useful, ask only whether
the user has genuine evidence they can add; never request an invented number.
结果指标 requires an achieved output or outcome of the described work. A number that
only describes the earlier problem or baseline is not an achieved result metric;
never infer an after-result from that baseline. Read semantics across all allowed
STAR sources, without assuming every number in an experience is its outcome.
数据可信度 also accepts a clearly scoped process count with an identifiable unit,
object and responsibility boundary. It does not require a business-result metric,
advanced statistical methods or independent external certification. If a process
count is supported, do not reject its credibility merely because business impact
is absent. Keep observation time and concurrent-measure attribution limits intact.

Terminal punctuation is handled by code. The grammar task covers other actual
grammar or natural-language defects. Missing facts require needs_information.
Use safe_cleanup only for changes supported by existing text, such as grammar,
punctuation, redundancy, or removing an unsupported overstatement. Suggestions
must remain actionable and must not imply facts absent from the sources.
""".strip()


_BANDS = ("strong", "adequate", "needs_attention", "insufficient_evidence")
_POSITIVE_STATUSES = frozenset(("verified", "user_claimed"))

_LOGIC_TASKS = (
    ("GLOBAL_LOGIC_ORDER", "信息顺序", "resume", "LOGIC_ORDER"),
    ("GLOBAL_LOGIC_CAUSALITY", "因果关系", "resume", "LOGIC_CAUSALITY"),
    ("GLOBAL_LOGIC_HIERARCHY", "信息层级", "resume", "LOGIC_HIERARCHY"),
    ("GLOBAL_LOGIC_FOCUS", "一致性与聚焦", "resume", "LOGIC_FOCUS"),
)

_READABILITY_TASKS = (
    ("GLOBAL_READABILITY_SCAN", "扫读结构", "resume", "READABILITY_SCAN"),
    ("GLOBAL_READABILITY_SENTENCES", "句子清晰度", "resume", "READABILITY_SENTENCES"),
    ("GLOBAL_READABILITY_DENSITY", "信息密度", "resume", "READABILITY_DENSITY"),
    ("GLOBAL_READABILITY_GRAMMAR", "语法与自然度", "resume", "READABILITY_GRAMMAR"),
    ("GLOBAL_READABILITY_REDUNDANCY", "重复与冗余", "resume", "READABILITY_REDUNDANCY"),
)

_STAR_TASKS = (
    ("SITUATION", "Situation情境", "s"),
    ("TASK", "Task任务", "t"),
    ("ACTION", "Action行动", "a"),
    ("RESULT", "Result结果", "r"),
)

_PROFESSIONAL_IDS = {
    "行动动词": "ACTION_VERBS",
    "岗位术语": "TERMINOLOGY",
    "表达精确度": "PRECISION",
    "贡献与责任边界": "RESPONSIBILITY",
    "客观与可信": "OBJECTIVITY",
}

_QUANT_IDS = {
    "结果指标": "RESULT_METRIC",
    "基线与前后对比": "BASELINE_COMPARISON",
    "覆盖规模": "COVERAGE_SCALE",
    "时间窗口": "TIME_WINDOW",
    "过程数量": "PROCESS_QUANTITY",
    "数据可信度": "DATA_CREDIBILITY",
}

_QUANT_OPTIONAL_COPY = {
    "结果指标": (
        "当前经历以定性成果为主，尚未提供可确认的结果指标。",
        "如有真实记录，可补充结果指标、统计口径和个人归属；没有则保留原文。",
    ),
    "基线与前后对比": (
        "当前经历尚未提供可确认的基线与前后对比。",
        "如有真实记录，可补充基线与前后对比及一致口径；没有则保留原文。",
    ),
    "覆盖规模": (
        "当前经历尚未提供可确认的覆盖规模。",
        "如有真实记录，可补充业务或服务的覆盖规模及范围；没有则保留原文。",
    ),
    "时间窗口": (
        "当前经历尚未提供可确认的时间窗口。",
        "如有真实记录，可补充测量或观察的时间窗口；没有则保留原文。",
    ),
    "过程数量": (
        "当前经历尚未提供可确认的过程数量。",
        "如有真实记录，可补充实际行动或交付物的过程数量；没有则保留原文。",
    ),
    "数据可信度": (
        "当前经历尚未提供可确认的数据可信度信息。",
        "如有真实记录，可补充数据可信度所需的口径、范围和个人归属；没有则保留原文。",
    ),
}

_COMPLETENESS = {
    name: maximum for name, maximum in dict(DIMENSION_SUBSCORES)["内容完整"]
}

_SAFE_CLEANUP_CRITERIA = frozenset(
    (
        "信息顺序",
        "信息层级",
        "一致性与聚焦",
        "扫读结构",
        "句子清晰度",
        "信息密度",
        "语法与自然度",
        "重复与冗余",
        "表达精确度",
        "标点",
        "risk:exaggerated_claim",
    )
)

_NEEDS_INFORMATION_PROMPTS = {
    "信息顺序": "补充各段经历的真实时间或关联，以便确认顺序。",
    "因果关系": "补充实际行动与结果之间可确认的联系。",
    "信息层级": "补充现有内容所属的真实模块或经历。",
    "一致性与聚焦": "补充希望突出且真实的目标职能。",
    "Situation情境": "补充该经历真实的背景、对象或问题。",
    "Task任务": "补充该经历中实际承担的任务或目标。",
    "Action行动": "补充实际采取的动作、处理对象和个人职责。",
    "Result结果": "补充实际交付、验收、上线或投入使用的结果。",
    "扫读结构": "补充现有内容所属的真实模块或要点。",
    "句子清晰度": "说明原文中指代不清的内容实际表示什么。",
    "信息密度": "补充能够确认的具体工作内容；没有则保留原文。",
    "语法与自然度": "确认原句希望表达的真实含义。",
    "重复与冗余": "确认重复表述是否指向不同的真实内容。",
    "求职方向": "补充真实的目标职能或方向。",
    "行动动词": "补充实际采取的动作和处理对象。",
    "岗位术语": "补充实际使用且能确认的工作对象、工具或业务术语。",
    "表达精确度": "说明泛化表述实际指向的动作或对象。",
    "贡献与责任边界": "补充本人实际承担的职责以及协作边界。",
    "客观与可信": "确认陈述的事实边界、条件和个人归属。",
    "结果指标": _QUANT_OPTIONAL_COPY["结果指标"][1],
    "基线与前后对比": _QUANT_OPTIONAL_COPY["基线与前后对比"][1],
    "覆盖规模": _QUANT_OPTIONAL_COPY["覆盖规模"][1],
    "时间窗口": _QUANT_OPTIONAL_COPY["时间窗口"][1],
    "过程数量": _QUANT_OPTIONAL_COPY["过程数量"][1],
    "数据可信度": _QUANT_OPTIONAL_COPY["数据可信度"][1],
    "risk:exaggerated_claim": "确认该表述的事实边界和个人归属。",
    "risk:conflicting_date": "核对并补充正确的起止时间。",
}

_SAFE_CLEANUP_PROMPTS = {
    "信息顺序": "仅调整现有模块或经历顺序，不添加新内容。",
    "信息层级": "仅用现有标题和要点重组层级，不添加新内容。",
    "一致性与聚焦": "删除偏离方向或重复的已有表述，保留真实内容。",
    "扫读结构": "仅调整现有模块或要点顺序，不扩写正文。",
    "句子清晰度": "删除影响理解的重复或填充词，保持原意。",
    "信息密度": "删除重复或低信息量短语，保留已有事实。",
    "语法与自然度": "仅修正文法或措辞，不改变事实含义。",
    "重复与冗余": "删除重复词句，保留一次完整陈述。",
    "表达精确度": "删除已有具体内容旁的模糊填充词。",
    "标点": "补齐缺失的句末标点。",
    "risk:exaggerated_claim": "删除绝对化或超出来源支持的词语，保留可确认事实。",
}

_STAR_SAFE_CLEANUP_PROMPT = "删除重复或无信息量短语，保留已有具体内容。"

_DESCRIPTIONS = {
    "信息顺序": {"minor_issues": "部分信息顺序影响快速理解。", "needs_revision": "信息顺序需要重新整理。", "insufficient_evidence": "缺少可判断信息顺序的内容。"},
    "因果关系": {"minor_issues": "部分行动与结果的联系不够清楚。", "needs_revision": "行动与结果之间缺少清楚联系。", "insufficient_evidence": "缺少可判断因果关系的内容。"},
    "信息层级": {"minor_issues": "部分内容层级不够清楚。", "needs_revision": "信息层级需要重新整理。", "insufficient_evidence": "缺少可判断信息层级的内容。"},
    "一致性与聚焦": {"minor_issues": "部分内容与主要方向关联较弱。", "needs_revision": "内容方向较分散，需要聚焦。", "insufficient_evidence": "缺少可判断方向一致性的内容。"},
    "扫读结构": {"minor_issues": "部分模块或要点不便快速扫读。", "needs_revision": "现有结构不便快速扫读。", "insufficient_evidence": "缺少可判断扫读结构的内容。"},
    "句子清晰度": {"minor_issues": "部分句子含义不够清楚。", "needs_revision": "多处句子含义需要澄清。", "insufficient_evidence": "缺少可判断句子清晰度的内容。"},
    "信息密度": {"minor_issues": "部分表述信息量较低。", "needs_revision": "正文中低信息量表述较多。", "insufficient_evidence": "缺少可判断信息密度的内容。"},
    "语法与自然度": {"minor_issues": "部分语句不够自然。", "needs_revision": "多处语句需要整理。", "insufficient_evidence": "缺少可判断语法与自然度的内容。"},
    "重复与冗余": {"minor_issues": "存在局部重复或冗余。", "needs_revision": "重复或冗余表述较多。", "insufficient_evidence": "缺少可判断重复情况的内容。"},
    "Situation情境": {"partial_context": "经历背景或问题描述不完整。", "absent": "缺少可确认的经历背景或问题。"},
    "Task任务": {"partial_task": "实际任务或目标描述不完整。", "absent": "缺少可确认的任务或目标。"},
    "Action行动": {"partial_action": "行动或处理对象描述不完整。", "generic_role_only": "行动描述停留在泛化职责。", "absent": "缺少可确认的具体行动。"},
    "Result结果": {"partial_result": "实际结果的含义描述不完整。", "generic_completion": "只说明完成，未说明具体产出。", "absent": "缺少可确认的实际结果。"},
    "求职方向": {"domain": "简历体现了领域方向，但具体职能不够清楚。", "absent": "简历内缺少可确认的求职方向。"},
    "结果指标": {"absent": "当前经历尚未提供可确认的结果指标。"},
    "基线与前后对比": {"absent": "当前经历尚未提供可确认的基线与前后对比。"},
    "覆盖规模": {"absent": "当前经历尚未提供可确认的覆盖规模。"},
    "时间窗口": {"absent": "当前经历尚未提供可确认的时间窗口。"},
    "过程数量": {"absent": "当前经历尚未提供可确认的过程数量。"},
    "数据可信度": {"absent": "当前经历尚未提供可确认的数据口径、范围或归属。"},
    "risk:exaggerated_claim": {"present": "存在绝对化或超出来源支持的表述。"},
    "risk:conflicting_date": {"present": "经历或教育的起止时间存在冲突。"},
}

_PROFESSIONAL_DEFECT_DESCRIPTIONS = {
    "vague_action": "行动表述较泛化。",
    "missing_action": "缺少可识别的具体行动。",
    "incorrect_term": "部分工作术语使用不准确。",
    "no_identifiable_work_terms": "缺少可识别且有原文支持的工作术语。",
    "ambiguous_action_or_object": "行动或处理对象指代不清。",
    "ambiguous_responsibility": "个人职责或协作边界不清。",
    "inflated_ownership": "责任表述超出原文支持的边界。",
    "exaggeration": "存在夸大或绝对化表述。",
    "contradiction": "表述之间存在矛盾。",
    "unsupported_causality": "因果或贡献归属缺少原文支持。",
    "no_qualifying_evidence": "缺少可用于判断该项的专业表达内容。",
}


def _guidance_menu(dimension: str, criterion: str) -> list[Dict[str, str]]:
    menu = [{"type": "none", "prompt": ""}]
    prompt = _NEEDS_INFORMATION_PROMPTS.get(
        criterion, f"补充与{criterion}有关且可确认的真实信息。"
    )
    menu.append({"type": "needs_information", "prompt": prompt})
    safe_prompt = (
        _STAR_SAFE_CLEANUP_PROMPT
        if dimension == "STAR应用"
        else _SAFE_CLEANUP_PROMPTS.get(criterion)
    )
    if safe_prompt:
        menu.append({"type": "safe_cleanup", "prompt": safe_prompt})
    return menu


def _assessment_description(
    dimension: str, criterion: str, assessment: str, band: str
) -> str:
    fixed = _DESCRIPTIONS.get(criterion, {}).get(assessment)
    if fixed:
        return fixed
    if dimension == "专业表达" and ":" in assessment:
        level, _separator, defect = assessment.partition(":")
        base = _PROFESSIONAL_DEFECT_DESCRIPTIONS.get(
            defect, "该项专业表达需要改进。"
        )
        if level == "minor":
            return "存在局部问题：" + base
        if level == "material":
            return "合格内容与实际问题并存：" + base
        if level == "predominantly_vague":
            return "多数表述未达到该项要求：" + base
        return base
    band_defaults = {
        "strong": f"{criterion}有充分原文支持。",
        "adequate": f"{criterion}基本清楚，仍有局部不足。",
        "needs_attention": f"{criterion}需要改进。",
        "insufficient_evidence": f"缺少可判断{criterion}的内容。",
    }
    if assessment in {"present"} and criterion.startswith("risk:"):
        return "存在需要核对的事实风险。"
    return band_defaults[band]


def _register_server_judgment(
    task: Dict[str, Any], judgment: Mapping[str, Any]
) -> None:
    pair = {
        "type": judgment["guidance"]["type"],
        "prompt": judgment["guidance"]["prompt"],
    }
    if pair not in task["allowedGuidance"]:
        task["allowedGuidance"].append(pair)
    task["assessmentDescriptions"][judgment["assessment"]] = judgment["reason"]


def judgment_description(
    task: Mapping[str, Any], judgment: Mapping[str, Any]
) -> str:
    """Return only the server-owned public description for a judgment."""
    assessment = judgment.get("assessment")
    descriptions = task.get("assessmentDescriptions")
    if (
        not isinstance(assessment, str)
        or not isinstance(descriptions, Mapping)
        or assessment not in descriptions
        or not isinstance(descriptions[assessment], str)
        or not descriptions[assessment].strip()
    ):
        raise ValueError("guidance task is missing a server-owned description")
    description = descriptions[assessment].strip()
    field_path = task.get("fieldPath")
    match = (
        re.match(r"experiences\[(\d+)\]", field_path)
        if isinstance(field_path, str)
        else None
    )
    if match:
        return f"第{int(match.group(1)) + 1}段经历：{description}"
    return description


def _judgment(
    assessment: str,
    source_refs: Iterable[str],
    reason: str,
    guidance_type: str = "none",
    prompt: str = "",
) -> Dict[str, Any]:
    return {
        "assessment": assessment,
        "sourceRefs": list(dict.fromkeys(source_refs)),
        "reason": reason,
        "guidance": {"type": guidance_type, "prompt": prompt},
    }


def _task(
    task_id: str,
    dimension: str,
    criterion: str,
    field_path: str,
    allowed_sources: Sequence[str],
    assessments: Mapping[str, tuple[str, float]],
    maximum: int,
    *,
    optional: bool = False,
) -> Dict[str, Any]:
    bands = {name: band for name, (band, _points) in assessments.items()}
    points = {name: float(value) for name, (_band, value) in assessments.items()}
    if not set(bands.values()) <= set(_BANDS):
        raise ValueError("guidance task contains an invalid internal band")
    if any(value < 0 or value > 1 for value in points.values()):
        raise ValueError("guidance task contains invalid normalized points")
    return {
        "taskId": task_id,
        "dimension": dimension,
        "criterion": criterion,
        "fieldPath": field_path,
        "allowedSources": list(dict.fromkeys(allowed_sources)),
        "allowedAssessments": list(assessments),
        "assessmentBands": bands,
        "assessmentPoints": points,
        "maxScore": maximum,
        "optional": optional,
        "allowedGuidance": _guidance_menu(dimension, criterion),
        "assessmentDescriptions": {
            name: _assessment_description(dimension, criterion, name, band)
            for name, (band, _points) in assessments.items()
        },
    }


def _schema_object(properties: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": dict(properties),
        "required": list(properties),
        "additionalProperties": False,
    }


def _judgment_schema(task: Mapping[str, Any]) -> Dict[str, Any]:
    guidance_types = list(
        dict.fromkeys(pair["type"] for pair in task["allowedGuidance"])
    )
    guidance_prompts = list(
        dict.fromkeys(pair["prompt"] for pair in task["allowedGuidance"])
    )
    return _schema_object(
        {
            "assessment": {
                "type": "string",
                "enum": list(task["allowedAssessments"]),
            },
            "sourceRefs": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": list(task["allowedSources"]),
                },
                "maxItems": len(task["allowedSources"]),
                "uniqueItems": True,
            },
            "reason": {"type": "string", "minLength": 1, "maxLength": 500},
            "guidance": _schema_object(
                {
                    "type": {
                        "type": "string",
                        "enum": guidance_types,
                    },
                    "prompt": {
                        "type": "string",
                        "enum": guidance_prompts,
                        "maxLength": 500,
                    },
                }
            ),
        }
    )


def _source_matches(source: str, patterns: Sequence[str]) -> bool:
    return any(re.fullmatch(pattern, source) for pattern in patterns)


def _positive_sources(
    facts: Mapping[str, Mapping[str, str]],
    source_ids: Mapping[str, str],
    patterns: Sequence[str],
) -> list[str]:
    return [
        source_ids[fact_id]
        for fact_id, fact in facts.items()
        if fact["verificationStatus"] in _POSITIVE_STATUSES
        and _source_matches(fact["source"], patterns)
    ]


def _generic_assessments() -> Dict[str, tuple[str, float]]:
    return {
        "clear": ("strong", 1),
        "minor_issues": ("adequate", 0.75),
        "needs_revision": ("needs_attention", 0.5),
        "insufficient_evidence": ("insufficient_evidence", 0),
    }


def _professional_assessments(criterion: str) -> Dict[str, tuple[str, float]]:
    result: Dict[str, tuple[str, float]] = {
        "met": ("strong", 1),
        # The shared rubric explicitly distinguishes no qualifying evidence
        # from an observed defect. This choice also gives deterministic empty
        # targets a truthful enum instead of inventing a contradiction.
        "absent:no_qualifying_evidence": ("insufficient_evidence", 0),
    }
    band_by_level = {
        "minor": "adequate",
        "material": "needs_attention",
        "predominantly_vague": "needs_attention",
        "absent": "insufficient_evidence",
    }
    for level, points in LEVEL_POINTS.items():
        if level == "met":
            continue
        for defect in DEFECTS[criterion]:
            result[f"{level}:{defect}"] = (
                band_by_level[level],
                points / LEVEL_POINTS["met"],
            )
    return result


def _star_assessments(criterion: str) -> Dict[str, tuple[str, float]]:
    points = STAR_ASSESSMENTS[criterion]
    maximum = max(points.values())
    result: Dict[str, tuple[str, float]] = {}
    for assessment, value in points.items():
        if value == maximum:
            band = "strong"
        elif value == 0:
            band = "insufficient_evidence"
        elif assessment in {"generic_role_only", "generic_completion"}:
            band = "needs_attention"
        else:
            band = "adequate"
        result[assessment] = (band, value / maximum if maximum else 0)
    return result


def _coverage_assessments(partial_points: float = 0.5) -> Dict[str, tuple[str, float]]:
    return {
        "complete": ("strong", 1),
        "partial": ("needs_attention", partial_points),
        "absent": ("insufficient_evidence", 0),
    }


def _quant_absent_judgment(criterion: str) -> Dict[str, Any]:
    reason, prompt = _QUANT_OPTIONAL_COPY[criterion]
    return _judgment("absent", [], reason, "needs_information", prompt)


def _add_task(
    tasks: list[Dict[str, Any]],
    deterministic: Dict[str, Dict[str, Any]],
    row: Dict[str, Any],
    *,
    empty_judgment: Dict[str, Any] | None = None,
) -> None:
    if any(existing["taskId"] == row["taskId"] for existing in tasks):
        raise ValueError("duplicate server guidance task identity")
    tasks.append(row)
    if not row["allowedSources"] and empty_judgment is not None:
        _register_server_judgment(row, empty_judgment)
        deterministic[row["taskId"]] = empty_judgment


def _set_deterministic(
    deterministic: Dict[str, Dict[str, Any]],
    row: Dict[str, Any],
    judgment: Dict[str, Any],
) -> None:
    _register_server_judgment(row, judgment)
    deterministic[row["taskId"]] = judgment


def _deterministic_coverage(
    present: int,
    total: int,
    refs: Sequence[str],
    *,
    missing_prompt: str,
    optional: bool = False,
) -> tuple[Dict[str, tuple[str, float]], Dict[str, Any]]:
    ratio = present / total if total else 0
    assessments = _coverage_assessments(ratio if 0 < ratio < 1 else 0.5)
    if total and present == total:
        return assessments, _judgment("complete", refs, "所需字段均已有来源支持。")
    if present:
        return assessments, _judgment(
            "partial",
            refs,
            "部分所需字段已有来源，仍有字段缺失。",
            "needs_information",
            missing_prompt,
        )
    guidance_type = "none" if optional else "needs_information"
    prompt = "" if optional else missing_prompt
    return assessments, _judgment(
        "absent", [], "当前没有该项可确认信息。", guidance_type, prompt
    )


def _eligible_numeric_expressions(text: str) -> list[Any]:
    # Import here to avoid loading the large optimization safety module for
    # callers that only inspect constants from this module.
    from ..resume_optimization.safety import (
        _fact_visible_text,
        _numeric_expressions_from_visible,
    )

    visible = _fact_visible_text(text)
    dates = list(_CALENDAR_DATE.finditer(visible))
    return [
        expression
        for expression in _numeric_expressions_from_visible(visible)
        if not (expression.negated or expression.conditional or expression.contradictory)
        and not any(
            expression.start < date.end() and expression.end > date.start()
            for date in dates
        )
    ]


_RESULT_SUBJECT = r"(?:本|该)?(?:产品|系统|流程|功能|版本|周报|报告|模板|需求文档|文档|方案)"
_CLEAR_RESULT_PATTERNS = (
    re.compile(
        _RESULT_SUBJECT
        + r"(?:已|已经|成功)(?:上线|交付|发布|部署|落地|投入使用)"
    ),
    re.compile(
        _RESULT_SUBJECT + r"(?:上线|交付|发布|部署|落地)了"
    ),
    re.compile(
        _RESULT_SUBJECT
        + r"(?:(?:已|已经|成功)通过验收|通过了验收|验收(?:已|已经|成功)通过)"
    ),
)


def _has_clear_qualitative_result(
    facts: Mapping[str, Mapping[str, str]],
    source_ids: Mapping[str, str],
    allowed_sources: Sequence[str],
) -> bool:
    """Recognize only a short, affirmative named delivery in scoped facts."""
    allowed = set(allowed_sources)
    for fact_id, fact in facts.items():
        if (
            source_ids.get(fact_id) not in allowed
            or not fact["source"].endswith(".star.r")
        ):
            continue
        visible = re.sub(r"<[^>]+>", " ", fact["content"]).strip()
        if visible.endswith(("。", ".")):
            visible = visible[:-1].rstrip()
        if any(pattern.fullmatch(visible) for pattern in _CLEAR_RESULT_PATTERNS):
            return True
    return False


def _numeric_sources_by_criterion(
    facts: Mapping[str, Mapping[str, str]],
    source_ids: Mapping[str, str],
    experience_index: int,
) -> Dict[str, list[str]]:
    expressions_by_source: Dict[str, list[Any]] = {}
    letters_by_source: Dict[str, str] = {}
    pattern = re.compile(
        rf"resume\.experiences\[{experience_index}\]\.star\.([star])"
    )
    for fact_id, fact in facts.items():
        match = pattern.fullmatch(fact["source"])
        if not match or fact["verificationStatus"] not in _POSITIVE_STATUSES:
            continue
        expressions = _eligible_numeric_expressions(fact["content"])
        if expressions:
            source_id = source_ids[fact_id]
            expressions_by_source[source_id] = expressions
            letters_by_source[source_id] = match.group(1)

    all_sources = list(expressions_by_source)
    result = {criterion: list(all_sources) for criterion in _QUANT_IDS}
    result["过程数量"] = [
        source_id
        for source_id in all_sources
        if letters_by_source[source_id] in {"a", "r"}
    ]

    units = Counter(
        _baseline_comparison_unit(expression.unit)
        for expressions in expressions_by_source.values()
        for expression in expressions
    )
    comparable = {unit for unit, count in units.items() if count >= 2}
    result["基线与前后对比"] = [
        source_id
        for source_id, expressions in expressions_by_source.items()
        if any(
            _baseline_comparison_unit(expression.unit) in comparable
            for expression in expressions
        )
    ]
    return result


def build_task_contract(evaluation_input: Mapping[str, Any]) -> Dict[str, Any]:
    """Build the complete server-owned task and dynamic generation contract."""
    if not isinstance(evaluation_input, Mapping):
        raise ValueError("evaluation_input must be an object")
    resume_input = evaluation_input.get("resume", {})
    if not isinstance(resume_input, Mapping) or "raw_text" in resume_input:
        # Raw-text sources cannot establish field-level absence or ownership.
        # Reject before generation rather than fixing false missing-field tasks.
        raise ResumeEvaluationInputError()
    facts = _build_fact_index(evaluation_input.get("fact_metadata", []))
    sources: Dict[str, Dict[str, str]] = {}
    source_ids: Dict[str, str] = {}
    for index, (fact_id, fact) in enumerate(facts.items(), start=1):
        source_id = f"SRC_{index:03d}"
        source_ids[fact_id] = source_id
        sources[source_id] = {
            "factId": fact_id,
            "content": fact["content"],
            "source": fact["source"],
            "verificationStatus": fact["verificationStatus"],
        }

    resume = evaluation_input.get("resume")
    if not isinstance(resume, Mapping):
        resume = {}
    experiences_raw = resume.get("experiences", [])
    experiences = (
        list(experiences_raw)
        if isinstance(experiences_raw, list)
        and all(isinstance(item, Mapping) for item in experiences_raw)
        else []
    )
    tasks: list[Dict[str, Any]] = []
    deterministic: Dict[str, Dict[str, Any]] = {}

    logic_patterns = {
        "信息顺序": (
            r"resume\.section_order\[\d+\]",
            r"resume\.personal_summary",
            r"resume\.experiences\[\d+\]\.(?:title|org|start_date|end_date|star\.[star])",
            r"resume\.educations\[\d+\]\.(?:school|major|degree|start_date|end_date)",
            r"resume\.skills\[\d+\]\.name",
            r"resume\.certifications\[\d+\]\.name",
            r"resume\.raw_text",
        ),
        "因果关系": (
            r"resume\.personal_summary",
            r"resume\.experiences\[\d+\]\.star\.[star]",
            r"resume\.raw_text",
        ),
        "信息层级": (
            r"resume\.section_order\[\d+\]",
            r"resume\.personal_summary",
            r"resume\.experiences\[\d+\]\.(?:title|org|star\.[star])",
            r"resume\.educations\[\d+\]\.(?:school|major|degree)",
            r"resume\.skills\[\d+\]\.name",
            r"resume\.certifications\[\d+\]\.name",
            r"resume\.raw_text",
        ),
        "一致性与聚焦": (
            r"resume\.personal_summary",
            r"resume\.experiences\[\d+\]\.(?:title|star\.[star])",
            r"resume\.skills\[\d+\]\.name",
            r"resume\.raw_text",
        ),
    }
    logic_maxima = dict(dict(DIMENSION_SUBSCORES)["逻辑清晰"])
    for task_id, criterion, field_path, _slug in _LOGIC_TASKS:
        logic_sources = _positive_sources(
            facts, source_ids, logic_patterns[criterion]
        )
        _add_task(
            tasks,
            deterministic,
            _task(
                task_id,
                "逻辑清晰",
                criterion,
                field_path,
                logic_sources,
                _generic_assessments(),
                logic_maxima[criterion],
            ),
            empty_judgment=_judgment(
                "insufficient_evidence",
                [],
                "没有可用于判断该项的简历内容。",
                "needs_information",
                "请补充真实的简历内容后再评估。",
            ),
        )

    star_maxima = dict(dict(DIMENSION_SUBSCORES)["STAR应用"])
    professional_maxima = dict(dict(DIMENSION_SUBSCORES)["专业表达"])
    quant_maxima = dict(dict(DIMENSION_SUBSCORES)["成果量化"])
    if experiences:
        for index, _experience in enumerate(experiences):
            prefix = f"EXP_{index + 1:03d}"
            local_sources = _positive_sources(
                facts,
                source_ids,
                (rf"resume\.experiences\[{index}\]\.star\.[star]",),
            )
            for suffix, criterion, letter in _STAR_TASKS:
                star_assessments = _star_assessments(criterion)
                if criterion == "Result结果" and _has_clear_qualitative_result(
                    facts, source_ids, local_sources
                ):
                    star_assessments = {
                        "clear_result": star_assessments["clear_result"]
                    }
                row = _task(
                    f"{prefix}_STAR_{suffix}",
                    "STAR应用",
                    criterion,
                    f"experiences[{index}].star.{letter}",
                    local_sources,
                    star_assessments,
                    star_maxima[criterion],
                )
                _add_task(
                    tasks,
                    deterministic,
                    row,
                    empty_judgment=_judgment(
                        "absent",
                        [],
                        "当前经历没有可确认的STAR内容。",
                        "needs_information",
                        "请补充该经历中真实的情境、任务、行动或结果信息。",
                    ),
                )

            for criterion, suffix in _PROFESSIONAL_IDS.items():
                _add_task(
                    tasks,
                    deterministic,
                    _task(
                        f"{prefix}_PROFESSIONAL_{suffix}",
                        "专业表达",
                        criterion,
                        f"experiences[{index}].star",
                        local_sources,
                        _professional_assessments(criterion),
                        professional_maxima[criterion],
                    ),
                    empty_judgment=_judgment(
                        "absent:no_qualifying_evidence",
                        [],
                        "当前经历没有可用于判断专业表达的内容。",
                        "needs_information",
                        "请补充该经历中真实的职责、行动和结果。",
                    ),
                )

            numeric_sources = _numeric_sources_by_criterion(facts, source_ids, index)
            for criterion, suffix in _QUANT_IDS.items():
                allowed = numeric_sources[criterion]
                _add_task(
                    tasks,
                    deterministic,
                    _task(
                        f"{prefix}_QUANT_{suffix}",
                        "成果量化",
                        criterion,
                        f"experiences[{index}].star",
                        allowed,
                        {
                            "supported": ("strong", 1),
                            "absent": ("insufficient_evidence", 0),
                        },
                        quant_maxima[criterion],
                        optional=True,
                    ),
                    empty_judgment=_quant_absent_judgment(criterion),
                )
    else:
        # Structured empty resumes still need complete rubric coverage, but no
        # semantic decision is delegated when there is no experience evidence.
        for suffix, criterion, letter in _STAR_TASKS:
            row = _task(
                f"GLOBAL_STAR_{suffix}",
                "STAR应用",
                criterion,
                "experiences",
                [],
                _star_assessments(criterion),
                star_maxima[criterion],
            )
            _add_task(tasks, deterministic, row)
            _set_deterministic(
                deterministic,
                row,
                _judgment(
                    "absent", [], "没有可确认的经历内容。", "needs_information", "请补充真实经历。"
                ),
            )
        for criterion, suffix in _PROFESSIONAL_IDS.items():
            row = _task(
                f"GLOBAL_PROFESSIONAL_{suffix}",
                "专业表达",
                criterion,
                "experiences",
                [],
                _professional_assessments(criterion),
                professional_maxima[criterion],
            )
            _add_task(tasks, deterministic, row)
            _set_deterministic(
                deterministic,
                row,
                _judgment(
                    "absent:no_qualifying_evidence",
                    [],
                    "没有可确认的经历内容。",
                    "needs_information",
                    "请补充真实经历。",
                ),
            )
        for criterion, suffix in _QUANT_IDS.items():
            row = _task(
                f"GLOBAL_QUANT_{suffix}",
                "成果量化",
                criterion,
                "experiences",
                [],
                {"supported": ("strong", 1), "absent": ("insufficient_evidence", 0)},
                quant_maxima[criterion],
                optional=True,
            )
            _add_task(tasks, deterministic, row)
            _set_deterministic(
                deterministic, row, _quant_absent_judgment(criterion)
            )

    readability_patterns = {
        "扫读结构": (
            r"resume\.personal_summary",
            r"resume\.section_order\[\d+\]",
            r"resume\.experiences\[\d+\]\.(?:title|org|star\.[star])",
            r"resume\.raw_text",
        ),
        "句子清晰度": (
            r"resume\.personal_summary",
            r"resume\.experiences\[\d+\]\.star\.[star]",
            r"resume\.raw_text",
        ),
        "信息密度": (
            r"resume\.personal_summary",
            r"resume\.experiences\[\d+\]\.star\.[star]",
            r"resume\.raw_text",
        ),
        "语法与自然度": (
            r"resume\.personal_summary",
            r"resume\.experiences\[\d+\]\.star\.[star]",
            r"resume\.raw_text",
        ),
        "重复与冗余": (
            r"resume\.personal_summary",
            r"resume\.experiences\[\d+\]\.star\.[star]",
            r"resume\.raw_text",
        ),
    }
    readability_maxima = dict(dict(DIMENSION_SUBSCORES)["内容可读"])
    for task_id, criterion, field_path, _slug in _READABILITY_TASKS:
        readability_sources = _positive_sources(
            facts, source_ids, readability_patterns[criterion]
        )
        _add_task(
            tasks,
            deterministic,
            _task(
                task_id,
                "内容可读",
                criterion,
                field_path,
                readability_sources,
                _generic_assessments(),
                readability_maxima[criterion],
            ),
            empty_judgment=_judgment(
                "insufficient_evidence",
                [],
                "没有可用于判断可读性的正文。",
                "needs_information",
                "请补充真实的简历正文后再评估。",
            ),
        )

    _grammar_ids, punctuation = _grammar_targets(facts)
    punctuation_assessments = {
        "complete": ("strong", 1),
        "missing_terminal_punctuation": ("needs_attention", 0),
    }
    punctuation_occurrences = [
        source_ids[item["factId"]]
        for item in punctuation.values()
        if item["factId"] in source_ids
        for _index in range(max(1, int(item.get("missingMarks", 1))))
    ]
    if not punctuation_occurrences:
        punctuation_occurrences = [None]
    for index, source_ref in enumerate(punctuation_occurrences, start=1):
        punctuation_task = _task(
            f"GLOBAL_READABILITY_PUNCTUATION_{index:03d}",
            "内容可读",
            "标点",
            (
                sources[source_ref]["source"].removeprefix("resume.")
                if source_ref
                else "resume"
            ),
            [source_ref] if source_ref else [],
            punctuation_assessments,
            0,
            optional=True,
        )
        _add_task(tasks, deterministic, punctuation_task)
        punctuation_judgment = (
            _judgment(
                "missing_terminal_punctuation",
                [source_ref],
                "该句正文缺少句末标点。",
                "safe_cleanup",
                "补齐缺失的句末标点。",
            )
            if source_ref
            else _judgment("complete", [], "正文句末标点完整。")
        )
        _set_deterministic(deterministic, punctuation_task, punctuation_judgment)

    # Deterministic completeness tasks.
    def refs_for(patterns: Sequence[str]) -> list[str]:
        return _positive_sources(facts, source_ids, patterns)

    profile_fields = ("name", "email", "phone")
    profile_refs = [
        refs_for((rf"resume\.profile\.{field}",)) for field in profile_fields
    ]
    assessments, judgment = _deterministic_coverage(
        sum(bool(items) for items in profile_refs),
        len(profile_fields),
        [ref for items in profile_refs for ref in items],
        missing_prompt="请补充真实的姓名、邮箱或电话等缺失基础信息。",
    )
    missing_profile_labels = [
        label
        for label, refs in zip(("姓名", "邮箱", "电话"), profile_refs)
        if not refs
    ]
    if missing_profile_labels:
        missing_text = "、".join(missing_profile_labels)
        judgment["reason"] = f"基础信息缺少{missing_text}。"
        judgment["guidance"] = {
            "type": "needs_information",
            "prompt": f"请补充真实的{missing_text}。",
        }
    row = _task(
        "GLOBAL_COMPLETENESS_BASIC",
        "内容完整",
        "基础信息",
        "profile.name,profile.email,profile.phone",
        [ref for items in profile_refs for ref in items],
        assessments,
        _COMPLETENESS["基础信息"],
    )
    _add_task(tasks, deterministic, row)
    _set_deterministic(deterministic, row, judgment)

    education_raw = resume.get("educations", [])
    educations = education_raw if isinstance(education_raw, list) else []
    education_slots = [
        refs_for((rf"resume\.educations\[{index}\]\.{field}",))
        for index, item in enumerate(educations)
        if isinstance(item, Mapping)
        for field in ("school", "major", "degree")
    ]
    assessments, judgment = _deterministic_coverage(
        sum(bool(items) for items in education_slots),
        len(education_slots) or 3,
        [ref for items in education_slots for ref in items],
        missing_prompt="请补充真实的学校、专业和学历信息。",
    )
    row = _task(
        "GLOBAL_COMPLETENESS_EDUCATION",
        "内容完整",
        "教育经历",
        "educations",
        [ref for items in education_slots for ref in items],
        assessments,
        _COMPLETENESS["教育经历"],
    )
    _add_task(tasks, deterministic, row)
    _set_deterministic(deterministic, row, judgment)

    core_refs = refs_for(
        (r"resume\.experiences\[\d+\]\.(?:title|org|star\.[star])",)
    )
    assessments, judgment = _deterministic_coverage(
        1 if core_refs else 0,
        1,
        core_refs,
        missing_prompt="请补充并选择真实的工作或项目经历。",
    )
    row = _task(
        "GLOBAL_COMPLETENESS_CORE_EXPERIENCE",
        "内容完整",
        "核心经历模块",
        "experiences",
        core_refs,
        assessments,
        _COMPLETENESS["核心经历模块"],
    )
    _add_task(tasks, deterministic, row)
    _set_deterministic(deterministic, row, judgment)

    necessary_slots: list[list[str]] = []
    for index, experience in enumerate(experiences):
        for field in ("title", "org", "start_date"):
            necessary_slots.append(
                refs_for((rf"resume\.experiences\[{index}\]\.{field}",))
            )
        end_refs = refs_for((rf"resume\.experiences\[{index}\]\.end_date",))
        if not end_refs and experience.get("is_current") is True:
            # is_current is a boolean and intentionally absent from fact metadata.
            end_refs = ["__CURRENT__"]
        necessary_slots.append(end_refs)
    necessary_real_refs = [
        ref for items in necessary_slots for ref in items if ref != "__CURRENT__"
    ]
    assessments, judgment = _deterministic_coverage(
        sum(bool(items) for items in necessary_slots),
        len(necessary_slots) or 4,
        necessary_real_refs,
        missing_prompt="请补充各段经历真实的名称、组织和起止时间。",
    )
    row = _task(
        "GLOBAL_COMPLETENESS_EXPERIENCE_FIELDS",
        "内容完整",
        "经历必要字段",
        "experiences[].title,org,start_date,end_date",
        necessary_real_refs,
        assessments,
        _COMPLETENESS["经历必要字段"],
    )
    _add_task(tasks, deterministic, row)
    _set_deterministic(deterministic, row, judgment)

    skill_refs = refs_for((r"resume\.skills\[\d+\]\.name",))
    certification_refs = refs_for((r"resume\.certifications\[\d+\]\.name",))
    skill_assessments = {
        "skills_present": ("strong", 1),
        "certifications_only": ("adequate", 8 / 15),
        "absent": ("insufficient_evidence", 0),
    }
    row = _task(
        "GLOBAL_COMPLETENESS_SKILLS",
        "内容完整",
        "技能与资格",
        "skills,certifications",
        skill_refs or certification_refs,
        skill_assessments,
        _COMPLETENESS["技能与资格"],
    )
    _add_task(tasks, deterministic, row)
    if skill_refs:
        skill_judgment = _judgment(
            "skills_present", skill_refs, "已有可确认的技能信息。"
        )
    elif certification_refs:
        skill_judgment = _judgment(
            "certifications_only",
            certification_refs,
            "已有资格信息但没有已选技能。",
            "needs_information",
            "请按实际情况补充或选择已有的真实技能。",
        )
    else:
        skill_judgment = _judgment(
            "absent",
            [],
            "没有可确认的技能或资格信息。",
            "needs_information",
            "请按实际情况补充技能或资格。",
        )
    _set_deterministic(deterministic, row, skill_judgment)

    direction_sources = refs_for(
        (
            r"resume\.personal_summary",
            r"resume\.profile\.summary",
            r"resume\.raw_text",
            r"resume\.experiences\[\d+\]\.title",
        )
    )
    direction_task = _task(
        "GLOBAL_COMPLETENESS_DIRECTION",
        "内容完整",
        "求职方向",
        "personal_summary,experiences[].title",
        direction_sources,
        {
            "function": ("strong", 1),
            "domain": ("adequate", 0.5),
            "absent": ("insufficient_evidence", 0),
        },
        _COMPLETENESS["求职方向"],
    )
    _add_task(
        tasks,
        deterministic,
        direction_task,
        empty_judgment=_judgment(
            "absent",
            [],
            "简历内没有可确认的求职方向来源。",
            "needs_information",
            "请补充真实的目标职能或方向。",
        ),
    )

    supplemental_refs = certification_refs + refs_for(
        tuple(
            rf"resume\.experiences\[{index}\]\.title"
            for index, experience in enumerate(experiences)
            if experience.get("category") == "project"
        )
    )
    supplemental_assessments, supplemental_judgment = _deterministic_coverage(
        1 if supplemental_refs else 0,
        1,
        supplemental_refs,
        missing_prompt="如有真实且相关的项目或证书，可按实际情况补充。",
        optional=True,
    )
    row = _task(
        "GLOBAL_COMPLETENESS_SUPPLEMENTAL",
        "内容完整",
        "补充信息",
        "experiences,certifications",
        supplemental_refs,
        supplemental_assessments,
        _COMPLETENESS["补充信息"],
        optional=True,
    )
    _add_task(tasks, deterministic, row)
    _set_deterministic(deterministic, row, supplemental_judgment)

    exaggeration_sources = refs_for(
        (
            r"resume\.personal_summary",
            r"resume\.profile\.summary",
            r"resume\.raw_text",
            r"resume\.experiences\[\d+\]\.star\.[star]",
        )
    )
    exaggeration_task = _task(
        "RISK_EXAGGERATED_CLAIM",
        "专业表达",
        "risk:exaggerated_claim",
        "resume",
        exaggeration_sources,
        {
            "absent": ("strong", 1),
            "present": ("needs_attention", 0),
        },
        0,
        optional=True,
    )
    _add_task(
        tasks,
        deterministic,
        exaggeration_task,
        empty_judgment=_judgment("absent", [], "没有可用于检查夸大表达的正文。"),
    )

    date_sources = refs_for(
        (
            r"resume\.experiences\[\d+\]\.(?:title|org|start_date|end_date)",
            r"resume\.educations\[\d+\]\.(?:school|start_date|end_date)",
        )
    )
    conflict_task = _task(
        "RISK_CONFLICTING_DATE",
        "逻辑清晰",
        "risk:conflicting_date",
        "experiences,educations",
        date_sources,
        {"absent": ("strong", 1), "present": ("needs_attention", 0)},
        0,
        optional=True,
    )
    _add_task(
        tasks,
        deterministic,
        conflict_task,
        empty_judgment=_judgment("absent", [], "没有可用于检查日期冲突的日期来源。"),
    )

    for fact_id, fact in facts.items():
        status = fact["verificationStatus"]
        if status not in {"unverified", "inferred"}:
            continue
        risk_type = "unverified_fact" if status == "unverified" else "inferred_fact"
        suffix = sum(
            1
            for row in tasks
            if row["criterion"] == f"risk:{risk_type}"
        ) + 1
        source_id = source_ids[fact_id]
        row = _task(
            f"RISK_{risk_type.upper()}_{suffix:03d}",
            "专业表达",
            f"risk:{risk_type}",
            fact["source"].removeprefix("resume."),
            [source_id],
            {"absent": ("strong", 1), "present": ("needs_attention", 0)},
            0,
            optional=True,
        )
        _add_task(tasks, deterministic, row)
        _set_deterministic(
            deterministic,
            row,
            _judgment(
                "present",
                [source_id],
                "该事实当前尚未确认。",
                "needs_information",
                "发布前请确认该事实；无法确认时删除或改为明确受限的表述。",
            ),
        )

    model_tasks = [row for row in tasks if row["taskId"] not in deterministic]
    generation_schema = _schema_object(
        {row["taskId"]: _judgment_schema(row) for row in model_tasks}
    )
    return {
        "tasks": tasks,
        "sources": sources,
        "deterministic": deterministic,
        "generationSchema": generation_schema,
    }


_JUDGMENT_KEYS = frozenset(("assessment", "sourceRefs", "reason", "guidance"))
_GUIDANCE_KEYS = frozenset(("type", "prompt"))
_GUIDANCE_TYPES = frozenset(("none", "safe_cleanup", "needs_information"))
def _missing_factual_component(task: Mapping[str, Any], assessment: str) -> bool:
    professional_level = assessment.partition(":")[0]
    if professional_level in {"absent", "predominantly_vague"}:
        assessment = professional_level
    if assessment not in {
        "absent",
        "partial_context",
        "partial_task",
        "partial_action",
        "generic_role_only",
        "partial_result",
        "generic_completion",
        "insufficient_evidence",
    }:
        return False
    return (
        task["dimension"] in {"STAR应用", "成果量化", "内容完整"}
        or task["criterion"]
        in {"表达精确度", "贡献与责任边界", "行动动词", "岗位术语"}
    )


def _validated_judgment(
    raw: Any,
    task: Mapping[str, Any],
    sources: Mapping[str, Mapping[str, str]],
) -> Dict[str, Any]:
    if not isinstance(raw, Mapping) or set(raw) != _JUDGMENT_KEYS:
        raise ValueError("guidance judgment must contain the exact fixed fields")
    assessment = raw.get("assessment")
    if not isinstance(assessment, str) or assessment not in task["allowedAssessments"]:
        raise ValueError("guidance judgment contains an unsupported assessment")
    source_refs = raw.get("sourceRefs")
    if not isinstance(source_refs, list) or any(
        not isinstance(source_id, str) for source_id in source_refs
    ):
        raise ValueError("guidance judgment sourceRefs must be an array of strings")
    if len(source_refs) != len(set(source_refs)):
        raise ValueError("guidance judgment contains duplicate source references")
    if any(source_id not in task["allowedSources"] for source_id in source_refs):
        raise ValueError("guidance judgment contains an out-of-scope source reference")

    reason = raw.get("reason")
    if not isinstance(reason, str) or not 0 < len(reason.strip()) <= 500:
        raise ValueError("guidance judgment reason must be a non-empty short string")
    guidance = raw.get("guidance")
    if not isinstance(guidance, Mapping) or set(guidance) != _GUIDANCE_KEYS:
        raise ValueError("guidance judgment guidance must contain the exact fixed fields")
    guidance_type = guidance.get("type")
    prompt = guidance.get("prompt")
    if guidance_type not in _GUIDANCE_TYPES or not isinstance(prompt, str):
        raise ValueError("guidance judgment contains invalid guidance")
    if len(prompt.strip()) > 500:
        raise ValueError("guidance judgment prompt is too long")
    if guidance_type == "none" and prompt.strip():
        raise ValueError("none guidance must have an empty prompt")
    if guidance_type != "none" and not prompt.strip():
        raise ValueError("actionable guidance must have a non-empty prompt")
    allowed_guidance = task.get("allowedGuidance")
    if (
        not isinstance(allowed_guidance, list)
        or {"type": guidance_type, "prompt": prompt} not in allowed_guidance
    ):
        raise ValueError("guidance judgment contains an unregistered action")
    band = task["assessmentBands"][assessment]
    if band == "strong" and guidance_type == "needs_information":
        raise ValueError("strong guidance judgment cannot request missing information")
    if (
        band == "strong"
        and guidance_type == "safe_cleanup"
        and task["dimension"] != "STAR应用"
    ):
        raise ValueError("strong guidance judgment cannot add unrelated cleanup")
    if (
        not task["optional"]
        and band != "strong"
        and guidance_type == "none"
    ):
        raise ValueError("required non-strong guidance judgment must provide a next step")
    if guidance_type == "safe_cleanup" and not (
        task["criterion"] in _SAFE_CLEANUP_CRITERIA
        or (
            task["dimension"] == "STAR应用"
            and task["assessmentBands"][assessment] == "strong"
        )
    ):
        raise ValueError("safe cleanup is not allowed for this factual criterion")
    if _missing_factual_component(task, assessment) and guidance_type == "safe_cleanup":
        raise ValueError("missing factual components require information rather than cleanup")

    points = task["assessmentPoints"][assessment]
    is_risk = str(task["criterion"]).startswith("risk:")
    if points > 0 and task["maxScore"] > 0 and not is_risk:
        if not source_refs:
            raise ValueError("positive guidance assessment requires allowed evidence")
        if any(
            sources[source_id]["verificationStatus"] not in _POSITIVE_STATUSES
            for source_id in source_refs
        ):
            raise ValueError("positive guidance assessment uses ineligible evidence")

    return {
        "assessment": assessment,
        "sourceRefs": list(source_refs),
        "reason": reason.strip(),
        "guidance": {"type": guidance_type, "prompt": prompt.strip()},
    }


def validate_judgments(
    raw: Any, contract: Mapping[str, Any]
) -> Dict[str, Dict[str, Any]]:
    """Strictly validate model judgments and merge code-owned judgments."""
    if not isinstance(contract, Mapping) or set(contract) != {
        "tasks",
        "sources",
        "deterministic",
        "generationSchema",
    }:
        raise ValueError("guidance task contract is malformed")
    tasks = contract["tasks"]
    sources = contract["sources"]
    deterministic = contract["deterministic"]
    if (
        not isinstance(tasks, list)
        or not isinstance(sources, Mapping)
        or not isinstance(deterministic, Mapping)
    ):
        raise ValueError("guidance task contract containers are malformed")
    if any(not isinstance(row, Mapping) for row in tasks):
        raise ValueError("guidance task contract contains a malformed task")
    task_by_id = {row.get("taskId"): row for row in tasks}
    if len(task_by_id) != len(tasks) or any(not isinstance(key, str) for key in task_by_id):
        raise ValueError("guidance task contract contains duplicate task identities")
    if any(key not in task_by_id for key in deterministic):
        raise ValueError("guidance task contract contains an unknown deterministic task")

    if not isinstance(raw, Mapping):
        raise ValueError("guidance judgments must be an object keyed by task identity")
    expected_model_ids = [
        row["taskId"] for row in tasks if row["taskId"] not in deterministic
    ]
    if set(raw) != set(expected_model_ids) or len(raw) != len(expected_model_ids):
        raise ValueError("guidance judgments must cover every semantic task exactly once")

    validated: Dict[str, Dict[str, Any]] = {}
    for task_id in expected_model_ids:
        validated[task_id] = _validated_judgment(
            raw[task_id], task_by_id[task_id], sources
        )
    validated_deterministic: Dict[str, Dict[str, Any]] = {}
    for task_id, value in deterministic.items():
        validated_deterministic[task_id] = _validated_judgment(
            value, task_by_id[task_id], sources
        )

    merged: Dict[str, Dict[str, Any]] = {}
    for row in tasks:
        task_id = row["taskId"]
        value = validated_deterministic.get(task_id, validated.get(task_id))
        if value is None:
            raise ValueError("guidance task is missing a judgment")
        merged[task_id] = deepcopy(value)
    return merged


__all__ = [
    "TASK_RUBRIC_VERSION",
    "TASK_RULES",
    "build_task_contract",
    "validate_judgments",
]
