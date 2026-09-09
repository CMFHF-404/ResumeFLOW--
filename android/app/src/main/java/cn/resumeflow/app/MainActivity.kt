package cn.resumeflow.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : ComponentActivity() {
    internal lateinit var webView: WebView
        private set
    private lateinit var container: FrameLayout
    private lateinit var overlay: LinearLayout
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private lateinit var retry: Button
    private lateinit var home: Button
    private lateinit var downloads: DownloadController
    private val handler = Handler(Looper.getMainLooper())
    private var uploadCallback: ValueCallback<Array<Uri>>? = null
    private var failed = false
    private var committed = false
    private var navigationGeneration = 0
    private var checkingContent = false
    private var rendererGone = false
    private var retryUrl = NavigationPolicy.HOME
    private var documentStartScript = false
    private val pageTimeout = Runnable { if (!committed) showError() }
    private val popupViews = mutableSetOf<WebView>()
    private val uploadPicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = uploadCallback
        uploadCallback = null
        val data = if (result.resultCode == Activity.RESULT_OK)
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
                ?.filter { it.scheme == "content" }?.toTypedArray()?.takeIf { it.isNotEmpty() }
        else null
        callback?.onReceiveValue(data)
    }
    private val savePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (::downloads.isInitialized) downloads.saveTo(
            if (result.resultCode == Activity.RESULT_OK) result.data?.data else null)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.decorView.setBackgroundColor(Color.WHITE)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            window.isNavigationBarContrastEnforced = false
            window.isStatusBarContrastEnforced = false
        }
        buildLayout()
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(safe.left, safe.top, safe.right, maxOf(safe.bottom, keyboard.bottom))
            // Native owns all safe areas. Web content must not apply the same insets again.
            WindowInsetsCompat.CONSUMED
        }
        downloads = DownloadController(this, savedInstanceState?.getBoolean("download_pending") == true) { name, mime ->
            try {
                savePicker.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mime
                    putExtra(Intent.EXTRA_TITLE, name)
                })
            } catch (_: Exception) { downloads.saveTo(null); toast(R.string.picker_unavailable) }
        }
        configureWebView()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val insets = ViewCompat.getRootWindowInsets(container)
                when {
                    insets?.isVisible(WindowInsetsCompat.Type.ime()) == true ->
                        WindowCompat.getInsetsController(window, container).hide(WindowInsetsCompat.Type.ime())
                    webView.canGoBack() -> webView.goBack()
                    else -> finish()
                }
            }
        })
        if (!BrowserPolicy.supportsVersion(WebView.getCurrentWebViewPackage()?.versionName) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            showUpdateRequired()
            return
        }
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null)
            webView.loadUrl(NavigationPolicy.HOME)
    }

    private fun buildLayout() {
        container = FrameLayout(this).apply { setBackgroundColor(Color.WHITE) }
        webView = WebView(this).apply {
            id = View.generateViewId()
            setBackgroundColor(Color.WHITE)
        }
        container.addView(webView, FrameLayout.LayoutParams(-1, -1))
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            contentDescription = getString(R.string.loading)
        }
        container.addView(progress, FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP))
        overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.WHITE)
            setPadding(dp(24), dp(24), dp(24), dp(24))
            isClickable = true
        }
        overlay.addView(ImageView(this).apply {
            setImageResource(R.mipmap.ic_launcher_foreground)
            contentDescription = getString(R.string.app_name)
        }, LinearLayout.LayoutParams(dp(120), dp(120)))
        status = TextView(this).apply {
            setText(R.string.loading); textSize = 16f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(65, 75, 70))
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        overlay.addView(status, LinearLayout.LayoutParams(-1, -2))
        retry = Button(this).apply {
            setText(R.string.retry); visibility = View.GONE
            setOnClickListener { webView.loadUrl(NavigationPolicy.retryDestination(retryUrl)) }
        }
        home = Button(this).apply {
            setText(R.string.home); visibility = View.GONE
            setOnClickListener { webView.loadUrl(NavigationPolicy.HOME) }
        }
        overlay.addView(retry)
        overlay.addView(home)
        container.addView(overlay, FrameLayout.LayoutParams(-1, -1))
        setContentView(container)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true // System document picker grants content:// access for uploads.
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            mediaPlaybackRequiresUserGesture = true
            useWideViewPort = true
            loadWithOverviewMode = true
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "ResumeFlowDownload", setOf(NavigationPolicy.SITE)) {
                _, message, sourceOrigin, isMainFrame, reply ->
                if (NavigationPolicy.acceptsBridge(sourceOrigin.toString(), isMainFrame, webView.url.orEmpty()))
                    message.data?.let { downloads.message(it, reply) }
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(webView, downloadScript(), setOf(NavigationPolicy.SITE))
                documentStartScript = true
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return NavigationPolicy.origin(request.url.toString()) == null
                return route(request.url.toString(), false)
            }
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                downloads.abortBlob()
                if (NavigationPolicy.destination(url) != NavigationPolicy.Destination.INTERNAL) {
                    view.stopLoading(); route(url, false); return
                }
                retryUrl = url
                navigationGeneration++
                checkingContent = false
                failed = false
                committed = false
                status.setText(R.string.loading)
                retry.setText(R.string.retry)
                retry.visibility = View.GONE
                home.visibility = View.GONE
                overlay.visibility = View.VISIBLE
                progress.visibility = View.VISIBLE
                handler.removeCallbacks(pageTimeout)
                handler.postDelayed(pageTimeout, 35_000)
            }
            override fun onPageCommitVisible(view: WebView, url: String) {
                if (!documentStartScript && NavigationPolicy.isSite(url)) view.evaluateJavascript(downloadScript(), null)
                ensureContentReady()
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (!documentStartScript && NavigationPolicy.isSite(url)) view.evaluateJavascript(downloadScript(), null)
                ensureContentReady()
                if (!documentStartScript && NavigationPolicy.isSite(url)) view.evaluateJavascript(downloadScript(), null)
                CookieManager.getInstance().flush()
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showError()
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame && response.statusCode >= 400) showError()
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                if (error.url == view.url) showError()
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // A dead renderer cannot be reused. Recreate the activity and restore the last trusted URL.
                rendererGone = true
                recreate()
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, value: Int) {
                progress.progress = value
                if (value == 100 || failed) progress.visibility = View.GONE
            }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                uploadCallback?.onReceiveValue(null)
                uploadCallback = callback
                try {
                    val types = params.acceptTypes.flatMap { it.split(',') }.map { it.trim() }
                        .filter { it.isNotBlank() }.mapNotNull {
                            if (it.startsWith('.')) MimeTypeMap.getSingleton().getMimeTypeFromExtension(it.drop(1))
                            else it.takeIf { type -> type.contains('/') }
                        }.distinct()
                    uploadPicker.launch(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = types.singleOrNull() ?: "*/*"
                        if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    })
                } catch (_: Exception) {
                    uploadCallback = null
                    callback.onReceiveValue(null)
                    toast(R.string.picker_unavailable)
                }
                return true
            }
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                if (!isUserGesture) return false
                val popup = WebView(this@MainActivity)
                popupViews.add(popup)
                var handled = false
                fun open(url: String) {
                    if (handled || url == "about:blank") return
                    handled = true
                    route(url, true)
                    handler.post { popupViews.remove(popup); popup.destroy() }
                }
                popup.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        open(request.url.toString()); return true
                    }
                    override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                        view.stopLoading(); open(url)
                    }
                }
                (resultMsg.obj as WebView.WebViewTransport).webView = popup
                resultMsg.sendToTarget()
                handler.postDelayed({ if (popupViews.remove(popup)) popup.destroy() }, 10_000)
                return true
            }
            override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity).setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
                    .setOnCancelListener { result.cancel() }.show()
                return true
            }
        }
        webView.setDownloadListener { url, agent, disposition, mime, _ ->
            if (!NavigationPolicy.isSite(webView.url.orEmpty())) { toast(R.string.link_unavailable); return@setDownloadListener }
            if (url.startsWith("blob:")) toast(R.string.update_webview)
            else downloads.downloadHttps(url, disposition, mime, agent)
        }
    }

    private fun route(url: String, newWindow: Boolean): Boolean = when (NavigationPolicy.destination(url)) {
        NavigationPolicy.Destination.INTERNAL -> {
            if (newWindow) webView.loadUrl(url)
            newWindow
        }
        NavigationPolicy.Destination.EXTERNAL -> {
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)) }
            catch (_: Exception) { toast(R.string.link_unavailable) }
            true
        }
        NavigationPolicy.Destination.BLOCKED -> { toast(R.string.link_unavailable); true }
    }
    private fun ensureContentReady() {
        if (failed || committed || checkingContent) return
        checkingContent = true
        probeContent(navigationGeneration)
    }
    private fun probeContent(generation: Int) {
        if (generation != navigationGeneration || failed || isDestroyed) return
        // HTML navigation commit does not mean the React application has rendered.
        webView.evaluateJavascript("(function(){var r=document.getElementById('root');return !!(r ? r.children.length : document.body && document.body.innerText.trim().length);})()") { result ->
            if (generation != navigationGeneration || failed || isDestroyed) return@evaluateJavascript
            if (result == "true") {
                committed = true
                checkingContent = false
                overlay.visibility = View.GONE
                handler.removeCallbacks(pageTimeout)
            } else handler.postDelayed({ probeContent(generation) }, 250)
        }
    }
    private fun showUpdateRequired() {
        status.setText(R.string.browser_update_required)
        retry.setText(R.string.browser_update)
        retry.visibility = View.VISIBLE
        retry.setOnClickListener {
            val provider = WebView.getCurrentWebViewPackage()?.packageName ?: "com.google.android.webview"
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$provider"))) }
            catch (_: Exception) { toast(R.string.link_unavailable) }
        }
        home.setText(R.string.browser_recheck)
        home.visibility = View.VISIBLE
        home.setOnClickListener { recreate() }
        progress.visibility = View.GONE
        overlay.visibility = View.VISIBLE
    }
    private fun showError() {
        failed = true
        handler.removeCallbacks(pageTimeout)
        val payment = NavigationPolicy.isPayment(retryUrl)
        status.setText(if (payment) R.string.payment_load_failed else R.string.load_failed)
        retry.setText(if (payment) R.string.home else R.string.retry)
        retry.visibility = View.VISIBLE
        home.visibility = View.VISIBLE
        overlay.visibility = View.VISIBLE
        progress.visibility = View.GONE
    }
    private fun downloadScript() = assets.open("downloads.js").bufferedReader().use { it.readText() }
    private fun toast(resource: Int) = Toast.makeText(this, resource, Toast.LENGTH_LONG).show()
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("download_pending", downloads.hasPendingDestination())
        if (!rendererGone) webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }
    override fun onPause() {
        if (!rendererGone) webView.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }
    override fun onResume() { super.onResume(); if (::webView.isInitialized) webView.onResume() }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        uploadCallback?.onReceiveValue(null)
        uploadCallback = null
        downloads.close(preservePending = !isFinishing)
        popupViews.forEach { it.destroy() }
        popupViews.clear()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }
}
