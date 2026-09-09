package cn.resumeflow.app

import java.net.URI

/** Exact HTTPS origins only. Never trust suffix matching or a URL substring. */
object NavigationPolicy {
    const val SITE = "https://resumeflow.preview.aliyun-zeabur.cn"
    const val HOME = "$SITE/"
    const val AUTH = "https://stzo1l.logto.app"
    // Keep the configured checkout origin in this WebView: sending only its URL
    // to ACTION_VIEW would discard the signed POST form. This grants no bridge access.
    const val PAYMENT = "https://www.yifut.com"
    enum class Destination { INTERNAL, EXTERNAL, BLOCKED }

    fun origin(url: String): String? = runCatching {
        val uri = URI(url)
        if (!uri.scheme.equals("https", true) || uri.rawUserInfo != null ||
            uri.host.isNullOrEmpty() || (uri.port != -1 && uri.port != 443)) null
        else "https://${uri.host.lowercase()}"
    }.getOrNull()

    fun isSite(url: String) = origin(url) == SITE
    fun isPayment(url: String) = origin(url) == PAYMENT
    fun retryDestination(url: String): String = when {
        isPayment(url) -> HOME
        destination(url) == Destination.INTERNAL -> url
        else -> HOME
    }
    fun destination(url: String): Destination = when (origin(url)) {
        SITE, AUTH, PAYMENT -> Destination.INTERNAL
        null -> Destination.BLOCKED
        else -> Destination.EXTERNAL
    }

    fun acceptsBridge(source: String, mainFrame: Boolean, page: String): Boolean =
        mainFrame && isSite(source) && isSite(page)
}
