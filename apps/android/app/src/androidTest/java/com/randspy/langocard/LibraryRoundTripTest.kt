package com.randspy.langocard

import android.app.Application
import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import org.json.JSONArray
import java.io.File

class LibraryRoundTripTest {
    private class IsolatedApp(context: Context, private val folder: File) : Application() {
        init { attachBaseContext(context) }
        override fun getFilesDir() = folder
    }
    @Test fun additionsAndHistorySurviveRestoreAndInvalidPacksDoNotMutateState() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.cacheDir, "library-test-${System.nanoTime()}").apply { mkdirs() }
        try {
            instrumentation.runOnMainSync {
                val application = IsolatedApp(instrumentation.targetContext, directory)
                val model = LearningModel(application)
                val originalCount = model.entries.size
                model.addEntry("une idée", "an idea", "Pensée nouvelle.", "Voici {une idée}.")
                assertEquals(originalCount + 1, model.entries.size)
                model.skipPlacement()
                model.start(false, false)
                assertEquals("une idée", model.prompt!!.entry.word)
                model.rate(io.github.openspacedrepetition.Rating.GOOD, false)
                val saved = model.backup()
                val restored = LearningModel(application)
                restored.restore(saved)
                assertEquals(originalCount + 1, restored.entries.size)
                assertEquals(1, JSONObject(restored.backup()).getJSONObject("data").getJSONObject("cards").length())
                assertEquals(1, JSONObject(restored.backup()).getJSONObject("data").getJSONArray("reviews").length())
                val entry = Entry("test-pack-entry", "un récit", "a narrative", "Histoire racontée.", "Elle écrit {un récit}.", "culture")
                val pack = JSONObject().put("format", "langocard-pack").put("version", 1).put("source", "Test author")
                    .put("license", "Test license").put("entries", JSONArray().put(ContentFiles.entryJson(entry)))
                assertEquals(1, restored.importPack(pack.toString()))
                val before = restored.backup()
                try { restored.importPack(pack.toString()); fail("Duplicate accepted") } catch (_: IllegalArgumentException) { }
                assertEquals(before, restored.backup())
                restored.restore(saved)
                assertEquals(originalCount + 1, restored.entries.size)
                assertFalse(restored.entries.any { it.id == "test-pack-entry" })
                assertEquals(originalCount + 1, LearningModel(application).entries.size)
                assertTrue(restored.ankiExport().contains("une idée"))
                try { restored.restore("{}"); fail("Invalid backup accepted") } catch (_: Exception) { }
                assertEquals(originalCount + 1, LearningModel(application).entries.size)
                restored.addEntry("un essai", "an attempt", "Action pour essayer.", "Elle prépare {un essai}.")
                restored.start(false, false)
                assertEquals("un essai", restored.prompt!!.entry.word)
                restored.rate(io.github.openspacedrepetition.Rating.GOOD, false)
                val states = JSONObject(restored.backup()).getJSONObject("data").getJSONObject("cards")
                val ids = states.keys().asSequence().map { io.github.openspacedrepetition.Card.fromJson(states.getString(it)).cardId }.toList()
                assertEquals(2, ids.size)
                assertEquals(ids.size, ids.distinct().size)
            }
        } finally { directory.deleteRecursively() }
    }
}
