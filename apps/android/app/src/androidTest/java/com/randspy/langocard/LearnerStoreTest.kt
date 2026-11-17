package com.randspy.langocard

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException

class LearnerStoreTest {
    private fun withDirectory(test: (File) -> Unit) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.cacheDir, "learner-store-${System.nanoTime()}").apply { mkdirs() }
        try { test(directory) } finally { directory.deleteRecursively() }
    }

    @Test fun savesPersistBeforeReturningAndCaptureState() = withDirectory { directory ->
        val store = LearnerStore(directory)
        val learner = store.load()
        assertEquals(ContentFiles.DATA_VERSION, learner.document.getInt("version"))
        learner.document.put("futureField", JSONObject().put("keep", true))
        for (seconds in 1..40) {
            learner.seconds = seconds
            learner.introduced = seconds / 10
            store.save(learner)
            assertEquals(seconds, JSONObject(File(directory, "learning-v2.json").readText()).getInt("seconds"))
        }
        learner.seconds = 999

        val reloaded = LearnerStore(directory).load()

        assertEquals(40, reloaded.seconds)
        assertEquals(4, reloaded.introduced)
        assertTrue(reloaded.document.getJSONObject("futureField").getBoolean("keep"))
        val saved = JSONObject(File(directory, "learning-v2.json").readText())
        assertEquals(40, saved.getInt("seconds"))
        assertFalse(saved.has("format"))
    }

    @Test fun restoreFollowsQueuedSavesAndPersistsItsSyncResetBeforeReturning() = withDirectory { directory ->
        val store = LearnerStore(directory)
        val learner = store.load()
        SyncData.reset(learner.document)
        SyncData.reset(learner.document)
        learner.seconds = 12
        learner.document.put("futureField", JSONArray().put("retained"))
        val backup = store.backup(learner)
        assertFalse(JSONObject(backup).getJSONObject("data").has("sync"))
        for (seconds in 13..40) { learner.seconds = seconds; store.save(learner) }

        val restored = store.restore(backup, emptySet(), learner)

        assertEquals(12, restored.seconds)
        assertEquals(40, learner.seconds)
        assertEquals(2, SyncData.generation(learner.document))
        assertEquals(3, SyncData.generation(restored.document))
        val reloaded = LearnerStore(directory).load()
        assertEquals(12, reloaded.seconds)
        assertEquals(3, SyncData.generation(reloaded.document))
        assertEquals("retained", reloaded.document.getJSONArray("futureField").getString(0))
        restored.seconds = 50
        store.save(restored)
        assertEquals(50, LearnerStore(directory).load().seconds)
        assertEquals(12, JSONObject(backup).getJSONObject("data").getInt("seconds"))
    }

    @Test fun invalidBackupAndFailedRestoreLeaveTheSavedAndLiveLearnerIntact() = withDirectory { directory ->
        val store = LearnerStore(directory)
        val learner = store.load()
        learner.seconds = 25
        store.save(learner)
        store.load()
        val file = File(directory, "learning-v2.json")
        val saved = file.readText()
        val live = learner.document.toString()
        try { store.restore("{}", emptySet(), learner); fail("Accepted an invalid backup") }
        catch (_: Exception) { }
        assertEquals(saved, file.readText())
        assertEquals(live, learner.document.toString())

        val replacement = Learner(JSONObject().put("version", 2)).apply { seconds = 90 }
        val blockedWrite = File(directory, "learning-v2.json.new").apply { mkdir() }
        try {
            try { store.restore(store.backup(replacement), emptySet(), learner); fail("Restore write succeeded") }
            catch (_: IOException) { }
            assertEquals(saved, file.readText())
            assertEquals(live, learner.document.toString())
        } finally { blockedWrite.delete() }
        assertEquals(25, store.load().seconds)
    }

    @Test fun loadRecoversAnInterruptedAtomicFileWriteWithoutDroppingUnknownFields() = withDirectory { directory ->
        val saved = JSONObject().put("version", 2).put("seconds", 37).put("futureField", "retained").toString()
        File(directory, "learning-v2.json.bak").writeText(saved)
        File(directory, "learning-v2.json").writeText("interrupted")

        val store = LearnerStore(directory)
        val recovered = store.load()

        assertEquals(37, recovered.seconds)
        assertEquals("retained", recovered.document.getString("futureField"))
        store.save(recovered)
        assertEquals(37, LearnerStore(directory).load().seconds)
        assertEquals("retained", JSONObject(File(directory, "learning-v2.json").readText()).getString("futureField"))
    }
}
