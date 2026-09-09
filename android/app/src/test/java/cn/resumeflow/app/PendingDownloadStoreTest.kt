package cn.resumeflow.app

import java.io.File
import java.util.Properties
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PendingDownloadStoreTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun recreatedStoreRestoresBytesAndDestinationMetadata() {
        val directory = temporary.newFolder("exports")
        val file = File(directory, "export.tmp").apply { writeBytes(byteArrayOf(1, 2, 3, -1)) }
        PendingDownloadStore(directory).save(PendingDownloadStore.Item(file, "张三简历.pdf", "application/pdf"))
        val restored = PendingDownloadStore(directory).restore()!!
        assertEquals("张三简历.pdf", restored.name)
        assertEquals("application/pdf", restored.mime)
        assertArrayEquals(byteArrayOf(1, 2, 3, -1), restored.file.readBytes())
        PendingDownloadStore(directory).clear()
        assertNull(PendingDownloadStore(directory).restore())
    }

    @Test fun missingOrTruncatedPendingFileCannotBeRestored() {
        val directory = temporary.newFolder("exports")
        val file = File(directory, "export.tmp").apply { writeText("complete") }
        val store = PendingDownloadStore(directory)
        store.save(PendingDownloadStore.Item(file, "file.pdf", "application/pdf"))
        file.writeText("short")
        assertNull(store.restore())
        file.delete()
        assertNull(store.restore())
    }

    @Test fun metadataCannotRestoreAFileOutsideThePrivateExportDirectory() {
        val directory = temporary.newFolder("exports")
        val outside = temporary.newFile("outside.pdf").apply { writeText("private") }
        Properties().apply {
            setProperty("file", "../outside.pdf")
            setProperty("name", "file.pdf")
            setProperty("mime", "application/pdf")
            setProperty("size", outside.length().toString())
        }.also { properties ->
            File(directory, "pending.properties").outputStream().use { properties.store(it, null) }
        }
        assertNull(PendingDownloadStore(directory).restore())
        assertEquals("private", outside.readText())
    }
}
