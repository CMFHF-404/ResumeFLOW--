# 六维证据评分 v3

工程版本：`resume_score_v3` / `evidence_rubric_v1`，提示词 `resume_evidence_prompt_v2`，岗位指南 `early_career_roles_v1`。

后续v4实现、灰度开关、专属量表与推理档位实验见 [v4说明](v4.md)。v3继续作为历史和默认证据版本保留。

### 2026-09-12 引用校验修复

合成简历的真实模型调用复现了合法 JSON 被拒绝的情况：模型在观察项和建议的 `sourceRefs` 中同时引用简历与 JD，旧校验却只允许简历来源。现在对已知的混合引用做确定性分类：简历证据留在 `sourceRefs`，岗位参照保存为可选 `jdSourceRefs`；界面分别标注“简历原文/已检查范围”和“岗位要求（JD，非简历事实）”。观察项、亮点与建议仍必须引用至少一个简历来源，不接受不存在的来源，也不允许 JD 单独证明经历。历史 v3 缺少可选字段仍可读取，评分公式和量表版本不变。

失败日志增加处理阶段、异常类型、函数及行号，不记录简历或模型原文。先完成真实账户输入的本地 mock 回放和合成简历的模型验证；自动审批最初阻止了真实简历重评，用户随后明确授权。

授权后的首次验证发现旧后端热重载未完成，实际请求仍由旧进程处理。重启本地后端后，账户重评成功：页面和数据库均为 `resume_score_v3` / `evidence_rubric_v1`，提示词 `resume_evidence_prompt_v2`，六维总分 92、独立 JD 匹配 85%，自动保存完成且 `evaluationIsOutdated=false`。这证明当前账户的生成与保存链路可用，不代表人审质量校准完成。

## 当前交付与边界

- 已实现：岗位/求职阶段/日期输入、八项审阅、18 个证据观察项、服务端加权、引用目录、诊断与亮点、报告与选中模块优化衔接。
- 六维权重依次为 15/25/10/15/10/25，后端以整数档位加权后统一四舍五入。前端不重新计算总分；无额外封顶。
- 求职阶段保存在简历 `config.careerStage`，不是全局个人资料。未指定时省略快照 `career_stage`，保持旧快照兼容。显式阶段参与评估签名、配置变化失效和后端优化上下文校验，不改变独立 JD 匹配分。
- `needsFacts` 的建议必须先追问或保持原文；已回答的目标最多一次批量改写。删除整段、前置经历和只读模块为手动建议。引用校验只检查结构和有效来源，不充当语义审核。
- v2 报告及已生成方案保留原版本阅读、应用和撤销；v3 开关启用后，v2 报告必须复评才可生成新方案。回滚时对应恢复 v2 新方案入口。
- 当前没有作者确认的 32 份简历及两名 HR 的独立标注。真实模型对照、人审阈值、认证应用和物理设备验收均未完成。测试 JSON 是合成工程夹具，不能作为质量达标证据。

## 开关与切换

默认关闭新链路，现有 v2 保持运行。先部署支持两版协议的前后端代码，完成开发集与独立留出集验收后，再设置：

```text
后端 ENABLE_EVIDENCE_RESUME_SCORE=true
前端构建 VITE_ENABLE_EVIDENCE_RESUME_SCORE=true
```

前端开关已接入根 Dockerfile 的 ARG → ENV → Vite 构建。修改运行时变量不能改变已构建页面；正式启用仍需检查服务实际返回版本、已部署 JS 和登录后的报告/优化入口。现有优化总开关继续独立生效。

回滚时关闭上述两项并重新构建前端；历史 v3 报告仍可读，既有方案仍可应用/撤销，生成新方案需按当前启用规则复评。不迁移历史分数，也不自动发起评分。

## 质量校准工具

从仓库根目录运行。输出目录在 `.gitignore` 中，不能把真实简历和人审记录放进工程夹具目录。

```powershell
python -B backend/evaluate_evidence_score.py scaffold .artifacts/evidence-calibration
python -B backend/evaluate_evidence_score.py validate .artifacts/evidence-calibration/manifest.json
```

scaffold 创建32份基础样本的版本2清单，不编造简历：产品、技术、财务、运营各4份，数据分析、行业研究各8份，各方向均衡覆盖两阶段及开发/留出分组。旧四方向清单保持可读。每份 A 原始、B 仅润色、C 补清贡献、D 补清成果都属于同一个分组。作者需准备各输入 JSON 并将该基础样本 `authorConfirmed` 设为 true。缺文件、未确认、错分组、跨组复用输入均验证失败。

每个输入为 `{"snapshot": <前端完整评估快照>, "jd": "完整正文或空字符串"}`。应保留反例：已有百分比但口径不全、无百分比但已验收、在读未来毕业时间、团队贡献、正确术语、缺 JD 和无图片。只向 provider 传当前可见 resume，经历库不会成为评分证据。

以下命令调用真实提供方并消耗用量；工具不初始化数据库、不运行服务端应用。固定当前模型与推理设置，先跑开发集，再冻结提示词/量表/指南，用留出集验收。

```powershell
python -B backend/evaluate_evidence_score.py run .artifacts/evidence-calibration/manifest.json --version v3 --live --split dev --output .artifacts/evidence-calibration/v3-dev.jsonl
python -B backend/evaluate_evidence_score.py run .artifacts/evidence-calibration/manifest.json --live --split dev --baseline --output .artifacts/evidence-calibration/v2-dev.jsonl
python -B backend/evaluate_evidence_score.py run .artifacts/evidence-calibration/manifest.json --version v3 --live --split holdout --output .artifacts/evidence-calibration/v3-holdout.jsonl
python -B backend/evaluate_evidence_score.py run .artifacts/evidence-calibration/manifest.json --live --split holdout --baseline --output .artifacts/evidence-calibration/v2-holdout.jsonl
python -B backend/evaluate_evidence_score.py summarize .artifacts/evidence-calibration/v3-holdout.jsonl
```

每条命令 16 基础样本 × 四变体 × 三次 = 192 次单次请求；四组共 768 次。不覆盖已有结果；失败也写记录，不静默重试。记录实际版本、输入 hash、成功/失败、耗时和提供方 usage。

两名岗位方向 HR 独立标注后讨论分歧，保留原始标注与最终 adjudication。按 `adjudication.example.json` 填写两名不同审阅者、每次运行的人审计数及每个基础样本的质量顺序。`resultHash` 和 `manifestHash` 使用对应文件的 SHA-256；`resolved=true` 表示分歧已处理。

```powershell
Get-FileHash .artifacts/evidence-calibration/manifest.json -Algorithm SHA256
Get-FileHash .artifacts/evidence-calibration/v3-holdout.jsonl -Algorithm SHA256
python -B backend/evaluate_evidence_score.py summarize .artifacts/evidence-calibration/v3-holdout.jsonl --annotations .artifacts/evidence-calibration/adjudication.json
```

hash 填写小写十六进制。计数字段：`expectedHigh` 为人审高优先级总数、`truePositiveHigh` 为命中、`falsePositiveHigh` 为误报；`importantDiagnostics/correctSources` 衡量重要诊断来源；`shouldKeep/incorrectlyChanged` 衡量误改保留内容；`severeErrors` 包括无依据新增事实、跨模块错引和无图评视觉。

汇总给出成功率、P50/P95、平均 token、usage 覆盖率及评分辅助指标。当前采用建议优先策略：高优先级召回/准确率≥90%、来源正确率≥95%、建议可执行率≥90%、误改保留内容≤5%、严重错误为零。标注需提供 `reviewedDiagnostics` 与 `actionableDiagnostics`；缺少可执行性标注时不宣称通过。分数极差、纯润色提分及梯度排序只作观察，梯度标注可省略。没有人审、样本不完整或必要分母为零时不能显示通过，不把降分当成改进证据。

## 工程验证

```powershell
node --test tests/evidenceResumeScore.test.mjs tests/evidenceResumeScore.browser.test.mjs tests/resumeScore.test.mjs tests/resumeEvaluationSnapshot.test.mjs
npx tsc --noEmit --pretty false
npm run build
```

在 `backend/`：

```powershell
python -B -m unittest test_evidence_resume_score test_evidence_score_evaluation test_resume_score test_resume_service test_resume_optimization_context test_resume_optimization_apply test_resume_optimization_finalize
```

另运行受影响的评分执行、JD 刷新/取消、优化保存屏障、方案再生成、配置保存与部署结构回归。浏览器测试实际挂载生产报告组件，在 1280×1000 和 390×844 下检查优先问题、原文依据、档位展开、可选/手动动作、旧报告禁用及横向溢出。设置 `EVIDENCE_SCREENSHOT_DIR` 可留存截图；这不代表认证应用或真机验收。
