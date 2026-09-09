# 原子简历 Android

独立 Kotlin/WebView 工程。包名 `cn.resumeflow.app`，版本 `1.0.2`（versionCode 3），最低 Android 8/API 26，compile/target API 36。网站要求 Chrome/WebView 107 或更高版本；旧内核显示升级提示。

启动入口为 `https://resumeflow.preview.aliyun-zeabur.cn/`。2026-09-08 从线上入口脚本核验认证域名为 `https://stzo1l.logto.app`，回调为网站 `/callback`。页面随线上发布更新，APK 不打包网站、不修改后端 API。

## 构建

要求 Node.js（图标生成使用根工程的 sharp）、JDK 17/21、Android SDK platform 36 / build-tools 36.0.0。Windows 示例：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
# 首次为全新应用创建签名；已有签名必须复用，禁止重新生成
node android/tools/create-signing.mjs
# 根目录执行，产出正式 APK、校验清单
powershell -ExecutionPolicy Bypass -File android/tools/Build-Release.ps1
```

Gradle Wrapper 固定为 8.14.3，AGP 8.13.0，Kotlin 2.2.20。SDK 路径可写入未跟踪的 `android/local.properties`（`sdk.dir=C:/.../Android/Sdk`）。Linux/macOS 在 android 下执行 `sh gradlew testDebugUnitTest lintRelease assembleRelease`，再用 SDK 的 apksigner 验签。

正式包必须具备签名配置，否则 `packageRelease` 明确失败。测试包可使用 `gradlew assembleDebug`，包名 `cn.resumeflow.app.debug`，可与正式版共存；只有 debug 开启 WebView 调试。

## 长期签名与交付

`private/release-signing-backup/` 内有 PKCS12 密钥、`credentials.json` 及中文保管说明。该目录与 `signing.properties` 均被 Git 忽略。请将完整备份移交应用所有者的加密存储，不要随 APK 分发，也不要贴进日志或聊天。

恢复签名时，根据备份填写 `android/signing.properties`：

```properties
storeFile=private/release-signing-backup/resumeflow-release.p12
keyAlias=resumeflow-release
storePassword=从备份读取
keyPassword=从备份读取
```

CI 可使用 `RF_ANDROID_KEYSTORE`、`RF_ANDROID_KEY_ALIAS`、`RF_ANDROID_STORE_PASSWORD`、`RF_ANDROID_KEY_PASSWORD` 覆盖。密码只通过环境或忽略文件读取，不作为命令行参数。更新 APK 必须沿用包名和签名，并同步递增 app/build.gradle.kts 的 versionCode/versionName 及交付脚本文件名。

交付 APK 和 `SHA256SUMS.txt` 位于 `artifacts/`。签名备份独立交付；不包含应用商店上架或自动发布。

## 页面行为

- 无地址栏、无标题栏；白色状态栏保留时间电量。原生容器处理 systemBars/displayCutout/IME，网页区域不重复应用安全区。支持旋转和三键/手势导航。
- 网站、精确认证 origin 和支付 origin `https://www.yifut.com` 在应用内打开，支付表单保留原始 POST 和签名字段；其余 HTTPS 页面交给系统浏览器。支付 origin 必须与服务端及前端 CSP 的 `YIFUT_BASE_URL` 一致，变更支付域名时同步更新 `NavigationPolicy.PAYMENT`。支付页不获得下载桥接。HTTP、file、intent、自定义协议及带用户信息的 URL 被阻止。不关闭 TLS 校验，不开放全盘存储。
- 开启 JavaScript、DOM storage、一方 Cookie；登录状态保留。第三方 Cookie 默认关闭。第三方社交 OAuth 若禁止嵌入式登录，需要独立原生 OAuth 方案，不能以放开域名或禁用校验替代。首版验收以现有 Logto 登录方式为准。
- 返回优先收起键盘，再回退网页历史，最后退出。旋转保留 WebView，进程重建恢复可恢复的历史；未保存的网页编辑内容仍受网站保存机制约束。
- 上传使用 ACTION_OPEN_DOCUMENT；下载使用 ACTION_CREATE_DOCUMENT，保存后可交给已安装的文件查看器打开。取消不会显示成功提示。
- 网站 Blob 下载脚本由壳注入，保留 createObjectURL 对应的原始 Blob 以避免触发网站 CSP，随 revokeObjectURL 释放引用；WebMessageListener 仅暴露给网站 origin，原生还核验主框架及当前页面。48 KiB 分块、逐块确认、30 秒传输超时、64 MiB 上限；导出文件位于应用私有 files 目录；打开系统保存选择器前持久化待保存文件信息，进程重建时恢复。取消、完成或退出流程后清理。
- 较旧 WebView 不支持安全 WebMessageListener 时明确提示升级 Android System WebView/Chrome，不退回全局 JavaScriptInterface。Android OS 版本合格仍需保持 WebView 更新。
- HTTPS 下载最长 5 次重定向、20 秒连接超时、30 秒读取超时，跨域不传网站 Cookie。带 Bearer 授权的简历导出仍由网站现有请求取得 Blob，再交壳保存。
- 加载提示保持到 React 根节点或认证页面实际出现内容；加载出错或主页面加载超时显示重试及首页按钮。网络恢复后由用户重试；支付页失败时返回网站，在订单记录中确认状态后继续付款，不把原支付 POST 改成 GET 重试。

## 图标

Android 图标源为 `artwork/logo-mark.svg`，按网站 R 的几何轮廓重建为矢量。运行 `node android/tools/generate-icons.mjs` 生成各密度 PNG、原生 VectorDrawable 自适应前景及 `artifacts/icon-1024.png`。1.0.1 将自适应 R 从 62 dp 缩至 48 dp，传统图标 R 从 32 dp 缩至 26 dp，保留纯白背景。网站原图不变。

## 测试

```powershell
node --test android/tests/downloads.test.mjs
cd android
.\gradlew.bat testDebugUnitTest lintRelease assembleRelease assembleDebug assembleDebugAndroidTest
# 启动目标模拟器后；ANDROID_SERIAL 指定目标设备
$env:ANDROID_SERIAL = 'emulator-5556'
.\gradlew.bat connectedDebugAndroidTest
```

单元测试覆盖 URL/origin、桥接来源、下载文件名/大小和 Blob 分块/失败。设备测试覆盖实际 WebView 设置、安全区、桥接注入隔离。在线登录、真实账号 PDF 导出、系统文件选择、网络切换、桌面图标、旋转及覆盖升级需额外设备验证。证据边界与当次结果见 `QA.md`，不能用静态测试或模拟页面代替在线账号验收。

官方参考：[WebView 安全区](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)、[WebViewCompat](https://developer.android.com/reference/androidx/webkit/WebViewCompat)。
