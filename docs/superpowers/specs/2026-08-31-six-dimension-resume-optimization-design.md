# ResumeFlow 六维智能优化功能设计规范

**文档状态：** 实施基线
**适用仓库：** `CMFHF-404/ResumeFLOW--`
**审计基线：** `main@bc9cb8c45ec3e96ccb250892e069bbb60e486f56`
**首发版本标识：** `resume_optimization_v1`
**首发安全策略标识：** `thin_safety_v1`
**目标发布日期策略：** 先交付可收费闭环，再增加通用稿复用，最后演进为完整 Evidence-constrained Writing Harness。

---

## 1. 产品目标

在用户已经手动生成六维简历报告后，提供一个可付费执行的“根据报告优化”流程：

1. 只评价和修改当前组装出来的简历，不把未选择经历偷偷算作当前内容。
2. 充分利用当前已选经历在经历库中的完整版本，减少重复询问。
3. 对纯表达问题直接改写；对事实缺口先询问；对经历库中未选择但可能更强的内容只给出素材建议。
4. 不为提高分数虚构职责、方法、工具、规模、数字或因果关系。
5. 用户逐项确认后，仅把结果应用到当前简历的 override/config。
6. 应用完成后只触发一次优化后六维复评，并展示前后变化。
7. 首发沿用现有 AI Token 计费，避免在尚无真实成本数据时增加固定价格 SKU。

成功标准不是“模型把分数写高”，而是：

- 用户能在一条清晰路径中完成诊断、补充、预览、应用和复评；
- 低事实密度简历不会被模型擅自补成高质量案例；
- 当前简历与总经历库不会因多次 JD 特化改写发生互相污染；
- 每一次付费操作有可恢复、可审计、可撤销的优化 Run；
- 首发完成后无需重构即可继续建设通用稿缓存和完整证据 Harness。

---

## 2. 核心产品边界

### 2.1 六维分析与一键组装的职责

| 功能 | 回答的问题 | 是否改变选择内容 |
|---|---|---|
| 六维诊断 | 当前这份简历哪里存在表达和结构问题？ | 否 |
| 六维智能优化 | 在不擅自更换主体内容的前提下，当前简历怎样写得更好？ | 默认否 |
| 一键组装 | 针对这个 JD，应该从经历库选择哪些经历、证书和技能？ | 是 |

六维优化可以展示未选经历机会，但只能提供以下操作：

- 查看该经历；
- 前往一键组装；
- 保持当前选择。

首发不得在六维优化后台自动增删经历、证书或技能。

### 2.2 数据范围

| 数据范围 | 首发用途 |
|---|---|
| 当前简历快照 | 诊断、改写、前后 Diff、最终评分 |
| 当前已选经历对应的完整经历库版本 | 补回同一经历中已经存在但当前简历省略的事实 |
| 当前用户对追问的回答 | 允许进入受影响模块的改写 |
| 未选择经历的标题、组织、类别、匹配分和匹配理由 | 生成最多 3 条素材建议 |
| 未选择经历的完整 STAR 文本 | 首发不送入优化模型 |
| 全部经历自动重新组合 | 保留给一键组装 |

### 2.3 四类处理动作

每个六维问题必须被归到下列一种动作，不能由生成模型模糊处理：

```text
rewrite_now
ask_user
suggest_from_bank
leave_unchanged
```

- `rewrite_now`：已有事实足够，只需重排、精简、标准化或重新组织。
- `ask_user`：缺少职责边界、个人动作、方法、结果、规模、数字或因果事实。
- `suggest_from_bank`：当前简历缺少某项能力，但未选经历中存在更强候选内容。
- `leave_unchanged`：没有安全改进空间，或问题不属于首发支持范围。

---

## 3. 首发支持范围

### 3.1 支持直接修改的模块

1. 工作经历和项目经历的 `star.s/t/a/r`；
2. 当前简历的个人总结；
3. 已选择技能 ID 的显示顺序；
4. 当前已有模块的顺序；
5. 文本加粗和重点标记，但不得新增事实。

### 3.2 首发只给建议、不直接修改的模块

1. 教育经历正文；
2. 证书正文；
3. 新增技能；
4. 新增或删除经历；
5. 新增项目；
6. 新增无法从当前事实支持的岗位术语；
7. 未选经历自动并入当前简历。

### 3.3 首发不做

- 全量事实原子化；
- 多轮自主 Agent 对话；
- 自动证明文档真实性；
- 自动写回总经历；
- 每次编辑自动重新评分；
- 以模型生成内容作为模型自身的事实依据；
- 以固定售价打包优化服务。

---

## 4. 内容分层与复用

系统必须从首发开始保留四层概念，即使其中第二层到后续版本才持久化。

```text
L0 事实源：经历库中的 ExperienceVersion
L1 通用优化稿：不依赖具体 JD 的表达改进
L2 JD 特化稿：只属于当前 resume_id + JD
L3 组装与排版：选择、顺序、模板和一页适配
```

### 4.1 L0 事实源

- 继续使用现有 `MasterExperience + ExperienceVersion`；
- 当前简历的文本不得反向自动覆盖 L0；
- 用户追问中确认的新事实只保存在优化 Run；
- 首发不提供自动同步；
- 后续提供“同步新增事实到总经历”时，必须创建新的 `ExperienceVersion`，不得直接覆盖旧版本。

### 4.2 L1 通用优化稿

可复用的变化包括：

- STAR 字段归位；
- 口语改为书面表达；
- 长句拆分；
- 冗余删除；
- 已有动作和结果的结构化；
- 保留责任边界的专业动词；
- 不依赖特定 JD 的内容排序。

首发模型返回 `generalValue` 并随 Run 保存，但不建立独立缓存表。发布层级 B 再增加 `experience_optimization_artifacts`。

### 4.3 L2 JD 特化稿

只保存到当前简历：

- JD 相关证据前置；
- 事实支持的岗位术语；
- 特定岗位的重点顺序；
- 特定岗位的加粗；
- 为一页简历进行的压缩。

经历字段写入 `ResumeExperienceLink.overrides_json.star`；个人总结、技能顺序和模块顺序写入 `Resume.config`。

### 4.4 L3 组装与排版

继续由现有简历工厂管理。六维优化不得复制一套选择器。

---

## 5. 用户流程

### 5.1 前置条件

“根据报告优化”按钮仅在以下条件全部满足时可用：

- 当前简历存在；
- 六维报告存在；
- `evaluationVersion === "resume_flow_v1"`；
- `evaluationIsOutdated !== true`；
- 当前 `evaluationSignature` 与持久化签名一致；
- 当前没有六维评分、自动组装、单段润色或批量润色正在运行；
- 功能开关已开启；
- 用户有可用 AI Token 或有效无限套餐。

### 5.2 主流程

```text
分析报告
  ↓
点击“根据报告优化”
  ↓
冻结简历、JD、评价和已选经历版本
  ↓
生成优化方案与安全改写
  ↓
存在事实问题？
  ├─ 否 → 对照确认
  └─ 是 → 一轮补充信息 → 只重写受影响模块 → 对照确认
  ↓
用户勾选要应用的改动
  ↓
服务器再次检查快照和安全策略
  ↓
事务应用到当前简历
  ↓
调用现有六维评价一次
  ↓
保存优化后报告
  ↓
结果页展示分数变化、已解决项、未解决项和经历库机会
```

### 5.3 用户拒答或没有数据

每个问题必须支持：

- `answered`：明确回答；
- `no_data`：没有统计或没有数据；
- `unknown`：记不清；
- `not_my_work`：不属于本人工作；
- `skipped`：跳过。

这些回答是正常终止状态。系统继续应用安全的结构和表达优化，不得继续逼问，也不得用占位数字生成简历。

---

## 6. 状态机

### 6.1 服务端 Run 状态

```text
planning
awaiting_answers
preview_ready
applying
applied
rescoring
completed
failed
stale
cancelled
reverted
```

合法迁移：

```text
planning -> awaiting_answers | preview_ready | failed | cancelled
awaiting_answers -> preview_ready | failed | stale | cancelled
preview_ready -> applying | stale | cancelled
applying -> applied | failed | stale
applied -> rescoring | reverted
rescoring -> completed | applied
completed -> reverted
```

`applied -> applied` 只允许复评失败后重试，不允许重复应用。

### 6.2 前端状态

```text
closed
starting
awaiting_answers
answering
preview
applying
rescoring
completed
error
stale
```

前端状态只反映 UI；服务端 Run 是恢复和审计的权威来源。

---

## 7. 数据模型

### 7.1 `resume_optimization_runs`

```text
id UUID PRIMARY KEY
user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE

status TEXT NOT NULL
optimizer_version TEXT NOT NULL
policy_version TEXT NOT NULL
prompt_version TEXT NOT NULL

source_resume_updated_at TIMESTAMPTZ NOT NULL
source_evaluation_signature TEXT NOT NULL
source_jd_signature TEXT NOT NULL DEFAULT ''
source_snapshot_hash TEXT NOT NULL

idempotency_key_hash TEXT
request_hash TEXT NOT NULL

before_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
plan_json JSONB NOT NULL DEFAULT '{}'::jsonb
answers_json JSONB NOT NULL DEFAULT '{}'::jsonb
result_json JSONB NOT NULL DEFAULT '{}'::jsonb
after_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
post_evaluation_json JSONB NOT NULL DEFAULT '{}'::jsonb
error_json JSONB NOT NULL DEFAULT '{}'::jsonb

accepted_change_ids TEXT[] NOT NULL DEFAULT '{}'
applied_content_signature TEXT

created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
applied_at TIMESTAMPTZ
completed_at TIMESTAMPTZ
```

约束：

- `status` 只能取状态机中的值；
- 所有 JSONB 列必须是 object；
- 每个 JSONB 列最大 4 MiB；
- 同一用户的非空 `idempotency_key_hash` 唯一；
- 索引：`user_id`、`resume_id + created_at DESC`、`status`。

### 7.2 发布层级 B：`experience_optimization_artifacts`

```text
id UUID PRIMARY KEY
user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
master_experience_id UUID NOT NULL REFERENCES master_experiences(id) ON DELETE CASCADE
source_version_id UUID NOT NULL REFERENCES experience_versions(id) ON DELETE CASCADE
source_hash TEXT NOT NULL
optimizer_version TEXT NOT NULL
policy_version TEXT NOT NULL
language TEXT NOT NULL
general_star JSONB NOT NULL
source_run_id UUID REFERENCES resume_optimization_runs(id) ON DELETE SET NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

唯一键：

```text
user_id
+ master_experience_id
+ source_version_id
+ source_hash
+ optimizer_version
+ policy_version
+ language
```

它是派生缓存，不是事实源。

---

## 8. 服务端上下文

服务端必须自己加载数据，不相信前端提交整份简历。

冻结上下文包含：

```json
{
  "resumeId": "uuid",
  "resumeUpdatedAt": "ISO-8601",
  "evaluationSignature": "...",
  "jdSignature": "...",
  "targetRole": "...",
  "evaluation": {},
  "currentResume": {},
  "selectedSourceExperiences": {},
  "selectedMasterExperienceIds": [],
  "bankSuggestionCandidates": [],
  "factMetadata": [],
  "snapshotHash": "sha256"
}
```

事实来源优先级：

```text
本轮明确回答
> 当前简历明确文字
> 同一条已选经历的完整 ExperienceVersion
> 不使用其他经历改写当前经历
```

未选经历只参与 `bankSuggestionCandidates`。

---

## 9. AI 输出协议

### 9.1 变更

```json
{
  "changeId": "CHG_001",
  "issueIds": ["I003"],
  "dimension": "STAR应用",
  "moduleType": "experience_star",
  "moduleId": "master-experience-uuid",
  "fieldPath": "star.a",
  "actionKind": "rewrite_now",
  "scope": "general",
  "beforeValue": "参与支付页面改版",
  "generalValue": "参与支付页面改版，完成表单交互与异常状态处理",
  "targetedValue": "参与支付页面改版，完成表单交互与异常状态处理",
  "sourceRefs": [
    "/currentResume/experiences/master-experience-uuid/star/a",
    "/selectedSourceExperiences/master-experience-uuid/star/a"
  ],
  "introducedTerms": ["表单交互", "异常状态处理"],
  "rationale": "补足原文中已存在的具体行动并保持参与边界",
  "expectedScoreGain": 3,
  "defaultSelected": true
}
```

服务端添加：

```json
{
  "safetyStatus": "allowed",
  "safetyFindings": []
}
```

### 9.2 问题

```json
{
  "questionId": "Q001",
  "moduleId": "master-experience-uuid",
  "fieldPath": "responsibility",
  "text": "你负责整个支付模块，还是其中某几个页面？",
  "reason": "当前文本无法确定责任范围，不能直接使用“负责”或“主导”",
  "answerType": "single_choice_with_text",
  "choices": [
    {"value": "partial", "label": "负责部分页面或功能"},
    {"value": "whole", "label": "负责整个模块"},
    {"value": "assist", "label": "主要协助他人完成"},
    {"value": "not_my_work", "label": "不属于我的工作"}
  ],
  "affectsChangeIds": ["CHG_002"],
  "priority": 1
}
```

整份简历最多 5 个问题。模型可以返回 0 个问题。

### 9.3 经历库建议

由服务器确定性生成，不依赖改写模型：

```json
{
  "suggestionId": "BANK_001",
  "masterExperienceId": "uuid",
  "category": "project",
  "title": "校园电商产品项目",
  "org": "课程项目",
  "matchScore": 87,
  "reason": "包含用户调研和需求排序证据，可补强产品分析能力",
  "capabilities": ["用户研究", "需求分析"]
}
```

最多 3 条，不默认选中，不会自动应用。

---

## 10. 薄安全层

首发不等待完整语义 Harness，但以下规则属于硬门，不能仅依赖 Prompt。

### 10.1 来源引用

- 每个文本变更至少一个 `sourceRef`；
- `sourceRef` 只能指向冻结上下文或本轮回答；
- 无法解析的引用直接阻断该变更；
- 未选经历不能成为当前经历改写的来源。

### 10.2 数字保真

提取优化后新出现的所有数字表达。每个新数字必须能在允许来源中找到同值、同单位、同指标语境。

阻断示例：

```text
输入：完成三轮迭代
输出：效率提升 30%
```

允许示例：

```text
用户回答：处理时长从 4 分钟降至 2.5 分钟
输出：将平均处理时长由 4 分钟缩短至 2.5 分钟
```

### 10.3 责任等级

```text
assist/support
< participate/follow
< execute/complete/develop/analyse
< own/responsible
< lead/drive
```

输出等级不得高于允许来源最高等级。

### 10.4 因果等级

```text
时间先后
< 相关或共同贡献
< 明确贡献
< 直接导致
```

“上线后增长”不能改成“通过我的优化使其增长”。

### 10.5 工具和方法

- 比较 ASCII 技术 Token、缩写、CamelCase 标识；
- 比较受保护的方法词典，例如 A/B 测试、用户画像、竞品分析、漏斗分析、MVP、PRD、SQL、React；
- 模型必须报告 `introducedTerms`；
- 新术语必须出现在允许来源中；
- JD 本身不是候选人做过某事的证据。

### 10.6 阻断行为

某项变更失败时：

- 保留 `beforeValue`；
- `safetyStatus = "blocked"`；
- UI 显示原因；
- 其他安全变更继续；
- 不因为一个模块失败而丢弃整个 Run。

---

## 11. API

路由前缀：

```text
/api/resume-optimizations
```

使用 `BoundedAiRequestBodyRoute`、现有鉴权、现有 Billing Context 和现有流式 NDJSON 协议。

### 11.1 创建优化 Run

```http
POST /api/resume-optimizations/stream
Idempotency-Key: <uuid>
Content-Type: application/json
```

```json
{
  "resume_id": "uuid",
  "evaluation_signature": "...",
  "expected_resume_updated_at": "ISO-8601",
  "include_bank_suggestions": true
}
```

流事件节点：

```text
freeze_snapshot
prepare_context
plan_changes
verify_changes
persist_run
```

终态：

- `awaiting_answers`
- `preview_ready`

### 11.2 查询

```http
GET /api/resume-optimizations/{run_id}
GET /api/resume-optimizations/latest?resume_id=<uuid>
```

只返回当前用户拥有的 Run。

### 11.3 提交回答

```http
POST /api/resume-optimizations/{run_id}/answers/stream
```

```json
{
  "answers": [
    {
      "question_id": "Q001",
      "state": "answered",
      "value": "负责其中两个前端页面"
    },
    {
      "question_id": "Q002",
      "state": "no_data",
      "value": ""
    }
  ]
}
```

只允许改写 `affectsChangeIds` 涉及的模块。

### 11.4 应用

```http
POST /api/resume-optimizations/{run_id}/apply
```

```json
{
  "accepted_change_ids": ["CHG_001", "CHG_003"],
  "expected_resume_updated_at": "ISO-8601"
}
```

返回：

```json
{
  "run": {},
  "resume_updated_at": "ISO-8601",
  "applied_change_ids": ["CHG_001", "CHG_003"]
}
```

### 11.5 完成复评

```http
POST /api/resume-optimizations/{run_id}/finalize
```

服务端读取当前 `Resume.config.jdAnalysis.result.resumeEvaluation`，校验它对应应用后的简历签名，再保存前后分数与维度差值。

### 11.6 撤销

```http
POST /api/resume-optimizations/{run_id}/revert
```

只有当前内容签名仍等于 `applied_content_signature` 时才能撤销，避免覆盖用户后续手动编辑。

---

## 12. 样式与交互设计

### 12.1 报告入口

在有效六维报告主卡片中，放置主按钮：

```text
[魔棒图标] 根据报告优化
```

视觉：

- 绿色实心主按钮；
- 与“重新生成六维报告”的文字按钮区分；
- 过期时禁用并显示“请先重新生成六维报告”；
- 执行中显示 Spinner 和“正在准备优化方案”。

### 12.2 优化工作区

桌面：

```text
fixed inset-0 z-[100]
背景：slate-950/50 + backdrop-blur-sm
容器：max-w-6xl
高度：max-h-[min(900px,calc(100vh-32px))]
圆角：rounded-2xl
左侧步骤栏：220px
右侧主内容：flex-1
底部：sticky 操作区
```

移动端：

- 全屏；
- 顶部标题栏；
- 步骤改为横向可滚动 Chip；
- 底部按钮高度至少 44px；
- Diff 由双列改为上下排列。

步骤：

```text
1 优化方案
2 补充信息（无问题时隐藏）
3 对照确认
4 优化结果
```

### 12.3 颜色语义

| 颜色 | 含义 |
|---|---|
| emerald | 安全、可应用、完成、分数提升 |
| amber | 缺少证据、需要回答、仍待改进 |
| rose | 被安全策略阻断、风险、失败 |
| slate | 原文、保留、未选择、辅助信息 |
| indigo | 经历库机会和跳转一键组装 |

延续当前六维报告的圆角、轻渐变、低饱和边框和暗色模式。

### 12.4 优化概览

顶部指标：

- 可直接优化；
- 需要确认；
- 安全阻断；
- 经历库机会。

列表按 `expectedScoreGain` 降序，但必须标注维度和模块。

### 12.5 问题卡

包含：

- 问题；
- 为什么需要回答；
- 选择项；
- 可选文本输入；
- “没有数据 / 记不清 / 不属于我的工作 / 跳过”。

一次展示全部 1～5 个问题，避免聊天式多轮等待。

### 12.6 Diff 卡

每个变更卡：

```text
模块标题 + 六维维度 + 复用标签
修改前（slate）
修改后（emerald）
修改原因
来源标签
安全检查状态
勾选框 / 保留原文
```

标签：

- 通用优化；
- JD 定向；
- 来自补充信息；
- 从总经历补回；
- 安全阻断。

### 12.7 经历库建议

独立于 Diff：

- indigo 色调；
- 不带应用复选框；
- 显示匹配分、能力和原因；
- 按钮：“查看经历”“前往一键组装”。

### 12.8 结果页

显示：

- 优化前总分；
- 优化后总分；
- 分数差；
- 六维前后条形或紧凑雷达对比；
- 已解决问题数；
- 用户未提供的事实缺口；
- 被阻断的夸张改写数；
- 经历库机会数；
- “重试复评”；
- “撤销本次应用”。

不得把预测分数当最终分数。复评失败时显示“内容已应用，评分尚未完成”。

### 12.9 可访问性

- `role="dialog"`、`aria-modal="true"`；
- 打开后焦点到标题；
- 关闭后恢复到 CTA；
- Escape 在非应用阶段可关闭；
- `aria-live="polite"` 播报进度；
- 键盘可操作复选框、步骤和按钮；
- 支持 `prefers-reduced-motion`；
- 暗色模式保持对比度；
- 不以颜色作为唯一状态信息。

---

## 13. 计费与幂等

首发按现有 Token 机制计费：

- 创建优化方案：`entrypoint=resume_optimization_plan`；
- 回答后补写：`entrypoint=resume_optimization_answer`；
- 优化后评分：沿用 `resume_evaluation`；
- 查询、应用、撤销和 finalize 不调用模型，不额外计费。

`Idempotency-Key` 防止网络重试重复创建 Run 和重复模型计费。相同用户、相同 Key、不同请求 Hash 返回 409。

前端文案：

> 本次优化按实际模型用量消耗 Token，包含一轮事实补充和一次应用后复评。

---

## 14. 失败与恢复

| 场景 | 行为 |
|---|---|
| 简历在规划期间被修改 | Run 标记 `stale`，不生成可应用预览 |
| 六维报告过期 | 拒绝创建 Run |
| 模型返回结构错误 | 规范化失败并记录 `failed` |
| 单项安全检查失败 | 阻断该项，保留其他项 |
| 回答接口失败 | 保留 Run 和回答草稿，可重试 |
| 应用时版本冲突 | 返回 409，Run 标记 `stale` |
| 应用成功但复评失败 | Run 保持 `applied`，允许重试复评 |
| 用户刷新页面 | `GET latest` 恢复未完成 Run |
| 用户应用后手动编辑 | 禁止一键撤销旧 Run |
| 用户切换账号 | 中止前端流，不展示前一账号数据 |

---

## 15. 数据与安全

- 所有 Run 查询必须同时过滤 `user_id`；
- 服务端从数据库加载事实，不接受前端伪造 source snapshot；
- 不把完整简历写入应用日志；
- AI 错误日志只记录 request ID、状态和安全摘要；
- JSON 大小和文本长度使用现有 Runtime Budget；
- Run 保存的是简历内容，后续应增加保留期和用户删除策略；
- 删除简历时级联删除 Run；
- 未选经历完整内容不发给优化模型；
- 不在分析进度中暴露模型私有思维过程。

---

## 16. 分阶段发布

### Gate A：可收费首发

包含：

- 手动报告入口；
- Run 持久化；
- 四类问题路由；
- 当前简历 + 已选总经历上下文；
- 一轮问题；
- Diff 预览；
- 薄安全层；
- 事务应用；
- 一次复评；
- 结果与撤销；
- Token 计费；
- 功能开关与埋点。

达到 Gate A 即可上线。

### Gate B：通用优化稿复用

包含：

- `experience_optimization_artifacts`；
- 根据源版本 Hash 命中通用稿；
- 只重新生成 JD 特化层；
- 用户显式选择“使用通用优化稿作为当前简历基础”；
- 缓存命中和节省 Token 指标；
- 源经历更新时自然失效。

### Gate C：Evidence-constrained Writing Harness

包含：

- 持久 Evidence Ledger；
- Claim IR；
- Claim-to-Evidence 映射；
- 语义蕴含校验；
- 事实冲突和确认事件；
- 用户确认的新事实同步到新 ExperienceVersion；
- 统一供润色、六维评价、个人总结、Boss 招呼语和 Agent 使用；
- 最终评价继续引用生成前 Evidence，不从生成文本重新洗成事实。

---

## 17. 首发验收标准

1. 无有效六维报告时看不到可用优化入口。
2. 历史报告不能启动优化。
3. 创建 Run 后，即使刷新页面也能恢复。
4. 六维优化不改变经历、证书和技能的选中集合。
5. 未选经历不会成为当前经历改写来源。
6. 同一条已选经历的完整版本可以补回已有事实。
7. 最多提出 5 个问题。
8. `no_data` 不会产生占位数字或虚构指标。
9. 新数字、责任升级、新工具和新增直接因果会被服务器阻断。
10. 用户可以逐项取消变更。
11. 应用只写当前简历 override/config，不改总经历。
12. 应用使用 optimistic concurrency，冲突时不覆盖新内容。
13. 应用后只自动复评一次。
14. 结果分数来自用户实际接受后的简历。
15. 复评失败不回滚已经确认的文本。
16. 撤销不会覆盖应用后的用户手动编辑。
17. 每个 AI 调用进入现有 Token 用量记录。
18. 同一个幂等 Key 的网络重试不会重复计费。
19. 桌面、移动、暗色模式和键盘操作均可完成主流程。
20. 功能开关关闭时不影响现有六维报告、润色和一键组装。

---

## 18. 上线观察指标

核心漏斗：

```text
报告曝光
→ 优化 CTA 点击
→ 方案生成成功
→ 问题提交
→ 预览到达
→ 应用
→ 复评完成
→ 再次购买 Token
```

质量指标：

- 平均接受变更比例；
- 被安全层阻断比例；
- 用户选择 `no_data/unknown/not_my_work` 的比例；
- 优化前后六维分数变化；
- 用户应用后立即撤销比例；
- 经历库建议点击率；
- 通用稿未来命中率；
- 单 Run p50/p90 Token；
- 单 Run p50/p90 延迟；
- 409 stale 率；
- 模型结构修复率。

固定价格产品只在真实数据稳定后设计，至少参考 p50/p90 Token 成本、完成率、复评提升和退款/撤销率。
