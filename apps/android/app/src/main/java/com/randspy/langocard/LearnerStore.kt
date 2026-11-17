package com.randspy.langocard

import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors

/**
 * Keeps the [Learner] in private `files/learning-v2.json`, and makes and restores backups of it;
 * no other code touches that file. Saving copies the learner on the calling thread and writes the
 * copy on one background thread through [AtomicFile], so the file always holds a whole save and
 * saves finish before returning to the caller.
 */
class LearnerStore(directory: File) {
    private val file = AtomicFile(File(directory, "learning-v${ContentFiles.DATA_VERSION}.json"))

    /** The saved learner, read after any save still being written, or a new learner if none was saved. */
    fun load() = Learner(onWriter {
        if (file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()) {
            file.openRead().bufferedReader().use { JSONObject(it.readText()) }
        } else JSONObject().put("version", ContentFiles.DATA_VERSION)
    })

    /** Writes [learner] atomically before returning. A failed write propagates to the caller. */
    fun save(learner: Learner) {
        val snapshot = learner.document.toString()
        onWriter { write(snapshot) }
    }

    /** The backup file for [learner]: everything except this device's sync bookkeeping. */
    fun backup(learner: Learner): String = JSONObject().put("format", "langocard-backup").put("version", ContentFiles.BACKUP_VERSION)
        .put("data", JSONObject(learner.document.toString()).apply { remove("sync") }).toString(2)

    /**
     * The learner backed up in [text], already written to the file. An invalid backup or a failed
     * write throws before anything changes, leaving the file and [current] as they were.
     */
    fun restore(text: String, bundled: Set<String>, current: Learner): Learner {
        val restored = current.restoredFrom(ContentFiles.backupData(text, bundled))
        val snapshot = restored.document.toString()
        onWriter { write(snapshot) }
        return restored
    }

    private fun write(text: String) {
        val stream = file.startWrite()
        try { stream.write(text.toByteArray()); file.finishWrite(stream) }
        catch (e: Exception) { file.failWrite(stream); throw e }
    }

    private companion object {
        /** Runs one task at a time in the order queued, so a model created later reads what an earlier one saved. */
        val writer = Executors.newSingleThreadExecutor { Thread(it, "learner-store") }
        fun <T> onWriter(task: () -> T): T =
            try { writer.submit(Callable(task)).get() } catch (e: ExecutionException) { throw e.cause ?: e }
    }
}
