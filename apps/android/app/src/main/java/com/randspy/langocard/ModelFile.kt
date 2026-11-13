package com.randspy.langocard

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

/**
 * One large model file kept in app storage, fetched once and trusted only after its
 * size and SHA-256 match. Interrupted downloads resume where they stopped; a file that
 * fails the check is deleted, so a corrupt model is never loaded.
 *
 * The finished file appears at [path] only after it is verified (rename is atomic), so
 * [ready] never needs to hash 2.6 GB again.
 */
class ModelFile(dir: File, name: String, private val size: Long, private val sha256: String) {
    private val file = File(dir, name)
    private val partial = File(dir, "$name.part")

    val path: String get() = file.absolutePath
    val ready: Boolean get() = file.length() == size

    /** Bytes still to fetch, for the free-space check. */
    val remaining: Long get() = if (ready) 0 else size - partial.length().coerceAtMost(size)

    /**
     * Fetches the rest of the file. [open] starts a transfer at the given byte offset and
     * says whether the server honoured it (`resumed = false` means it sent the whole file).
     * [progress] receives the fraction done, from 0 to 1.
     */
    fun download(open: (offset: Long) -> Transfer, progress: (Float) -> Unit) {
        if (ready) return
        file.parentFile?.mkdirs()
        if (partial.length() > size) partial.delete()
        if (partial.length() < size) {
            val transfer = open(partial.length())
            val append = transfer.resumed && partial.length() > 0
            var done = if (append) partial.length() else 0L
            var reported = -1
            transfer.body.use { input ->
                java.io.FileOutputStream(partial, append).use { output ->
                    val buffer = ByteArray(1 shl 16)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        if (done + read > size) { partial.delete(); throw IOException("Model download is larger than expected") }
                        output.write(buffer, 0, read)
                        done += read
                        val percent = (done * 100 / size).toInt()
                        if (percent != reported) { reported = percent; progress(done.toFloat() / size) }
                    }
                }
            }
            if (done < size) throw IOException("Model download stopped early; try again to resume")
        }
        if (digest(partial) != sha256) { partial.delete(); throw IOException("Model failed its integrity check; try again") }
        if (!partial.renameTo(file)) throw IOException("Could not store the model")
    }

    /** Removes the model and any partial download. */
    fun delete() { file.delete(); partial.delete() }

    class Transfer(val body: InputStream, val resumed: Boolean)

    private fun digest(f: File): String {
        val sha = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input ->
            val buffer = ByteArray(1 shl 16)
            while (true) { val read = input.read(buffer); if (read < 0) break; sha.update(buffer, 0, read) }
        }
        return sha.digest().joinToString("") { "%02x".format(it) }
    }
}
