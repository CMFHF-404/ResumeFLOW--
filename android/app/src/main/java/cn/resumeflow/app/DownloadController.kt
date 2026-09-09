package cn.resumeflow.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

/** One bounded transfer at a time. Temp data is private and deleted on every terminal path. */
class DownloadController(
    private val activity: Activity,
    restorePending: Boolean = false,
    private val pickDestination: (String, String) -> Unit
) {
    private data class Pending(val file: File, val name: String, val mime: String)
    private data class BlobTransfer(
        val id: String, val pending: Pending, val output: FileOutputStream,
        val expected: Long, var received: Long = 0
    )
    private val worker = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private val directory = File(activity.filesDir, "exports").apply { mkdirs() }
    private val store = PendingDownloadStore(directory)
    private var blob: BlobTransfer? = null
    private var pending: Pending? = null
    private var busy = false
    @Volatile private var closed = false
    private val timeout = Runnable { abortBlob(); toast(R.string.download_failed) }

    init {
        val restored = if (restorePending) store.restore() else null
        pending = restored?.let { Pending(it.file, it.name, it.mime) }
        busy = pending != null
        directory.listFiles()?.filter {
            it != pending?.file && (pending == null || it.name != "pending.properties")
        }?.forEach { it.delete() }
    }

    fun hasPendingDestination() = pending != null

    private fun chooseDestination(item: Pending) {
        try {
            store.save(PendingDownloadStore.Item(item.file, item.name, item.mime))
            pending = item
            pickDestination(item.name, item.mime)
        } catch (_: Exception) {
            store.clear()
            item.file.delete()
            pending = null
            busy = false
            toast(R.string.download_failed)
        }
    }

    private fun toast(resource: Int) {
        if (!closed) Toast.makeText(activity, resource, Toast.LENGTH_LONG).show()
    }
    private fun reply(proxy: JavaScriptReplyProxy, ok: Boolean) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
            runCatching { proxy.postMessage(JSONObject().put("ok", ok).toString()) }
    }
    private fun touchTimeout() {
        handler.removeCallbacks(timeout)
        handler.postDelayed(timeout, 30_000)
    }

    fun message(raw: String, proxy: JavaScriptReplyProxy) {
        if (closed) return
        try {
            require(raw.length <= 70_000)
            val data = JSONObject(raw)
            when (data.getString("type")) {
                "begin" -> {
                    if (busy) { toast(R.string.download_busy); reply(proxy, false); return }
                    val size = data.getLong("size")
                    require(DownloadPolicy.validSize(size))
                    val id = data.getString("id")
                    require(id.length in 1..80)
                    val item = Pending(File.createTempFile("export-", ".tmp", directory),
                        DownloadPolicy.fileName(data.optString("name")),
                        DownloadPolicy.mime(data.optString("mime")))
                    blob = BlobTransfer(id, item, FileOutputStream(item.file), size)
                    busy = true
                    touchTimeout()
                }
                "chunk" -> {
                    val current = requireNotNull(blob)
                    require(data.getString("id") == current.id)
                    val bytes = android.util.Base64.decode(data.getString("data"), android.util.Base64.NO_WRAP)
                    require(bytes.size <= DownloadPolicy.CHUNK_BYTES)
                    require(current.received + bytes.size <= current.expected)
                    current.output.write(bytes)
                    current.received += bytes.size
                    touchTimeout()
                }
                "end" -> {
                    val current = requireNotNull(blob)
                    require(data.getString("id") == current.id && current.received == current.expected)
                    current.output.close()
                    handler.removeCallbacks(timeout)
                    blob = null
                    chooseDestination(current.pending)
                }
                "abort" -> abortBlob()
                else -> error("Unknown transfer message")
            }
            reply(proxy, true)
        } catch (_: Exception) {
            abortBlob()
            toast(R.string.download_failed)
            reply(proxy, false)
        }
    }

    fun abortBlob() {
        handler.removeCallbacks(timeout)
        blob?.let {
            runCatching { it.output.close() }
            it.pending.file.delete()
            blob = null
            busy = false
        }
    }

    fun downloadHttps(url: String, disposition: String?, mime: String?, userAgent: String) {
        if (busy) { toast(R.string.download_busy); return }
        if (NavigationPolicy.origin(url) == null) { toast(R.string.download_failed); return }
        busy = true
        toast(R.string.download_preparing)
        // Only the site's cookie can accompany a site request. Never copy it to redirected hosts.
        val cookie = if (NavigationPolicy.isSite(url)) CookieManager.getInstance().getCookie(url) else null
        worker.execute {
            val file = File(directory, "${UUID.randomUUID()}.tmp")
            try {
                var target = URL(url)
                var connection: HttpURLConnection? = null
                for (redirect in 0..5) {
                    check(!closed)
                    require(NavigationPolicy.origin(target.toString()) != null)
                    val next = target.openConnection() as HttpURLConnection
                    next.connectTimeout = 20_000
                    next.readTimeout = 30_000
                    next.instanceFollowRedirects = false
                    next.setRequestProperty("User-Agent", userAgent)
                    if (cookie != null && NavigationPolicy.isSite(target.toString()))
                        next.setRequestProperty("Cookie", cookie)
                    val status = next.responseCode
                    if (status in listOf(301, 302, 303, 307, 308)) {
                        val location = next.getHeaderField("Location")
                        next.disconnect()
                        require(location != null && redirect < 5)
                        target = URL(target, location)
                    } else { connection = next; break }
                }
                val response = requireNotNull(connection)
                val result: Pending
                try {
                    require(response.responseCode in 200..299)
                    require(response.contentLengthLong <= DownloadPolicy.MAX_BYTES)
                    result = Pending(file, DownloadPolicy.fileName(URLUtil.guessFileName(
                        target.toString(), response.getHeaderField("Content-Disposition") ?: disposition,
                        response.contentType ?: mime)), DownloadPolicy.mime(response.contentType ?: mime.orEmpty()))
                    response.inputStream.use { input ->
                        file.outputStream().use { output ->
                            val buffer = ByteArray(48 * 1024)
                            var total = 0L
                            while (true) {
                                check(!closed)
                                val count = input.read(buffer)
                                if (count < 0) break
                                total += count
                                require(total <= DownloadPolicy.MAX_BYTES)
                                output.write(buffer, 0, count)
                            }
                        }
                    }
                } finally { response.disconnect() }
                handler.post {
                    if (closed) file.delete() else {
                        chooseDestination(result)
                    }
                }
            } catch (_: Exception) {
                file.delete()
                handler.post { busy = false; toast(R.string.download_failed) }
            }
        }
    }

    fun saveTo(uri: Uri?) {
        val item = pending ?: run {
            if (uri != null) {
                runCatching { DocumentsContract.deleteDocument(activity.contentResolver, uri) }
                toast(R.string.download_failed)
            }
            return
        }
        pending = null
        store.clear()
        if (uri == null) { item.file.delete(); busy = false; return }
        worker.execute {
            var saved = false
            try {
                require(uri.scheme == "content")
                activity.contentResolver.openOutputStream(uri, "w").use { output ->
                    requireNotNull(output)
                    item.file.inputStream().use { input -> input.copyTo(output) }
                }
                saved = true
            } catch (_: Exception) {
                runCatching { DocumentsContract.deleteDocument(activity.contentResolver, uri) }
            } finally { item.file.delete() }
            handler.post {
                busy = false
                if (!closed) {
                    if (!saved) toast(R.string.download_failed)
                    else AlertDialog.Builder(activity)
                        .setMessage(R.string.download_saved)
                        .setPositiveButton(R.string.download_open) { _, _ ->
                            try {
                                activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, item.mime)
                                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                            } catch (_: Exception) { toast(R.string.link_unavailable) }
                        }
                        .setNegativeButton(R.string.done, null).show()
                }
            }
        }
    }

    fun close(preservePending: Boolean = false) {
        closed = true
        abortBlob()
        if (!preservePending) { pending?.file?.delete(); store.clear() }
        pending = null
        worker.shutdownNow()
    }
}
