package cn.resumeflow.app

object DownloadPolicy {
    const val MAX_BYTES = 64L * 1024 * 1024
    const val CHUNK_BYTES = 48 * 1024
    fun fileName(raw: String): String = raw
        .replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_")
        .trim().trim('.').take(180).ifBlank { "原子简历文件" }
    fun mime(raw: String): String = raw.substringBefore(';').trim()
        .takeIf { Regex("[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+").matches(it) }
        ?: "application/octet-stream"
    fun validSize(size: Long) = size in 0..MAX_BYTES
}
