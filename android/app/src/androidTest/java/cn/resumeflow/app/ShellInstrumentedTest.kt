package cn.resumeflow.app

import android.content.Intent
import android.graphics.Color
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.junit.Assert.*
import org.junit.Test
import org.junit.Assume.assumeTrue
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class ShellInstrumentedTest {
    @Test fun webViewSettingsAndSafeArea() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            scenario.onActivity { activity ->
                val web = activity.webView
                assertTrue(web.settings.javaScriptEnabled)
                assertTrue(web.settings.domStorageEnabled)
                assertFalse(web.settings.allowFileAccess)
                assertEquals(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW, web.settings.mixedContentMode)
                val insets = ViewCompat.getRootWindowInsets(activity.window.decorView)
                assertNotNull(insets)
                val safe = insets!!.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                val position = IntArray(2)
                web.getLocationOnScreen(position)
                assertTrue("Web content must start below status/cutout", position[1] >= safe.top)
                assertTrue("Left cutout must be avoided", position[0] >= safe.left)
            }
        }
    }

    @Test fun siteMainFrameGetsBridgeButForeignOriginDoesNot() {
        assumeTrue(BrowserPolicy.supportsVersion(WebView.getCurrentWebViewPackage()?.versionName))
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                activity.webView.loadDataWithBaseURL(NavigationPolicy.HOME,
                    "<html><body>Android integration fixture</body></html>","text/html","UTF-8",null)
            }
            var value = ""
            repeat(40) {
                val latch = CountDownLatch(1)
                scenario.onActivity { activity ->
                    activity.webView.evaluateJavascript("typeof window.ResumeFlowDownload") { value=it; latch.countDown() }
                }
                assertTrue(latch.await(3, TimeUnit.SECONDS))
                if (value == "\"object\"") return@repeat
                Thread.sleep(100)
            }
            assertEquals("\"object\"", value)
            scenario.onActivity { activity ->
                activity.webView.loadDataWithBaseURL("https://example.com/",
                    "<html><body>Foreign origin</body></html>","text/html","UTF-8",null)
            }
            Thread.sleep(500)
            val latch = CountDownLatch(1)
            scenario.onActivity { activity ->
                activity.webView.evaluateJavascript("typeof window.ResumeFlowDownload") { value=it;latch.countDown() }
            }
            assertTrue(latch.await(3, TimeUnit.SECONDS))
            assertEquals("\"undefined\"", value)
        }
    }
}
