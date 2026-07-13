# ResumeFLOW Agent API

Use the API base URL and API key from the user's ResumeFLOW Agent API configuration.

## Authentication

Send this header on every Agent API call:

```http
Authorization: Bearer <API Key>
Content-Type: application/json
```

The API key is bound to the API Key 对应的 ResumeFLOW 用户账号. Agent calls analyze that account's resume data, generated resumes and export snapshots are stored under that account, and future token usage accounting can be associated with the same server-side user id.

Each ResumeFLOW user keeps one reusable Agent API key by default: 每个用户保留一个可复制的 Agent API Key. The full key is stored server-side for that user so the web app can include it when copying Agent instructions. It remains stable until the user explicitly clicks refresh, which revokes the old key and creates a replacement.

Agents should also persist the supplied API base URL and full API key in local user-private storage when their runtime supports it, such as an OS secret store or a local config file that is outside the project workspace and excluded from version control. This local copy is for reuse in later ResumeFLOW sessions on the same machine. Do not store the key in job archives, generated resumes, repository files, logs, screenshots, or chat summaries; if the local copy is missing or authentication returns 401, ask the user to provide or refresh the key.

## Agent Capabilities

ResumeFLOW exposes the core workflow Agent needs: skill bundle install, template selection, polish option selection, JD analysis, tailored resume generation, account-side resume archive, and PDF download metadata.

## Resume Templates

`GET <apiBaseUrl>/agent/v1/resume-templates`

Use this endpoint before starting a job search session. Present the returned templates to the user and ask them to choose a `template_id`. If they do not choose, use `default_template_id`.

Response body:

```json
{
  "default_template_id": "modern-slate",
  "templates": [
    {
      "id": "modern-slate",
      "name": "现代深灰",
      "description": "ATS 友好的成熟单栏模板，结构清晰稳重。",
      "has_avatar": false,
      "default_theme_color_preset_id": "slate"
    },
    {
      "id": "minimal-gray",
      "name": "极简留白",
      "description": "轻装饰、强可读的 clean 模板，适合大多数岗位。",
      "has_avatar": false,
      "default_theme_color_preset_id": "slate"
    },
    {
      "id": "accent-emerald",
      "name": "活力青绿",
      "description": "现代强调色单栏模板，保留专业感与识别度。",
      "has_avatar": false,
      "default_theme_color_preset_id": "emerald"
    },
    {
      "id": "open-source-classic",
      "name": "开源经典",
      "description": "参考开源简历项目的紧凑单栏结构，偏 ATS 与打印友好。",
      "has_avatar": false,
      "default_theme_color_preset_id": "blue"
    },
    {
      "id": "timeline-blue",
      "name": "时间线蓝",
      "description": "借鉴社区时间线模板的纵向节奏，适合项目和经历较多的简历。",
      "has_avatar": false,
      "default_theme_color_preset_id": "blue"
    },
    {
      "id": "avatar-professional",
      "name": "商务头像",
      "description": "右上头像与左侧信息严格分栏，适合正式商务简历。",
      "has_avatar": true,
      "default_theme_color_preset_id": "blue"
    },
    {
      "id": "avatar-split",
      "name": "侧栏头像",
      "description": "成熟双栏模板，左侧品牌信息，右侧主内容。",
      "has_avatar": true,
      "default_theme_color_preset_id": "amber"
    },
    {
      "id": "modern-slate-avatar",
      "name": "商务深灰",
      "description": "在现代深灰基础上增加头像与区块图标，更具视觉活力。",
      "has_avatar": true,
      "default_theme_color_preset_id": "slate"
    },
    {
      "id": "photo-card",
      "name": "头像名片",
      "description": "顶部名片式头像布局，适合需要更强个人识别度的投递场景。",
      "has_avatar": true,
      "default_theme_color_preset_id": "teal"
    },
    {
      "id": "photo-sidebar",
      "name": "深色侧栏",
      "description": "成熟双栏头像模板，侧栏承载身份信息，主栏突出成果内容。",
      "has_avatar": true,
      "default_theme_color_preset_id": "violet"
    },
    {
      "id": "deephire-standard",
      "name": "标准",
      "description": "清爽单栏、右上头像与细线标题，适合通用投递。",
      "has_avatar": true,
      "default_theme_color_preset_id": "slate"
    },
    {
      "id": "deephire-blue",
      "name": "青蓝",
      "description": "青蓝标题带与柔和底色强化模块层次。",
      "has_avatar": true,
      "default_theme_color_preset_id": "cyan"
    },
    {
      "id": "deephire-steady",
      "name": "沉稳",
      "description": "深海军蓝满宽页眉，稳重且有明确视觉重心。",
      "has_avatar": true,
      "default_theme_color_preset_id": "navy"
    },
    {
      "id": "deephire-simple",
      "name": "简约",
      "description": "轻量双栏，左侧身份信息与右侧经历严格分区。",
      "has_avatar": true,
      "default_theme_color_preset_id": "cyan"
    },
    {
      "id": "deephire-deep-blue",
      "name": "湛青",
      "description": "湛青弧形头区与居中圆形头像，简洁醒目。",
      "has_avatar": true,
      "default_theme_color_preset_id": "cyan"
    },
    {
      "id": "deephire-lucky-red",
      "name": "幸运红",
      "description": "酒红页眉与圆角内容卡片，强调个人识别度。",
      "has_avatar": true,
      "default_theme_color_preset_id": "crimson"
    },
    {
      "id": "deephire-champion-blue",
      "name": "冠军蓝",
      "description": "冠军蓝侧栏与大字号问候式页眉，适合创意岗位。",
      "has_avatar": true,
      "default_theme_color_preset_id": "royal"
    },
    {
      "id": "deephire-collector-red",
      "name": "典藏红",
      "description": "红色顶轨与信息侧栏结合，经典而利落。",
      "has_avatar": true,
      "default_theme_color_preset_id": "crimson"
    },
    {
      "id": "deephire-minimal",
      "name": "极简",
      "description": "大面积留白、细分隔线与居中信息，阅读轻盈。",
      "has_avatar": true,
      "default_theme_color_preset_id": "slate"
    },
    {
      "id": "deephire-blue-header",
      "name": "蓝顶",
      "description": "皇家蓝横幅页眉搭配紧凑单栏正文。",
      "has_avatar": true,
      "default_theme_color_preset_id": "royal"
    },
    {
      "id": "deephire-elegant",
      "name": "清雅",
      "description": "左侧栏目标题与右侧正文严格对齐，版面清爽雅致。",
      "has_avatar": true,
      "default_theme_color_preset_id": "slate"
    },
    {
      "id": "deephire-concise",
      "name": "简明",
      "description": "窄侧栏与红色节点时间线，信息路径一目了然。",
      "has_avatar": true,
      "default_theme_color_preset_id": "rose"
    },
    {
      "id": "deephire-table",
      "name": "表格",
      "description": "模块使用严谨表格边框，适合结构化经历展示。",
      "has_avatar": true,
      "default_theme_color_preset_id": "slate"
    },
    {
      "id": "deephire-ink",
      "name": "墨韵",
      "description": "衬线文字与暖色细线，呈现书卷式专业气质。",
      "has_avatar": true,
      "default_theme_color_preset_id": "crimson"
    },
    {
      "id": "deephire-retro",
      "name": "复古",
      "description": "米色资料侧栏与温暖正文，复古但保持清晰。",
      "has_avatar": true,
      "default_theme_color_preset_id": "amber"
    },
    {
      "id": "deephire-business",
      "name": "商务",
      "description": "深蓝商务侧栏与金色强调，突出成熟可靠。",
      "has_avatar": true,
      "default_theme_color_preset_id": "gold"
    },
    {
      "id": "deephire-fashion-black",
      "name": "时尚黑",
      "description": "黑色圆角页眉与重线模块，视觉对比鲜明。",
      "has_avatar": true,
      "default_theme_color_preset_id": "black"
    },
    {
      "id": "deephire-youth-energy",
      "name": "活力青春",
      "description": "明亮头像区与紫色内容导线，轻盈富有节奏。",
      "has_avatar": true,
      "default_theme_color_preset_id": "violet"
    },
    {
      "id": "deephire-artistic",
      "name": "艺术气息",
      "description": "深蓝画框、几何标签与金色强调，具有作品集气质。",
      "has_avatar": true,
      "default_theme_color_preset_id": "royal"
    },
    {
      "id": "deephire-soft-realm",
      "name": "柔境",
      "description": "柔和侧栏、圆形头像与紫红强调，亲和细腻。",
      "has_avatar": true,
      "default_theme_color_preset_id": "magenta"
    },
    {
      "id": "deephire-forest",
      "name": "林原",
      "description": "深色林野页眉与青绿节点，适合沉浸式个人品牌。",
      "has_avatar": true,
      "default_theme_color_preset_id": "cyan"
    },
    {
      "id": "deephire-classic-elegance",
      "name": "典雅",
      "description": "淡紫标题、克制间距与优雅细线，适合文职岗位。",
      "has_avatar": true,
      "default_theme_color_preset_id": "violet"
    },
    {
      "id": "deephire-magazine-editorial",
      "name": "杂志编辑",
      "description": "绿色编辑线、栏目式双栏与标签组件，版式感强。",
      "has_avatar": true,
      "default_theme_color_preset_id": "forest"
    },
    {
      "id": "deephire-forest-fresh",
      "name": "森系清新",
      "description": "浅绿侧栏与清爽内容区，强调自然与成长感。",
      "has_avatar": true,
      "default_theme_color_preset_id": "forest"
    },
    {
      "id": "deephire-cyber-future",
      "name": "赛博未来",
      "description": "深色整页与霓虹青蓝强调，适合技术与创意方向。",
      "has_avatar": true,
      "default_theme_color_preset_id": "cyan"
    },
    {
      "id": "deephire-renaissance",
      "name": "文艺复兴",
      "description": "羊皮纸色纸张、金红标题与居中章节，古典华丽。",
      "has_avatar": true,
      "default_theme_color_preset_id": "gold"
    },
    {
      "id": "deephire-watercolor",
      "name": "清新水彩",
      "description": "柔和水彩头区、蓝紫标题与留白正文，清新轻盈。",
      "has_avatar": true,
      "default_theme_color_preset_id": "blue"
    },
    {
      "id": "deephire-campus-youth",
      "name": "青春校园",
      "description": "多彩细线、圆形头像与蓝色小标题，适合校园求职。",
      "has_avatar": true,
      "default_theme_color_preset_id": "royal"
    }
  ]
}
```

## Polish Options

`GET <apiBaseUrl>/agent/v1/polish-options`

Use this endpoint before starting a job search session. Ask whether polish should be enabled and which level to use. Explain the options briefly. If interaction is unavailable, record the assumption and use enabled `标准`.

Response body:

```json
{
  "default_polish_before_output": true,
  "default_polish_level": "标准",
  "options": [
    {
      "id": "disabled",
      "label": "不启用",
      "polish_before_output": false,
      "polish_level": null,
      "description": "不生成新的个人总结润色内容，保留原简历已有内容。"
    },
    {
      "id": "standard",
      "label": "标准",
      "polish_before_output": true,
      "polish_level": "标准",
      "description": "平衡岗位匹配和事实克制，适合作为默认选择。"
    }
  ]
}
```

## Analyze A Job

`POST <apiBaseUrl>/agent/v1/jobs/analyze`

Use this endpoint to screen many jobs before generating resume PDFs.

Request body:

```json
{
  "job_title": "AI Product Intern",
  "company_name": "Example Company",
  "jd_text": "Full job description text...",
  "job_url": "https://example.com/jobs/123",
  "source": "optional job board name",
  "resume_id": "optional ResumeFLOW resume id"
}
```

Response fields:

- `match_percentage`: 0-100 match score.
- `evaluation`: short natural-language fit summary.
- `strengths`: matching resume strengths.
- `gaps`: risks or missing experience.
- `missing_keywords`: keywords that appear important in the JD but are weak or absent in the resume.
- `recommendation`: `skip`, `review`, or `generate`.
- `suggested_folder_name`: ResumeFLOW's server-side safe folder suggestion. The local archive still uses `match-company-role` unless the user requests otherwise.

## Generate A Tailored Resume

`POST <apiBaseUrl>/agent/v1/jobs/generate`

Use this endpoint only after the job passes the user's threshold and hard filters. The request accepts the same fields as analyze, plus optional overrides:

```json
{
  "job_title": "AI Product Intern",
  "company_name": "Example Company",
  "jd_text": "Full job description text...",
  "job_url": "https://example.com/jobs/123",
  "source": "optional job board name",
  "resume_id": "optional ResumeFLOW resume id",
  "template_id": "optional template id",
  "polish_before_output": true,
  "polish_level": "标准"
}
```

Pass the user's selected `template_id`, `polish_before_output`, and `polish_level` from the current session. If the optional override fields are omitted, ResumeFLOW falls back to the user's saved server-side Agent plugin configuration for backward compatibility. Generated resumes are saved under the user's ResumeFLOW account with the source JD and default to the smart one-page layout for export.

Response fields include all analyze fields, plus:

- `resume_pdf.download_url`: URL for downloading the generated PDF.
- `resume_pdf.file_name`: suggested PDF file name.
- `resume_pdf.generated_resume_id`: ResumeFLOW resume id saved under the user's account.
- `job_link_url`: direct job URL.
- `job_metadata`: job title, company, JD text, URL, source, generation time, folder name, and match score.

## Failure Handling

- If authentication fails, ask the user to refresh or provide a valid full API key.
- If a job URL is rejected, use the canonical public URL for the posting.
- If JD text is incomplete or hidden behind login, mark the job as blocked instead of guessing.
- If generation succeeds but PDF download fails, keep `metadata.json` with the `download_url` and report the failure.
