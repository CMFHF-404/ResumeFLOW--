from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from decimal import Decimal, InvalidOperation
import html as html_lib
import hashlib
import json
import re
import unicodedata
from typing import Any

from .normalizers import (
    markdown_link_spans,
    markdown_link_targets,
    markdown_links_to_plain_text,
)

from .schemas import (
    OptimizationAction,
    OptimizationChange,
    OptimizationModuleType,
    OptimizationPlan,
    OptimizationSafetySummary,
    POLICY_VERSION,
)


_SOURCE_ROOTS = frozenset(
    {"currentResume", "selectedSourceExperiences", "userAnswers"}
)
_MISSING_FROZEN_VALUE = object()


_NUMBER_UNITS = (
    "分钟",
    "秒",
    "毫秒",
    "公里",
    "千克",
    "公斤",
    "小时",
    "用户",
    "客户",
    "订单",
    "请求",
    "万元",
    "亿元",
    "倍",
    "%",
    "‰",
    "‱",
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
_ZH_DIGIT_VALUES = {
    "零": 0,
    "〇": 0,
    "○": 0,
    "一": 1,
    "壹": 1,
    "二": 2,
    "两": 2,
    "兩": 2,
    "贰": 2,
    "貳": 2,
    "三": 3,
    "叁": 3,
    "參": 3,
    "四": 4,
    "肆": 4,
    "五": 5,
    "伍": 5,
    "六": 6,
    "陆": 6,
    "陸": 6,
    "七": 7,
    "柒": 7,
    "八": 8,
    "捌": 8,
    "九": 9,
    "玖": 9,
}
_ZH_SMALL_UNIT_VALUES = {
    "十": 10,
    "拾": 10,
    "百": 100,
    "佰": 100,
    "千": 1_000,
    "仟": 1_000,
}
_ZH_LARGE_UNIT_VALUES = {
    "万": 10_000,
    "萬": 10_000,
    "亿": 100_000_000,
    "億": 100_000_000,
}
_ZH_DECIMAL_MARKS = frozenset({"点", "點"})
_ZH_NUMERAL_CHARS = "".join(
    (
        *_ZH_DIGIT_VALUES,
        *_ZH_SMALL_UNIT_VALUES,
        *_ZH_LARGE_UNIT_VALUES,
        *_ZH_DECIMAL_MARKS,
    )
)
_ZH_NUMERAL_BODY = rf"[{re.escape(_ZH_NUMERAL_CHARS)}]+"
_ZH_QUANTITY_UNITS = tuple(
    sorted(
        {
            *(_NUMBER_UNITS),
            "秒",
            "毫秒",
            "个",
            "名",
            "位",
            "单",
            "件",
            "份",
            "套",
            "种",
            "场",
            "台",
            "条",
            "款",
            "批",
            "倍",
            "个百分点",
            "百分点",
            "公里",
            "米",
        }
        - {"万", "亿"},
        key=len,
        reverse=True,
    )
)
_ZH_QUANTITY_UNIT_PATTERN = "|".join(map(re.escape, _ZH_QUANTITY_UNITS))
_ZH_PERCENT_RE = re.compile(
    rf"(?<![第{re.escape(_ZH_NUMERAL_CHARS)}])"
    rf"(?P<leading_sign>[正负]?)(?P<scale>百分之|千分之?|万分之?)"
    rf"(?P<trailing_sign>[正负]?)(?P<value>{_ZH_NUMERAL_BODY})"
    rf"(?![{re.escape(_ZH_NUMERAL_CHARS)}])"
)
_ZH_QUANTITY_RE = re.compile(
    rf"(?<![第{re.escape(_ZH_NUMERAL_CHARS)}])"
    rf"(?P<sign>[正负]?)(?P<value>{_ZH_NUMERAL_BODY}?)"
    rf"(?P<classifier>个|名|位)?(?P<unit>{_ZH_QUANTITY_UNIT_PATTERN})"
    rf"(?![{re.escape(_ZH_NUMERAL_CHARS)}])"
)
_ZH_AMBIGUOUS_QUANTITY_RE = re.compile(
    rf"(?<![第{re.escape(_ZH_NUMERAL_CHARS)}])(?:"
    rf"(?:几|数|若干)(?:{_ZH_NUMERAL_BODY})?(?:个|名|位)?"
    rf"(?:{_ZH_QUANTITY_UNIT_PATTERN})"
    rf")"
)
_ZH_AMBIGUOUS_PERCENT_RE = re.compile(
    rf"(?:百分之|千分之|万分之)(?:"
    rf"(?:几|数|若干)(?:{_ZH_NUMERAL_BODY})?"
    rf")"
)
_ZH_QUALIFIED_QUANTITY_RE = re.compile(
    rf"(?<![第{re.escape(_ZH_NUMERAL_CHARS)}])"
    rf"(?P<sign>[正负]?)(?P<value>{_ZH_NUMERAL_BODY})"
    rf"(?:(?P<inner_qualifier>余|多|来)(?P<inner_classifier>个|名|位)?"
    rf"(?P<inner_unit>{_ZH_QUANTITY_UNIT_PATTERN})"
    rf"|(?P<outer_classifier>个|名|位)?"
    rf"(?P<outer_unit>{_ZH_QUANTITY_UNIT_PATTERN})"
    rf"(?P<outer_qualifier>左右|上下|以上|以下))"
)
_ZH_BARE_NUMERAL_RE = re.compile(
    rf"(?<![第{re.escape(_ZH_NUMERAL_CHARS)}])"
    rf"(?P<sign>[正负]?)(?P<value>{_ZH_NUMERAL_BODY})"
    rf"(?![{re.escape(_ZH_NUMERAL_CHARS)}])"
)
_ZH_AMBIGUOUS_BARE_NUMERAL_RE = re.compile(
    rf"(?<![第{re.escape(_ZH_NUMERAL_CHARS)}])"
    rf"(?:(?:几|数){_ZH_NUMERAL_BODY}|若干)"
    rf"(?![{re.escape(_ZH_NUMERAL_CHARS)}])"
)
_ZH_FUZZY_QUANTITY_RE = re.compile(
    rf"(?<![第{re.escape(_ZH_NUMERAL_CHARS)}几])(?:"
    rf"[{re.escape(_ZH_NUMERAL_CHARS)}几]*几[{re.escape(_ZH_NUMERAL_CHARS)}几]*"
    rf"(?:个|名|位)?(?:{_ZH_QUANTITY_UNIT_PATTERN})"
    rf"|{_ZH_NUMERAL_BODY}(?:余|多|来)"
    rf"(?:十|百|千)?(?:万亿|亿|万)(?:个|名|位)?"
    rf"(?:{_ZH_QUANTITY_UNIT_PATTERN})?"
    rf"|[一二两三四五六七八九]{{2}}(?:万亿|亿|万)"
    rf"(?:个|名|位)?(?:{_ZH_QUANTITY_UNIT_PATTERN})?"
    rf"|(?:多名|多位|多人|许多|众多|大量|海量)"
    rf"(?:{_ZH_QUANTITY_UNIT_PATTERN})?"
    rf")"
)
_ZH_FIXED_QUANTIFIER_RE = re.compile(
    r"(?P<kind>双倍|翻倍|翻一番|翻番|倍增|(?:提升|增长|增加)一倍(?!半)|减半(?!拍)|"
    r"(?:降低|减少|下降|缩减|降)(?:到|至)?一半(?!拍)|腰斩)"
)
_ZH_AMBIGUOUS_INCREASE_MULTIPLIER_RE = re.compile(
    r"(?:提升|增长|增加)\s*(?:2(?:\.0+)?|二|两)\s*倍"
)
_ZH_MULTI_FOLD_RE = re.compile(
    rf"翻(?:了)?(?P<count>{_ZH_NUMERAL_BODY}|\d+)番"
)
_EN_FIXED_MULTIPLIER_RE = re.compile(
    r"\b(?P<kind>doubled?|tripled?|quadrupled?|twofold|threefold|fourfold|halved?)\b",
    re.IGNORECASE,
)
_EN_GENERAL_FOLD_RE = re.compile(
    r"\b(?P<count>five|six|seven|eight|nine|ten|\d+)[- ]?fold\b",
    re.IGNORECASE,
)
_EN_ORDER_OF_MAGNITUDE_RE = re.compile(
    r"\b(?:an?|one)\s+order\s+of\s+magnitude\b",
    re.IGNORECASE,
)
_EN_EXPLICIT_MULTIPLIER_RE = re.compile(
    r"(?P<value>\d+(?:\.\d+)?)\s*(?:x\b|×|times?\b)",
    re.IGNORECASE,
)
_EN_FRACTION_QUANTITY_RE = re.compile(
    r"\b(?:by\s+(?:a\s+)?|in\s+|to\s+(?:a|one)\s+)"
    r"(?P<fraction>half|third|quarter)\b",
    re.IGNORECASE,
)
_EN_INDETERMINATE_WORD_QUANTITY_RE = re.compile(
    r"\b(?:(?:dozens|tens|hundreds|thousands|millions|billions|trillions)"
    r"\s+of\s+[A-Za-z][A-Za-z-]*|"
    r"(?:a\s+few|few|several)\s+(?:hundred|thousand|million|billion|trillion)"
    r"(?:\s+[A-Za-z][A-Za-z-]*)?|"
    r"(?:countless|many|numerous|multiple|several|a\s+few)\s+"
    r"(?!hundred|thousand|million|billion|trillion)"
    r"[A-Za-z][A-Za-z-]*|"
    r"(?:myriad|myriads\s+of)\s+[A-Za-z][A-Za-z-]*|"
    r"(?:scores|a\s+couple|a\s+handful)\s+of\s+[A-Za-z][A-Za-z-]*|"
    r"(?:orders\s+of\s+magnitude|severalfold)(?:\s+growth)?)\b",
    re.IGNORECASE,
)
_EN_DOZEN_QUANTITY_RE = re.compile(
    r"\b(?:a\s+)?dozen\s+(?P<unit>[A-Za-z][A-Za-z-]*)\b",
    re.IGNORECASE,
)
_EN_SHARE_FRACTION_RE = re.compile(
    r"\b(?P<fraction>half|(?:a\s+)?quarter)\s+of\s+(?:all\s+)?"
    r"(?P<unit>[A-Za-z][A-Za-z-]*)\b",
    re.IGNORECASE,
)
_ZH_SHARE_FRACTION_RE = re.compile(
    rf"(?P<qualifier>过|近|大)半(?P<unit>{_ZH_QUANTITY_UNIT_PATTERN})"
)
_ZH_CONTEXTUAL_HALF_RE = re.compile(r"(?P<qualifier>过|近|大)半(?!拍|个|名|位)")
_ZH_ONE_AND_HALF_MULTIPLIER_RE = re.compile(
    rf"(?P<value>{_ZH_NUMERAL_BODY}|\d+)倍半"
)
_ZH_INDETERMINATE_SCALE_RE = re.compile(
    r"(?:成倍(?:增长|提升|增加)|(?:增长|提升|增加)?多倍(?:增长|提升|增加)?|"
    r"数以(?:十|百|千|万|亿)计)"
)
_ZH_TENTHS_PERCENT_RE = re.compile(
    rf"(?<![A-Za-z0-9第{re.escape(_ZH_NUMERAL_CHARS)}])"
    rf"(?P<value>{_ZH_NUMERAL_BODY}|\d+)成"
    rf"(?P<fraction>半|[一二两三四五六七八九](?:分)?)?"
    rf"(?![就A-Za-z0-9{re.escape(_ZH_NUMERAL_CHARS)}])"
)
_ZH_HALF_TENTH_PERCENT_RE = re.compile(r"半成(?!就)")
_ZH_COMPOSITE_MAGNITUDE_PATTERN = (
    r"(?:十|百|千)?(?:万亿|萬億|万億|萬亿)|"
    r"(?:十|百|千)?(?:亿|億)|(?:十|百|千)?(?:万|萬)|十|百|千"
)
_MIXED_ZH_MAGNITUDE_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>(?:\d+(?:\.\d+)?|\.\d+))\s*"
    rf"(?P<magnitude>{_ZH_COMPOSITE_MAGNITUDE_PATTERN})\s*"
    r"(?P<qualifier>\+|多|余)?\s*"
    r"(?P<classifier>个|名|位)?"
    rf"(?P<unit>{_ZH_QUANTITY_UNIT_PATTERN})?"
    rf"(?![{re.escape(_ZH_NUMERAL_CHARS)}])"
)
_ZH_SCALE_THRESHOLD_RE = re.compile(
    rf"(?P<qualifier>上|过|破)(?P<magnitude>{_ZH_COMPOSITE_MAGNITUDE_PATTERN})"
    rf"(?:(?P<classifier>个|名|位)?(?P<unit>{_ZH_QUANTITY_UNIT_PATTERN})"
    rf"|(?![A-Za-z0-9_\u4e00-\u9fff]))"
)
_ENGLISH_UNIT_ALIASES = {
    "user": "users",
    "users": "users",
    "order": "orders",
    "orders": "orders",
    "project": "projects",
    "projects": "projects",
    "year": "years",
    "years": "years",
    "month": "months",
    "months": "months",
    "day": "days",
    "days": "days",
    "hour": "hours",
    "hours": "hours",
    "minute": "minutes",
    "minutes": "minutes",
    "min": "minutes",
    "second": "seconds",
    "seconds": "seconds",
    "s": "seconds",
    "ms": "milliseconds",
    "millisecond": "milliseconds",
    "milliseconds": "milliseconds",
    "hr": "hours",
    "hrs": "hours",
    "customer": "customers",
    "customers": "customers",
    "client": "clients",
    "clients": "clients",
    "record": "records",
    "records": "records",
    "km": "kilometers",
    "kg": "kilograms",
    "kbps": "kilobits/second",
    "m": "meters",
    "meter": "meters",
    "meters": "meters",
    "kilometer": "kilometers",
    "kilometers": "kilometers",
    "g": "grams",
    "gram": "grams",
    "grams": "grams",
    "kilogram": "kilograms",
    "kilograms": "kilograms",
    "request": "requests",
    "requests": "requests",
    "req": "requests",
    "operation": "operations",
    "operations": "operations",
    "ops": "operations",
    "rps": "requests/second",
    "qps": "queries/second",
    "rpm": "requests/minute",
    "mbps": "megabits/second",
    "person": "people",
    "people": "people",
    "percent": "%",
    "percentage point": "percentage points",
    "percentage points": "percentage points",
    "usd": "USD",
    "cny": "CNY",
    "rmb": "CNY",
    "eur": "EUR",
    "gbp": "GBP",
}
_ENGLISH_UNIT_PATTERN = "|".join(
    map(re.escape, sorted(_ENGLISH_UNIT_ALIASES, key=len, reverse=True))
)
_GENERIC_ENGLISH_UNIT_TOKEN = r"[A-Za-z][A-Za-z-]*"
_EN_NUMBER_WORD_TOKEN = (
    r"zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|"
    r"twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|"
    r"nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|"
    r"hundred|thousand|million|billion|trillion"
)
_EN_WORD_NUMBER_RE = re.compile(
    rf"\b(?P<value>(?:{_EN_NUMBER_WORD_TOKEN})"
    rf"(?:[ -]+(?:(?:and)[ -]+)?(?:{_EN_NUMBER_WORD_TOKEN}))*)[ -]+"
    rf"(?P<unit>percentage\s+points?|percent|{_GENERIC_ENGLISH_UNIT_TOKEN})\b",
    re.IGNORECASE,
)
_EN_QUALIFIED_BARE_WORD_NUMBER_RE = re.compile(
    r"\b(?P<qualifier>about|around|approximately|roughly|nearly|almost|circa|"
    r"close\s+to|at\s+least|no\s+fewer\s+than|more\s+than|greater\s+than|over|"
    r"less\s+than|under|up\s+to|at\s+most|no\s+more\s+than)\s+"
    r"(?:a\s+)?(?P<value>hundred|thousand|million|billion|trillion)"
    rf"(?:\s+(?P<unit>{_GENERIC_ENGLISH_UNIT_TOKEN}))?\b",
    re.IGNORECASE,
)
_ENGLISH_UNIT_STOPWORDS = frozenset(
    {
        "and",
        "as",
        "at",
        "by",
        "for",
        "from",
        "in",
        "into",
        "more",
        "of",
        "on",
        "or",
        "over",
        "per",
        "than",
        "then",
        "to",
        "with",
        "previously",
        "originally",
        "formerly",
    }
)
_ARABIC_SEMANTIC_UNIT_PATTERN = "|".join(
    (
        _ZH_QUANTITY_UNIT_PATTERN,
        _ENGLISH_UNIT_PATTERN,
    )
)
_ENGLISH_MAGNITUDE_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>\d+(?:\.\d+)?)\s+"
    r"(?P<magnitude>thousand|million|billion|trillion)\b\s*"
    rf"(?P<unit>{_ENGLISH_UNIT_PATTERN}|{_GENERIC_ENGLISH_UNIT_TOKEN})?\b",
    re.IGNORECASE,
)
_ENGLISH_POSTFIX_QUALIFIED_NUMBER_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>\d+(?:\.\d+)?)\s+"
    r"(?P<qualifier>or\s+more)\s+"
    rf"(?P<unit>{_ENGLISH_UNIT_PATTERN})\b",
    re.IGNORECASE,
)
_SCIENTIFIC_NUMBER_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>(?:\d+(?:\.\d+)?|\.\d+)[eE][+-]?\d+)\s*"
    r"(?P<classifier>个|名|位)?"
    rf"(?P<unit>{_ARABIC_SEMANTIC_UNIT_PATTERN}|{_GENERIC_ENGLISH_UNIT_TOKEN})?",
    re.IGNORECASE,
)
_CURRENCY_PREFIX_ABBREVIATED_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<currency>USD|EUR|GBP|CNY|RMB|JPY|人民币|日元|\$|¥|€|£)\s*"
    r"(?P<value>\d+(?:\.\d+)?)\s*"
    r"(?P<magnitude>[kKmMbBwW])(?![A-Za-z])",
    re.IGNORECASE,
)
_CURRENCY_PREFIX_PLAIN_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<currency>USD|EUR|GBP|CNY|RMB|JPY|人民币|日元|\$|¥|€|£)\s*"
    r"(?P<value>\d+(?:\.\d+)?)(?![A-Za-z0-9_.,])",
    re.IGNORECASE,
)
_CURRENCY_PREFIX_GROUPED_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<currency>USD|EUR|GBP|CNY|RMB|JPY|人民币|日元|\$|¥|€|£)\s*"
    r"(?P<value>\d{1,3}(?:,\d{3})+(?:\.\d+)?)(?![A-Za-z0-9_.,])",
    re.IGNORECASE,
)
_CURRENCY_PREFIX_ENGLISH_MAGNITUDE_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<currency>USD|EUR|GBP|CNY|RMB|JPY|\$|¥|€|£)\s*"
    r"(?P<value>\d+(?:\.\d+)?)\s+"
    r"(?P<magnitude>thousand|million|billion|trillion)\b",
    re.IGNORECASE,
)
_OPAQUE_SLASH_DATE_RE = re.compile(
    r"(?<!\d)(?P<value>\d{1,4}/\d{1,2}/\d{1,4})(?!\d)"
)
_OPAQUE_LITERAL_ENTITY_RE = re.compile(
    r"(?P<value>&#(?:[xX][0-9A-Fa-f]+|\d+);?[A-Za-z0-9]*)"
)
_OPAQUE_TECH_NUMERIC_RE = re.compile(
    r"(?<![A-Za-z0-9_.])(?P<value>"
    r"\d+(?:\.\d+)?\s*(?:(?:K|M|G|T)B|MiB|GiB|TiB|p|fps|GHz|MHz|kHz|Hz|FA|th)"
    r"|TLS\d+(?:\.\d+)+|HTTP\d+(?:\.\d+)*|x\d+|p\d+)"
    r"(?![A-Za-z0-9_.])",
    re.IGNORECASE,
)
_OPAQUE_DISPLAY_K_RE = re.compile(
    r"(?<![A-Za-z0-9_.])(?P<value>\d+[Kk])"
    r"(?=\s*(?:video|display|resolution|视频|显示|分辨率|$))"
)
_OPAQUE_VERSION_SCALE_RE = re.compile(
    r"(?:\bversion|\bver\.?|版本)\s*(?P<value>\d+[kKmMbBwW])(?![A-Za-z0-9])",
    re.IGNORECASE,
)
_PLAIN_NUMBER_WITH_UNIT_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>(?:\d+(?:\.\d+)?|\.\d+))(?![0-9_.])\s*"
    r"(?P<classifier>个|名|位)?"
    rf"(?P<unit>{_ARABIC_SEMANTIC_UNIT_PATTERN})(?![A-Za-z])",
    re.IGNORECASE,
)
_GENERIC_ENGLISH_NUMBER_UNIT_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>\d+(?:\.\d+)?)\s+"
    rf"(?P<unit>{_GENERIC_ENGLISH_UNIT_TOKEN})\b",
    re.IGNORECASE,
)
_ATTACHED_PLAIN_ENGLISH_UNIT_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>\d+(?:\.\d+)?)(?:-)?(?P<unit>[A-Za-z][A-Za-z-]*)\b",
    re.IGNORECASE,
)
_RATIO_QUANTITY_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<numerator>\d+(?:\.\d+)?)\s*"
    r"(?:/|⁄|out\s+of|in|of)\s*(?P<denominator>\d+(?:\.\d+)?)\s*"
    r"(?P<classifier>个|名|位)?"
    rf"(?P<unit>{_ARABIC_SEMANTIC_UNIT_PATTERN}|{_GENERIC_ENGLISH_UNIT_TOKEN})?\b",
    re.IGNORECASE,
)
_EXPLICIT_RATIO_RE = re.compile(
    r"(?P<label>\bratio\b|比例|比率)\s*"
    r"(?P<numerator>\d+(?:\.\d+)?)\s*(?:/|⁄|:)\s*"
    r"(?P<denominator>\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
_TEMPERATURE_UNIT_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>\d+(?:\.\d+)?)\s*°\s*(?P<unit>[CF])\b",
    re.IGNORECASE,
)
_ZH_OBJECT_BOUNDARY = (
    r"(?=$|[\s，。；！？,.;!?、]|并|且|与|和|及|"
    r"建设|开发|设计|交付|完成|推进|优化|服务|支持|用于)"
)
_ZH_CLASSIFIED_OBJECT_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>\d+(?:\.\d+)?)\s*(?P<classifier>个|名|位|份)"
    rf"(?P<unit>[\u4e00-\u9fff]{{1,6}}?){_ZH_OBJECT_BOUNDARY}"
)
_ZH_CLASSIFIED_OBJECT_NUMERAL_RE = re.compile(
    rf"(?<![第{re.escape(_ZH_NUMERAL_CHARS)}])"
    rf"(?P<sign>[正负]?)(?P<value>{_ZH_NUMERAL_BODY})"
    rf"(?P<classifier>个|名|位|份)(?P<unit>[\u4e00-\u9fff]{{1,6}}?)"
    rf"{_ZH_OBJECT_BOUNDARY}"
)
_ABBREVIATED_NUMBER_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>\d+(?:\.\d+)?)\s*(?P<magnitude>[kKmMbBwW])"
    r"(?!\s*(?:[iI]?[bB])\b)(?![A-Za-z])\s*"
    r"(?P<qualifier>\+|多|余)?\s*"
    r"(?P<classifier>个|名|位)?"
    rf"(?P<unit>{_ARABIC_SEMANTIC_UNIT_PATTERN})?",
    re.IGNORECASE,
)
_ATTACHED_ABBREVIATED_UNIT_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>\d+(?:\.\d+)?)(?P<magnitude>[kKmMbBwW])"
    rf"(?P<unit>{_ENGLISH_UNIT_PATTERN})(?![A-Za-z])",
    re.IGNORECASE,
)
_VERSION_ABBREVIATION_PREFIX_RE = re.compile(
    r"(?:\bversion|\bver(?:sion)?\.?|版本)\s*$",
    re.IGNORECASE,
)
_GROUPED_NUMBER_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>\d{1,3}(?:(?:,\d{3})+|(?:[ '\u202f]\d{3})+)(?:\.\d+)?)"
    r"(?![A-Za-z0-9_.])\s*(?P<qualifier>\+|多|余)?\s*"
    r"(?P<classifier>个|名|位)?"
    rf"(?P<unit>{_ARABIC_SEMANTIC_UNIT_PATTERN})?",
    re.IGNORECASE,
)
_OPAQUE_DOTTED_NUMERIC_RE = re.compile(
    r"(?<![A-Za-z0-9_.])(?P<value>\d+(?:\.\d+){2,})(?![A-Za-z0-9_.])"
)
_POSTFIX_QUALIFIED_NUMBER_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<sign>[+-]?)\s*"
    r"(?P<value>\d+(?:\.\d+)?)(?![A-Za-z0-9_.])\s*"
    r"(?P<qualifier>\+|多|余)\s*(?P<classifier>个|名|位)?"
    rf"(?P<unit>{_ARABIC_SEMANTIC_UNIT_PATTERN})?",
    re.IGNORECASE,
)
_RICH_HTML_TAG_NAMES = r"b|strong|i|em|u|a|br|ul|ol|li|p|div"
_RICH_HTML_ATTRIBUTE_CONTENT = r'''(?:[^"'<>]|"[^"]*"|'[^']*')*'''
_RICH_HTML_TAG_RE = re.compile(
    rf"<(?P<closing>/)?(?P<tag>{_RICH_HTML_TAG_NAMES})\b"
    rf"(?P<attrs>{_RICH_HTML_ATTRIBUTE_CONTENT})>",
    re.IGNORECASE,
)
_MALFORMED_PROTECTED_HTML_TAG_RE = re.compile(
    rf"<(?:\s+/?\s*|/\s+)(?:{_RICH_HTML_TAG_NAMES})\b",
    re.IGNORECASE,
)
_UNTERMINATED_PROTECTED_HTML_TAG_RE = re.compile(
    rf"</?(?:{_RICH_HTML_TAG_NAMES})\b[^<>]*(?=<|$)",
    re.IGNORECASE,
)
_HTML_TAG_NAME_TOKEN_RE = re.compile(
    r"<(?P<closing>/)?(?P<tag>[^\s/>]+)",
    re.IGNORECASE,
)
_HTML_TAG_LIKE_PREFIX_RE = re.compile(r"</?[A-Za-z!?][^\s<>/]*", re.IGNORECASE)
_RICH_HTML_TAG_NAME_ALLOWLIST = frozenset(_RICH_HTML_TAG_NAMES.split("|"))
_RICH_HTML_ATTRIBUTE_RE = re.compile(
    r'''\s+(?P<name>[^\s"'<>/=]+)'''
    r'''(?:\s*=\s*(?:"(?P<double>[^"]*)"|'(?P<single>[^']*)'|'''
    r'''(?P<bare>[^\s"'=<>`]+)))?''',
    re.IGNORECASE,
)
_HTML_TAG_RE = re.compile(
    r'''<(?:[^"'<>]|"[^"]*"|'[^']*')*>''',
    re.IGNORECASE,
)
_RAW_TEXT_HTML_TAGS = frozenset(
    {
        "iframe",
        "noembed",
        "noframes",
        "noscript",
        "plaintext",
        "script",
        "style",
        "template",
        "textarea",
        "title",
        "xmp",
    }
)
_RICH_HTML_LIST_TAGS = frozenset({"ul", "ol", "li"})
_RICH_HTML_LIST_CONTAINERS = frozenset({"ul", "ol"})
# Visible-content policy treats every Cf character as non-rendering, preserving
# the existing contract, and adds the non-Cf marks, fillers, and reserved ranges
# from Unicode Default_Ignorable_Code_Point. Do not broaden this to every Mn.
_DEFAULT_IGNORABLE_CODE_POINT_RANGES = (
    (0x034F, 0x034F),
    (0x115F, 0x1160),
    (0x17B4, 0x17B5),
    (0x180B, 0x180F),
    (0x2065, 0x2065),
    (0x3164, 0x3164),
    (0xFE00, 0xFE0F),
    (0xFFA0, 0xFFA0),
    (0xFFF0, 0xFFF8),
    (0xE0000, 0xE0FFF),
)
_MARKDOWN_BOLD_RE = re.compile(r"(?:\*\*|＊＊)[^*＊\r\n]+(?:\*\*|＊＊)")
_MARKDOWN_UNDERLINE_RE = re.compile(r"__[^_\r\n]+__")
_MARKDOWN_ITALIC_RE = re.compile(r"(?<!\*)\*(?![\s*])[^*\r\n]*?\S\*(?!\*)")
_MARKDOWN_BINDING_PATTERNS = (
    (
        "markdown:bold",
        re.compile(
            r"(?P<open>\*\*|＊＊)(?P<content>[^*＊\r\n]+)(?P<close>\*\*|＊＊)"
        ),
    ),
    (
        "markdown:underline",
        re.compile(r"(?P<open>__)(?P<content>[^_\r\n]+)(?P<close>__)"),
    ),
    (
        "markdown:italic",
        re.compile(
            r"(?<!\*)(?P<open>\*)(?![\s*])"
            r"(?P<content>[^*\r\n]*?\S)(?P<close>\*)(?!\*)"
        ),
    ),
)
_DANGEROUS_RICH_TEXT_URL_SCHEMES = frozenset({"data", "file", "javascript", "vbscript"})

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
    "吞吐量",
    "用户规模",
    "规模",
    "用户数",
    "订单量",
    "GMV",
    "ROI",
    "conversion rate",
    "retention rate",
    "revenue",
    "latency",
    "DAU",
    "WAU",
    "MAU",
    "QPS",
    "TPS",
    "RPS",
    "ARR",
    "MRR",
)


def _normalize_text(value: str) -> str:
    return (
        unicodedata.normalize("NFKC", value)
        .replace("−", "-")
        .translate(str.maketrans("٠١٢٣٤٥٦٧٨٩٬", "0123456789,"))
    )


def _normalized_term(value: str) -> str:
    return re.sub(r"\s+", " ", _normalize_text(value).casefold()).strip()


def _rich_html_attributes(
    attrs: str,
) -> tuple[list[tuple[str, str | None]], bool] | None:
    attributes: list[tuple[str, str | None]] = []
    cursor = 0
    while cursor < len(attrs):
        remainder = attrs[cursor:]
        if not remainder.strip():
            break
        self_closing = re.fullmatch(r"\s*/\s*", remainder)
        if self_closing:
            return attributes, True
        match = _RICH_HTML_ATTRIBUTE_RE.match(attrs, cursor)
        if match is None or match.end() == cursor:
            return None
        value = next(
            (
                item
                for item in match.group("double", "single", "bare")
                if item is not None
            ),
            None,
        )
        attributes.append((match.group("name").casefold(), value))
        cursor = match.end()
    return attributes, False


def _rich_html_href(attrs: str) -> str:
    parsed = _rich_html_attributes(attrs)
    if parsed is None:
        return ""
    attributes, _ = parsed
    hrefs = [value for name, value in attributes if name == "href"]
    if len(hrefs) != 1 or hrefs[0] is None:
        return ""
    return html_lib.unescape(hrefs[0].strip())


def _rich_html_attributes_hide_subtree(attrs: str) -> bool:
    parsed = _rich_html_attributes(attrs)
    if parsed is None:
        return False
    attributes, _ = parsed
    if any(name == "hidden" for name, _ in attributes):
        return True
    for name, raw_value in attributes:
        value = html_lib.unescape(raw_value or "").casefold().strip()
        if name == "aria-hidden" and value == "true":
            return True
        if name == "style" and re.search(
            r"(?:display\s*:\s*none|visibility\s*:\s*hidden)",
            value,
        ):
            return True
    return False


def _html_markup_end(value: str, start: int) -> int | None:
    quote: str | None = None
    cursor = start + 1
    while cursor < len(value):
        char = value[cursor]
        if quote is not None:
            if char == quote:
                quote = None
        elif char in {'"', "'"}:
            quote = char
        elif char == ">":
            return cursor + 1
        cursor += 1
    return None


def _raw_text_element_end(
    value: str,
    *,
    tag: str,
    content_start: int,
) -> int:
    if tag == "plaintext":
        return len(value)
    folded = value.casefold()
    needle = f"</{tag}"
    cursor = content_start
    while True:
        close_start = folded.find(needle, cursor)
        if close_start < 0:
            return len(value)
        boundary = close_start + len(needle)
        if boundary < len(value) and value[boundary] not in "\t\n\f\r />":
            cursor = boundary
            continue
        close_end = _html_markup_end(value, close_start)
        return len(value) if close_end is None else close_end


def _mask_non_rendered_html_contexts(value: str) -> str:
    """Hide markup that must not contribute protected rich-text tokens.

    The returned value keeps the same length so regex match offsets still map
    to the original source. Known rich-text tags stay intact; comments and
    raw-text elements are hidden, and attributes on unknown tags are hidden so
    quoted tag-shaped text cannot masquerade as rendered markup.
    """

    masked = list(value)
    cursor = 0
    while cursor < len(value):
        start = value.find("<", cursor)
        if start < 0:
            break
        if value.startswith("<!--", start):
            comment_end = value.find("-->", start + 4)
            end = len(value) if comment_end < 0 else comment_end + 3
            masked[start:end] = " " * (end - start)
            cursor = end
            continue

        tag_token = _HTML_TAG_NAME_TOKEN_RE.match(value, start)
        end = _html_markup_end(value, start)
        if tag_token is None:
            if _MALFORMED_PROTECTED_HTML_TAG_RE.match(value, start):
                cursor = start + 1
                continue
            if end is None:
                cursor = start + 1
                continue
            masked[start:end] = " " * (end - start)
            cursor = end
            continue

        tag = tag_token.group("tag").casefold()
        is_closing = bool(tag_token.group("closing"))
        if end is None:
            if tag not in _RICH_HTML_TAG_NAME_ALLOWLIST:
                attrs_start = tag_token.end("tag")
                masked[attrs_start:] = " " * (len(value) - attrs_start)
            break

        if (
            tag in _RAW_TEXT_HTML_TAGS
            and not is_closing
        ):
            raw_end = _raw_text_element_end(
                value,
                tag=tag,
                content_start=end,
            )
            masked[start:raw_end] = " " * (raw_end - start)
            cursor = raw_end
            continue

        if tag not in _RICH_HTML_TAG_NAME_ALLOWLIST:
            attrs_start = tag_token.end("tag")
            masked[attrs_start:end - 1] = " " * (end - 1 - attrs_start)
        cursor = end
    return "".join(masked)


def _has_malformed_html_comment_or_raw_container(value: str) -> bool:
    """Fail closed where the browser parser can disagree with lexical masking."""

    cursor = 0
    while cursor < len(value):
        start = value.find("<", cursor)
        if start < 0:
            return False
        if value.startswith("<!--", start):
            comment_end = value.find("-->", start + 4)
            if comment_end < 0 or value[start + 4:start + 5] == ">":
                return True
            cursor = comment_end + 3
            continue
        token = _HTML_TAG_NAME_TOKEN_RE.match(value, start)
        end = _html_markup_end(value, start)
        if token is not None and token.group("tag").casefold() in _RAW_TEXT_HTML_TAGS:
            return True
        cursor = end if end is not None else start + 1
    return False


def _has_only_allowed_html_tags_and_block_nesting(value: str) -> bool:
    stack: list[str] = []
    scan_value = _strip_non_rendered_html_contexts(value)
    for match in _HTML_TAG_RE.finditer(scan_value):
        markup = match.group(0)
        if markup.startswith("<!--"):
            continue
        token = _HTML_TAG_NAME_TOKEN_RE.match(markup)
        if token is None:
            return False
        tag = token.group("tag").casefold()
        if tag not in _RICH_HTML_TAG_NAME_ALLOWLIST:
            return False
        closing = bool(token.group("closing"))
        if tag == "br":
            if closing:
                return False
            continue
        if closing:
            if not stack or stack[-1] != tag:
                return False
            stack.pop()
            continue
        if "p" in stack and tag in {"p", "div", "ul", "ol", "li"}:
            return False
        stack.append(tag)
    return not stack


_NUMERIC_CHARACTER_REFERENCE_RE = re.compile(
    r"&#(?:(?P<hex>[xX][0-9A-Fa-f]+)|(?P<decimal>\d+));?"
)


def _is_unsafe_unicode_scalar(codepoint: int) -> bool:
    if codepoint < 0 or codepoint > 0x10FFFF:
        return True
    if codepoint in {0x09, 0x0A, 0x0D}:
        return False
    if codepoint < 0x20 or 0x7F <= codepoint <= 0x9F:
        return True
    return 0xFDD0 <= codepoint <= 0xFDEF or (codepoint & 0xFFFF) in {
        0xFFFE,
        0xFFFF,
    }


def _has_unsafe_unicode_scalar_or_reference(value: str) -> bool:
    if any(_is_unsafe_unicode_scalar(ord(char)) for char in value):
        return True
    for match in _NUMERIC_CHARACTER_REFERENCE_RE.finditer(value):
        digits = match.group("hex") or match.group("decimal")
        base = 16 if match.group("hex") else 10
        if match.group("hex"):
            digits = digits[1:]
        try:
            codepoint = int(digits, base)
        except ValueError:
            return True
        if _is_unsafe_unicode_scalar(codepoint):
            return True
    return False


def _rendered_text_scan_value(value: str) -> str:
    """Return only rendered text-node source, with every HTML tag masked."""

    scan_value = _mask_non_rendered_html_contexts(value)
    rendered = list(scan_value)
    for match in _HTML_TAG_RE.finditer(scan_value):
        rendered[match.start():match.end()] = " " * (match.end() - match.start())
    return "".join(rendered)


def _is_default_ignorable_code_point(char: str) -> bool:
    if unicodedata.category(char) == "Cf":
        return True
    codepoint = ord(char)
    return any(
        range_start <= codepoint <= range_end
        for range_start, range_end in _DEFAULT_IGNORABLE_CODE_POINT_RANGES
    )


_FACT_BLOCK_TAGS = frozenset(
    {
        "br",
        "p",
        "div",
        "li",
        "ul",
        "ol",
        "table",
        "tr",
        "td",
        "th",
        "section",
        "article",
        "header",
        "footer",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
    }
)
_HTML_VOID_TAGS = frozenset(
    {
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr",
    }
)


_FACT_MARKDOWN_BOUNDARY = "\ufdd0"


def _strip_non_rendered_html_contexts(
    value: str,
    *,
    removed_boundary: str = "",
) -> str:
    chunks: list[str] = []
    cursor = 0
    while cursor < len(value):
        start = value.find("<", cursor)
        if start < 0:
            chunks.append(value[cursor:])
            break
        chunks.append(value[cursor:start])
        if value.startswith("<!--", start):
            comment_end = value.find("-->", start + 4)
            chunks.append(removed_boundary)
            cursor = len(value) if comment_end < 0 else comment_end + 3
            continue
        token = _HTML_TAG_NAME_TOKEN_RE.match(value, start)
        end = _html_markup_end(value, start)
        if token is None or end is None:
            chunks.append(value[start : start + 1])
            cursor = start + 1
            continue
        tag = token.group("tag").casefold()
        if tag in _RAW_TEXT_HTML_TAGS and not token.group("closing"):
            chunks.append(removed_boundary)
            cursor = _raw_text_element_end(value, tag=tag, content_start=end)
            continue
        hidden_subtree = _rich_html_attributes_hide_subtree(
            value[token.end("tag") : end - 1]
        )
        if not token.group("closing") and hidden_subtree:
            chunks.append(removed_boundary)
            cursor = (
                end
                if tag in _HTML_VOID_TAGS
                else _raw_text_element_end(value, tag=tag, content_start=end)
            )
            continue
        chunks.append(value[start:end])
        cursor = end
    return "".join(chunks)


def _has_hidden_html_subtree(value: str) -> bool:
    cursor = 0
    while cursor < len(value):
        start = value.find("<", cursor)
        if start < 0:
            return False
        if value.startswith("<!--", start):
            comment_end = value.find("-->", start + 4)
            cursor = len(value) if comment_end < 0 else comment_end + 3
            continue
        token = _HTML_TAG_NAME_TOKEN_RE.match(value, start)
        end = _html_markup_end(value, start)
        if token is None or end is None:
            cursor = start + 1
            continue
        tag = token.group("tag").casefold()
        if tag in _RAW_TEXT_HTML_TAGS and not token.group("closing"):
            cursor = _raw_text_element_end(value, tag=tag, content_start=end)
            continue
        if (
            not token.group("closing")
            and tag not in _HTML_VOID_TAGS
            and _rich_html_attributes_hide_subtree(
                value[token.end("tag") : end - 1]
            )
        ):
            return True
        cursor = end
    return False


def _fact_visible_text(value: str) -> str:
    """Normalize only renderer-visible fact text for semantic safety scans."""

    # The editor interprets Markdown independently inside each text node.  An
    # HTML tag/comment/raw subtree is therefore a Markdown parsing boundary,
    # even though inline HTML is transparent after rendering.  Parse each
    # segment first, then join the rendered text nodes; stripping HTML first
    # would incorrectly turn bracket syntax spanning a tag into a real link.
    scan_value = _strip_non_rendered_html_contexts(
        value,
        removed_boundary=_FACT_MARKDOWN_BOUNDARY,
    )

    def render_markdown_segment(segment: str) -> str:
        rendered = markdown_links_to_plain_text(segment)
        rendered = re.sub(r"\*\*(?=\S)(.+?\S)\*\*", r"\1", rendered)
        rendered = re.sub(r"__(?=\S)(.+?\S)__", r"\1", rendered)
        rendered = re.sub(r"(?<!\*)\*(?=\S)(.+?\S)\*(?!\*)", r"\1", rendered)
        rendered = re.sub(r"(?<!\w)_(?=\S)(.+?\S)_(?!\w)", r"\1", rendered)
        return re.sub(r"`(?=\S)(.+?\S)`", r"\1", rendered)

    rendered_chunks: list[str] = []
    for boundary_chunk in scan_value.split(_FACT_MARKDOWN_BOUNDARY):
        cursor = 0
        for match in _HTML_TAG_RE.finditer(boundary_chunk):
            rendered_chunks.append(render_markdown_segment(boundary_chunk[cursor:match.start()]))
            token = _HTML_TAG_NAME_TOKEN_RE.match(match.group(0))
            if token is None or token.group("tag").casefold() in _FACT_BLOCK_TAGS:
                rendered_chunks.append(" ")
            cursor = match.end()
        rendered_chunks.append(render_markdown_segment(boundary_chunk[cursor:]))
    visible = "".join(rendered_chunks)
    visible = html_lib.unescape(visible).replace("\xa0", " ")
    visible = "".join(
        char for char in visible if not _is_default_ignorable_code_point(char)
    )
    return _normalize_text(visible)


def _has_visible_html_content(value: str) -> bool:
    visible = html_lib.unescape(_rendered_text_scan_value(value)).replace("\xa0", " ")
    visible = "".join(
        char
        for char in visible
        if not _is_default_ignorable_code_point(char)
    )
    return bool(visible.strip())


def _nonempty_protected_wrapper_counts(value: str) -> Counter[str]:
    protected_tags = frozenset({"a", "b", "strong", "i", "em", "u", "li"})
    open_tags: list[tuple[str, str, int]] = []
    counts: Counter[str] = Counter()
    scan_value = _mask_non_rendered_html_contexts(value)
    for match in _RICH_HTML_TAG_RE.finditer(scan_value):
        tag = match.group("tag").casefold()
        if tag not in protected_tags:
            continue
        if not match.group("closing"):
            key = f"a:{_rich_html_href(match.group('attrs') or '')}" if tag == "a" else tag
            open_tags.append((tag, key, match.end()))
            continue
        if not open_tags or open_tags[-1][0] != tag:
            continue
        _, key, content_start = open_tags.pop()
        if _has_visible_html_content(value[content_start:match.start()]):
            counts[key] += 1
    return counts


def _has_valid_protected_html_nesting(value: str) -> bool:
    """Validate protected markup directly, without relying on browser repair."""

    scan_value = _mask_non_rendered_html_contexts(value)
    if (
        _MALFORMED_PROTECTED_HTML_TAG_RE.search(scan_value)
        or _UNTERMINATED_PROTECTED_HTML_TAG_RE.search(scan_value)
        or _has_unterminated_html_tag_like(scan_value)
    ):
        return False
    for token in _HTML_TAG_NAME_TOKEN_RE.finditer(scan_value):
        tag_name = token.group("tag").casefold()
        if tag_name in _RICH_HTML_TAG_NAME_ALLOWLIST:
            if _RICH_HTML_TAG_RE.match(scan_value, token.start()) is None:
                return False
            continue
        if any(
            tag_name.startswith(f"{protected_name}{separator}")
            for protected_name in _RICH_HTML_TAG_NAME_ALLOWLIST
            for separator in (".", "_", "@", "-")
        ):
            return False
    stack: list[str] = []
    for match in _RICH_HTML_TAG_RE.finditer(scan_value):
        tag = match.group("tag").casefold()
        is_closing = bool(match.group("closing"))
        if is_closing and (match.group("attrs") or "").strip():
            return False
        parsed_attributes = _rich_html_attributes(match.group("attrs") or "")
        if parsed_attributes is None:
            return False
        attributes, self_closing = parsed_attributes
        attribute_names = [name for name, _ in attributes]
        if len(set(attribute_names)) != len(attribute_names):
            return False
        if tag == "a" and not is_closing and any(
            name == "href" and value is None for name, value in attributes
        ):
            return False
        if tag == "br":
            if is_closing:
                return False
            continue
        if self_closing:
            return False
        if is_closing:
            if not stack or stack[-1] != tag:
                return False
            stack.pop()
            continue
        if tag == "a" and "a" in stack:
            return False
        stack.append(tag)
    return not stack


def _has_unterminated_html_tag_like(scan_value: str) -> bool:
    """Fail closed for lexical tag starts while preserving ordinary ``<`` text."""

    cursor = 0
    while cursor < len(scan_value):
        start = scan_value.find("<", cursor)
        if start < 0:
            return False
        if _HTML_TAG_LIKE_PREFIX_RE.match(scan_value, start) is None:
            cursor = start + 1
            continue
        end = _html_markup_end(scan_value, start)
        if end is None:
            return True
        cursor = end
    return False


def _list_direct_segment_is_whitespace(segment: str) -> bool:
    if _HTML_TAG_RE.search(segment):
        return False
    return not _has_visible_html_content(segment)


def _has_valid_html_list_content_model(value: str) -> bool:
    """Require ``li`` as the only rendered direct child of ``ul``/``ol``."""

    scan_value = _mask_non_rendered_html_contexts(value)
    stack: list[str] = []
    cursor = 0
    for match in _RICH_HTML_TAG_RE.finditer(scan_value):
        parent = stack[-1] if stack else None
        if (
            parent in _RICH_HTML_LIST_CONTAINERS
            and not _list_direct_segment_is_whitespace(
                scan_value[cursor:match.start()]
            )
        ):
            return False

        tag = match.group("tag").casefold()
        is_closing = bool(match.group("closing"))
        if not is_closing:
            if parent in _RICH_HTML_LIST_CONTAINERS and tag != "li":
                return False
            if tag == "li" and parent not in _RICH_HTML_LIST_CONTAINERS:
                return False

        if tag != "br":
            if is_closing:
                stack.pop()
            else:
                stack.append(tag)
        cursor = match.end()

    return not (
        stack
        and stack[-1] in _RICH_HTML_LIST_CONTAINERS
        and not _list_direct_segment_is_whitespace(scan_value[cursor:])
    )


def _rich_text_list_signature(value: str) -> tuple[Any, ...]:
    """Capture list roots and exact ``ul``/``ol``/``li`` ancestry."""

    roots: list[list[Any]] = []
    stack: list[list[Any]] = []
    scan_value = _mask_non_rendered_html_contexts(value)
    for match in _RICH_HTML_TAG_RE.finditer(scan_value):
        tag = match.group("tag").casefold()
        if tag not in _RICH_HTML_LIST_TAGS:
            continue
        if match.group("closing"):
            if stack:
                stack.pop()
            continue
        node: list[Any] = [tag, []]
        if stack:
            stack[-1][1].append(node)
        else:
            roots.append(node)
        stack.append(node)

    def freeze(node: list[Any]) -> tuple[Any, ...]:
        return (node[0], tuple(freeze(child) for child in node[1]))

    return tuple(freeze(root) for root in roots)


def _markdown_link_urls(value: str) -> tuple[str, ...]:
    return markdown_link_targets(value)


def _is_safe_rich_text_link_target(value: str) -> bool:
    """Reject URI schemes that can execute or embed active content.

    Decode the same HTML character references a renderer sees before inspecting
    the scheme, and disregard controls/whitespace that browsers may normalize
    out of an obfuscated protocol name. The target remains otherwise literal
    for the preservation comparison below.
    """

    decoded = html_lib.unescape(value).strip()
    compact = "".join(
        char
        for char in decoded
        if not char.isspace() and not (0 <= ord(char) <= 0x1F or 0x7F <= ord(char) <= 0x9F)
    )
    match = re.match(r"(?P<scheme>[A-Za-z][A-Za-z0-9+.-]*):", compact)
    return match is None or match.group("scheme").casefold() not in _DANGEROUS_RICH_TEXT_URL_SCHEMES


def _rich_text_signature(value: str) -> tuple[Any, ...]:
    html_tags: Counter[str] = Counter()
    html_tag_sequence: list[str] = []
    html_structural_tag_sequence: list[str] = []
    html_links: list[str] = []
    scan_value = _mask_non_rendered_html_contexts(value)
    markdown_scan_value = _rendered_text_scan_value(value)
    for match in _RICH_HTML_TAG_RE.finditer(scan_value):
        tag = match.group("tag").casefold()
        token = f"/{tag}" if match.group("closing") else tag
        if tag in {"br", "ul", "ol", "li"}:
            html_structural_tag_sequence.append(token)
            continue
        if tag not in {"a", "b", "strong", "i", "em", "u"}:
            continue
        html_tags[token] += 1
        html_tag_sequence.append(token)
        if tag == "a" and not match.group("closing"):
            html_links.append(_rich_html_href(match.group("attrs") or ""))
    return (
        tuple(sorted(html_tags.items())),
        tuple(html_tag_sequence),
        tuple(html_structural_tag_sequence),
        tuple(html_links),
        tuple(sorted(_nonempty_protected_wrapper_counts(value).items())),
        _markdown_link_urls(markdown_scan_value),
        len(_MARKDOWN_BOLD_RE.findall(markdown_scan_value)),
        len(_MARKDOWN_UNDERLINE_RE.findall(markdown_scan_value)),
        len(_MARKDOWN_ITALIC_RE.findall(markdown_scan_value)),
    )


@dataclass(frozen=True)
class _ProtectedBinding:
    key: str
    start: int
    end: int
    content: str


def _binding_visible_text(value: str) -> str:
    rendered = markdown_links_to_plain_text(_rendered_text_scan_value(value))
    rendered = re.sub(
        r"(?:\*\*|＊＊)([^*＊\r\n]+)(?:\*\*|＊＊)",
        r"\1",
        rendered,
    )
    rendered = re.sub(r"__([^_\r\n]+)__", r"\1", rendered)
    rendered = re.sub(
        r"(?<!\*)\*(?![\s*])([^*\r\n]*?\S)\*(?!\*)",
        r"\1",
        rendered,
    )
    rendered = html_lib.unescape(rendered).replace("\xa0", " ")
    rendered = "".join(
        char for char in rendered if not _is_default_ignorable_code_point(char)
    )
    return re.sub(r"\s+", " ", _normalize_text(rendered).casefold()).strip()


def _html_protected_bindings(value: str) -> list[_ProtectedBinding]:
    protected_tags = frozenset({"a", "b", "strong", "i", "em", "u"})
    records: list[_ProtectedBinding] = []
    stack: list[tuple[str, str, int, int]] = []
    scan_value = _mask_non_rendered_html_contexts(value)
    for match in _RICH_HTML_TAG_RE.finditer(scan_value):
        tag = match.group("tag").casefold()
        if tag not in protected_tags:
            continue
        if not match.group("closing"):
            key = (
                f"html:a:{_rich_html_href(match.group('attrs') or '')}"
                if tag == "a"
                else f"html:{tag}"
            )
            stack.append((tag, key, match.start(), match.end()))
            continue
        if not stack or stack[-1][0] != tag:
            continue
        _, key, open_start, content_start = stack.pop()
        records.append(
            _ProtectedBinding(
                key=key,
                start=open_start,
                end=match.end(),
                content=value[content_start:match.start()],
            )
        )
    return sorted(records, key=lambda item: (item.start, item.end, item.key))


def _markdown_protected_bindings(value: str) -> list[_ProtectedBinding]:
    records = [
        _ProtectedBinding(
            key=f"markdown:a:{target}",
            start=start,
            end=end,
            content=label,
        )
        for start, end, label, target in markdown_link_spans(value)
    ]
    for key, pattern in _MARKDOWN_BINDING_PATTERNS:
        for match in pattern.finditer(value):
            records.append(
                _ProtectedBinding(
                    key=key,
                    start=match.start(),
                    end=match.end(),
                    content=match.group("content"),
                )
            )
    return sorted(records, key=lambda item: (item.start, item.end, item.key))


def _protected_bindings(value: str) -> list[_ProtectedBinding]:
    markdown_source = _rendered_text_scan_value(value)
    return sorted(
        [
            *_html_protected_bindings(value),
            *_markdown_protected_bindings(markdown_source),
        ],
        key=lambda item: (item.start, item.end, item.key),
    )


def _preserves_protected_bindings(before: str, candidate: str) -> bool:
    before_bindings = _protected_bindings(before)
    if not before_bindings:
        return True
    candidate_bindings = _protected_bindings(candidate)
    candidate_cursor = 0
    for required in before_bindings:
        matched_index = next(
            (
                index
                for index in range(candidate_cursor, len(candidate_bindings))
                if candidate_bindings[index].key == required.key
            ),
            None,
        )
        if matched_index is None:
            return False
        available = candidate_bindings[matched_index]
        candidate_cursor = matched_index + 1
        before_content = _binding_visible_text(required.content)
        candidate_content = _binding_visible_text(available.content)
        before_prefix = _binding_visible_text(before[:required.start])
        candidate_prefix = _binding_visible_text(candidate[:available.start])
        before_outside = _binding_visible_text(
            before[:required.start] + before[required.end:]
        )

        def structural_slot(prefix: str) -> int:
            return len(re.findall(r"[^\s，。；！？,;!?：:]+", prefix))

        def occurrence_ordinal(prefix: str, content: str) -> int:
            if not content:
                return 0
            return len(re.findall(rf"(?={re.escape(content)})", prefix))

        if before_content == candidate_content:
            before_ordinal = occurrence_ordinal(before_prefix, before_content)
            candidate_ordinal = occurrence_ordinal(candidate_prefix, candidate_content)
            if before_content and before_ordinal != candidate_ordinal:
                return False
            continue
        if (
            before_content
            and before_content in before_outside
            and structural_slot(before_prefix) != structural_slot(candidate_prefix)
        ):
            return False
        candidate_outside = _binding_visible_text(
            candidate[:available.start] + candidate[available.end:]
        )
        old_content_moved_out = (
            bool(before_content)
            and before_content not in before_outside
            and before_content in candidate_outside
        )
        adjacent_content_moved_in = (
            bool(candidate_content)
            and candidate_content not in candidate_outside
            and candidate_content in before_outside
        )
        if old_content_moved_out or adjacent_content_moved_in:
            return False
    return True


def _rich_text_format_findings(candidate: str, before: str) -> list[str]:
    if _has_hidden_html_subtree(candidate):
        return ["候选文本包含前端清理后可能显示的隐藏富文本内容"]
    if preserves_rich_text_structure(before, candidate):
        return []
    return ["候选文本未原样保留原文的富文本链接或强调格式"]


def preserves_rich_text_structure(before: str, candidate: str) -> bool:
    if _has_hidden_html_subtree(candidate):
        return False
    before_has_visible_content = _has_visible_html_content(before)
    candidate_has_visible_content = _has_visible_html_content(candidate)
    if (
        (
            not candidate_has_visible_content
            and (before_has_visible_content or candidate != "")
        )
        or not _has_valid_protected_html_nesting(before)
        or not _has_valid_protected_html_nesting(candidate)
        or not _has_valid_html_list_content_model(before)
        or not _has_valid_html_list_content_model(candidate)
        or _has_malformed_html_comment_or_raw_container(before)
        or _has_malformed_html_comment_or_raw_container(candidate)
        or not _has_only_allowed_html_tags_and_block_nesting(before)
        or not _has_only_allowed_html_tags_and_block_nesting(candidate)
        or _has_unsafe_unicode_scalar_or_reference(before)
        or _has_unsafe_unicode_scalar_or_reference(candidate)
    ):
        return False
    # Plain, already-delimited prose may be condensed/reflowed. Keep the strict
    # structure rules whenever a link, emphasis marker, list or fragment is present.
    def reflowable(value: str) -> str | None:
        tags=list(_RICH_HTML_TAG_RE.finditer(value))
        if any(m.group("tag").casefold()!="br" for m in tags) or _protected_bindings(value):
            return None
        parts=re.split(r"<br\b[^>]*>",value,flags=re.IGNORECASE)
        if any(not _fact_visible_text(part).rstrip().endswith(("。","！","？","!","?",".",";","；")) for part in parts[:-1]):
            return None
        return re.sub(r"<br\b[^>]*>"," ",value,flags=re.IGNORECASE)
    reflowed_before,reflowed_candidate=reflowable(before),reflowable(candidate)
    if reflowed_before is not None and reflowed_candidate is not None:
        before,candidate=reflowed_before,reflowed_candidate
    before_signature = _rich_text_signature(before)
    candidate_signature = _rich_text_signature(candidate)
    before_list_signature = _rich_text_list_signature(before)
    candidate_list_signature = _rich_text_list_signature(candidate)

    def is_ordered_subset(required: tuple[str, ...], available: tuple[str, ...]) -> bool:
        cursor = 0
        for item in available:
            if cursor < len(required) and item == required[cursor]:
                cursor += 1
        return cursor == len(required)

    before_tags = dict(before_signature[0])
    candidate_tags = dict(candidate_signature[0])
    before_link_targets = before_signature[3], before_signature[5]
    candidate_link_targets = candidate_signature[3], candidate_signature[5]
    return (
        all(candidate_tags.get(tag, 0) >= count for tag, count in before_tags.items())
        and is_ordered_subset(before_signature[1], candidate_signature[1])
        and is_ordered_subset(before_signature[2], candidate_signature[2])
        and (
            not before_list_signature
            or candidate_list_signature == before_list_signature
        )
        # A link is a user-facing capability, not merely formatting. Its kind,
        # position in the respective HTML/Markdown sequence, and target must
        # stay exact: an old safe URL appended as a decoy cannot bless a newly
        # rebound anchor or Markdown link.
        and before_link_targets == candidate_link_targets
        and _preserves_protected_bindings(before, candidate)
        and all(
            _is_safe_rich_text_link_target(link_target)
            for link_group in (*before_link_targets, *candidate_link_targets)
            for link_target in link_group
        )
        and all(
            dict(candidate_signature[4]).get(tag, 0) >= count
            for tag, count in dict(before_signature[4]).items()
        )
        and candidate_signature[6] >= before_signature[6]
        and candidate_signature[7] >= before_signature[7]
        and candidate_signature[8] >= before_signature[8]
    )


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


def _without_conditional_claim_clauses(text: str) -> str:
    delimiter = re.compile(
        r"([，。；！？,.；;!?:：]|并且|并(?!非|未|不)|且|然后|随后|而(?:我)?|但|"
        r"\b(?:and|then|while|whereas|but(?:\s+also)?)\b)",
        re.IGNORECASE,
    )
    pieces = delimiter.split(text)
    carry_condition = False
    rendered: list[str] = []
    for index, piece in enumerate(pieces):
        if index % 2:
            rendered.append(piece)
            continue
        if (
            carry_condition
            and index > 0
            and re.fullmatch(r"[。；！？.;!?]", pieces[index - 1])
        ):
            carry_condition = False
        stripped = piece.strip()
        has_condition_lead = bool(
            re.search(
                r"(?:如果|若|假如|假设|有机会|如有需要|通过考核(?:后)?|"
                r"(?:如获|待)(?:批准|审批)(?:后)?|"
                r"(?:年度)?计划\s*$)",
                stripped,
            )
            or re.search(
                r"\b(?:if|unless|when|provided|assuming)\b",
                stripped,
                re.IGNORECASE,
            )
        )
        conditional = bool(
            has_condition_lead
            or re.search(
                r"(?:预计|预期|未来|可能|差点|险些|或(?=将|增长|提升|下降|减少)|或将|"
                r"将(?=增长|提升|下降|减少|达到|实现|负责|主导)|"
                r"有可能|希望|力争|争取|拟|应该|可(?=使用|负责|主导)|"
                r"目标(?:是|为|达到)?|计划(?=将|拟|负责|主导|支持|开展|实施|开发|完成))",
                stripped,
            )
            or re.search(
                r"\b(?:would|could(?!\s+not)|might|can|will|should|hope\s+to|aim(?:ed|ing)?\s+to|plan\s+to|"
                r"expected\s+to|projected\s+to|(?:is\s+)?likely(?:\s+to)?|potentially|assuming)\b",
                stripped,
                re.IGNORECASE,
            )
            or re.search(
                r"(?<!the )\bmay\s+(?:lead|support|manage|drive|cause|bring|"
                r"increase|decrease|grow|reduce|improve)\b",
                stripped,
            )
        )
        if conditional or carry_condition:
            rendered.append(" " * len(piece))
        else:
            rendered.append(piece)
        if has_condition_lead and re.fullmatch(
            r"\s*(?:if\s+needed|如有需要)\s*",
            piece,
            re.IGNORECASE,
        ):
            prior_index = index - 2
            if prior_index >= 0:
                rendered[prior_index] = " " * len(pieces[prior_index])
        carry_condition = has_condition_lead
    return "".join(rendered)


@dataclass(frozen=True)
class _NumericExpression:
    value: str
    unit: str
    metric: str | None
    sign: str
    explicit_sign: bool
    direction: str | None
    polarity: str
    qualifier: str
    contradictory: bool
    negated: bool
    conditional: bool
    start: int
    end: int

    @property
    def identity(self) -> tuple[str, str, str | None, str, str, bool, bool]:
        return (
            self.value,
            self.unit,
            self.metric,
            self.polarity,
            self.qualifier,
            self.negated,
            self.conditional,
        )


def _decimal_key(raw: str) -> str:
    try:
        value = Decimal(raw)
    except InvalidOperation:
        return raw
    if value and abs(value.adjusted()) > 1_000:
        return str(value).casefold()
    normalized = value.normalize()
    rendered = format(normalized, "f")
    return "0" if rendered in {"-0", ""} else rendered


def _canonical_numeric_value_unit(
    value: Decimal | str,
    unit: str,
) -> tuple[Decimal | str, str]:
    folded_unit = unit.casefold()
    canonical_unit = _ENGLISH_UNIT_ALIASES.get(folded_unit, unit)
    if (
        folded_unit not in _ENGLISH_UNIT_ALIASES
        and re.fullmatch(_GENERIC_ENGLISH_UNIT_TOKEN, unit)
    ):
        canonical_unit = folded_unit
        if canonical_unit.endswith("ies") and len(canonical_unit) > 4:
            canonical_unit = f"{canonical_unit[:-3]}y"
        elif canonical_unit.endswith("s") and not canonical_unit.endswith("ss"):
            canonical_unit = canonical_unit[:-1]
    unit_scale = {
        "milliseconds": (Decimal("0.001"), "seconds"),
        "minutes": (Decimal(60), "seconds"),
        "hours": (Decimal(3600), "seconds"),
        "kilometers": (Decimal(1000), "meters"),
        "kilograms": (Decimal(1000), "grams"),
    }.get(canonical_unit)
    if unit_scale is not None:
        try:
            scale, target_unit = unit_scale
            return Decimal(str(value)) * scale, target_unit
        except InvalidOperation:
            return value, canonical_unit
    monetary_scale = {
        "万元": Decimal(10_000),
        "亿元": Decimal(100_000_000),
    }.get(canonical_unit)
    fractional_percent_scale = {
        "‰": Decimal(10),
        "‱": Decimal(100),
    }.get(canonical_unit)
    if fractional_percent_scale is not None:
        try:
            return Decimal(str(value)) / fractional_percent_scale, "%"
        except InvalidOperation:
            return value, canonical_unit
    if canonical_unit == "元":
        return value, "CNY"
    if monetary_scale is None:
        return value, canonical_unit
    try:
        return Decimal(str(value)) * monetary_scale, "CNY"
    except InvalidOperation:
        return value, canonical_unit


def _numeric_rate_period(text: str, start: int, end: int) -> str | None:
    prefix = text[max(0, start - 40) : start]
    suffix = text[end : min(len(text), end + 24)]
    period_aliases = {
        "年": "year",
        "月": "month",
        "天": "day",
        "日": "day",
        "小时": "hour",
        "周": "week",
        "季度": "quarter",
        "分钟": "minute",
        "分": "minute",
        "秒": "second",
        "year": "year",
        "years": "year",
        "month": "month",
        "months": "month",
        "day": "day",
        "days": "day",
        "hour": "hour",
        "hours": "hour",
        "week": "week",
        "weeks": "week",
        "weekly": "week",
        "quarter": "quarter",
        "quarters": "quarter",
        "quarterly": "quarter",
        "daily": "day",
        "monthly": "month",
        "annual": "year",
        "annually": "year",
        "minute": "minute",
        "minutes": "minute",
        "second": "second",
        "seconds": "second",
        "s": "second",
        "min": "minute",
        "h": "hour",
        "hr": "hour",
        "wk": "week",
        "mo": "month",
        "yr": "year",
    }
    suffix_match = re.match(
        r"^\s*(?:(?:/|per\s+|each\s+|every\s+|an?\s+|每)?"
        r"(年|月|天|日|小时|周|季度|分钟|分|秒|years?|months?|days?|hours?|weeks?|quarters?|minutes?|seconds?|s|min|h|hr|wk|mo|yr)"
        r"|(weekly|daily|monthly|annual|annually|quarterly))"
        r"(?=$|\s|[，。；！？,.;!?])",
        suffix,
        re.IGNORECASE,
    )
    if suffix_match:
        return period_aliases[(suffix_match.group(1) or suffix_match.group(2)).casefold()]
    prefix_match = re.search(
        r"(?:每|按)?(年|月|天|日|小时|周|季度|分钟|分|秒)(?:均)?\s*$",
        prefix,
    )
    if prefix_match:
        return period_aliases[prefix_match.group(1)]
    zh_average_prefix = re.search(
        r"(年|月|天|日|小时|周|季度|分钟|分|秒)均"
        r"[^，。；！？,;!?]{0,16}$",
        prefix,
    )
    if zh_average_prefix:
        return period_aliases[zh_average_prefix.group(1)]
    en_prefix_match = re.search(
        r"\b(daily|weekly|monthly|annual|annually|quarterly)\b"
        r"[^,.;!?]{0,24}$",
        prefix,
        re.IGNORECASE,
    )
    if en_prefix_match:
        return period_aliases[en_prefix_match.group(1).casefold()]
    zh_clause_prefix = re.search(
        r"(?:每|按)(年|月|天|日|小时|周|季度|分钟|分|秒)"
        r"[^，。；！？,;!?]{0,16}$",
        prefix,
    )
    if zh_clause_prefix:
        return period_aliases[zh_clause_prefix.group(1)]
    return None


def _chinese_magnitude_value(raw: str) -> Decimal | None:
    normalized = raw.translate(str.maketrans({"萬": "万", "億": "亿"}))
    for suffix, base in (
        ("万亿", Decimal(1_000_000_000_000)),
        ("亿", Decimal(100_000_000)),
        ("万", Decimal(10_000)),
    ):
        if normalized.endswith(suffix):
            prefix = normalized[: -len(suffix)]
            factor = {"": 1, "十": 10, "百": 100, "千": 1_000}.get(prefix)
            return base * factor if factor is not None else None
    return {
        "十": Decimal(10),
        "百": Decimal(100),
        "千": Decimal(1_000),
    }.get(normalized)


def _english_number_word_value(raw: str) -> Decimal | None:
    values = {
        "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4,
        "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
        "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
        "fourteen": 14, "fifteen": 15, "sixteen": 16,
        "seventeen": 17, "eighteen": 18, "nineteen": 19,
        "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
        "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    }
    current = 0
    total = 0
    tokens = re.split(r"[ -]+", raw.strip().casefold())
    for index, token in enumerate(tokens):
        if token == "and":
            if (
                index == 0
                or index + 1 >= len(tokens)
                or tokens[index - 1] != "hundred"
                or tokens[index + 1] not in values
                or values[tokens[index + 1]] >= 100
            ):
                return None
            continue
        if token in values:
            current += values[token]
        elif token == "hundred":
            current = max(current, 1) * 100
        elif token in {"thousand", "million", "billion", "trillion"}:
            scale = {
                "thousand": 1_000,
                "million": 1_000_000,
                "billion": 1_000_000_000,
                "trillion": 1_000_000_000_000,
            }[token]
            total += max(current, 1) * scale
            current = 0
        else:
            return None
    return Decimal(total + current)


def _parse_chinese_small_integer(raw: str) -> int | None:
    if not raw:
        return None
    if all(char in _ZH_DIGIT_VALUES for char in raw):
        return int("".join(str(_ZH_DIGIT_VALUES[char]) for char in raw))

    total = 0
    pending_digit: int | None = None
    pending_after_zero = False
    saw_zero = False
    saw_unit = False
    last_unit = 10_000
    for char in raw:
        if char in _ZH_DIGIT_VALUES:
            digit = _ZH_DIGIT_VALUES[char]
            if digit == 0:
                if pending_digit is not None:
                    return None
                saw_zero = True
                continue
            if pending_digit is not None:
                return None
            pending_digit = digit
            pending_after_zero = saw_zero
            saw_zero = False
            continue
        unit = _ZH_SMALL_UNIT_VALUES.get(char)
        if unit is None or unit >= last_unit or saw_zero:
            return None
        if pending_digit is None:
            if total != 0:
                return None
            pending_digit = 1
        total += pending_digit * unit
        pending_digit = None
        pending_after_zero = False
        saw_unit = True
        last_unit = unit

    if saw_zero:
        return None
    if pending_digit is not None:
        if saw_unit and last_unit > 10 and not pending_after_zero:
            return None
        total += pending_digit
    return total


def _parse_chinese_integer(raw: str) -> int | None:
    if not raw:
        return None
    total = 0
    segment_start = 0
    last_large_unit = 1_000_000_000
    saw_large_unit = False
    for index, char in enumerate(raw):
        large_unit = _ZH_LARGE_UNIT_VALUES.get(char)
        if large_unit is None:
            continue
        if large_unit >= last_large_unit:
            return None
        segment = raw[segment_start:index]
        segment_value = _parse_chinese_small_integer(segment)
        if segment_value is None:
            return None
        total += segment_value * large_unit
        segment_start = index + 1
        last_large_unit = large_unit
        saw_large_unit = True

    remainder = raw[segment_start:]
    if not remainder:
        return total if saw_large_unit else None
    remainder_value = _parse_chinese_small_integer(remainder)
    if remainder_value is None:
        return None
    if (
        saw_large_unit
        and all(char in _ZH_DIGIT_VALUES for char in remainder)
        and not remainder.startswith(("零", "〇", "○"))
    ):
        # ``一万二`` is colloquially either 12,000 or 10,002. Do not guess.
        return None
    return total + remainder_value


def _parse_chinese_number(raw: str) -> Decimal | None:
    decimal_marks = [index for index, char in enumerate(raw) if char in _ZH_DECIMAL_MARKS]
    if len(decimal_marks) > 1:
        return None
    if not decimal_marks:
        integer = _parse_chinese_integer(raw)
        return Decimal(integer) if integer is not None else None
    decimal_index = decimal_marks[0]
    integer_raw = raw[:decimal_index]
    fraction_raw = raw[decimal_index + 1:]
    if (
        not integer_raw
        or not fraction_raw
        or not all(char in _ZH_DIGIT_VALUES for char in fraction_raw)
    ):
        return None
    integer = _parse_chinese_integer(integer_raw)
    if integer is None:
        return None
    fraction = "".join(str(_ZH_DIGIT_VALUES[char]) for char in fraction_raw)
    return Decimal(f"{integer}.{fraction}")


_NUMERIC_PREFIX_QUALIFIERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "gte",
        (
            r"至少",
            r"不少于",
            r"不低于",
            r"不小于",
            r"\bat\s+least\b",
            r"\bno\s+less\s+than\b",
            r"\bno\s+fewer\s+than\b",
            r"\bnot\s+less\s+than\b",
            r"\bgreater\s+than\s+or\s+equal\s+to\b",
            r">=|≥",
        ),
    ),
    (
        "lte",
        (
            r"至多",
            r"最多",
            r"不超过",
            r"不高于",
            r"不大于",
            r"\bup\s+to\b",
            r"\bat\s+most\b",
            r"\bno\s+more\s+than\b",
            r"\bnot\s+more\s+than\b",
            r"\b(?:no|not)\s+greater\s+than\b",
            r"\bless\s+than\s+or\s+equal\s+to\b",
            r"<=|≤",
        ),
    ),
    (
        "gt",
        (
            r"超过",
            r"突破",
            r"多于",
            r"高于",
            r"大于",
            r"逾",
            r"超",
            r"\bover\b",
            r"\bmore\s+than\b",
            r"\bgreater\s+than\b",
            r">",
        ),
    ),
    (
        "lt",
        (
            r"低于",
            r"少于",
            r"不足",
            r"不到",
            r"\bunder\b",
            r"\bless\s+than\b",
            r"<",
        ),
    ),
    (
        "approx",
        (
            r"大约",
            r"约",
            r"接近",
            r"近",
            r"\babout\b",
            r"\baround\b",
            r"\bapproximately\b",
            r"\bapprox\.?",
            r"\broughly\b",
            r"\bnearly\b",
            r"\balmost\b",
            r"\bcirca\b",
            r"\bclose\s+to\b",
            r"约莫",
            r"接近于",
        ),
    ),
)
_NUMERIC_SUFFIX_QUALIFIERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("gte", (r"(?:及)?以上", r"\+", r"\bor\s+more\b", r"\band\s+above\b")),
    ("lte", (r"(?:及)?以下", r"以内", r"\bor\s+less\b")),
    ("approx", (r"左右", r"上下", r"多", r"余")),
)


def _numeric_prefix_qualifier_match(prefix: str) -> tuple[str, re.Match[str]] | None:
    for qualifier, patterns in _NUMERIC_PREFIX_QUALIFIERS:
        for pattern in patterns:
            match = re.search(
                rf"(?:{pattern})(?:有|为|达|达到|了)?\s*$",
                prefix,
                re.IGNORECASE,
            )
            if match is not None:
                return qualifier, match
    return None


def _nearby_numeric_qualifier(text: str, start: int, end: int) -> str:
    prefix = text[max(0, start - 32) : start]
    suffix = text[end : min(len(text), end + 32)]
    if prefix_qualifier := _numeric_prefix_qualifier_match(prefix):
        return prefix_qualifier[0]
    for qualifier, patterns in _NUMERIC_SUFFIX_QUALIFIERS:
        if any(
            re.match(rf"^\s*(?:{pattern})(?![A-Za-z])", suffix, re.IGNORECASE)
            for pattern in patterns
        ):
            return qualifier
    return "exact"


def _nearby_quantitative_subject(text: str, start: int, end: int) -> str | None:
    # Reserve the same 32-character qualifier window used by the bound parser.
    prefix = text[max(0, start - 48 - 32) : start]
    prefix = re.split(r"[，。；！？,;!?]", prefix)[-1]
    # Consume the complete quantity qualifier before taking the subject window.
    # Its words describe the numeric bound, rather than the measured metric.
    if prefix_qualifier := _numeric_prefix_qualifier_match(prefix[-32:]):
        prefix = prefix[: -len(prefix_qualifier[1].group(0))]
    prefix = prefix[-48:]
    prefix = re.sub(
        r"(?:提升|增长|增加|提高|上升|攀升|上涨|降低|下降|减少|"
        r"下滑|回落|缩水|服务|覆盖|处理|达到|达|共计|合计|总计|累计)\s*$",
        "",
        prefix,
    ).strip()
    if prefix in {"持续", "累计", "共计", "合计", "总计", "长期", "稳定"}:
        prefix = ""
    zh_match = re.search(
        r"((?:[A-Za-z0-9][A-Za-z0-9_-]*)?[\u4e00-\u9fff]{1,10})$",
        prefix,
    )
    if zh_match:
        return f"subject:{zh_match.group(1)}"
    en_words = re.findall(r"[A-Za-z][A-Za-z-]*", prefix.casefold())
    en_words = [
        word
        for word in en_words[-3:]
        if word not in {
            "increased", "improved", "grew", "climbed", "fell", "declined",
            "shrank", "reduced", "decreased", "served", "covered", "processed",
            "reached", "cut", "cuts", "cutting", "by", "to", "at", "least", "most", "about", "around",
            "roughly", "nearly", "approximately", "approx", "almost", "circa",
            "more", "than", "over", "up",
        }
    ]
    en_words = ["costs" if word == "cost" else word for word in en_words]
    if en_words:
        return f"subject:{' '.join(en_words)}"
    suffix = re.split(r"[，。；！？,;!?]", text[end : end + 32])[0]
    zh_suffix = re.match(r"\s*([\u4e00-\u9fff]{2,10})", suffix)
    if zh_suffix:
        return f"subject:{zh_suffix.group(1)}"
    suffix_words = re.findall(r"[A-Za-z][A-Za-z-]*", suffix.casefold())[:3]
    while suffix_words and suffix_words[0] in {"of", "from", "among"}:
        suffix_words.pop(0)
    return f"subject:{' '.join(suffix_words)}" if suffix_words else None


def _nearby_count_context(text: str, start: int) -> str | None:
    prefix = re.split(
        r"[，。；！？,;!?]|并且|并(?=在|处理|服务|覆盖|支持|触达)|"
        r"且(?=处理|服务|覆盖|支持|触达)|\band\b",
        text[max(0, start - 48) : start],
        flags=re.IGNORECASE,
    )[-1]
    zh_match = re.search(
        r"(?P<context>(?:[A-Za-z0-9][A-Za-z0-9_-]*)?[\u4e00-\u9fff]{1,10}?)"
        r"(?:服务|覆盖|处理|支持|触达|管理|handled?)"
        r"(?:至少|至多|超过|约|近)?\s*$",
        prefix,
    )
    if zh_match:
        context = re.sub(r"^在", "", zh_match.group("context"))
        if context not in {"持续", "累计", "共", "共计", "合计", "总计", "长期", "稳定", "计划", "目标"}:
            return f"context:{context}"
    zh_direct = re.search(r"(?P<context>[\u4e00-\u9fff]{2,8})\s*$", prefix)
    if zh_direct and re.search(r"(?:北京|上海|广州|深圳|全国|全球|线上|线下)$", zh_direct.group("context")):
        return f"context:{zh_direct.group('context')}"
    en_match = re.search(
        r"(?P<context>[A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,2})\s+"
        r"(?:served|covered|processed|handled|supported|reached|managed)\s*$",
        prefix,
        re.IGNORECASE,
    )
    if en_match:
        words = en_match.group("context").casefold().split()
        context = [
            word
            for word in words
            if word not in {
                "and", "then", "the", "a", "an", "i", "we", "our", "my",
                "continued", "consistently", "successfully", "not", "only", "just", "merely",
            }
        ]
        if context and not all(
            word in {
                "execution", "delivery", "operation", "operations", "work", "project",
                "initiative", "initiatives", "effort", "efforts", "program", "programs",
            }
            for word in context
        ):
            return f"context:{' '.join(context)}"
    return None


def _numeric_expression(
    text: str,
    *,
    value: Decimal | str,
    unit: str,
    raw_sign: str,
    start: int,
    end: int,
    qualifier: str | None = None,
) -> _NumericExpression:
    if unit == "opaque-token":
        value = re.sub(r"\s+", "", str(value)).casefold()
    value, unit = _canonical_numeric_value_unit(value, unit)
    if rate_period := _numeric_rate_period(text, start, end):
        unit = f"{unit}/{rate_period}"
    sign = "-" if raw_sign in {"-", "负"} else "+"
    explicit_sign = bool(raw_sign)
    direction = _nearby_direction(text, start, end)
    if unit == "倍" and direction is None and re.search(
        r"(?:为|达到|达至)\s*(?:原来|原先|此前)(?:的)?\s*$",
        text[max(0, start - 24) : start],
    ):
        direction = "increase"
    if unit == "%" and direction == "increase" and _decimal_key(str(value)) == "100":
        value = Decimal(2)
        unit = "倍"
    contradictory = (
        (sign == "-" and direction == "increase")
        or (sign == "+" and explicit_sign and direction == "decrease")
    )
    if direction == "decrease" or sign == "-":
        polarity = "decrease"
    elif direction == "increase":
        polarity = "increase"
    else:
        polarity = "positive"
    metric = _nearby_metric(text, start, end)
    if metric in {"rps", "qps", "tps"} and "/" in unit:
        metric = None
    if (
        metric is None
        and unit not in {"", "%", "倍", "opaque-token"}
        and "/" not in unit
    ):
        metric = _nearby_count_context(text, start)
    if metric is None and (
        unit in {"%", "倍", "CNY", "USD", "EUR", "GBP", "JPY"}
        or (unit == "" and direction is not None)
    ):
        metric = _nearby_quantitative_subject(text, start, end)
    return _NumericExpression(
        value=_decimal_key(str(value)),
        unit=unit,
        metric=metric,
        sign=sign,
        explicit_sign=explicit_sign,
        direction=direction,
        polarity=polarity,
        qualifier=qualifier or _nearby_numeric_qualifier(text, start, end),
        contradictory=contradictory,
        negated=(
            _claim_is_negated(text, start)
            or _claim_is_postfix_negated(text, end)
        ),
        conditional=_claim_is_conditional(text, start, end),
        start=start,
        end=end,
    )


def _chinese_numeric_expressions(
    text: str,
) -> tuple[list[_NumericExpression], list[str]]:
    expressions: list[_NumericExpression] = []
    invalid_fragments: list[str] = []
    occupied: list[tuple[int, int]] = []

    for match in _ZH_FUZZY_QUANTITY_RE.finditer(text):
        occupied.append(match.span())
        invalid_fragments.append(match.group(0))

    for match in _ZH_INDETERMINATE_SCALE_RE.finditer(text):
        occupied.append(match.span())
        invalid_fragments.append(match.group(0))

    for match in _ZH_SCALE_THRESHOLD_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        magnitude = _chinese_magnitude_value(match.group("magnitude"))
        if magnitude is None:
            occupied.append(match.span())
            invalid_fragments.append(match.group(0))
            continue
        occupied.append(match.span())
        implied_unit = ""
        if (
            match.group("unit") is None
            and re.search(
                r"(?:营收|收入|销售额|利润)[^，。；！？,;!?]{0,8}$",
                text[max(0, match.start() - 24) : match.start()],
            )
        ):
            implied_unit = "元"
        expressions.append(
            _numeric_expression(
                text,
                value=magnitude,
                unit=match.group("unit") or implied_unit,
                raw_sign="",
                start=match.start(),
                end=match.end(),
                qualifier="gt",
            )
        )

    for match in _ZH_CLASSIFIED_OBJECT_NUMERAL_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        parsed = _parse_chinese_number(match.group("value"))
        if parsed is None:
            occupied.append(match.span())
            invalid_fragments.append(match.group(0))
            continue
        occupied.append(match.span())
        expressions.append(
            _numeric_expression(
                text,
                value=parsed,
                unit=match.group("unit"),
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )

    for match in _ZH_AMBIGUOUS_INCREASE_MULTIPLIER_RE.finditer(text):
        occupied.append(match.span())
        invalid_fragments.append(match.group(0))

    for match in _ZH_MULTI_FOLD_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        raw_count = match.group("count")
        count = (
            Decimal(raw_count)
            if raw_count.isascii() and raw_count.isdigit()
            else _parse_chinese_number(raw_count)
        )
        if count is None or count != count.to_integral_value() or not (1 <= count <= 10):
            occupied.append(match.span())
            invalid_fragments.append(match.group(0))
            continue
        occupied.append(match.span())
        expressions.append(
            _numeric_expression(
                text,
                value=Decimal(2) ** int(count),
                unit="倍",
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        )

    for match in _ZH_FIXED_QUANTIFIER_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        kind = match.group("kind")
        is_half = kind in {"减半", "腰斩"} or kind.endswith("一半")
        value = Decimal(50) if is_half else Decimal(2)
        occupied.append(match.span())
        expressions.append(
            _numeric_expression(
                text,
                value=value,
                unit="%" if is_half else "倍",
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        )

    for match in _ZH_HALF_TENTH_PERCENT_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        occupied.append(match.span())
        expressions.append(
            _numeric_expression(
                text,
                value=Decimal(5),
                unit="%",
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        )

    for match in _ZH_SHARE_FRACTION_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        occupied.append(match.span())
        expression = _numeric_expression(
                text,
                value=Decimal(50),
                unit="%",
                raw_sign="",
                start=match.start(),
                end=match.end(),
                qualifier="gt" if match.group("qualifier") in {"过", "大"} else "approx",
            )
        expressions.append(
            replace(expression, metric=f"subject:{match.group('unit')}")
        )

    for match in _ZH_CONTEXTUAL_HALF_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        if _nearby_metric(text, match.start(), match.end()) is None and (
            _nearby_quantitative_subject(text, match.start(), match.end()) is None
        ):
            continue
        occupied.append(match.span())
        expressions.append(
            _numeric_expression(
                text,
                value=Decimal(50),
                unit="%",
                raw_sign="",
                start=match.start(),
                end=match.end(),
                qualifier="gt" if match.group("qualifier") in {"大", "过"} else "approx",
            )
        )

    for match in _ZH_ONE_AND_HALF_MULTIPLIER_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        raw_value = match.group("value")
        value = (
            Decimal(raw_value)
            if raw_value.isascii() and raw_value.isdigit()
            else _parse_chinese_number(raw_value)
        )
        if value is None:
            occupied.append(match.span())
            invalid_fragments.append(match.group(0))
            continue
        occupied.append(match.span())
        expressions.append(
            _numeric_expression(
                text,
                value=value * Decimal(100) + Decimal(50),
                unit="%",
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        )

    for match in _ZH_TENTHS_PERCENT_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        raw_value = match.group("value")
        parsed = (
            Decimal(raw_value)
            if raw_value.isascii() and raw_value.isdigit()
            else _parse_chinese_number(raw_value)
        )
        if parsed is None:
            occupied.append(match.span())
            invalid_fragments.append(match.group(0))
            continue
        occupied.append(match.span())
        fraction = match.group("fraction")
        fraction_value = Decimal(0)
        if fraction == "半":
            fraction_value = Decimal(5)
        elif fraction:
            fraction_value = Decimal(_ZH_DIGIT_VALUES[fraction[0]])
        expressions.append(
            _numeric_expression(
                text,
                value=parsed * Decimal(10) + fraction_value,
                unit="%",
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        )

    for match in _ZH_QUALIFIED_QUANTITY_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        parsed = _parse_chinese_number(match.group("value"))
        if parsed is None:
            occupied.append(match.span())
            invalid_fragments.append(match.group(0))
            continue
        inner_qualifier = match.group("inner_qualifier")
        outer_qualifier = match.group("outer_qualifier")
        qualifier = {
            "以上": "gte",
            "以下": "lte",
        }.get(outer_qualifier or "", "approx")
        occupied.append(match.span())
        expressions.append(
            _numeric_expression(
                text,
                value=parsed,
                unit=match.group("inner_unit") or match.group("outer_unit"),
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
                qualifier=qualifier if inner_qualifier or outer_qualifier else None,
            )
        )

    for pattern in (_ZH_AMBIGUOUS_PERCENT_RE, _ZH_AMBIGUOUS_QUANTITY_RE):
        for match in pattern.finditer(text):
            occupied.append(match.span())
            invalid_fragments.append(match.group(0))

    for match in _ZH_PERCENT_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        occupied.append(match.span())
        leading_sign = match.group("leading_sign")
        trailing_sign = match.group("trailing_sign")
        parsed = _parse_chinese_number(match.group("value"))
        if parsed is None or (leading_sign and trailing_sign):
            invalid_fragments.append(match.group(0))
            continue
        divisor = {
            "百分之": Decimal(1),
            "千分之": Decimal(10),
            "千分": Decimal(10),
            "万分之": Decimal(100),
            "万分": Decimal(100),
        }[match.group("scale")]
        expressions.append(
            _numeric_expression(
                text,
                value=parsed / divisor,
                unit="%",
                raw_sign=leading_sign or trailing_sign,
                start=match.start(),
                end=match.end(),
            )
        )

    for match in _ZH_QUANTITY_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        if re.search(r"\d(?:\.\d+)?\s*$", text[:match.start()]):
            # The Chinese magnitude belongs to a mixed Arabic form such as
            # ``2 万用户`` or ``2.5亿元`` and is parsed by the mixed/ASCII path.
            continue
        occupied.append(match.span())
        parsed = _parse_chinese_number(match.group("value"))
        if parsed is None:
            invalid_fragments.append(match.group(0))
            continue
        expressions.append(
            _numeric_expression(
                text,
                value=parsed,
                unit=match.group("unit"),
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )

    for match in _ZH_AMBIGUOUS_BARE_NUMERAL_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        if not _has_bare_quantitative_context(text, match.start(), match.end()):
            continue
        occupied.append(match.span())
        invalid_fragments.append(match.group(0))

    for match in _ZH_BARE_NUMERAL_RE.finditer(text):
        if any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        if re.search(r"\d(?:\.\d+)?\s*$", text[:match.start()]):
            continue
        if not _has_bare_quantitative_context(text, match.start(), match.end()):
            continue
        parsed = _parse_chinese_number(match.group("value"))
        if parsed is None:
            invalid_fragments.append(match.group(0))
            continue
        expressions.append(
            _numeric_expression(
                text,
                value=parsed,
                unit="",
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )
    return expressions, invalid_fragments


def _invalid_chinese_quantities(text: str) -> list[str]:
    normalized = _fact_visible_text(text)
    _, invalid = _chinese_numeric_expressions(normalized)
    return invalid


_ENGLISH_NUMERIC_SUFFIX_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<number>\d+(?:\.\d+)?)\s+"
    r"(?P<suffix>[A-Za-z][A-Za-z-]*)"
)
_CHINESE_NUMERIC_SUFFIX_RE = re.compile(
    r"(?<![A-Za-z0-9_.+#])(?P<number>\d+(?:\.\d+)?)\s*"
    r"(?P<suffix>[\u4e00-\u9fff]{1,12})"
)
_MALFORMED_NUMERIC_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9_.])(?:"
    r"\d{1,3}(?:,\d{1,2})+(?:,\d+)+"
    r"|\d+(?:,{2,}\d+|,\d{4,})"
    r"|\d+(?:\.\d+){2,}"
    r"|\d+[eE](?![+-]?\d)"
    r"|\.\.\d+"
    r"|\d+_\d+"
    r"|0[xX][0-9A-Fa-f]+"
    r"|0[oO][0-7]+"
    r"|0[bB][01]+"
    r"|\d+\.\.\d+"
    r"|\d+(?:bn|mm|mn|kk|kpi|bps)\b"
    r")"
    r"(?:\s*(?:个|名|位)?[\u4e00-\u9fffA-Za-z%]+)?",
    re.IGNORECASE,
)
_CONFLICTING_NUMERIC_QUALIFIER_RE = re.compile(
    rf"(?:约|近|大约)\s*(?:超过|突破|至少|至多|不到)\s*(?:\d|{_ZH_NUMERAL_BODY})"
    rf"|(?:至少|至多)\s*(?:不到|超过|突破)\s*(?:\d|{_ZH_NUMERAL_BODY})"
    r"|\d+(?:\.\d+)?\s*\+\s*(?:左右|上下)"
    r"|(?:至少|至多|at\s+least|at\s+most|up\s+to)\s*\d+(?:\.\d+)?\s*\+"
    r"|\b(?:about|around|approximately|roughly|nearly|almost|circa|close\s+to)\s+"
    r"(?:over|more\s+than|greater\s+than|at\s+least|under|less\s+than|at\s+most|up\s+to)\s+"
    r"(?:\d|zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)"
    r"|(?:<=|>=|[<>≤≥≈~])\s*\d"
)
_ENGLISH_QUANTITATIVE_PREFIX_RE = re.compile(
    r"(?:served|serving|covered|reached|processed|supported|managed|"
    r"delivered|revenue|sales|users?|customers?|orders?|projects?)\s*$",
    re.IGNORECASE,
)


def _invalid_numeric_suffixes(
    text: str,
    expressions: Sequence[_NumericExpression],
) -> list[str]:
    text = _fact_visible_text(text)
    invalid: list[str] = []
    invalid.extend(
        match.group(0)
        for match in _EN_INDETERMINATE_WORD_QUANTITY_RE.finditer(text)
    )
    for match in _MALFORMED_NUMERIC_TOKEN_RE.finditer(text):
        prefix = text[max(0, match.start() - 32) : match.start()]
        fragment = match.group(0)
        if _VERSION_ABBREVIATION_PREFIX_RE.search(prefix):
            continue
        if (
            _has_bare_quantitative_context(text, match.start(), match.end())
            or _nearby_metric(text, match.start(), match.end()) is not None
            or re.search(
                rf"(?:{_ARABIC_SEMANTIC_UNIT_PATTERN})\s*$",
                fragment,
                re.IGNORECASE,
            )
            or (
                (suffix_match := re.search(r"([A-Za-z][A-Za-z-]*)\s*$", fragment))
                and suffix_match.group(1).casefold() not in _ENGLISH_UNIT_STOPWORDS
            )
        ):
            invalid.append(fragment)
    invalid.extend(
        match.group(0) for match in _CONFLICTING_NUMERIC_QUALIFIER_RE.finditer(text)
    )
    known_english = {
        *_ENGLISH_UNIT_ALIASES,
        "thousand",
        "million",
        "billion",
        "trillion",
    }
    for match in _ENGLISH_NUMERIC_SUFFIX_RE.finditer(text):
        suffix = match.group("suffix").casefold()
        if suffix in known_english or suffix in _ENGLISH_UNIT_STOPWORDS:
            continue
        if any(
            expression.start <= match.start()
            and expression.end >= match.end()
            for expression in expressions
        ):
            continue
        prefix = text[max(0, match.start() - 24) : match.start()]
        if _VERSION_ABBREVIATION_PREFIX_RE.search(prefix):
            continue
        if not (
            _ENGLISH_QUANTITATIVE_PREFIX_RE.search(prefix)
            or suffix.endswith("illion")
        ):
            continue
        invalid.append(match.group(0))
    for match in _CHINESE_NUMERIC_SUFFIX_RE.finditer(text):
        if match.group("suffix") in {"至", "到", "和", "与", "并", "且"}:
            continue
        if any(
            expression.start <= match.start()
            and expression.end > match.end("number")
            for expression in expressions
        ):
            continue
        if not (
            _has_bare_quantitative_context(text, match.start(), match.end("number"))
            or _nearby_metric(text, match.start(), match.end("number")) is not None
        ):
            continue
        invalid.append(match.group(0))
    return invalid


def _invalid_claim_signature(
    text: str,
    fragment: str,
    occurrence_index: int = 0,
) -> tuple[str, str | None, str, str | None]:
    visible = _fact_visible_text(text)
    matches = list(re.finditer(re.escape(fragment), visible))
    if occurrence_index >= len(matches):
        return (_normalized_term(fragment), None, "", None)
    start = matches[occurrence_index].start()
    end = start + len(fragment)
    metric = _nearby_metric(visible, start, end)
    if metric is None:
        metric = _nearby_count_context(visible, start)
    suffix = visible[end : min(len(visible), end + 12)]
    object_match = re.match(
        r"\s*(?:的)?(?P<object>[\u4e00-\u9fff]{1,6})",
        suffix,
    )
    measured_object = (
        object_match.group("object")
        if object_match is not None and metric is None
        else ""
    )
    return (
        _normalized_term(fragment),
        metric,
        measured_object,
        _nearby_direction(visible, start, end),
    )


def _invalid_claim_signatures(text: str) -> list[tuple[str, str | None, str, str | None]]:
    occurrences: Counter[str] = Counter()
    signatures: list[tuple[str, str | None, str, str | None]] = []
    for fragment in _invalid_chinese_quantities(text):
        signatures.append(_invalid_claim_signature(text, fragment, occurrences[fragment]))
        occurrences[fragment] += 1
    return signatures


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
    local_separator_re = re.compile(
        r"并且|并(?=在|处理|服务|覆盖|支持|触达|留存率|转化率|上海|北京)|"
        r"且(?=处理|服务|覆盖|支持|触达|留存率|转化率|上海|北京)|\band\b",
        re.IGNORECASE,
    )
    for match in local_separator_re.finditer(text):
        if match.end() <= start:
            left_boundary = max(left_boundary, match.end() - 1)
        elif match.start() >= end:
            right_candidates.append(match.start())
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


_BARE_QUANTITATIVE_PREFIX_RE = re.compile(
    r"(?:覆盖|服务|触达|处理|支持|管理|交付|接待|销售|"
    r"达到|达|共计|合计|总计|累计|约|近|超过|至少|至多)\s*$"
)
_LEXICAL_NUMERAL_SUFFIXES = (
    "流",
    "站式",
    "方面",
    "体化",
    "线",
    "般",
)


def _has_bare_quantitative_context(text: str, start: int, end: int) -> bool:
    if text[end:].startswith(_LEXICAL_NUMERAL_SUFFIXES):
        return False
    if _nearby_metric(text, start, end) is not None:
        return True
    window, window_start = _local_clause_window(text, start, end, radius=32)
    local_start = start - window_start
    prefix = window[:local_start]
    return _BARE_QUANTITATIVE_PREFIX_RE.search(prefix) is not None


_DIRECTION_SIGNALS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "increase",
        (
            r"增加",
            r"提升",
            r"增长",
            r"提高",
            r"上升",
            r"攀升",
            r"上涨",
            r"翻倍",
            r"翻一番",
            r"翻番",
            r"倍增",
            rf"翻(?:了)?(?:{_ZH_NUMERAL_BODY}|\d+)番",
            r"\bincreas(?:e|ed|es|ing)\b",
            r"\bimprov(?:e|ed|es|ing)\b",
            r"\bgrow(?:s|ing|n)?\b",
            r"\bgrew\b",
            r"\bclimb(?:s|ed|ing)?\b",
            r"\b(?:rise|rises|rose|rising)\b",
            r"\b(?:double|doubled|triple|tripled|quadruple|quadrupled)\b",
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
            r"下滑",
            r"回落",
            r"缩水",
            r"节省",
            r"减半",
            r"降低一半",
            r"减少一半",
            r"下降一半",
            r"缩减一半",
            r"腰斩",
            r"\bdecreas(?:e|ed|es|ing)\b",
            r"\breduc(?:e|ed|es|ing)\b",
            r"\bdrop(?:s|ped|ping)?\b",
            r"\b(?:fall|falls|fell|fallen|falling)\b",
            r"\bdeclin(?:e|es|ed|ing)\b",
            r"\b(?:shrink|shrinks|shrank|shrunk|shrinking)\b",
            r"\bcut(?:s|ting)?\b",
            r"\b(?:halve|halved)\b",
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
    if re.search(
        r"\b(?:did\s+not|never|won't|will\s+not|hasn't|has\s+not|"
        r"is\s+unable\s+to|was\s+unable\s+to)\b[^,.;!?]{0,56}"
        r"\d+(?:\.\d+)?(?:\s+\w+)?\s+and\s*$",
        prefix,
        re.IGNORECASE,
    ):
        return True
    reset_matches = list(
        re.finditer(
            r"[，。；！？,;!?]|而是|但(?:是)?|然而|不过|却|"
            r"并且|并(?!非|未|不)|且|然后|随后|"
            r"\bbut\s+rather\b|\binstead\b|\bbut\b|\bhowever\b|\byet\b|"
            r"\band\b|\bthen\b",
            prefix,
            re.IGNORECASE,
        )
    )
    if reset_matches:
        prefix = prefix[reset_matches[-1].end() :]
    if re.search(r"(?:不仅|不但)\s*[^，。；！？,;!?]{0,24}$", prefix) or re.search(
        r"\bnot\s+only\b[^,.;!?]{0,40}$",
        prefix,
        re.IGNORECASE,
    ):
        return False
    if re.search(
        r"(?:不超过|不高于|不大于|不少于|不低于|不小于|"
        r"\b(?:no|not)\s+(?:more|greater)\s+than|"
        r"\b(?:no|not)\s+less\s+than)\s*$",
        prefix,
        re.IGNORECASE,
    ):
        return False
    return bool(
        re.search(
            r"(?:并非|不是|未曾|未能|未|没有|不曾|不能|无法|不)"
            r"[^，。；！？,;!?]{0,24}$",
            prefix,
        )
        or re.search(
            r"\b(?:did\s+not|does\s+not|(?:was|were|is|are)\s+not|"
            r"not|never|without|failed\s+to|cannot|can't|won't|will\s+not|"
            r"hasn't|has\s+not|(?:is|are|was|were)\s+unable\s+to)"
            r"\b[^,.;!?]{0,40}$",
            prefix,
            re.IGNORECASE,
        )
    )


def _claim_is_postfix_negated(text: str, end: int) -> bool:
    suffix = text[end : min(len(text), end + 48)]
    return bool(
        re.match(
            r"^\s*(?:[A-Za-z\u4e00-\u9fff]+\s*){0,3}"
            r"(?:were?\s+not\s+(?:reached|achieved|served)|"
            r"was\s+not\s+(?:reached|achieved|served)|"
            r"未(?:达到|达成|实现)|没有(?:达到|达成|实现))",
            suffix,
            re.IGNORECASE,
        )
    )


def _claim_is_conditional(text: str, start: int, end: int) -> bool:
    filtered = _without_conditional_claim_clauses(text)
    if text[start:end].strip() and not filtered[start:end].strip():
        return True
    prefix = text[:start]
    if re.search(
        r"(?:求职意向|求职方向|职业目标|意向(?:岗位|公司)|期望(?:岗位|公司))"
        r"[ \t]*(?:[：:]|\r?\n)[^。；！？;!?]*$",
        prefix,
    ) or re.search(
        r"(?:\b(?:career|job)\s+(?:objective|goal|direction)|\bobjective)"
        r"[ \t]*(?:[：:]|\r?\n)"
        r"[^.;!?]*$",
        prefix,
        re.IGNORECASE,
    ):
        return True
    boundary = max(
        (prefix.rfind(marker) for marker in "，。；！？,.;!?"),
        default=-1,
    )
    local = prefix[boundary + 1 :]
    suffix = text[end : min(len(text), end + 24)]
    return bool(
        re.search(r"(?:目标|计划|预计|预期|希望|若|如果|假设|有望|可能|差点|险些|或将|"
                  r"将(?=增长|提升|下降|减少|达到|实现|负责|主导)|"
                  r"有可能|力争|争取|拟|应该|如有需要|(?:如获|待)(?:批准|审批)|"
                  r"想(?:要)?|寻求|有意|应聘|"
                  r"可(?=使用|负责|主导))", local)
        or re.search(
            r"\b(?:target|goal|plan(?:ned)?|expected|forecast|projected|"
            r"estimated|potentially|likely|hope|aim(?:ed|ing)?|if|unless|when|provided|upon\s+approval|"
            r"seek(?:s|ing)?(?:\s+to)?|interested\s+in|aspire(?:s|d|ing)?\s+to|apply(?:ing|ied)?\s+to|"
            r"assuming|would|could(?!\s+not)|might|will|should)\b",
            local,
            re.IGNORECASE,
        )
        or re.search(
            r"(?<!the )\b(?:may|can)\s+(?:grow|increase|decrease|reduce|"
            r"improve|reach|serve|lead|drive|cause|bring)\b",
            local,
            re.IGNORECASE,
        )
        or re.match(
            r"^\s*(?:的)?(?:目标|目标值|预计|预估|预测|target|goal|expected|projected)",
            suffix,
            re.IGNORECASE,
        )
    )


def _numeric_expressions(text: str) -> list[_NumericExpression]:
    return _numeric_expressions_from_visible(_fact_visible_text(text))


def _numeric_expressions_from_visible(normalized: str) -> list[_NumericExpression]:
    chinese_expressions, _ = _chinese_numeric_expressions(normalized)
    supplemental_expressions: list[_NumericExpression] = []
    occupied_spans: list[tuple[int, int]] = [
        (expression.start, expression.end) for expression in chinese_expressions
    ]
    for match in _EXPLICIT_RATIO_RE.finditer(normalized):
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=f"ratio:{_decimal_key(match.group('numerator'))}:{_decimal_key(match.group('denominator'))}",
                unit="opaque-token",
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _TEMPERATURE_UNIT_RE.finditer(normalized):
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=match.group("value"),
                unit=f"°{match.group('unit').upper()}",
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _EN_DOZEN_QUANTITY_RE.finditer(normalized):
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=Decimal(12),
                unit=match.group("unit"),
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _EN_SHARE_FRACTION_RE.finditer(normalized):
        occupied_spans.append(match.span())
        expression = _numeric_expression(
                normalized,
                value=(
                    Decimal(50)
                    if match.group("fraction").casefold() == "half"
                    else Decimal(25)
                ),
                unit="%",
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        supplemental_expressions.append(
            replace(
                expression,
                metric=f"subject:{_ENGLISH_UNIT_ALIASES.get(match.group('unit').casefold(), match.group('unit').casefold())}",
            )
        )
    for match in _EN_QUALIFIED_BARE_WORD_NUMBER_RE.finditer(normalized):
        parsed = _english_number_word_value(match.group("value"))
        if parsed is None:
            continue
        occupied_spans.append(match.span())
        raw_qualifier = re.sub(r"\s+", " ", match.group("qualifier").casefold())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=parsed,
                unit=match.group("unit") or "",
                raw_sign="",
                start=match.start(),
                end=match.end(),
                qualifier=(
                    "gte" if raw_qualifier in {"at least", "no fewer than"}
                    else "gt" if raw_qualifier in {"over", "more than", "greater than"}
                    else "lt" if raw_qualifier in {"under", "less than"}
                    else "lte" if raw_qualifier in {"up to", "at most", "no more than"}
                    else "approx"
                ),
            )
        )
    for pattern in (
        _OPAQUE_LITERAL_ENTITY_RE,
        _OPAQUE_DOTTED_NUMERIC_RE,
        _OPAQUE_SLASH_DATE_RE,
        _OPAQUE_TECH_NUMERIC_RE,
        _OPAQUE_DISPLAY_K_RE,
        _OPAQUE_VERSION_SCALE_RE,
    ):
        for match in pattern.finditer(normalized):
            if pattern is _OPAQUE_DISPLAY_K_RE:
                prefix = normalized[max(0, match.start() - 24) : match.start()]
                if (
                    re.search(
                        r"(?:USD|EUR|GBP|CNY|RMB|JPY|人民币|日元|\$|¥|€|£)\s*$",
                        prefix,
                        re.IGNORECASE,
                    )
                    or _VERSION_ABBREVIATION_PREFIX_RE.search(prefix)
                    or _has_bare_quantitative_context(normalized, match.start(), match.end())
                    or _nearby_metric(normalized, match.start(), match.end()) is not None
                ):
                    continue
            occupied_spans.append(match.span())
            supplemental_expressions.append(
                _numeric_expression(
                    normalized,
                    value=match.group("value"),
                    unit="opaque-token",
                    raw_sign="",
                    start=match.start(),
                    end=match.end(),
                )
            )
    for match in _EN_FRACTION_QUANTITY_RE.finditer(normalized):
        if any(match.start() < end and match.end() > start for start, end in occupied_spans):
            continue
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value={
                    "half": Decimal(50),
                    "third": Decimal("33.333333333333"),
                    "quarter": Decimal(25),
                }[match.group("fraction").casefold()],
                unit="%",
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _EN_WORD_NUMBER_RE.finditer(normalized):
        if any(match.start() < end and match.end() > start for start, end in occupied_spans):
            continue
        if re.search(r"\d\s*$", normalized[: match.start()]):
            continue
        if re.search(
            r"\b(?:ranked|number)\s*$",
            normalized[: match.start()],
            re.IGNORECASE,
        ):
            continue
        if re.fullmatch(
            rf"(?:{_EN_NUMBER_WORD_TOKEN})",
            match.group("unit"),
            re.IGNORECASE,
        ):
            continue
        parsed = _english_number_word_value(match.group("value"))
        if parsed is None:
            continue
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=parsed,
                unit=match.group("unit"),
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _EN_FIXED_MULTIPLIER_RE.finditer(normalized):
        kind = match.group("kind").casefold()
        is_half = kind.startswith("hal")
        value = (
            Decimal(50)
            if is_half
            else Decimal(4)
            if "quad" in kind or kind == "fourfold"
            else Decimal(3)
            if "trip" in kind or kind == "threefold"
            else Decimal(2)
        )
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=value,
                unit="%" if is_half else "倍",
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        )
    fold_values = {
        "five": Decimal(5),
        "six": Decimal(6),
        "seven": Decimal(7),
        "eight": Decimal(8),
        "nine": Decimal(9),
        "ten": Decimal(10),
    }
    for match in _EN_GENERAL_FOLD_RE.finditer(normalized):
        if any(match.start() < end and match.end() > start for start, end in occupied_spans):
            continue
        raw_count = match.group("count").casefold()
        count = fold_values.get(raw_count, Decimal(raw_count) if raw_count.isdigit() else None)
        if count is None or count <= 0 or count > 1_000:
            continue
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=count,
                unit="倍",
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _EN_ORDER_OF_MAGNITUDE_RE.finditer(normalized):
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=Decimal(10),
                unit="倍",
                raw_sign="",
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _EN_EXPLICIT_MULTIPLIER_RE.finditer(normalized):
        if any(match.start() < end and match.end() > start for start, end in occupied_spans):
            continue
        prefix = normalized[max(0, match.start() - 8) : match.start()]
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=match.group("value"),
                unit="倍",
                raw_sign="",
                start=match.start(),
                end=match.end(),
                qualifier="delta" if re.search(r"\bby\s*$", prefix, re.IGNORECASE) else None,
            )
        )
    for match in _MIXED_ZH_MAGNITUDE_RE.finditer(normalized):
        occupied_spans.append(match.span())
        magnitude = _chinese_magnitude_value(match.group("magnitude"))
        if magnitude is None:
            continue
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=Decimal(match.group("value")) * magnitude,
                unit=match.group("unit") or "",
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
                qualifier=(
                    "gte"
                    if match.group("qualifier") == "+"
                    else "approx" if match.group("qualifier") else None
                ),
            )
        )
    english_scales = {
        "thousand": Decimal(1_000),
        "million": Decimal(1_000_000),
        "billion": Decimal(1_000_000_000),
        "trillion": Decimal(1_000_000_000_000),
    }
    for match in _ENGLISH_MAGNITUDE_RE.finditer(normalized):
        if re.search(
            r"(?:USD|EUR|GBP|CNY|RMB|JPY|\$|¥|€|£)\s*$",
            normalized[max(0, match.start() - 16) : match.start()],
            re.IGNORECASE,
        ):
            continue
        occupied_spans.append(match.span())
        magnitude_unit = match.group("unit") or ""
        if magnitude_unit.casefold() in _ENGLISH_UNIT_STOPWORDS:
            magnitude_unit = ""
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=(
                    Decimal(match.group("value"))
                    * english_scales[match.group("magnitude").casefold()]
                ),
                unit=magnitude_unit,
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )
    for pattern, qualifier in (
        (_ENGLISH_POSTFIX_QUALIFIED_NUMBER_RE, "gte"),
        (_SCIENTIFIC_NUMBER_RE, None),
    ):
        for match in pattern.finditer(normalized):
            if any(
                match.start() < end and match.end() > start
                for start, end in occupied_spans
            ):
                continue
            occupied_spans.append(match.span())
            supplemental_expressions.append(
                _numeric_expression(
                    normalized,
                    value=match.group("value"),
                    unit=match.group("unit") or "",
                    raw_sign=match.group("sign"),
                    start=match.start(),
                    end=match.end(),
                    qualifier=qualifier,
                )
            )
    abbreviation_scales = {
        "k": Decimal(1_000),
        "m": Decimal(1_000_000),
        "b": Decimal(1_000_000_000),
        "w": Decimal(10_000),
    }
    currency_aliases = {
        "$": "USD",
        "¥": "CNY",
        "rmb": "CNY",
        "人民币": "CNY",
        "日元": "JPY",
        "€": "EUR",
        "£": "GBP",
    }
    english_magnitude_scales = {
        "thousand": Decimal(1_000),
        "million": Decimal(1_000_000),
        "billion": Decimal(1_000_000_000),
        "trillion": Decimal(1_000_000_000_000),
    }
    for match in _ATTACHED_ABBREVIATED_UNIT_RE.finditer(normalized):
        if (
            f"{match.group('magnitude')}{match.group('unit')}".casefold()
            in _ENGLISH_UNIT_ALIASES
        ):
            continue
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=(
                    Decimal(match.group("value"))
                    * abbreviation_scales[match.group("magnitude").casefold()]
                ),
                unit=match.group("unit"),
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _CURRENCY_PREFIX_GROUPED_RE.finditer(normalized):
        occupied_spans.append(match.span())
        currency = match.group("currency")
        unit = currency_aliases.get(currency.casefold(), currency.upper())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=match.group("value").replace(",", ""),
                unit=unit,
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _CURRENCY_PREFIX_ENGLISH_MAGNITUDE_RE.finditer(normalized):
        if any(match.start() < end and match.end() > start for start, end in occupied_spans):
            continue
        occupied_spans.append(match.span())
        currency = match.group("currency")
        unit = currency_aliases.get(currency.casefold(), currency.upper())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=(
                    Decimal(match.group("value"))
                    * english_magnitude_scales[match.group("magnitude").casefold()]
                ),
                unit=unit,
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _CURRENCY_PREFIX_PLAIN_RE.finditer(normalized):
        if any(match.start() < end and match.end() > start for start, end in occupied_spans):
            continue
        occupied_spans.append(match.span())
        currency = match.group("currency")
        unit = currency_aliases.get(currency.casefold(), currency.upper())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=match.group("value"),
                unit=unit,
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _CURRENCY_PREFIX_ABBREVIATED_RE.finditer(normalized):
        occupied_spans.append(match.span())
        currency = match.group("currency")
        unit = currency_aliases.get(currency.casefold(), currency.upper())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=(
                    Decimal(match.group("value"))
                    * abbreviation_scales[match.group("magnitude").casefold()]
                ),
                unit=unit,
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _ABBREVIATED_NUMBER_RE.finditer(normalized):
        if match.group("unit") and (
            f"{match.group('magnitude')}{match.group('unit')}".casefold()
            in _ENGLISH_UNIT_ALIASES
        ):
            continue
        if _VERSION_ABBREVIATION_PREFIX_RE.search(
            normalized[max(0, match.start() - 24) : match.start()]
        ):
            continue
        if not match.group("unit") and not (
            _has_bare_quantitative_context(normalized, match.start(), match.end())
            or _nearby_metric(normalized, match.start(), match.end()) is not None
            or re.match(r"^\s*[-–—]", normalized[match.end() :])
        ):
            continue
        if any(match.start() < end and match.end() > start for start, end in occupied_spans):
            continue
        occupied_spans.append(match.span())
        raw_qualifier = match.group("qualifier")
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=(
                    Decimal(match.group("value"))
                    * abbreviation_scales[match.group("magnitude").casefold()]
                ),
                unit=match.group("unit") or "",
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
                qualifier=(
                    "gte"
                    if raw_qualifier == "+"
                    else "approx" if raw_qualifier else None
                ),
            )
        )
    for pattern in (_GROUPED_NUMBER_RE, _POSTFIX_QUALIFIED_NUMBER_RE):
        for match in pattern.finditer(normalized):
            if any(
                match.start() < end and match.end() > start
                for start, end in occupied_spans
            ):
                continue
            occupied_spans.append(match.span())
            raw_qualifier = match.group("qualifier")
            supplemental_expressions.append(
                _numeric_expression(
                    normalized,
                    value=re.sub(r"[, '\u202f]", "", match.group("value")),
                    unit=match.group("unit") or "",
                    raw_sign=match.group("sign"),
                    start=match.start(),
                    end=match.end(),
                    qualifier=(
                        "gte"
                        if raw_qualifier == "+"
                        else "approx" if raw_qualifier else None
                    ),
                )
            )
    for match in _ZH_CLASSIFIED_OBJECT_RE.finditer(normalized):
        if any(
            match.start() < end and match.end() > start
            for start, end in occupied_spans
        ):
            continue
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=match.group("value"),
                unit=match.group("unit"),
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _RATIO_QUANTITY_RE.finditer(normalized):
        if any(
            match.start() < end and match.end() > start
            for start, end in occupied_spans
        ):
            continue
        denominator = Decimal(match.group("denominator"))
        if denominator == 0:
            continue
        occupied_spans.append(match.span())
        expression = _numeric_expression(
            normalized,
            value=(Decimal(match.group("numerator")) / denominator * Decimal(100)),
            unit="%",
            raw_sign="",
            start=match.start(),
            end=match.end(),
        )
        ratio_unit = match.group("unit") or ""
        if ratio_unit.casefold() in _ENGLISH_UNIT_STOPWORDS:
            ratio_unit = ""
        if ratio_unit:
            canonical_unit = _canonical_numeric_value_unit(Decimal(0), ratio_unit)[1]
            expression = replace(expression, metric=f"subject:{canonical_unit}")
        supplemental_expressions.append(expression)
    for match in _PLAIN_NUMBER_WITH_UNIT_RE.finditer(normalized):
        if any(
            match.start() < end and match.end() > start
            for start, end in occupied_spans
        ):
            continue
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=match.group("value"),
                unit=match.group("unit"),
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _ATTACHED_PLAIN_ENGLISH_UNIT_RE.finditer(normalized):
        if any(
            match.start() < end and match.end() > start
            for start, end in occupied_spans
        ):
            continue
        unit = match.group("unit")
        if unit.casefold() in {"k", "m", "b", "w", "e"}:
            continue
        occupied_spans.append(match.span())
        supplemental_expressions.append(
            _numeric_expression(
                normalized,
                value=match.group("value"),
                unit=unit,
                raw_sign=match.group("sign"),
                start=match.start(),
                end=match.end(),
            )
        )
    for match in _GENERIC_ENGLISH_NUMBER_UNIT_RE.finditer(normalized):
            if any(
                match.start() < end and match.end() > start
                for start, end in occupied_spans
            ):
                continue
            unit = match.group("unit")
            if unit.casefold() in _ENGLISH_UNIT_STOPWORDS:
                continue
            if re.fullmatch(r"[kmgt](?:i?b)", unit, re.IGNORECASE):
                continue
            if _VERSION_ABBREVIATION_PREFIX_RE.search(
                normalized[max(0, match.start() - 24) : match.start()]
            ):
                continue
            occupied_spans.append(match.span())
            supplemental_expressions.append(
                _numeric_expression(
                    normalized,
                    value=match.group("value"),
                    unit=unit,
                    raw_sign=match.group("sign"),
                    start=match.start(),
                    end=match.end(),
                )
            )
    expressions: list[_NumericExpression] = [
        *chinese_expressions,
        *supplemental_expressions,
    ]
    for match in _NUMBER_RE.finditer(normalized):
        if re.match(
            r"^(?:[kKmMgGtT](?:i?[bB])\b)",
            normalized[match.end() :],
        ):
            continue
        if any(
            match.start() < end and match.end() > start
            for start, end in occupied_spans
        ):
            continue
        raw_sign = match.group("sign")
        value: Decimal | str = match.group("value")
        unit = match.group("unit") or ""
        if unit in {"万", "亿"} and _has_bare_quantitative_context(
            normalized,
            match.start(),
            match.end(),
        ):
            value = Decimal(str(value)) * Decimal(
                10_000 if unit == "万" else 100_000_000
            )
            unit = ""
        expressions.append(
            _numeric_expression(
                normalized,
                value=value,
                unit=unit,
                raw_sign=raw_sign,
                start=match.start(),
                end=match.end(),
            )
        )
    ordered = sorted(expressions, key=lambda item: (item.start, item.end))
    for index, (first, second) in enumerate(zip(ordered, ordered[1:])):
        between = normalized[first.end : second.start]
        if not re.fullmatch(r"\s*[-–—:]\s*", between):
            continue
        if not first.unit and second.unit:
            ordered[index] = replace(first, unit=second.unit)
        elif first.unit and not second.unit:
            ordered[index + 1] = replace(second, unit=first.unit)
    return ordered


@dataclass(frozen=True)
class _OrderedNumericTransition:
    metric: str | None
    unit: str
    polarity: str
    from_value: str
    from_qualifier: str
    to_value: str
    to_qualifier: str
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
    r"缩减为|缩减至|缩为|减为|"
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
    normalized = _fact_visible_text(text)
    expressions = _numeric_expressions_from_visible(normalized)
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
        if first.unit and second.unit and first.unit != second.unit:
            continue
        prefix = normalized[max(0, first.start - 16) : first.start]
        between = normalized[first.end : second.start]
        metric = first.metric or second.metric
        transition_unit = first.unit or second.unit
        transition_polarity = first.polarity
        try:
            from_decimal = Decimal(first.value)
            to_decimal = Decimal(second.value)
            if to_decimal < from_decimal:
                transition_polarity = "decrease"
            elif to_decimal > from_decimal:
                transition_polarity = "increase"
        except InvalidOperation:
            pass

        is_forward = bool(
            _FORWARD_ORIGIN_MARKER_RE.search(prefix)
            and _FORWARD_TARGET_MARKER_RE.search(between)
        )
        is_forward = is_forward or bool(
            re.search(
                r"(?:降低|下降|减少|缩短|缩减|提升|增长|增加|提高|"
                r"\b(?:reduced?|decreased?|increased?|raised?|grew|cut))"
                r"[^，。；！？,;!?]{0,8}$",
                prefix,
                re.IGNORECASE,
            )
            and re.fullmatch(r"\s*(?:to|至|到|→|⇒|->)\s*", between, re.IGNORECASE)
        )
        is_forward = is_forward or bool(
            re.fullmatch(r"\s*(?:[-–—:/]|至|到|to|→|⇒|->)\s*", between, re.IGNORECASE)
            or (
                re.search(r"\bbetween\s*$", prefix, re.IGNORECASE)
                and re.fullmatch(r"\s*and\s*", between, re.IGNORECASE)
            )
        )
        is_target_first = bool(
            _TARGET_FIRST_TARGET_MARKER_RE.search(prefix)
            and _TARGET_FIRST_ORIGIN_MARKER_RE.search(between)
        )
        if is_forward:
            transitions.append(
                _OrderedNumericTransition(
                    metric=metric,
                    unit=transition_unit,
                    polarity=transition_polarity,
                    from_value=first.value,
                    from_qualifier=first.qualifier,
                    to_value=second.value,
                    to_qualifier=second.qualifier,
                    member_starts=(first.start, second.start),
                )
            )
        elif is_target_first:
            target_first_polarity = transition_polarity
            try:
                origin_decimal = Decimal(second.value)
                target_decimal = Decimal(first.value)
                if target_decimal < origin_decimal:
                    target_first_polarity = "decrease"
                elif target_decimal > origin_decimal:
                    target_first_polarity = "increase"
            except InvalidOperation:
                pass
            transitions.append(
                _OrderedNumericTransition(
                    metric=metric,
                    unit=transition_unit,
                    polarity=target_first_polarity,
                    from_value=second.value,
                    from_qualifier=second.qualifier,
                    to_value=first.value,
                    to_qualifier=first.qualifier,
                    member_starts=(first.start, second.start),
                )
            )
    return transitions


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
    selected_source_experiences = source_documents.get("selectedSourceExperiences")
    selected_source_ids = (
        set(selected_source_experiences)
        if isinstance(selected_source_experiences, Mapping)
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
    if change.module_type == OptimizationModuleType.PERSONAL_SUMMARY and root == "currentResume":
        is_summary = tokens == ["currentResume", "personal_summary"]
        is_selected_experience = (
            len(tokens) >= 4
            and tokens[1] == "experiences"
            and tokens[2] in selected_ids
            and tokens[2] in selected_source_ids
        )
        is_selected_skills = tokens[1:2] == ["skills"]
        if not (is_summary or is_selected_experience or is_selected_skills):
            return "个人摘要变更只能引用当前个人摘要、已选经历或明确回答"
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
    unique_sources: list[str] = []
    seen_visible_sources: set[str] = set()
    for source in [before, *sources]:
        visible_source = _fact_visible_text(source)
        if visible_source in seen_visible_sources:
            continue
        seen_visible_sources.add(visible_source)
        unique_sources.append(source)
    before_numbers = _numeric_expressions(before)
    candidate_numbers = _numeric_expressions(candidate)
    source_numbers = [
        expression
        for source in unique_sources
        for expression in _numeric_expressions(source)
    ]
    remaining_source_numbers = list(source_numbers)
    findings: list[str] = []
    for match in _SCIENTIFIC_NUMBER_RE.finditer(_fact_visible_text(candidate)):
        exponent_match = re.search(r"[eE]([+-]?\d+)", match.group("value"))
        if exponent_match and (
            len(exponent_match.group(1).lstrip("+-")) > 4
            or abs(int(exponent_match.group(1))) > 1_000
        ):
            findings.append("候选文本包含超出安全解析范围的科学计数值")
    supported_invalid_claims: Counter[
        tuple[str, str | None, str, str | None]
    ] = Counter()
    for source in dict.fromkeys([before, *sources]):
        supported_invalid_claims.update(_invalid_claim_signatures(source))
    candidate_invalid_occurrences: Counter[str] = Counter()
    for fragment in _invalid_chinese_quantities(candidate):
        occurrence_index = candidate_invalid_occurrences[fragment]
        candidate_invalid_occurrences[fragment] += 1
        signature = _invalid_claim_signature(candidate, fragment, occurrence_index)
        if supported_invalid_claims[signature] > 0:
            supported_invalid_claims[signature] -= 1
            continue
        findings.append(f"疑似量化“{fragment}”无法可靠解析，需用户确认")
    supported_indeterminate_claims: Counter[
        tuple[str, str | None, str, str | None]
    ] = Counter()
    for source in dict.fromkeys([before, *sources]):
        source_occurrences: Counter[str] = Counter()
        source_numbers_for_invalid = _numeric_expressions(source)
        for fragment in _invalid_numeric_suffixes(source, source_numbers_for_invalid):
            if not _EN_INDETERMINATE_WORD_QUANTITY_RE.fullmatch(fragment):
                continue
            occurrence_index = source_occurrences[fragment]
            source_occurrences[fragment] += 1
            supported_indeterminate_claims[
                _invalid_claim_signature(source, fragment, occurrence_index)
            ] += 1
    candidate_indeterminate_occurrences: Counter[str] = Counter()
    for fragment in _invalid_numeric_suffixes(candidate, candidate_numbers):
        if _EN_INDETERMINATE_WORD_QUANTITY_RE.fullmatch(fragment):
            occurrence_index = candidate_indeterminate_occurrences[fragment]
            candidate_indeterminate_occurrences[fragment] += 1
            signature = _invalid_claim_signature(
                candidate,
                fragment,
                occurrence_index,
            )
            if supported_indeterminate_claims[signature] > 0:
                supported_indeterminate_claims[signature] -= 1
                continue
        findings.append(
            f"数字后的单位或数量级“{fragment}”无法可靠解析，需用户确认"
        )
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
        matching = [
            source
            for source in remaining_source_numbers
            if source.value == expression.value and source.unit == expression.unit
        ]
        if not matching:
            findings.append(f"新增数字“{rendered}”没有同值同单位的来源证据")
            continue
        usable_matching = [
            source
            for source in matching
            if not source.contradictory
            and source.negated == expression.negated
            and source.conditional == expression.conditional
        ]
        if not usable_matching:
            findings.append(
                f"来源数字“{rendered}”的符号与方向存在矛盾，需用户确认"
            )
            continue
        matching = usable_matching
        qualifier_matching = [
            source
            for source in matching
            if source.qualifier == expression.qualifier
        ]
        if not qualifier_matching:
            findings.append(
                f"新增数字“{rendered}”的精确、阈值或近似限定与来源证据不一致"
            )
            continue
        matching = qualifier_matching
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
            continue
        remaining_source_numbers.remove(polarity_matching[0])
    return findings


def _candidate_findings(
    candidate: Any,
    *,
    before: Any,
    source_texts: list[str],
    answered_source_texts: list[str],
    introduced_terms: Sequence[str],
    layer_name: str,
    allow_explicit_empty: bool,
) -> list[str]:
    if candidate is None or candidate == before:
        return []
    if not isinstance(candidate, str) or not isinstance(before, str):
        return []
    if allow_explicit_empty and candidate == "":
        return []
    findings: list[str] = []
    findings.extend(_rich_text_format_findings(candidate, before))
    findings.extend(
        _numeric_findings(
            candidate,
            before,
            source_texts,
            answered_source_texts,
        )
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


def _is_unsupported_read_only_sentinel(change: OptimizationChange) -> bool:
    """Return whether the change intentionally has no mutable resume target."""

    return (
        change.module_type == OptimizationModuleType.PERSONAL_SUMMARY
        and change.module_id == "current_resume"
        and change.field_path == "unsupported"
        and change.action_kind == OptimizationAction.LEAVE_UNCHANGED
        and change.before_value is None
        and change.general_value is None
        and change.targeted_value is None
        and not change.source_refs
        and not change.introduced_terms
        and change.expected_score_gain == 0
        and change.default_selected is False
    )


def _frozen_before_value(
    change: OptimizationChange,
    source_documents: Mapping[str, Any],
) -> Any:
    current = source_documents.get("currentResume")
    if not isinstance(current, Mapping):
        return _MISSING_FROZEN_VALUE
    if change.module_type == OptimizationModuleType.PERSONAL_SUMMARY:
        return current.get("personal_summary", _MISSING_FROZEN_VALUE)
    if change.module_type == OptimizationModuleType.SECTION_ORDER:
        return current.get("section_order", _MISSING_FROZEN_VALUE)
    if change.module_type == OptimizationModuleType.SKILLS_ORDER:
        raw_skills = current.get("skills")
        if not isinstance(raw_skills, list):
            return _MISSING_FROZEN_VALUE
        skill_ids: list[str] = []
        for skill in raw_skills:
            if isinstance(skill, Mapping):
                skill_id = skill.get("id")
                if isinstance(skill_id, str) and skill_id:
                    skill_ids.append(skill_id)
            elif isinstance(skill, str) and skill:
                skill_ids.append(skill)
        return skill_ids
    if change.module_type != OptimizationModuleType.EXPERIENCE_STAR:
        return _MISSING_FROZEN_VALUE
    experiences = current.get("experiences")
    experience = (
        experiences.get(change.module_id)
        if isinstance(experiences, Mapping)
        else None
    )
    if not isinstance(experience, Mapping):
        return _MISSING_FROZEN_VALUE
    value: Any = experience
    for token in change.field_path.split("."):
        if not isinstance(value, Mapping) or token not in value:
            return _MISSING_FROZEN_VALUE
        value = value[token]
    return value


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
        findings: list[str] = []
        if not _is_unsupported_read_only_sentinel(change):
            frozen_before = _frozen_before_value(change, source_documents)
            if frozen_before is _MISSING_FROZEN_VALUE:
                findings.append("无法解析变更对应的冻结当前简历字段")
            elif frozen_before != change.before_value:
                findings.append("变更原值与冻结的当前简历字段不一致")
        if _is_not_applicable(change):
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
                    update={"safety_status": "pending", "default_selected": False}
                )
                pending_ids.append(change.change_id)
            verified.append(change)
            continue

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
                    allow_explicit_empty=(
                        change.module_type == OptimizationModuleType.PERSONAL_SUMMARY
                    ),
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
                    allow_explicit_empty=(
                        change.module_type == OptimizationModuleType.PERSONAL_SUMMARY
                    ),
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
        elif needs_semantic_review(change):
            receipt = change.semantic_review
            if receipt is None or receipt.policy_version != POLICY_VERSION or (
                receipt.input_hash != semantic_review_hash(change, source_documents)
            ):
                change = change.model_copy(update={
                    "safety_status": "pending", "default_selected": False,
                    "safety_findings": ["改写尚未通过当前文本与来源的语义审核，请重新生成优化方案"],
                })
                pending_ids.append(change.change_id)
            elif receipt.verdict == "supported":
                change = change.model_copy(update={"safety_status": "allowed", "safety_findings": []})
                allowed_ids.append(change.change_id)
            else:
                status = "blocked" if receipt.verdict == "unsupported" else "pending"
                change = change.model_copy(update={
                    "safety_status": status, "default_selected": False,
                    "safety_findings": [receipt.reason],
                })
                (blocked_ids if status == "blocked" else pending_ids).append(change.change_id)
                summary_findings.append(f"{change.change_id}：{receipt.reason}")
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


def needs_semantic_review(change: OptimizationChange) -> bool:
    return not _is_not_applicable(change) and any(
        isinstance(value, str) and value != change.before_value and value != ""
        for value in (change.general_value, change.targeted_value)
    )


def semantic_review_input(change: OptimizationChange, documents: Mapping[str, Any]) -> dict[str, Any]:
    # Called only after source scope and frozen-before validation. Keep each
    # source separate so one action cannot inherit another action's ownership.
    return {
        "module_type": change.module_type.value,
        "module_id": change.module_id,
        "field_path": change.field_path,
        "before": change.before_value,
        "general": change.general_value,
        "targeted": change.targeted_value,
        "sources": [{"ref": ref, "content": resolve_source_ref(documents, ref)}
                    for ref in change.source_refs],
    }


def semantic_review_hash(change: OptimizationChange, documents: Mapping[str, Any]) -> str:
    payload = {"policy": POLICY_VERSION, "change_id": change.change_id,
               "input": semantic_review_input(change, documents)}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False,
                                    separators=(",", ":")).encode("utf-8")).hexdigest()
