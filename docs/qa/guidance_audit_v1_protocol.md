# guidance_audit_v1 验收协议

该协议验收一份可审计的改进指导，不验收旧版数值评分。正常产品请求只允许一次语义判断和一次独立审核；审核失败、结构失败、连接失败或取消均不触发第三次语义生成，也不发布参考结论。

## 冻结输入与运行边界

`backend/qa_guidance_audit.py` 在准备时重建十份匿名合成样本：基础语料的 `R7K2`、`R2M9`、`R8P4`、`R3V6`，旧留出集的 `H4Q1`、`H9S2`，以及 v3/v4 留出生成器的 `N6D2`、`N4T8`、`P5L2`、`P8C6`。它不读取未完成的 v4 接受波作为输入。

每个新标签会冻结样本、预期缺陷键、协议、相关服务和测试代码哈希，以及不含密钥的运行配置指纹。输入、协议、代码或路由配置任一变化，都必须使用新的纯字母数字标签。每次逻辑尝试使用独占文件名；失败也是证据，不能覆盖或重试筛除。

`run` 子命令只调用评估服务，不创建测试用户、不授予额度、不写数据库，也不执行 HTTP apply/finalize。`check` 是只读配置检查；`prepare` 只创建本次冻结证据目录；`run`、`rewrite`、`quality` 与 `probe` 会按各自下述边界调用配置的 AI 提供方。外部通知必须关闭。

## 调用与发布断言

每一份 `evaluation-<sample>-<repeat>.json` 都必须保留核心诊断：

- `generation/attempt` 恰好一次，随后为 `generation/generated` 或失败类别；
- `rubric_audit/attempt` 恰好一次，随后为 `rubric_audit/reviewed`、拒绝或失败类别；
- 发布成功时恰好一条 `publication/approved`，并且报告含审核回执。

公开报告必须是 `guidance_audit_v1`，包含固定等级、六维状态、问题和建议。递归检查禁止 `score`、`subscore`、`pointsNotEarned` 等评分字段；唯一允许的数值兼容字段是独立 JD 匹配 `jdMatch`。审核回执及内部任务依据仅用于优化器和 QA 绑定，不向用户展示。

`--transaction-batch-size` 的单位是完整逻辑事务。它绝不会只启动生成而把对应审核留到下一批；已写入失败记录不再自动调用。

## 三次稳定性与指标

十份样本各执行三次，一次出与完整服务成功率的固定分母为 30 个逻辑请求。生成或审核失败、结构拒绝、超时、取消和提供方错误均保留并计入该分母。报告至少包括：一次出/完整服务成功率、审核调用尝试和成功率、安全指导获准率、错误类别、P50/P95/最大总耗时。

一次出率与完整服务成功率按全部 30 个逻辑请求计算；审核调用成功率按实际进入审核的请求计算。安全指导获准率以已收到合法审核结果且实际含建议（`guidance.type != none`）的任务为分母，不能用没有建议的正常任务稀释风险；该指标表示模型审核的判断，不等于独立内容质检已经确认安全。

只有同一样本三次都成功发布时才评价稳定性：整体等级三次一致；每个六维状态最多相邻波动一级；三个最高优先项中至少两个内部 `taskId` 全部重复；公共任务的“可直接整理”与“需要补充信息”分类一致。若任一重复本身不足两项优先项，不制造问题来满足重叠阈值，标为 `not_applicable_fewer_than_two`；其余条件满足时状态为 `consistent_with_fewer_than_two_priorities`，不能称为严格 `stable`。少于三次成功必须标为 `insufficient_successes`，不能声称语义稳定。

十份样本必须继续覆盖强对照、空泛行动、夸大表达、定性成果、句末标点、结果遗漏、观察期/归因限制和禁止编造数字或高级职责的边界。冻结缺陷键不得传给生成器或审核器。

## 匿名指导与文本盲评

`probe` 是独立的盲评输出契约预检：使用一份明确不作为产品结论的空指导和同一文本的两份拷贝，检查两类评审是否按完整 Schema 返回。它先校验冻结清单，保留成功或失败及合成原始响应，同标签不重试；不生成评估报告，不写 `finished.json`，也不计入产品一次出率、指导质量或文本偏好。正式 `quality` 仍必须等全部 30 次产品事务完成。

`quality` 是独立的真实提供方验收，不能混入上述 30 次产品请求，也不会改写简历。它只在 30 次产品事务全部结束后运行，并使用同一冻结运行配置调用匿名评审。每份首次成功发布的指导都会与其来源一起接受检查：建议是否准确、可执行、安全，是否要求不必要的高级职责，或诱导新增事实。相同调用还携带该样本所有已发布重复报告的随机匿名别名，专门判断是否存在相互矛盾的建议；别名不含分数、重复序号或前后阶段。三份成功报告齐全且匿名评审明确 `contradictoryAdvice=false` 前，不得给该样本标记 `semantically_consistent`。所有没有可发布指导、提供方失败和结构失败都保留记录。

先运行 `rewrite`。它从对应 `evaluation-*.json` 的私有审核回执重建内部指导依据，将审核回执、内部任务和来源绑定交给生产的 `qa_resume_blind_direct.direct()` 路径。该路径执行真实的 `plan_resume_optimization`、`review_plan_semantics` 和 `verify_plan_changes`，只采用 `rewrite_now` 且 `allowed` 的改写；所有补充问题保持未回答，绝不作为新事实写入。候选记录保留完整 changes、questions、safety、accepted 与回执绑定，供后续盲评核对。该步骤不经 HTTP apply/finalize、不写数据库，也不改变用户可见的指导报告；无可接受改写时允许保留原文候选。

随后 `quality` 将原文/候选随机化为匿名标识，交给独立文本盲评员比较；评审检查重复、句末标点、无来源事实、职责夸大和因果夸大，并给出候选较好、原文较好或平局。高质量且无需修改的对照应保持平局或不产生虚假优先项。所有没有可发布指导、改写/盲评提供方失败和结构失败都必须保留记录。

## 命令

在 `backend/` 中，先运行离线检查：

```powershell
python -B -m unittest test_qa_guidance_audit
python -B qa_guidance_audit.py check
```

获得真实提供方调用许可后，使用一个从未使用的新标签：

```powershell
python -B qa_guidance_audit.py prepare --run-tag guidanceaudit20260907a
python -u -B qa_guidance_audit.py probe --run-tag guidanceaudit20260907a
python -u -B qa_guidance_audit.py run --run-tag guidanceaudit20260907a --transaction-batch-size 1
python -u -B qa_guidance_audit.py rewrite --run-tag guidanceaudit20260907a --rewrite-batch-size 1
python -u -B qa_guidance_audit.py quality --run-tag guidanceaudit20260907a --quality-batch-size 1
python -B qa_guidance_audit.py summarize --run-tag guidanceaudit20260907a
```

重复 `run` 会只处理尚未有记录的完整逻辑事务。开始真实调用前，必须确认本地配置指向获准的提供方、通知关闭，并保留 `run-manifest.json` 与全部失败记录。
