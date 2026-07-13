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
    {
        "id": "deephire-standard",
        "name": "标准",
        "description": "清爽单栏、右上头像与细线标题，适合通用投递。",
        "has_avatar": True,
        "default_theme_color_preset_id": "slate",
    },
    {
        "id": "deephire-blue",
        "name": "青蓝",
        "description": "青蓝标题带与柔和底色强化模块层次。",
        "has_avatar": True,
        "default_theme_color_preset_id": "cyan",
    },
    {
        "id": "deephire-steady",
        "name": "沉稳",
        "description": "深海军蓝满宽页眉，稳重且有明确视觉重心。",
        "has_avatar": True,
        "default_theme_color_preset_id": "navy",
    },
    {
        "id": "deephire-simple",
        "name": "简约",
        "description": "轻量双栏，左侧身份信息与右侧经历严格分区。",
        "has_avatar": True,
        "default_theme_color_preset_id": "cyan",
    },
    {
        "id": "deephire-deep-blue",
        "name": "湛青",
        "description": "湛青弧形头区与居中圆形头像，简洁醒目。",
        "has_avatar": True,
        "default_theme_color_preset_id": "cyan",
    },
    {
        "id": "deephire-lucky-red",
        "name": "幸运红",
        "description": "酒红页眉与圆角内容卡片，强调个人识别度。",
        "has_avatar": True,
        "default_theme_color_preset_id": "crimson",
    },
    {
        "id": "deephire-champion-blue",
        "name": "冠军蓝",
        "description": "冠军蓝侧栏与大字号问候式页眉，适合创意岗位。",
        "has_avatar": True,
        "default_theme_color_preset_id": "royal",
    },
    {
        "id": "deephire-collector-red",
        "name": "典藏红",
        "description": "红色顶轨与信息侧栏结合，经典而利落。",
        "has_avatar": True,
        "default_theme_color_preset_id": "crimson",
    },
    {
        "id": "deephire-minimal",
        "name": "极简",
        "description": "大面积留白、细分隔线与居中信息，阅读轻盈。",
        "has_avatar": True,
        "default_theme_color_preset_id": "slate",
    },
    {
        "id": "deephire-blue-header",
        "name": "蓝顶",
        "description": "皇家蓝横幅页眉搭配紧凑单栏正文。",
        "has_avatar": True,
        "default_theme_color_preset_id": "royal",
    },
    {
        "id": "deephire-elegant",
        "name": "清雅",
        "description": "左侧栏目标题与右侧正文严格对齐，版面清爽雅致。",
        "has_avatar": True,
        "default_theme_color_preset_id": "slate",
    },
    {
        "id": "deephire-concise",
        "name": "简明",
        "description": "窄侧栏与红色节点时间线，信息路径一目了然。",
        "has_avatar": True,
        "default_theme_color_preset_id": "rose",
    },
    {
        "id": "deephire-table",
        "name": "表格",
        "description": "模块使用严谨表格边框，适合结构化经历展示。",
        "has_avatar": True,
        "default_theme_color_preset_id": "slate",
    },
    {
        "id": "deephire-ink",
        "name": "墨韵",
        "description": "衬线文字与暖色细线，呈现书卷式专业气质。",
        "has_avatar": True,
        "default_theme_color_preset_id": "crimson",
    },
    {
        "id": "deephire-retro",
        "name": "复古",
        "description": "米色资料侧栏与温暖正文，复古但保持清晰。",
        "has_avatar": True,
        "default_theme_color_preset_id": "amber",
    },
    {
        "id": "deephire-business",
        "name": "商务",
        "description": "深蓝商务侧栏与金色强调，突出成熟可靠。",
        "has_avatar": True,
        "default_theme_color_preset_id": "gold",
    },
    {
        "id": "deephire-fashion-black",
        "name": "时尚黑",
        "description": "黑色圆角页眉与重线模块，视觉对比鲜明。",
        "has_avatar": True,
        "default_theme_color_preset_id": "black",
    },
    {
        "id": "deephire-youth-energy",
        "name": "活力青春",
        "description": "明亮头像区与紫色内容导线，轻盈富有节奏。",
        "has_avatar": True,
        "default_theme_color_preset_id": "violet",
    },
    {
        "id": "deephire-artistic",
        "name": "艺术气息",
        "description": "深蓝画框、几何标签与金色强调，具有作品集气质。",
        "has_avatar": True,
        "default_theme_color_preset_id": "royal",
    },
    {
        "id": "deephire-soft-realm",
        "name": "柔境",
        "description": "柔和侧栏、圆形头像与紫红强调，亲和细腻。",
        "has_avatar": True,
        "default_theme_color_preset_id": "magenta",
    },
    {
        "id": "deephire-forest",
        "name": "林原",
        "description": "深色林野页眉与青绿节点，适合沉浸式个人品牌。",
        "has_avatar": True,
        "default_theme_color_preset_id": "cyan",
    },
    {
        "id": "deephire-classic-elegance",
        "name": "典雅",
        "description": "淡紫标题、克制间距与优雅细线，适合文职岗位。",
        "has_avatar": True,
        "default_theme_color_preset_id": "violet",
    },
    {
        "id": "deephire-magazine-editorial",
        "name": "杂志编辑",
        "description": "绿色编辑线、栏目式双栏与标签组件，版式感强。",
        "has_avatar": True,
        "default_theme_color_preset_id": "forest",
    },
    {
        "id": "deephire-forest-fresh",
        "name": "森系清新",
        "description": "浅绿侧栏与清爽内容区，强调自然与成长感。",
        "has_avatar": True,
        "default_theme_color_preset_id": "forest",
    },
    {
        "id": "deephire-cyber-future",
        "name": "赛博未来",
        "description": "深色整页与霓虹青蓝强调，适合技术与创意方向。",
        "has_avatar": True,
        "default_theme_color_preset_id": "cyan",
    },
    {
        "id": "deephire-renaissance",
        "name": "文艺复兴",
        "description": "羊皮纸色纸张、金红标题与居中章节，古典华丽。",
        "has_avatar": True,
        "default_theme_color_preset_id": "gold",
    },
    {
        "id": "deephire-watercolor",
        "name": "清新水彩",
        "description": "柔和水彩头区、蓝紫标题与留白正文，清新轻盈。",
        "has_avatar": True,
        "default_theme_color_preset_id": "blue",
    },
    {
        "id": "deephire-campus-youth",
        "name": "青春校园",
        "description": "多彩细线、圆形头像与蓝色小标题，适合校园求职。",
        "has_avatar": True,
        "default_theme_color_preset_id": "royal",
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
