package cn.resumeflow.app

import java.io.File
import java.io.FileOutputStream
import java.util.Properties

/** Private durable handoff to ACTION_CREATE_DOCUMENT, independent of the Activity. */
class PendingDownloadStore(private val directory: File) {
    data class Item(val file: File, val name: String, val mime: String)
    private val metadata = File(directory, "pending.properties")

    fun save(item: Item) {
        require(item.file.canonicalFile.parentFile == directory.canonicalFile && item.file.isFile)
        val properties = Properties().apply {
            setProperty("file", item.file.name)
            setProperty("name", item.name)
            setProperty("mime", item.mime)
            setProperty("size", item.file.length().toString())
        }
        val temporary = File(directory, "pending.new")
        FileOutputStream(temporary).use { output -> properties.store(output, null); output.fd.sync() }
        check(temporary.renameTo(metadata)) { "Cannot persist pending download" }
    }

    fun restore(): Item? = runCatching {
        val properties = Properties().apply { metadata.inputStream().use { load(it) } }
        val file = File(directory, properties.getProperty("file"))
        require(file.canonicalFile.parentFile == directory.canonicalFile)
        require(file.isFile && file.length() == properties.getProperty("size").toLong())
        require(DownloadPolicy.validSize(file.length()))
        Item(file, DownloadPolicy.fileName(properties.getProperty("name")),
            DownloadPolicy.mime(properties.getProperty("mime")))
    }.getOrNull()

    fun clear() { metadata.delete() }
}
