package com.randspy.langocard

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

class ModelFileTest {
    @get:Rule val folder = TemporaryFolder()

    private val content = ByteArray(300_000) { (it % 251).toByte() }
    private val sha = MessageDigest.getInstance("SHA-256").digest(content).joinToString("") { "%02x".format(it) }
    private fun model() = ModelFile(folder.root, "model.litertlm", content.size.toLong(), sha)

    /** A server that honours ranges, optionally dropping the connection after [cut] bytes. */
    private fun server(cut: Int = content.size, honoursRange: Boolean = true, offsets: MutableList<Long> = mutableListOf()) = { offset: Long ->
        offsets += offset
        val start = if (honoursRange) offset.toInt() else 0
        val end = minOf(content.size, start + cut)
        ModelFile.Transfer(ByteArrayInputStream(content, start, end - start), resumed = honoursRange)
    }

    @Test fun `is ready only after a verified download`() {
        val model = model()
        assertFalse(model.ready)
        val progress = mutableListOf<Float>()
        model.download(server()) { progress += it }
        assertTrue(model.ready)
        assertEquals(0L, model.remaining)
        assertEquals(1f, progress.last())
        assertArrayEquals(content, java.io.File(model.path).readBytes())
    }

    @Test fun `resumes an interrupted download from where it stopped`() {
        val model = model()
        assertThrows(IOException::class.java) { model.download(server(cut = 100_000)) {} }
        assertFalse(model.ready)
        assertEquals(200_000L, model.remaining)
        val offsets = mutableListOf<Long>()
        model.download(server(offsets = offsets)) {}
        assertEquals(listOf(100_000L), offsets)
        assertTrue(model.ready)
    }

    @Test fun `starts over when the server ignores the resume request`() {
        val model = model()
        assertThrows(IOException::class.java) { model.download(server(cut = 100_000)) {} }
        model.download(server(honoursRange = false)) {}
        assertArrayEquals(content, java.io.File(model.path).readBytes())
    }

    @Test fun `deletes a download that fails the integrity check`() {
        val corrupt = content.copyOf().also { it[5] = 99 }
        val model = model()
        val error = assertThrows(IOException::class.java) {
            model.download({ ModelFile.Transfer(ByteArrayInputStream(corrupt) as InputStream, resumed = true) }) {}
        }
        assertTrue(error.message!!.contains("integrity"))
        assertFalse(model.ready)
        assertEquals(content.size.toLong(), model.remaining)
    }
}
