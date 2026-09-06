# Design QA — 斜方框标题卡片补充验收

## 验收范围

- 本轮只验收用户指出的两处标题卡片：`艺术气息` 全部章节标题，以及 `杂志编辑` 左栏的 `资格证书 / 掌握技能` 标题。
- 不把两边样例简历的姓名、头像、正文内容与章节顺序差异计入本轮卡片几何验收。
- 其余 26 款模板以及这两款的其他版式细节不在本轮 `passed` 结论内。

## Source visual truth

- 艺术气息：[源图](docs/design-qa/deephire/19-artistic-source.png)
- 杂志编辑：[源图](docs/design-qa/deephire/23-magazine-editorial-source.png)

## Browser-rendered implementation

- 艺术气息：[浏览器实渲染](docs/design-qa/deephire/19-artistic-rendered.jpg)
- 杂志编辑：[浏览器实渲染](docs/design-qa/deephire/23-magazine-editorial-rendered.jpg)
- 浏览器视口：`1699 × 828`；可见 A4 预览根节点：约 `691.64 × 978.17`。
- 状态：已登录的真实 ResumeFLOW 简历；分别切换到两款目标模板完成检查，结束后恢复为用户原先的 `accent-emerald`。

## Comparison evidence

- 全视图同图对照：
  - [艺术气息全视图对照](docs/design-qa/deephire/19-artistic-full-comparison.png)
  - [杂志编辑全视图对照](docs/design-qa/deephire/23-magazine-editorial-full-comparison.png)
- 聚焦卡片同图对照：
  - [艺术气息卡片对照](docs/design-qa/deephire/19-artistic-focus-comparison.png)
  - [杂志编辑卡片对照](docs/design-qa/deephire/23-magazine-editorial-focus-comparison.png)
- 聚焦对照是必要的：全页缩放后，5–10 px 的斜切量和圆角无法可靠判断。

## Comparison history

### Iteration 0 — blocked

- `[P2] 艺术气息`：产品标题是直角矩形；竞品是约 `-10°`、两边同向倾斜的圆角平行四边形，且标题文字保持正向。
- `[P2] 杂志编辑`：产品左栏仍是绿色小方块加文字；竞品左栏是只有右边斜切的绿色标题卡。右栏不应被卡片化。

### Fixes

- 艺术气息：语义标题元素使用 `skewX(-10deg)`，标题文字反向 `skewX(10deg)`；颜色校准为 `#213558`，圆角 `5px`，未缩放尺寸约 `118.72 × 36.29px`。
- 杂志编辑：只作用于 `.rf-template-sidebar`；右侧单边切角 `5px`，颜色 `#3EB97F`，未缩放尺寸 `97 × 32px`，隐藏左栏方形 marker；右栏透明标题、方块 marker 与横线保持不变。

### Iteration 1 — passed

- 聚焦同图对照确认两款卡片的倾斜方向、尺寸、颜色、圆角/切角与文字方向均无剩余 P0/P1/P2 差异。
- 全视图确认所有艺术气息章节标题统一应用斜卡；杂志编辑只在左栏应用斜卡，没有污染右栏标题系统。

## Required fidelity surfaces

- 字体与排印：两款均为 `18px` 粗体；艺术气息保留白色斜体并对文字反向校正，杂志编辑保留白色正体。
- 间距与节奏：艺术气息 `6px 18px`，杂志编辑 `5px 13px 5px 12px`；实渲染尺寸与竞品量取一致。
- 颜色：艺术气息 `#213558`；杂志编辑 `#3EB97F`。
- 图像与资产：本轮对象是语义标题卡组件，不需要替换或伪造图片资产；竞品源图和浏览器产物均以原始截图参与对照。
- 文案：对照使用相同章节名 `教育经历` 与 `掌握技能`；正文 fixture 差异不影响卡片验收。

## Runtime and interaction checks

- 真实交互依次验证 `艺术气息 → 杂志编辑 → accent-emerald`，每次都校验 A4 根节点的 `data-rf-template-id`。
- 浏览器中 `vite-error-overlay = 0`、`alertdialog = 0`；Vite HMR 终端没有本轮 CSS 更新错误。
- 自动化：14 项相关 Node 测试通过，TypeScript 检查通过，生产构建通过。

## Findings

- 本轮验收范围内无剩余 P0/P1/P2；无开放问题。

## Final result

passed

---

# Design QA — AI 布局与内嵌优化对照

## 验收范围

- 桌面顶部三档布局分段控件、列表 / 三栏 / AI 三种宽度关系。
- 分析报告右栏与优化右栏的切换、优化侧栏的步骤条、独立滚动区和粘性操作区。
- 经历 STAR 字段内黄色“原内容”与绿色“优化后”卡片，以及右栏逐项采用控件。
- 移动端继续使用全屏优化模态；Dashboard、打印和 PDF 不注入审阅卡。

## Source visual truth

- DeepHire 布局参考：用户在本会话提供的截图附件（未纳入仓库；本地临时副本不作为可审计链接）。
- 参考范围仅为顶部三档布局、中央简历与右栏的信息层级，不复制竞品品牌、素材或颜色体系。

## Browser-rendered implementation

- 实际编辑器：`http://localhost:5173/`
- 固定数据对照入口（仅开发环境）：`http://localhost:5173/__dev/resume-template-preview?templateId=modern-slate&optimizationReview=1`
- 桌面视口：`1355 × 792`；移动验收视口：`390 × 844`，结束后已恢复默认桌面视口。
- 对照方式：将用户提供的竞品截图与本轮 Codex In-app Browser 实渲染截图同时作为视觉依据，分别检查控件位置、栏宽比例、信息层级、颜色语义与卡片密度。

## Comparison history

### Iteration 0

- 顶部只有独立 AI 按钮，无法表达三种布局状态。
- 桌面优化使用居中模态，遮挡编辑器和简历上下文。
- 优化方案只在工作区展示，简历原位置没有字段级前后对照。
- 新方案沿用服务端 `defaultSelected`，不能保证全部待确认。

### Iteration 1 — passed

- 顶部使用等宽三段图标控件，位置、密度和选中态与参考图层级一致，同时沿用 ResumeFLOW 的翡翠绿与 Slate 视觉语言。
- 三栏布局同时保留编辑栏、A4 和 `390px` 右栏；AI 布局将左栏动画收至 `0`，并将右栏扩展至 `460px`，提升长文本与操作区的可读性。
- 分析报告默认三栏；恢复已有优化 Run 后自动进入 AI 布局，右栏不再生成遮罩或锁定页面。
- 固定数据预览确认同一经历的行动 A、结果 R 按顺序显示黄色原文与绿色优化稿，未选中时明确标记“保留原文”。
- 右栏显示“可直接优化 / 需要确认 / 安全阻断 / 经历库机会”四项计数，并按简历内容中的出现顺序列出建议；两项建议初始均为保留原文，底部为禁用的“应用已接受的 0 项”。选择一项后计数变为 1，方向键返回原文后恢复为 0。

## Required fidelity surfaces

- 布局：桌面 `list / triple / ai` 三态互斥；三栏右栏保持 `390px`，AI 模式右栏为 `460px` 且左栏从可见宽度收至 `0`。
- 排印：沿用现有字号、字重、圆角与间距；优化侧栏在窄宽中采用纵向对照，避免双列文本过度压缩。
- 颜色：原文使用 Amber，优化稿与采用操作使用 Emerald；暗色模式下均保持可读对比。
- 文案：使用中文明确标签和状态；不展示或按服务端 `expectedScoreGain` 排序，最终效果以应用后的六维复评为准。
- 资产：布局按钮使用现有 Lucide 图标库，没有伪造或新增品牌素材。

## Runtime and interaction checks

- 桌面依次验证列表 → 三栏 → AI；关闭普通右栏回到列表。
- 打开分析报告进入三栏；恢复已有 Run 进入 AI 布局且左栏从可访问树移除。
- 在优化审阅态按左方向键先安全关闭工作区、保留 Run，再进入三栏并打开 AI 助理；“返回优化方案”可恢复同一 Run，不调用外部 AI。
- 布局控件和逐项二选一均通过方向键验证；焦点随选中项移动。
- 暗色模式实渲染通过；移动端全屏模态、步骤条、底部操作区和页面锁定保持有效。
- 两个浏览器页面均无 `error` / `warn` 日志。
- 结构与 SSR 回归覆盖编辑器专用注入边界；PDF 数据快照仍直接从真实简历数据构建，打印 scope 不渲染优化卡。

## Findings

- 本轮验收范围内无剩余 P0/P1/P2。
- 现有 Run 停留在补充问题阶段，因此未提交答案、未批量应用，也未执行真实复评；黄绿对照与逐项选择使用开发环境固定数据验证，没有消耗 AI Token 或改动真实简历。

## Final result

passed
