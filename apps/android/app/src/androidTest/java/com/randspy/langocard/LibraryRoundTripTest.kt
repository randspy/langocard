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
                val originalCount = model.library.entries.size
                model.library.addEntry("une idée", "an idea", "Pensée nouvelle.", listOf("Voici {une idée}."), Gender.Feminine)
                assertEquals(originalCount + 1, model.library.entries.size)
                model.skipPlacement()
                model.start(SessionKind.Practice, false)
                assertEquals("une idée", model.review.card.prompt.entry.word)
                model.rate(io.github.openspacedrepetition.Rating.GOOD, false)
                val saved = model.library.backup()
                val restored = LearningModel(application)
                restored.restore(saved)
                assertEquals(originalCount + 1, restored.library.entries.size)
                assertEquals(1, JSONObject(restored.library.backup()).getJSONObject("data").getJSONObject("cards").length())
                assertEquals(1, JSONObject(restored.library.backup()).getJSONObject("data").getJSONArray("reviews").length())
                val entry = Entry("test-pack-entry", "un récit", "a narrative", "Histoire racontée.", listOf(Example("Elle écrit {un récit}.")), "culture")
                val pack = JSONObject().put("format", "langocard-pack").put("version", 2).put("source", "Test author")
                    .put("license", "Test license").put("entries", JSONArray().put(ContentFiles.entryJson(entry)))
                assertEquals(1, restored.library.importPack(pack.toString()))
                val before = restored.library.backup()
                try { restored.library.importPack(pack.toString()); fail("Duplicate accepted") } catch (_: IllegalArgumentException) { }
                assertEquals(before, restored.library.backup())
                restored.restore(saved)
                assertEquals(originalCount + 1, restored.library.entries.size)
                assertFalse(restored.library.entries.any { it.id == "test-pack-entry" })
                assertEquals(originalCount + 1, LearningModel(application).library.entries.size)
                assertTrue(restored.library.ankiExport().contains("une idée"))
                try { restored.restore("{}"); fail("Invalid backup accepted") } catch (_: Exception) { }
                assertEquals(originalCount + 1, LearningModel(application).library.entries.size)
                restored.library.addEntry("un essai", "an attempt", "Action pour essayer.", listOf("Elle prépare {un essai}."), Gender.Masculine)
                restored.start(SessionKind.Practice, false)
                assertEquals("un essai", restored.review.card.prompt.entry.word)
                restored.rate(io.github.openspacedrepetition.Rating.GOOD, false)
                val states = JSONObject(restored.library.backup()).getJSONObject("data").getJSONObject("cards")
                val ids = states.keys().asSequence().map { io.github.openspacedrepetition.Card.fromJson(states.getString(it)).cardId }.toList()
                assertEquals(2, ids.size)
                assertEquals(ids.size, ids.distinct().size)
            }
        } finally { directory.deleteRecursively() }
    }
}
