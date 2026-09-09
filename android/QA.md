# Android 1.0.2 修复版打包

- 包名 `cn.resumeflow.app`，versionCode 3，versionName 1.0.2。
- 包含支付 POST 跳转、支付错误恢复及文件选择期间进程重建的待保存文件恢复修复。
- `testDebugUnitTest` 9 项、`lintRelease`、`assembleRelease` 通过；Lint 使用既有 `.qa/local-lint.init.gradle` 本地依赖配置。
- APK v2 验签通过，证书与 1.0.1 一致；产物 `artifacts/resumeflow-1.0.2-release.apk`，173087 字节。
- SHA-256：`8db92ef3126010364efa1bc958d5bcf301c10a2547afc54c4d1ce18facab8e68`。
- 本次未进行设备覆盖安装、真实支付或设备进程回收恢复验收。下方为历史版本记录。

# Android 1.0.1 图标更新

- R 尺寸：自适应前景 62 → 48 dp（缩小约 23%）；传统图标 32 → 26 dp（缩小约 19%）。
- 改用 SVG 几何轮廓生成资源，自适应前景和 Android 12+ 启动画面使用原生 VectorDrawable；附带 1024×1024 白底 PNG。
- versionCode 2 / versionName 1.0.1，保留原发布签名；Lint 与 release 构建通过，apksigner 校验通过，Android 16 模拟器覆盖安装成功。
- APK 171367 字节；校验：

`472303d2a2172c1652597472ec52b4d801f737592d0d519dea24fc41ebc59afd  resumeflow-1.0.1-release.apk`

以下为上一版历史验证记录，功能验收边界继续适用。

# Android 1.0.0 验证记录

日期：2026-09-08。按用户后续要求，最终收敛为基础烟测，账号登录后的完整验收停止。本记录不代表全部原始验收项或真机已通过。

## 最终交付

- `artifacts/resumeflow-1.0.0-release.apk`，258731 字节，包名 `cn.resumeflow.app`，versionCode 1，versionName 1.0.0。
- SHA-256：`14885aacd607e8bff89e770edec1a6d9a871dd9e892f10d3950d32972029e338`。
- RSA 4096 长期发布签名，APK v2 验证成功；发布证书 SHA-256：`73803385b4d53f92acd8a5cb4b5787d720794d4b2664b960d4c488470f846324`。
- 签名备份为 `private/release-signing-backup/`，独立于 APK，已确认被 Git 忽略。不要随 APK 对外分发。

## 已通过

| 检查 | 结果与证据 |
| --- | --- |
| Kotlin/JVM 单元测试 | 4/4，URL、来源隔离、文件约束、旧内核策略；`app/build/test-results/testDebugUnitTest/` |
| 下载脚本测试 | 5/5，包含 CSP 禁止 Blob fetch 的回归、原始字节分块、外部来源、iframe、失败和取消；`node --test tests/downloads.test.mjs` |
| 最终构建与 Lint | `testDebugUnitTest lintRelease assembleRelease assembleDebug` 成功，Lint 0 错误（11 条建议警告）；`smoke-fix-build.log` |
| APK 签名 | apksigner verify 成功，`artifacts/qa/signature-verification.txt` |
| Android 16 正式包 | 首次安装、同签名覆盖安装、线上首页显示、顶部状态栏及底部手势区；正式包未启用 WebView 调试 |
| 挖孔/横屏 | Android 16 开启系统 hole 模拟后，内容左侧避让 136 px、顶部 63 px，横屏页面可见，无摄像头遮挡；`artifacts/qa/release-hole-landscape.png` |
| 原生 PDF 保存 | Android 16 调试包，最终下载脚本在实际站点 origin/CSP 下传输测试 PDF，系统 ACTION_CREATE_DOCUMENT 保存中文文件名成功 |
| 文件完整性 | 测试 PDF 605 字节，源文件与从模拟器拉回的文件 SHA-256 均为 `0d4de8e766425d12bb13a15ffac16d1a745abee921ef3fe39aacbd32d4430798`；不是已登录账号的真实简历导出 |
| 登录入口 | Android 16 前期设备检查中，网站按钮在壳内打开 `stzo1l.logto.app/sign-in`；未输入账号或密码 |
| 设备结构测试 | Android 15/16 各 2 项通过，覆盖实际 WebView 配置、安全区和桥接 origin；记录在 `artifacts/qa/instrumentation-5560.txt`、`instrumentation-5556.txt`。这组运行在最后两项烟测修复之前；修复后另跑最终构建、脚本回归和上述现场烟测 |

## 烟测修复

1. 不再以 HTML 导航提交当作网页就绪：加载提示保持到 React 根节点或认证页面有实际内容，35 秒超时显示重试。
2. 网站 CSP 不允许 `fetch(blob:)`。壳在 document start 保留 `URL.createObjectURL` 对应的原始 Blob，随 revoke 释放，通过来源限制的消息通道逐块保存，不修改网站 CSP。先复现回归测试失败，再修复至 5/5，并验证系统保存后的文件哈希。

## 限制与未验收

- Android 8 镜像内置 Chrome 69，无法解析当前网站。首版要求 Chrome/WebView 107+，旧内核走升级提示；Android 8 现代内核下的完整网站流程未验收。该设备结构测试中来源桥接测试因旧内核跳过。
- Android 15 的后续交互检查遭遇模拟器系统进程无响应及蓝牙组件崩溃，未将其当作 APP 崩溃。关闭该测试设备后，将最后一轮文件烟测转到 Android 16。
- 登录后回跳、登录持久化、退出与账号中心、真实简历 PDF 导出、上传选择、键盘全流程、断网恢复矩阵及真机未完成。按用户要求不继续扩大验收。
- 不包含广告归因、渠道深链、推送、商店上架或线上发布。
- `.qa/` 和 `artifacts/` 为本地忽略目录，截图、镜像、私有测试数据不进入源码提交。

## 本机依赖下载说明

首次 Java 构建需获得已安装 SDK 的访问权限。Lint 的 kotlin-compiler 31.13.0 下载曾停滞，改从 Google 官方 Maven 分段下载并核验官方 SHA-1，通过 `.qa/local-lint.init.gradle` 指向该本地文件完成验证；工程自身仍使用标准 Google/Maven Central 仓库。JDK 使用 Android Studio bundled JBR 21，SDK 36 / build-tools 36.0.0。
