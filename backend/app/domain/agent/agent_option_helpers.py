from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, Iterable, List

from fastapi import HTTPException
from starlette.status import HTTP_404_NOT_FOUND

from .schemas import (
    AgentPolishOption,
    AgentPolishOptionsResponse,
    AgentResumeTemplateOption,
    AgentResumeTemplateOptionsResponse,
    AgentSkillBundleFile,
    AgentSkillBundleResponse,
    DEFAULT_AGENT_POLISH_LEVEL,
    DEFAULT_AGENT_TEMPLATE_ID,
)

FOLDER_SAFE_PATTERN = re.compile(r'[\\/:*?"<>|\r\n\t]+')
AGENT_SKILL_DIR = Path(__file__).resolve().parent / "skill_bundles" / "resumeflow-job-search"
AGENT_SKILL_FILES = ("SKILL.md", "references/api.md", "agents/openai.yaml")
AGENT_RESUME_TEMPLATE_OPTIONS = (
    {
        "id": "modern-slate",
        "name": "现代深灰",
        "description": "ATS 友好的成熟单栏模板，结构清晰稳重。",
        "has_avatar": False,
        "default_theme_color_preset_id": "slate",
    },
    {
        "id": "minimal-gray",
        "name": "极简留白",
        "description": "轻装饰、强可读的 clean 模板，适合大多数岗位。",
        "has_avatar": False,
        "default_theme_color_preset_id": "slate",
    },
    {
        "id": "accent-emerald",
        "name": "活力青绿",
        "description": "现代强调色单栏模板，保留专业感与识别度。",
        "has_avatar": False,
        "default_theme_color_preset_id": "emerald",
    },
    {
        "id": "open-source-classic",
        "name": "开源经典",
        "description": "参考开源简历项目的紧凑单栏结构，偏 ATS 与打印友好。",
        "has_avatar": False,
        "default_theme_color_preset_id": "blue",
    },
    {
        "id": "timeline-blue",
        "name": "时间线蓝",
        "description": "借鉴社区时间线模板的纵向节奏，适合项目和经历较多的简历。",
        "has_avatar": False,
        "default_theme_color_preset_id": "blue",
    },
    {
        "id": "avatar-professional",
        "name": "商务头像",
        "description": "右上头像与左侧信息严格分栏，适合正式商务简历。",
        "has_avatar": True,
        "default_theme_color_preset_id": "blue",
    },
    {
        "id": "avatar-split",
        "name": "侧栏头像",
        "description": "成熟双栏模板，左侧品牌信息，右侧主内容。",
        "has_avatar": True,
        "default_theme_color_preset_id": "amber",
    },
    {
        "id": "modern-slate-avatar",
        "name": "商务深灰",
        "description": "在现代深灰基础上增加头像与区块图标，更具视觉活力。",
        "has_avatar": True,
        "default_theme_color_preset_id": "slate",
    },
    {
        "id": "photo-card",
        "name": "头像名片",
        "description": "顶部名片式头像布局，适合需要更强个人识别度的投递场景。",
        "has_avatar": True,
        "default_theme_color_preset_id": "teal",
    },
    {
        "id": "photo-sidebar",
        "name": "深色侧栏",
        "description": "成熟双栏头像模板，侧栏承载身份信息，主栏突出成果内容。",
        "has_avatar": True,
        "default_theme_color_preset_id": "violet",
    },
)
AGENT_POLISH_OPTIONS = (
    {
        "id": "disabled",
        "label": "不启用",
        "polish_before_output": False,
        "polish_level": None,
        "description": "不生成新的个人总结润色内容，保留原简历已有内容。",
    },
    {
        "id": "conservative",
        "label": "保守",
        "polish_before_output": True,
        "polish_level": "保守",
        "description": "仅做措辞澄清和轻微顺序调整，最大限度保留原表达。",
    },
    {
        "id": "standard",
        "label": "标准",
        "polish_before_output": True,
        "polish_level": "标准",
        "description": "平衡岗位匹配和事实克制，适合作为默认选择。",
    },
    {
        "id": "enhanced",
        "label": "增强",
        "polish_before_output": True,
        "polish_level": "增强",
        "description": "更主动地重组表达，突出与 JD 相关的经历和关键词。",
    },
    {
        "id": "strong-match",
        "label": "强匹配",
        "polish_before_output": True,
        "polish_level": "强匹配",
        "description": "优先强化 JD 匹配度，但仍只使用用户已有真实经历。",
    },
)


def build_agent_skill_bundle() -> AgentSkillBundleResponse:
    files: List[AgentSkillBundleFile] = []
    for relative_path in AGENT_SKILL_FILES:
        path = AGENT_SKILL_DIR / relative_path
        if not path.is_file():
            raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Agent skill bundle not found")
        files.append(
            AgentSkillBundleFile(
                path=relative_path.replace("\\", "/"),
                content=path.read_text(encoding="utf-8"),
            )
        )
    return AgentSkillBundleResponse(name="resumeflow-job-search", files=files)

def build_agent_resume_template_options() -> AgentResumeTemplateOptionsResponse:
    return AgentResumeTemplateOptionsResponse(
        default_template_id=DEFAULT_AGENT_TEMPLATE_ID,
        templates=[AgentResumeTemplateOption(**item) for item in AGENT_RESUME_TEMPLATE_OPTIONS],
    )

def build_agent_polish_options() -> AgentPolishOptionsResponse:
    return AgentPolishOptionsResponse(
        default_polish_before_output=True,
        default_polish_level=DEFAULT_AGENT_POLISH_LEVEL,
        options=[AgentPolishOption(**item) for item in AGENT_POLISH_OPTIONS],
    )

def sanitize_folder_name(company_name: str, job_title: str, match_percentage: int) -> str:
    parts = [company_name.strip(), job_title.strip(), str(match_percentage)]
    cleaned_parts = []
    for part in parts:
        cleaned = FOLDER_SAFE_PATTERN.sub("_", part)
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._")
        cleaned_parts.append(cleaned or "unknown")
    return "_".join(cleaned_parts)

def _clamp_score(value: Any) -> int:
    try:
        numeric = int(round(float(value)))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, numeric))

def _normalize_string_list(value: Any, fallback: Iterable[str] = ()) -> List[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()][:8]
    return [item for item in fallback if item][:8]

def _analysis_evaluation(result: Dict[str, Any], payload: AgentJobRequest) -> str:
    summary = str(result.get("summary") or result.get("evaluation") or "").strip()
    if summary:
        return summary
    score = _clamp_score(result.get("matchPercentage"))
    if score >= 85:
        return f"{payload.company_name} 的 {payload.job_title} 匹配度较高，建议优先生成材料。"
    if score >= 70:
        return f"{payload.company_name} 的 {payload.job_title} 具备一定匹配度，建议人工复核后投递。"
    return f"{payload.company_name} 的 {payload.job_title} 匹配度偏低，建议谨慎投入时间。"

def _recommendation(score: int) -> str:
    if score >= 80:
        return "generate"
    if score >= 65:
        return "review"
    return "skip"

def _absolute_url(request: Any, path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    try:
        base = f"{request.url.scheme}://{request.url.netloc}"
    except Exception:
        return path
    return f"{base}{path}"

def _entry_reasons(entries: Any, minimum_score: int) -> List[str]:
    if not isinstance(entries, list):
        return []
    reasons = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if _clamp_score(entry.get("score")) < minimum_score:
            continue
        reason = str(entry.get("reason") or entry.get("title") or "").strip()
        if reason:
            reasons.append(reason)
    return reasons
