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
