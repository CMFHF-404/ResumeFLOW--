# 浏览器 Agent 页面约定

适用于主应用、游客预览及共用弹窗。所有操作继续使用用户界面原有的处理函数、认证、确认和保存流程；这些标记不提供额外执行权限。

## 定位与操作

- 优先使用角色和可访问名称，例如 `getByRole('navigation', { name: '主导航' })`、`getByRole('textbox', { name: '姓名', exact: true })`。先限定当前页面、面板、弹窗或条目，再定位其中的操作。
- 页面容器的 `data-agent-page` 使用现有视图值：`DASHBOARD`、`EXPERIENCE_BANK`、`EDITOR`、`AI_ASSISTANT`。导航按钮通过 `aria-current="page"` 表示当前页。
- 重复条目的 `data-agent-item` 使用已有简历、经历、会话或模板 ID。同名条目须按 ID 区分；ID 只在所在页面／集合内解释，不能把简历经历项 ID 当作经历库主记录 ID。
- `data-agent-action` 描述操作，例如 `open-resume`、`resume-actions`、`select-template`、`send-message`、`export-pdf`。部分标记在条目子控件上；不要假设它们全局唯一。
- 控件上的 `aria-pressed`、`aria-expanded`、`aria-current`、`aria-readonly`、原生 `disabled` 表达现有状态。日期触发器提供字段名称和 `data-agent-value`；打开后操作月份选项或已有清除／至今按钮。
- 具有独立点击区域的卡片标题和日期触发器支持 Enter／Space。子按钮的键盘激活不会额外触发卡片操作。
- 文件上传仍使用原文件选择器；隐藏的文件 input 具备名称，但默认可访问树不显示它，应从上传按钮打开文件选择器。模板、模块排序和头像裁剪继续使用原有拖拽交互与拖拽目标，不新增键盘排序协议。

## 状态与隐藏内容

- 优先在命名弹窗中操作；`data-agent-dialog` 可辅助区分共用弹窗。保留现有取消、关闭及危险操作确认规则。只有原本具备模态行为的弹窗才声明 `aria-modal`。
- 保存状态、Toast 和字段错误使用 `status`／`alert`。`aria-busy` 表达相关区域或动作正在处理；不能把按钮点击成功视为保存或下载完成。
- 滑出视口的工厂面板、关闭的侧栏和测量预览保持挂载，并从可访问树与键盘焦点序列中排除。简历缩略图不重复暴露全文。响应式副本通过现有 CSS 控制可见性；应选择当前可见的控件。
- 标记不复制密钥、简历全文、请求内容或隐藏用户资料。共享控件的 `id`、`labelledBy`、`describedBy` 仅用于名称和描述关联，React 生成的关联 ID 不是持久定位接口。

## 验证

`node --test tests/agentFriendly.browser.test.mjs` 使用真实组件、模拟认证和 HTTP 响应，覆盖角色／名称操作、同名条目、重命名校验、资料保存、附件、富文本、日期、键盘事件、忙碌状态、模板与模拟 PDF 下载。测试拦截外部请求，不连接真实账户或模型服务。下载验证检查页面到浏览器下载的链路，不验证服务端 PDF 排版。

视觉基线应在修改前运行 `node tests/helpers/captureAgentBaseline.mjs --capture`，脚本输出临时目录。修改后在 PowerShell 中设置 `$env:AGENT_VISUAL_BASELINE` 为该目录，再运行浏览器测试。矩阵覆盖四个页面、游客预览、重命名和确认弹窗，包含 1440／390 像素视口及明暗主题。固定时间、字体并关闭动画；仅容忍单个颜色通道 1 级的栅格化舍入差异，不更新基线来掩盖布局变化。

补充运行受影响的既有回归测试、`npx tsc --noEmit --pretty false`、`npm run build` 和 `git diff --check`。模拟浏览器结果不代表真实登录、Android 设备、在线模型、真实 PDF 服务或生产部署验收。

### 本次验证记录（2026-09-11）

- 改造基线：`6157f3d`，原组件打包结果在修改前保存；视觉对比使用同一模拟数据、固定时间与字体。
- 新增的 7 个浏览器操作场景及 28 组视觉对比通过；截图仅允许前述 1 级颜色通道舍入误差。
- 首组既有回归检查 131 项中 130 项通过；额外的桌面工作区、优化无障碍和移动浏览器检查 40 项通过（含与首组重复的移动检查）。类型、构建及差异检查通过。
- 唯一既有失败：`experienceTabToolbarStructure.test.mjs` 仍断言三栏布局包含 `xl:flex xl:w-[460px]`。直接读取 `6157f3d` 中的测试与源文件运行，同样失败；本轮保留现有侧栏尺寸，仅增加隐藏侧栏的语义隔离。
