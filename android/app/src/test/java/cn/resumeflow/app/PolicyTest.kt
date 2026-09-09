package cn.resumeflow.app

import org.junit.Assert.*
import org.junit.Test

class PolicyTest {
    @Test fun failedPaymentReturnsToTheSiteInsteadOfReplayingThePostAsGet() {
        assertEquals(NavigationPolicy.HOME,
            NavigationPolicy.retryDestination("https://www.yifut.com/api/pay/submit"))
        assertEquals(NavigationPolicy.HOME,
            NavigationPolicy.retryDestination("https://www.yifut.com:443/api/pay/submit"))
        val ordinaryPage = "${NavigationPolicy.SITE}/?tab=resumes"
        assertEquals(ordinaryPage, NavigationPolicy.retryDestination(ordinaryPage))
        assertEquals(NavigationPolicy.HOME, NavigationPolicy.retryDestination("https://evil.com"))
    }

    @Test fun paymentPostStaysInWebViewWithoutReceivingTheDownloadBridge() {
        val payment = "https://www.yifut.com/api/pay/submit"
        assertEquals(NavigationPolicy.Destination.INTERNAL, NavigationPolicy.destination(payment))
        assertEquals(NavigationPolicy.Destination.INTERNAL,
            NavigationPolicy.destination("https://www.yifut.com:443/api/pay/submit"))
        assertFalse(NavigationPolicy.acceptsBridge("https://www.yifut.com", true, payment))
        assertFalse(NavigationPolicy.acceptsBridge(NavigationPolicy.SITE, true, payment))
        assertEquals(NavigationPolicy.Destination.EXTERNAL,
            NavigationPolicy.destination("https://www.yifut.com.evil.com/api/pay/submit"))
        assertEquals(NavigationPolicy.Destination.BLOCKED,
            NavigationPolicy.destination("http://www.yifut.com/api/pay/submit"))
        assertEquals(NavigationPolicy.Destination.BLOCKED,
            NavigationPolicy.destination("https://www.yifut.com:8443/api/pay/submit"))
    }

    @Test fun oldOrUnknownBrowserShowsUpgradeInsteadOfBlankPage() {
        assertFalse(BrowserPolicy.supportsVersion("69.0.3497.100"))
        assertFalse(BrowserPolicy.supportsVersion(null))
        assertFalse(BrowserPolicy.supportsVersion("unknown"))
        assertTrue(BrowserPolicy.supportsVersion("107.0.0.0"))
        assertTrue(BrowserPolicy.supportsVersion("138.0.0.0"))
    }
    @Test fun trustedOriginsAreExactAndHttpsOnly() {
        assertEquals(NavigationPolicy.Destination.INTERNAL, NavigationPolicy.destination(NavigationPolicy.HOME))
        assertEquals(NavigationPolicy.Destination.INTERNAL, NavigationPolicy.destination("${NavigationPolicy.AUTH}/oidc/auth?state=x"))
        assertTrue(NavigationPolicy.isSite("${NavigationPolicy.SITE}:443/callback?code=x"))
        assertFalse(NavigationPolicy.isSite("${NavigationPolicy.SITE}.evil.com/"))
        assertFalse(NavigationPolicy.isSite("${NavigationPolicy.SITE}@evil.com/"))
        assertFalse(NavigationPolicy.isSite("${NavigationPolicy.SITE}:8443/"))
        listOf("http://example.com", "javascript:alert(1)", "file:///sdcard/x", "intent://x", "data:text/html,x", "https://x@stzo1l.logto.app/")
            .forEach { assertEquals(it, NavigationPolicy.Destination.BLOCKED, NavigationPolicy.destination(it)) }
        assertEquals(NavigationPolicy.Destination.EXTERNAL, NavigationPolicy.destination("https://example.com/"))
    }
    @Test fun bridgeRejectsFramesAndAuthenticationPages() {
        assertTrue(NavigationPolicy.acceptsBridge(NavigationPolicy.SITE, true, NavigationPolicy.HOME))
        assertFalse(NavigationPolicy.acceptsBridge(NavigationPolicy.SITE, false, NavigationPolicy.HOME))
        assertFalse(NavigationPolicy.acceptsBridge(NavigationPolicy.AUTH, true, NavigationPolicy.HOME))
        assertFalse(NavigationPolicy.acceptsBridge(NavigationPolicy.SITE, true, NavigationPolicy.AUTH))
    }
    @Test fun downloadNamesAndLimitsAreSafe() {
        assertEquals("简历_张三.pdf", DownloadPolicy.fileName("简历/张三.pdf"))
        assertFalse(DownloadPolicy.fileName("../../x\u0000.pdf").contains('/'))
        assertEquals("原子简历文件", DownloadPolicy.fileName("..."))
        assertEquals("application/pdf", DownloadPolicy.mime("application/pdf; charset=utf-8"))
        assertEquals("application/octet-stream", DownloadPolicy.mime("invalid\nheader"))
        assertTrue(DownloadPolicy.validSize(0)); assertTrue(DownloadPolicy.validSize(DownloadPolicy.MAX_BYTES))
        assertFalse(DownloadPolicy.validSize(-1)); assertFalse(DownloadPolicy.validSize(DownloadPolicy.MAX_BYTES+1))
    }
}
