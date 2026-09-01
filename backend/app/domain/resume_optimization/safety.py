from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
import re
import unicodedata
from typing import Any

from .schemas import (
    OptimizationAction,
    OptimizationChange,
    OptimizationModuleType,
    OptimizationPlan,
    OptimizationSafetySummary,
)


_SOURCE_ROOTS = frozenset(
    {"currentResume", "selectedSourceExperiences", "userAnswers"}
)

PROTECTED_TERMS = frozenset(
    {
        "A/B测试",
        "用户画像",
        "竞品分析",
        "漏斗分析",
        "MVP",
        "PRD",
        "SQL",
        "Python",
        "React",
        "Vue",
        "Next.js",
        "Tableau",
        "Power BI",
        "Docker",
        "C++",
        "C#",
        "Figma",
        "Axure",
        "用户调研",
        "需求优先级",
        "转化率",
        "留存率",
        "GMV",
        "ROI",
    }
)

_NUMBER_UNITS = (
    "分钟",
    "小时",
    "用户",
    "订单",
    "万元",
    "亿元",
    "%",
    "人",
    "次",
    "轮",
    "页",
    "项",
    "家",
    "天",
    "周",
    "月",
    "年",
    "元",
    "万",
    "亿",
)
_NUMBER_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>\d+(?:\.\d+)?)(?![A-Za-z0-9_.])\s*"
    rf"(?P<unit>{'|'.join(map(re.escape, _NUMBER_UNITS))})?"
)
_ASCII_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9])"
    r"(?:[A-Za-z]\+\+\d*|[A-Za-z]#\d*|"
    r"[A-Za-z][A-Za-z0-9]*(?:(?:[./+#-])[A-Za-z0-9]+)*)"
    r"(?![A-Za-z0-9])"
)

_METRIC_NAMES = (
    "平均处理时长",
    "处理时长",
    "响应时间",
    "转化率",
    "留存率",
    "点击率",
    "完成率",
    "成功率",
    "通过率",
    "复购率",
    "增长率",
    "流失率",
    "准确率",
    "错误率",
    "满意度",
    "活跃度",
    "客单价",
    "销售额",
    "效率",
    "时长",
    "耗时",
    "收入",
    "营收",
    "成本",
    "利润",
    "用户数",
    "订单量",
    "GMV",
    "ROI",
    "conversion rate",
    "retention rate",
    "revenue",
    "latency",
)


def _normalize_text(value: str) -> str:
    return unicodedata.normalize("NFKC", value).replace("−", "-")


def _normalized_term(value: str) -> str:
    return re.sub(r"\s+", " ", _normalize_text(value).casefold()).strip()


def _decode_pointer_token(token: str) -> str:
    decoded: list[str] = []
    cursor = 0
    while cursor < len(token):
        char = token[cursor]
        if char != "~":
            decoded.append(char)
            cursor += 1
            continue
        if cursor + 1 >= len(token) or token[cursor + 1] not in {"0", "1"}:
            raise ValueError("来源引用包含无效的 RFC 6901 转义")
        decoded.append("~" if token[cursor + 1] == "0" else "/")
        cursor += 2
    return "".join(decoded)


def _pointer_tokens(source_ref: str) -> list[str]:
    if not isinstance(source_ref, str) or not source_ref.startswith("/"):
        raise ValueError("来源引用必须是绝对 RFC 6901 JSON Pointer")
    raw_tokens = source_ref[1:].split("/")
    if not raw_tokens or any(token == "" for token in raw_tokens):
        raise ValueError("来源引用不能包含空路径段")
    tokens = [_decode_pointer_token(token) for token in raw_tokens]
    if tokens[0] not in _SOURCE_ROOTS:
        raise ValueError("来源引用根节点不受支持")
    if any(token in {".", ".."} for token in tokens):
        raise ValueError("来源引用不能使用父级或当前级路径语义")
    return tokens


def resolve_source_ref(documents: Mapping[str, Any], source_ref: str) -> Any:
    """Resolve an allowlisted RFC 6901 source pointer without traversal shortcuts."""

    if not isinstance(documents, Mapping):
        raise ValueError("来源文档必须是映射")
    tokens = _pointer_tokens(source_ref)
    current: Any = documents
    for token in tokens:
        if isinstance(current, Mapping):
            if token not in current:
                raise ValueError("来源引用指向不存在的键")
            current = current[token]
            continue
        if isinstance(current, Sequence) and not isinstance(
            current, (str, bytes, bytearray)
        ):
            if not token.isdigit() or (len(token) > 1 and token.startswith("0")):
                raise ValueError("来源引用包含无效的数组下标")
            index = int(token)
            if index >= len(current):
                raise ValueError("来源引用数组下标越界")
            current = current[index]
            continue
        raise ValueError("来源引用不能穿过标量值")
    return current


_RESPONSIBILITY_SIGNALS: tuple[tuple[int, tuple[str, ...]], ...] = (
    (
        4,
        (
            r"主导",
            r"牵头",
            r"推动",
            r"lead(?:s|ing)?",
            r"\bled\b",
            r"driv(?:e|es|ing)",
            r"\bdrove\b",
        ),
    ),
    (
        3,
        (
            r"负责",
            r"独立(?:承担|完成|开发|设计|负责)?",
            r"\bown(?:ed|s|ing)?\b",
            r"responsible\s+for",
            r"independently",
        ),
    ),
    (
        2,
        (
            r"执行",
            r"完成",
            r"开发",
            r"分析",
            r"设计",
            r"implement(?:ed|s|ing)?",
            r"execut(?:e|ed|es|ing)",
            r"complet(?:e|ed|es|ing)",
            r"develop(?:ed|s|ing)?",
            r"analy[sz](?:e|ed|es|ing)",
        ),
    ),
    (
        1,
        (
            r"参与",
            r"跟进",
            r"配合",
            r"participat(?:e|ed|es|ing)",
            r"follow(?:ed|s|ing)?(?:\s+up)?",
        ),
    ),
    (
        0,
        (
            r"协助",
            r"支持",
            r"assist(?:ed|s|ing)?",
            r"support(?:ed|s|ing)?",
        ),
    ),
)

_ZH_RESPONSIBILITY_TOKEN = (
    r"(?:主导|牵头|推动|负责|独立(?:承担)?|执行|完成|开发|分析|设计|"
    r"参与|跟进|配合|协助|支持)"
)
_EN_RESPONSIBILITY_TOKEN = (
    r"(?:lead(?:s|ing)?|led|driv(?:e|es|ing)|drove|"
    r"own(?:ed|s|ing)?|responsible|execut(?:e|ed|es|ing)|"
    r"complet(?:e|ed|es|ing)|develop(?:ed|s|ing)?|"
    r"analy[sz](?:e|ed|es|ing)|implement(?:ed|s|ing)?|"
    r"participat(?:e|ed|es|ing)|follow(?:ed|s|ing)?(?:\s+up)?|"
    r"assist(?:ed|s|ing)?|support(?:ed|s|ing)?)"
)
_ZH_NEGATED_GAP = (
    r"(?:(?!(?:但|但是|然而|却|后来|然后|随后))[^，。；！？,;!?]){0,12}?"
)
_EN_NEGATED_GAP = (
    r"(?:(?!(?:but|however|yet|later|then|subsequently|afterwards?)\b|"
    r"and\s+(?:later|then|subsequently|afterwards?)\b)"
    r"[A-Za-z][A-Za-z'-]*\s+){0,4}?"
)
_NEGATED_RESPONSIBILITY_RE = re.compile(
    rf"(?:并未|未曾|未能|未|没有|并非|不是我|非本人|不能|不曾|不)\s*"
    rf"{_ZH_NEGATED_GAP}"
    rf"{_ZH_RESPONSIBILITY_TOKEN}"
    rf"(?:\s*(?:(?:、|/|或|和|与|及|,)\s*)?{_ZH_RESPONSIBILITY_TOKEN})*"
    rf"|(?:did\s+not|didn't|(?:was|were|is|are)\s+not|wasn't|not|never|without|failed\s+to)\s+"
    rf"{_EN_NEGATED_GAP}"
    rf"{_EN_RESPONSIBILITY_TOKEN}"
    rf"(?:"
    rf"(?:\s*(?:,|/)\s*(?:or\s+|and\s+)?|\s+(?:or|and)\s+)"
    rf"{_EN_RESPONSIBILITY_TOKEN}"
    rf")*",
    re.IGNORECASE,
)


def responsibility_rank(text: str) -> int:
    """Return the highest non-negated responsibility signal, from 0 to 4."""

    if not isinstance(text, str):
        return -1
    normalized = _normalize_text(text).casefold()
    normalized = _NEGATED_RESPONSIBILITY_RE.sub(" ", normalized)
    for rank, patterns in _RESPONSIBILITY_SIGNALS:
        if any(re.search(pattern, normalized, re.IGNORECASE) for pattern in patterns):
            return rank
    return -1


_ZH_CAUSALITY_TOKEN = (
    r"(?:上线后|发布后|交付后|实施后|直接导致|导致|造成|带来|使|让|"
    r"促进|助力|帮助|共同贡献|贡献|相关|关联|协同)"
)
_EN_CAUSALITY_TOKEN = (
    r"(?:after\s+launch|following\s+launch|"
    r"correlat(?:e|ed|es|ing)|associated\s+with|"
    r"contribut(?:e|ed|es|ing)|caus(?:e|ed|es|ing)|"
    r"lead(?:s|ing)?\s+to|led\s+to|"
    r"result(?:s|ed|ing)?\s+in)"
)
_NEGATED_CAUSALITY_RE = re.compile(
    rf"(?:并非|不是|未能|未|没有|并不|不能|不曾|不)\s*"
    rf"{_ZH_NEGATED_GAP}"
    rf"{_ZH_CAUSALITY_TOKEN}"
    rf"(?:\s*(?:、|/|或|和|与|及|,)\s*{_ZH_CAUSALITY_TOKEN})*"
    rf"|(?:did\s+not|didn't|does\s+not|doesn't|(?:was|were|is|are)\s+not|wasn't|not|never|without|failed\s+to)\s+"
    rf"{_EN_NEGATED_GAP}"
    rf"{_EN_CAUSALITY_TOKEN}"
    rf"(?:"
    rf"(?:\s*(?:,|/)\s*(?:or\s+|and\s+)?|\s+(?:or|and)\s+)"
    rf"(?:directly\s+|jointly\s+)?{_EN_CAUSALITY_TOKEN}"
    rf")*",
    re.IGNORECASE,
)


def causality_rank(text: str) -> int:
    """Return the highest non-negated causality signal, from 0 to 3."""

    if not isinstance(text, str):
        return -1
    normalized = _normalize_text(text).casefold()
    normalized = _NEGATED_CAUSALITY_RE.sub(" ", normalized)
    direct = (
        r"通过.{0,24}(?:使|让|带来)",
        r"直接(?:导致|造成|带来)",
        r"(?:使|让).{0,20}(?:提升|增长|降低|减少|改善)",
        r"(?:导致|造成|归因于)",
        r"带来(?:(?!(?:并|且|而|但|然后|随后|同时|以及))"
        r"[^，。；！？,;!?]){0,16}"
        r"(?:提升|增长|降低|下降|减少|改善|提高|上升|"
        r"[+-]?\d+(?:\.\d+)?\s*(?:个)?(?:人|用户|订单|元|万|亿|%))",
        r"\bbring(?:s|ing)?\s+about\b"
        r"(?:(?!(?:and|but|then|later|subsequently|afterward)\b)"
        r"[^,.;!?]){0,20}"
        r"(?:increase|growth|reduction|improvement|"
        r"[+-]?\d+(?:\.\d+)?\s*(?:users?|orders?))",
        r"\bcaus(?:e|ed|es|ing)\b",
        r"\b(?:led|lead|leads)\s+to\b",
        r"\bresult(?:ed|s|ing)?\s+in\b",
    )
    explicit = (
        r"促进",
        r"助力",
        r"帮助.{0,16}(?:提升|增长|降低|减少|改善)",
        r"contribut(?:e|ed|es|ing)\s+to\s+(?:the\s+)?"
        r"(?:improvement|increase|growth|reduction)",
    )
    related = (
        r"相关",
        r"关联",
        r"共同(?:贡献|作用)",
        r"协同",
        r"correlat(?:e|ed|es|ing)",
        r"associated\s+with",
        r"jointly\s+contribut",
    )
    temporal = (
        r"(?:上线|发布|交付|实施)后",
        r"随后",
        r"之后",
        r"\bafter\s+launch\b",
        r"\bfollowing\s+launch\b",
        r"\bsubsequently\b",
    )
    if any(re.search(pattern, normalized, re.IGNORECASE) for pattern in direct):
        return 3
    if any(re.search(pattern, normalized, re.IGNORECASE) for pattern in explicit):
        return 2
    if any(re.search(pattern, normalized, re.IGNORECASE) for pattern in related):
        return 1
    if any(re.search(pattern, normalized, re.IGNORECASE) for pattern in temporal):
        return 0
    return -1


@dataclass(frozen=True)
class _NumericExpression:
    value: str
    unit: str
    metric: str | None
    sign: str
    explicit_sign: bool
    direction: str | None
    polarity: str
    contradictory: bool
    negated: bool
    start: int
    end: int

    @property
    def identity(self) -> tuple[str, str, str | None, str]:
        return (self.value, self.unit, self.metric, self.polarity)


def _decimal_key(raw: str) -> str:
    try:
        value = Decimal(raw)
    except InvalidOperation:
        return raw
    rendered = format(value.normalize(), "f")
    return "0" if rendered in {"-0", ""} else rendered


def _local_clause_window(
    text: str,
    start: int,
    end: int,
    *,
    radius: int = 64,
) -> tuple[str, int]:
    left_boundary = max(
        (text.rfind(marker, 0, start) for marker in "，。；！？,;!?"),
        default=-1,
    )
    right_candidates = [
        position
        for marker in "，。；！？,;!?"
        if (position := text.find(marker, end)) >= 0
    ]
    right_boundary = min(right_candidates, default=len(text))
    window_start = max(left_boundary + 1, start - radius)
    window_end = min(right_boundary, end + radius)
    return text[window_start:window_end].casefold(), window_start


def _nearby_metric(text: str, start: int, end: int) -> str | None:
    window, window_start = _local_clause_window(text, start, end)
    closest: tuple[int, str] | None = None
    number_midpoint = (start + end) // 2 - window_start
    for metric in _METRIC_NAMES:
        normalized = _normalize_text(metric).casefold()
        for match in re.finditer(re.escape(normalized), window):
            distance = abs((match.start() + match.end()) // 2 - number_midpoint)
            canonical = _normalized_term(metric)
            if closest is None or distance < closest[0]:
                closest = (distance, canonical)
    return closest[1] if closest is not None else None


_DIRECTION_SIGNALS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "increase",
        (
            r"增加",
            r"提升",
            r"增长",
            r"提高",
            r"上升",
            r"\bincreas(?:e|ed|es|ing)\b",
            r"\bimprov(?:e|ed|es|ing)\b",
            r"\bgrow(?:s|ing|n)?\b",
            r"\b(?:rise|rises|rose|rising)\b",
        ),
    ),
    (
        "decrease",
        (
            r"降低",
            r"降至",
            r"下降",
            r"减少",
            r"缩短",
            r"节省",
            r"\bdecreas(?:e|ed|es|ing)\b",
            r"\breduc(?:e|ed|es|ing)\b",
            r"\bdrop(?:s|ped|ping)?\b",
            r"\bcut(?:s|ting)?\b",
        ),
    ),
)


def _nearby_direction(text: str, start: int, end: int) -> str | None:
    window, window_start = _local_clause_window(text, start, end)
    number_midpoint = (start + end) // 2 - window_start
    closest: tuple[int, str] | None = None
    for direction, signals in _DIRECTION_SIGNALS:
        for signal in signals:
            for match in re.finditer(signal, window, re.IGNORECASE):
                distance = abs((match.start() + match.end()) // 2 - number_midpoint)
                if closest is None or distance < closest[0]:
                    closest = (distance, direction)
    return closest[1] if closest is not None else None


def _claim_is_negated(text: str, start: int) -> bool:
    prefix = text[:start]
    reset_matches = list(
        re.finditer(
            r"[，。；！？,;!?]|而是|但(?:是)?|然而|不过|却|"
            r"\bbut\s+rather\b|\binstead\b|\bbut\b|\bhowever\b|\byet\b",
            prefix,
            re.IGNORECASE,
        )
    )
    if reset_matches:
        prefix = prefix[reset_matches[-1].end() :]
    return bool(
        re.search(
            r"(?:并非|不是|未曾|未能|未|没有|不曾|不能|不)"
            r"[^，。；！？,;!?]{0,24}$",
            prefix,
        )
        or re.search(
            r"\b(?:did\s+not|does\s+not|(?:was|were|is|are)\s+not|"
            r"not|never|without|failed\s+to)\b[^,.;!?]{0,40}$",
            prefix,
            re.IGNORECASE,
        )
    )


def _numeric_expressions(text: str) -> list[_NumericExpression]:
    normalized = _normalize_text(text)
    expressions: list[_NumericExpression] = []
    for match in _NUMBER_RE.finditer(normalized):
        raw_sign = match.group("sign")
        sign = "-" if raw_sign == "-" else "+"
        explicit_sign = bool(raw_sign)
        direction = _nearby_direction(
            normalized,
            match.start(),
            match.end(),
        )
        contradictory = (
            (sign == "-" and direction == "increase")
            or (raw_sign == "+" and direction == "decrease")
        )
        if direction == "decrease" or sign == "-":
            polarity = "decrease"
        elif direction == "increase":
            polarity = "increase"
        else:
            polarity = "positive"
        expressions.append(
            _NumericExpression(
                value=_decimal_key(match.group("value")),
                unit=match.group("unit") or "",
                metric=_nearby_metric(normalized, match.start(), match.end()),
                sign=sign,
                explicit_sign=explicit_sign,
                direction=direction,
                polarity=polarity,
                contradictory=contradictory,
                negated=_claim_is_negated(normalized, match.start()),
                start=match.start(),
                end=match.end(),
            )
        )
    return expressions


@dataclass(frozen=True)
class _OrderedNumericTransition:
    metric: str | None
    unit: str
    polarity: str
    from_value: str
    to_value: str
    member_starts: tuple[int, int] = field(
        compare=False,
        hash=False,
        repr=False,
    )


_FORWARD_ORIGIN_MARKER_RE = re.compile(
    r"(?:从|由|\bfrom)\s*$",
    re.IGNORECASE,
)
_FORWARD_TARGET_MARKER_RE = re.compile(
    r"(?:降至|升至|提升至|增加至|降低至|缩短至|"
    r"降低到|缩短到|提升到|增加到|上升到|减少到|减至|增至|至|到|\bto\b)",
    re.IGNORECASE,
)
_TARGET_FIRST_TARGET_MARKER_RE = re.compile(
    r"(?:降至|升至|提升至|增加至|降低至|缩短至|"
    r"降低到|缩短到|提升到|增加到|上升到|减少到|减至|增至|\bto)\s*$",
    re.IGNORECASE,
)
_TARGET_FIRST_ORIGIN_MARKER_RE = re.compile(
    r"(?:之前为|原为|原先(?:为)?|原来(?:为)?|此前(?:为)?|"
    r"\bfrom\b|\bpreviously\b|\boriginally\b|\bformerly\b)",
    re.IGNORECASE,
)


def _ordered_numeric_transitions(text: str) -> list[_OrderedNumericTransition]:
    normalized = _normalize_text(text)
    expressions = _numeric_expressions(normalized)
    transitions: list[_OrderedNumericTransition] = []
    for first, second in zip(expressions, expressions[1:]):
        if (
            first.contradictory
            or second.contradictory
            or first.negated
            or second.negated
        ):
            continue
        if first.metric and second.metric and first.metric != second.metric:
            continue
        if first.unit != second.unit:
            continue
        prefix = normalized[max(0, first.start - 16) : first.start]
        between = normalized[first.end : second.start]
        metric = first.metric or second.metric

        is_forward = bool(
            _FORWARD_ORIGIN_MARKER_RE.search(prefix)
            and _FORWARD_TARGET_MARKER_RE.search(between)
        )
        is_target_first = bool(
            _TARGET_FIRST_TARGET_MARKER_RE.search(prefix)
            and _TARGET_FIRST_ORIGIN_MARKER_RE.search(between)
        )
        if is_forward:
            transitions.append(
                _OrderedNumericTransition(
                    metric=metric,
                    unit=first.unit,
                    polarity=first.polarity,
                    from_value=first.value,
                    to_value=second.value,
                    member_starts=(first.start, second.start),
                )
            )
        elif is_target_first:
            transitions.append(
                _OrderedNumericTransition(
                    metric=metric,
                    unit=first.unit,
                    polarity=first.polarity,
                    from_value=second.value,
                    to_value=first.value,
                    member_starts=(first.start, second.start),
                )
            )
    return transitions


def _is_ascii_technical_token(token: str) -> bool:
    if any(char.isdigit() or char in "./+#-" for char in token):
        return True
    if len(token) >= 2 and token.isupper():
        return True
    if re.search(r"[a-z][A-Z]", token):
        return True
    return False


def _canonical_term_pattern(normalized_term: str) -> str:
    body = re.escape(normalized_term).replace(r"\ ", r"\s+")
    if any(char.isascii() and char.isalnum() for char in normalized_term):
        return rf"(?<![A-Za-z0-9]){body}(?![A-Za-z0-9])"
    return body


def _protected_term_pattern(term: str) -> str:
    return _canonical_term_pattern(_normalized_term(term))


def _canonical_term_occurrences(
    text: str,
    normalized_term: str,
) -> list[re.Match[str]]:
    folded = _normalize_text(text).casefold()
    return list(re.finditer(_canonical_term_pattern(normalized_term), folded))


def _has_affirmative_canonical_term(text: str, normalized_term: str) -> bool:
    normalized_text = _normalize_text(text).casefold()
    return any(
        not _claim_is_negated(normalized_text, occurrence.start())
        for occurrence in _canonical_term_occurrences(text, normalized_term)
    )


def _extracted_terms(text: str) -> dict[str, str]:
    normalized_text = _normalize_text(text)
    folded = normalized_text.casefold()
    terms: dict[str, str] = {}
    for protected in PROTECTED_TERMS:
        normalized = _normalized_term(protected)
        pattern = _protected_term_pattern(protected)
        if re.search(pattern, folded):
            terms[normalized] = protected
    for match in _ASCII_TOKEN_RE.finditer(normalized_text):
        token = match.group(0)
        if _is_ascii_technical_token(token):
            terms.setdefault(_normalized_term(token), token)
    return terms


def _flatten_source_text(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if value is None or isinstance(value, bool):
        return []
    if isinstance(value, (int, float, Decimal)):
        return [str(value)]
    if isinstance(value, Mapping):
        flattened: list[str] = []
        for child in value.values():
            flattened.extend(_flatten_source_text(child))
        return flattened
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        flattened = []
        for child in value:
            flattened.extend(_flatten_source_text(child))
        return flattened
    return []


def _source_scope_finding(
    change: OptimizationChange,
    tokens: list[str],
    *,
    plan: OptimizationPlan,
    source_documents: Mapping[str, Any],
) -> str | None:
    root = tokens[0]
    if root == "userAnswers":
        if len(tokens) != 3 or tokens[2] != "value":
            return "回答来源必须精确引用 /userAnswers/{question_id}/value"
        question = next(
            (item for item in plan.questions if item.question_id == tokens[1]),
            None,
        )
        if question is None:
            return "回答来源未对应本计划中的问题"
        if question.module_id != change.module_id:
            return "回答来源与当前变更不属于同一模块"
        if change.change_id not in question.affects_change_ids:
            return "回答来源未关联到当前变更"
        user_answers = source_documents.get("userAnswers")
        answer = (
            user_answers.get(tokens[1])
            if isinstance(user_answers, Mapping)
            else None
        )
        if not isinstance(answer, Mapping):
            return "回答来源必须是结构化的已提交回答"
        if answer.get("state") != "answered":
            return "只有状态为 answered 的回答可以作为事实来源"
        answer_value = answer.get("value")
        if not isinstance(answer_value, str) or not answer_value.strip():
            return "作为事实来源的 answered 回答必须包含非空文本"
        return None

    current_resume = source_documents.get("currentResume")
    current_experiences = (
        current_resume.get("experiences")
        if isinstance(current_resume, Mapping)
        else None
    )
    selected_ids = (
        set(current_experiences)
        if isinstance(current_experiences, Mapping)
        else set()
    )

    if change.module_type == OptimizationModuleType.EXPERIENCE_STAR:
        if root == "currentResume":
            if len(tokens) < 4 or tokens[1:3] != ["experiences", change.module_id]:
                return "经历变更只能引用当前简历中的同一段经历"
        elif root == "selectedSourceExperiences":
            if (
                len(tokens) < 3
                or tokens[1] != change.module_id
                or tokens[1] not in selected_ids
            ):
                return "经历变更只能引用已选中的同一段来源经历"
        return None

    if root == "selectedSourceExperiences":
        if len(tokens) < 3 or tokens[1] not in selected_ids:
            return "只能引用当前简历已选中的来源经历"
        if change.module_type not in {
            OptimizationModuleType.PERSONAL_SUMMARY,
        }:
            return "该变更类型不能使用经历文本作为来源"
    return None


def _answer_resolves_numeric_ambiguity(
    before_numbers: list[_NumericExpression],
    candidate_numbers: list[_NumericExpression],
    answered_sources: list[str],
) -> bool:
    contradictory_before = [item for item in before_numbers if item.contradictory]
    corresponding_candidates = [
        candidate
        for candidate in candidate_numbers
        if any(
            before.value == candidate.value
            and before.unit == candidate.unit
            and before.metric == candidate.metric
            for before in contradictory_before
        )
    ]
    if not corresponding_candidates:
        return True
    if any(item.contradictory for item in corresponding_candidates):
        return False
    answer_numbers = [
        item
        for source in answered_sources
        for item in _numeric_expressions(source)
        if not item.contradictory and not item.negated
    ]
    return all(
        any(answer.identity == candidate.identity for answer in answer_numbers)
        for candidate in corresponding_candidates
    )


def _numeric_findings(
    candidate: str,
    before: str,
    sources: list[str],
    answered_sources: list[str],
) -> list[str]:
    before_numbers = _numeric_expressions(before)
    candidate_numbers = _numeric_expressions(candidate)
    before_counts = Counter(
        item.identity for item in before_numbers if not item.negated
    )
    seen_counts: Counter[tuple[str, str, str | None, str]] = Counter()
    source_numbers = [
        expression
        for source in sources
        for expression in _numeric_expressions(source)
    ]
    findings: list[str] = []
    if any(expression.contradictory for expression in before_numbers) and not (
        _answer_resolves_numeric_ambiguity(
            before_numbers,
            candidate_numbers,
            answered_sources,
        )
    ):
        findings.append(
            "原文数字的显式符号与增减方向存在矛盾，需用户确认后才能改写"
        )

    before_transitions = set(_ordered_numeric_transitions(before))
    source_transitions = {
        transition
        for source in sources
        for transition in _ordered_numeric_transitions(source)
    }
    supported_transition_members: set[int] = set()
    for transition in _ordered_numeric_transitions(candidate):
        if transition in before_transitions or transition in source_transitions:
            supported_transition_members.update(transition.member_starts)
        else:
            findings.append(
                "候选文本中的数值起点与终点顺序没有同序来源证据"
            )

    for expression in candidate_numbers:
        rendered = f"{expression.value}{expression.unit}"
        if expression.contradictory:
            findings.append(
                f"数字“{rendered}”的显式符号与增减方向相互矛盾"
            )
            continue
        if expression.start in supported_transition_members:
            continue
        seen_counts[expression.identity] += 1
        if seen_counts[expression.identity] <= before_counts[expression.identity]:
            continue
        matching = [
            source
            for source in source_numbers
            if source.value == expression.value and source.unit == expression.unit
        ]
        if not matching:
            findings.append(f"新增数字“{rendered}”没有同值同单位的来源证据")
            continue
        usable_matching = [
            source
            for source in matching
            if not source.contradictory and not source.negated
        ]
        if not usable_matching:
            findings.append(
                f"来源数字“{rendered}”的符号与方向存在矛盾，需用户确认"
            )
            continue
        matching = usable_matching
        metric_matching = [
            source
            for source in matching
            if source.metric == expression.metric
        ]
        if expression.metric is not None and not metric_matching:
            findings.append(f"新增数字“{rendered}”缺少相同指标语境的来源证据")
            continue
        if expression.metric is None:
            source_metrics = {
                source.metric for source in matching if source.metric
            }
            if source_metrics:
                findings.append(f"新增数字“{rendered}”未保留来源中的指标语境")
                continue
            metric_matching = matching
        polarity_matching = [
            source
            for source in metric_matching
            if source.polarity == expression.polarity
        ]
        if not polarity_matching:
            if expression.direction is None and any(
                source.direction is None for source in metric_matching
            ):
                findings.append(
                    f"新增数字“{rendered}”的正负符号或语义极性与来源证据不一致"
                )
            else:
                findings.append(
                    f"新增数字“{rendered}”的增减方向或语义极性与来源证据不一致"
                )
    return findings


def _term_findings(
    candidate: str,
    before: str,
    sources: list[str],
    introduced_terms: Sequence[str],
) -> list[str]:
    candidate_terms = _extracted_terms(candidate)
    reported: dict[str, str] = {}
    for term in introduced_terms:
        if isinstance(term, str) and term.strip():
            reported[_normalized_term(term)] = term.strip()
    candidate_terms.update(reported)
    findings: list[str] = []
    for normalized, display in candidate_terms.items():
        if normalized not in reported and not _has_affirmative_canonical_term(
            candidate,
            normalized,
        ):
            continue
        if _has_affirmative_canonical_term(before, normalized):
            continue
        if not any(
            _has_affirmative_canonical_term(source, normalized)
            for source in sources
        ):
            findings.append(f"新增工具、方法或技术术语“{display}”没有来源证据")
    return findings


def _candidate_findings(
    candidate: Any,
    *,
    before: Any,
    source_texts: list[str],
    answered_source_texts: list[str],
    introduced_terms: Sequence[str],
    layer_name: str,
) -> list[str]:
    if candidate is None or candidate == before:
        return []
    if not isinstance(candidate, str) or not isinstance(before, str):
        return []
    findings: list[str] = []
    findings.extend(
        _numeric_findings(
            candidate,
            before,
            source_texts,
            answered_source_texts,
        )
    )
    max_responsibility = max(
        (responsibility_rank(text) for text in [before, *source_texts]),
        default=0,
    )
    candidate_responsibility = responsibility_rank(candidate)
    if candidate_responsibility > max_responsibility:
        findings.append(
            "候选文本的责任等级高于来源证据"
            f"（{candidate_responsibility}>{max_responsibility}）"
        )
    max_causality = max(
        (causality_rank(text) for text in [before, *source_texts]),
        default=0,
    )
    candidate_causality = causality_rank(candidate)
    if candidate_causality > max_causality:
        findings.append(
            "候选文本的因果等级高于来源证据"
            f"（{candidate_causality}>{max_causality}）"
        )
    findings.extend(
        _term_findings(candidate, before, source_texts, introduced_terms)
    )
    return [f"{layer_name}：{finding}" for finding in findings]


def _is_not_applicable(change: OptimizationChange) -> bool:
    if change.action_kind == OptimizationAction.LEAVE_UNCHANGED:
        return True
    if change.action_kind == OptimizationAction.ASK_USER and (
        change.general_value is None and change.targeted_value is None
    ):
        return True
    if change.action_kind == OptimizationAction.SUGGEST_FROM_BANK:
        return True
    return False


def verify_plan_changes(
    *,
    plan: OptimizationPlan,
    source_documents: Mapping[str, Any],
) -> tuple[list[OptimizationChange], OptimizationSafetySummary]:
    """Verify each plan change independently and return copied safe results."""

    verified: list[OptimizationChange] = []
    allowed_ids: list[str] = []
    blocked_ids: list[str] = []
    pending_ids: list[str] = []
    summary_findings: list[str] = []

    for original in plan.changes:
        change = original.model_copy(deep=True)
        if _is_not_applicable(change):
            change = change.model_copy(
                update={"safety_status": "pending", "default_selected": False}
            )
            pending_ids.append(change.change_id)
            verified.append(change)
            continue

        findings: list[str] = []
        source_texts: list[str] = []
        answered_source_texts: list[str] = []
        if change.module_type in {
            OptimizationModuleType.EXPERIENCE_STAR,
            OptimizationModuleType.PERSONAL_SUMMARY,
        }:
            for field_name, value in (
                ("before_value", change.before_value),
                ("general_value", change.general_value),
                ("targeted_value", change.targeted_value),
            ):
                if not isinstance(value, str):
                    findings.append(
                        f"文本变更字段 {field_name} 必须是字符串"
                    )
        if not change.source_refs and change.module_type in {
            OptimizationModuleType.EXPERIENCE_STAR,
            OptimizationModuleType.PERSONAL_SUMMARY,
        }:
            findings.append("文本变更缺少来源引用")
        for source_ref in change.source_refs:
            try:
                tokens = _pointer_tokens(source_ref)
            except ValueError as exc:
                findings.append(f"来源引用“{source_ref}”无效：{exc}")
                continue
            scope_finding = _source_scope_finding(
                change,
                tokens,
                plan=plan,
                source_documents=source_documents,
            )
            if scope_finding is not None:
                findings.append(f"来源引用“{source_ref}”越界：{scope_finding}")
                continue
            try:
                resolved = resolve_source_ref(source_documents, source_ref)
            except ValueError as exc:
                findings.append(f"来源引用“{source_ref}”无效：{exc}")
                continue
            resolved_texts = _flatten_source_text(resolved)
            source_texts.extend(resolved_texts)
            if tokens[0] == "userAnswers":
                answered_source_texts.extend(resolved_texts)

        if not findings:
            findings.extend(
                _candidate_findings(
                    change.general_value,
                    before=change.before_value,
                    source_texts=source_texts,
                    answered_source_texts=answered_source_texts,
                    introduced_terms=change.introduced_terms,
                    layer_name="通用候选",
                )
            )
            findings.extend(
                _candidate_findings(
                    change.targeted_value,
                    before=change.before_value,
                    source_texts=source_texts,
                    answered_source_texts=answered_source_texts,
                    introduced_terms=change.introduced_terms,
                    layer_name="定向候选",
                )
            )

        findings = list(dict.fromkeys(findings))
        if findings:
            change = change.model_copy(
                update={
                    "general_value": change.before_value,
                    "targeted_value": change.before_value,
                    "default_selected": False,
                    "safety_status": "blocked",
                    "safety_findings": findings,
                },
                deep=True,
            )
            blocked_ids.append(change.change_id)
            summary_findings.extend(
                f"{change.change_id}：{finding}" for finding in findings
            )
        else:
            change = change.model_copy(
                update={"safety_status": "allowed", "safety_findings": []}
            )
            allowed_ids.append(change.change_id)
        verified.append(change)

    return verified, OptimizationSafetySummary(
        allowed_change_ids=allowed_ids,
        blocked_change_ids=blocked_ids,
        pending_change_ids=pending_ids,
        findings=summary_findings,
    )
