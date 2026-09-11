# 单页与自然续页实现及验收

实施日期：2026-09-11。实施起点：`d79777d7103114c794c7f3dc19de1c296effdaca`，不是方案所列的历史基线。

## 实现范围

1. `resumePageGeometry` 定义固定 A4 CSS 像素容量，安全余量 2 px、测量误差 0.1 px。测量从页眉、有效模块和明确正文流标记开始，包含后代溢出、外边距和双栏底部内边距；背景和撑高容器不增加容量。编辑器缩放按固定纸张宽度换算回内部单位。
2. 简历打印壳内的模块和条目允许跨页，短标题保护与后文的连接，正文与列表控制孤行。经历库全局 `.rf-break-avoid` 保持原样。富文本继续经过原有净化器；嵌套列表保留标记。双栏姓名允许换行，防止覆盖头像。
3. 字体和图片加载/解码、两次布局帧和 DOM 稳定性共用有截止时间、可取消的资源等待。智能排版最终提交后再次测量；内容、账号、模板、手动布局或密度变化使旧运行失效。历史 applied 状态仅用于恢复 UI；本次验证单独绑定内容和布局。最终异步收尾完成后才恢复自动保存/空闲状态。导出等待空闲、检查是否有新运行，并取最新提交的快照。
4. 快照可选携带 `pageConstraint: { maxPages: 1 }`。仅当前版本成功拟合时附加；普通多页快照不受限。后端用 pypdf 检查真实页数，在认领成功缓存落库前以及缓存命中/恢复返回前执行。超限返回 422、`PDF_PAGE_COUNT_MISMATCH`、`actualPages`、`maxPages` 和可读消息；失败释放认领。直接、owned、legacy 路径均覆盖。浏览器先切换 print media 再加载页面，并注入共享剩余截止时间；现有 50 ms 等待未删除。
5. 增加真实组件 PDF 夹具及失败对照。测试不依赖账号、不调用模型、不修改数据库。

## 本地验证

以下已执行：

- 几何边界、智能排版生命周期、下载账号隔离、错误文件拒绝、快照安全、预览调度和布局恢复相关 Node 测试 22 项通过；预览模块路由回归 2 项通过。
- 后端 72 项：页数、HTTP 21 种路径/页数组合、HTTP 兼容、浏览器资源/生命周期、快照契约、租约认领和通用 PDF 字节校验。
- Chromium 151.0.7922.34 的 13 个真实组件场景全部通过。
- 系统 Edge 152.0.4191.66 的同一组 13 个场景全部通过。
- TypeScript 检查、Vite 生产构建及 `git diff --check`。
- 额外的富文本安全测试在系统 Edge 上 6 项通过；默认完整 Chromium 可执行文件在本机存在但启动报 `spawn UNKNOWN`，因此使用测试已支持的可执行路径覆盖变量，无需修改测试断言。

13 个场景包含：13 个有符号临界高度；固定容量不随 2000 px 根节点增长；普通、双栏、时间线的短内容单页和超长富文本；长侧栏；冷字体、延迟图片与取消；页底标题；安全边界真实一页；无列表、有序和无序列表的自然续页。15 行正文逐行及全文比较，有序编号跨页连续。恢复旧 avoid 规则的对照 PDF 必须把正文开头移出第一页。

PDF 页数来自 pypdf。文本比较保留顺序并作空白与 Unicode NFKC 规范化，避免字体 ToUnicode 兼容部首映射造成误报。Poppler 渲染每一页 PNG，代表性双栏、时间线、长列表、标题边界页面已人工查看。

## 重跑

根目录：

```powershell
node --test tests/resumePageGeometry.test.mjs tests/resumePaginationPolicy.test.mjs tests/resumeSmartPageLifecycle.test.mjs tests/exportOwnerIsolation.test.mjs tests/resumePdfSecurity.test.mjs tests/previewMeasurementScheduler.test.mjs tests/resumeEditorSmartPageLayoutPersistence.test.mjs
node tools/qa-resume-pagination.mjs
npx tsc --noEmit --pretty false
npm run build
```

`backend/`：

```powershell
python -B -m unittest test_resume_pdf_page_constraint test_resume_pdf_constraint_http.ResumePdfConstraintHttpTests test_export_http_compatibility test_browser_pdf_service test_export_snapshot_contract test_export_snapshot_claims test_export_pdf_payload
```

夹具使用已有 esbuild、Tailwind、React 组件，经本地 Vite 页面加载。每个场景使用独立测试进程和浏览器，避免 Windows 本地打印/关闭等待互相影响。PDF 使用 Chromium `Page.printToPDF` 直接取字节，避免本机 Playwright 文件流写出停滞；这不是后端 HTTP 渲染端到端证明。需要系统可用的 `python`/pypdf 和 `pdftoppm`。输出位于已忽略的 `artifacts/resume-pagination/`，可用 `PAGINATION_CASE` 单独运行一个场景，用 `PAGINATION_BROWSER` 指定浏览器。

系统浏览器示例：

```powershell
$env:PAGINATION_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node tools/qa-resume-pagination.mjs
```

## 发布闸门边界

### 本地开发导出超时补充修复

导出资源白名单遗漏根目录 `/types.ts`，导致 Vite 模块被 `ERR_BLOCKED_BY_CLIENT` 拦截，页面无法挂载，最后耗尽 45 秒。现已加入同源精确路径，测试覆盖带时间戳查询的模块请求、相似路径拒绝和跨域拒绝。

新增 `python -B ../tools/qa-resume-export-runtime.py`（从 `backend/` 运行）。它在真实本地 Vite 页面上调用正式后端渲染函数，仅将快照接口替换为合成简历，不操作数据库或真实账号。修复后实测 2.57 秒生成一页 PDF；相关后端回归 39 项通过。这补充了打包组件夹具未覆盖的开发模块加载路径，仍不等同于真实账号 HTTP 下载全链路验收。

未发布、未提交。未连接部署环境，也未验证真实登录账号切换、完整认证应用中的自动保存/撤销、物理设备或真实后端浏览器 HTTP 渲染。

后端 Dockerfile 运行 `playwright install chromium`，依赖为 `playwright>=1.53`，无法仅从仓库确定已部署浏览器版本。发布前需在实际部署镜像中重跑夹具，并验证真实账号的调整中导出/切换账号及下载全链路。本地 DOM 或 mock HTTP 测试不能替代这些验收；2 px 余量也不是跨所有浏览器的通用保证。
