package com.randspy.langocard

import android.app.Application
import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import io.github.openspacedrepetition.Card
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.Scheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException
import java.time.Instant

class LearningOwnershipTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private class IsolatedApp(context: Context, private val directory: File) : Application() {
        init { attachBaseContext(context) }
        override fun getFilesDir() = directory
    }
    private fun withModel(test: suspend (LearningModel, File) -> Unit) {
        val directory = File(instrumentation.targetContext.cacheDir, "learning-ownership-${System.nanoTime()}").apply { mkdirs() }
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    test(LearningModel(IsolatedApp(instrumentation.targetContext, directory)), directory)
                }
            }
        } finally { directory.deleteRecursively() }
    }
    private fun LearningLibrary.add(word: String) = addEntry(word, "an idea", "Pensée nouvelle.", listOf("Voici {$word}."), null)
    private fun page(rows: List<JSONObject> = emptyList()) = JSONObject().put("serverTime", 120000)
        .put("page", JSONArray(rows)).put("continueCursor", "").put("isDone", true)
    private fun client(
        push: (JSONObject) -> Unit = {},
        pull: (String) -> List<JSONObject> = { emptyList() },
    ) = object : SyncClient {
        override fun mutation(path: String, args: JSONObject): JSONObject {
            assertEquals("sync:push", path)
            push(args)
            return JSONObject()
        }
        override fun query(path: String, args: JSONObject): JSONObject {
            assertEquals("sync:pull", path)
            return page(pull(args.getString("table")))
        }
    }
    private fun remoteEntry(id: String) = SyncData.entryRow(Entry(id, "une pensée", "a thought", "Une idée.",
        listOf(Example("Voici {une pensée}.")), "daily")).put("origin", "personal").put("retired", false)

    @Test fun restoreDuringPushLeavesRestoredProgressPendingForTheNextSync() = withModel { model, directory ->
        model.library.add("une idée")
        model.start(SessionKind.Practice, false)
        model.rate(Rating.GOOD, false)
        val backup = model.library.backup()
        val restoredId = model.library.entries.last().id
        var pulls = 0
        model.cloudSync.runSync(client(push = {
            instrumentation.runOnMainSync {
                model.restore(backup)
                model.library.add("un essai")
            }
        }, pull = { pulls++; emptyList() }))

        assertEquals(0, pulls)
        val current = LearnerStore(directory).load()
        val pending = SyncData.outbox(current.document, StudyPolicy.date(Instant.now()))
        assertEquals(2, pending.entries.size)
        assertTrue(pending.entries.any { it.getString("entryId") == restoredId })
        assertEquals(1, pending.cards.size)
        assertEquals(1, pending.reviews.size)

        val sent = mutableListOf<JSONObject>()
        model.cloudSync.runSync(client(push = { sent.add(it) }))
        assertEquals(2, sent.single().getJSONArray("entries").length())
        assertEquals(1, sent.single().getJSONArray("cards").length())
        assertTrue(SyncData.outbox(LearnerStore(directory).load().document, StudyPolicy.date(Instant.now())).entries.isEmpty())
    }

    @Test fun restoreDuringPullDiscardsTheOldPageAndItsCursor() = withModel { model, directory ->
        model.library.add("une idée")
        val backup = model.library.backup()
        var pulls = 0
        model.cloudSync.runSync(client(pull = {
            pulls++
            instrumentation.runOnMainSync { model.restore(backup) }
            listOf(JSONObject().put("entryId", "stale-hook").put("text", "stale").put("editedAt", 1))
        }))

        assertEquals(1, pulls)
        assertEquals("", model.memoryHook("stale-hook"))
        val saved = LearnerStore(directory).load()
        assertEquals("", saved.hook("stale-hook"))
        assertEquals(0, SyncData.cursor(saved.document, "hooks"))
        assertEquals(1, SyncData.outbox(saved.document, StudyPolicy.date(Instant.now())).entries.size)
    }

    @Test fun libraryEditsDuringPushAndPulledCardsShareTheSessionLearner() = withModel { model, directory ->
        model.library.add("une idée")
        val remoteId = "personal-remote-thought"
        val remoteCard = Scheduler.builder().build().reviewCard(Card.builder().cardId(40).build(), Rating.GOOD,
            Instant.now().minusSeconds(864000)).card()
        model.cloudSync.runSync(client(push = {
            instrumentation.runOnMainSync { model.library.add("un essai") }
        }, pull = { table -> when (table) {
            "entries" -> listOf(remoteEntry(remoteId))
            "cards" -> listOf(JSONObject().put("key", "$remoteId:Reading").put("card", remoteCard.toJson())
                .put("lastReview", remoteCard.lastReview.toEpochMilli()).put("failures", 0).put("pausedUntil", 0)
                .put("suspendedUntil", 0).put("cardEditedAt", 0))
            else -> emptyList()
        } }))

        assertTrue(model.library.entries.any { it.id == remoteId })
        assertEquals(1, model.studied)
        val pending = SyncData.outbox(LearnerStore(directory).load().document, StudyPolicy.date(Instant.now()))
        assertEquals(listOf("un essai"), pending.entries.map { it.getString("word") })
        assertTrue(model.library.ankiExport().contains("une pensée"))
        model.start(SessionKind.Practice, false)
        assertEquals("$remoteId:Reading", model.review.card.prompt.key)
        model.rate(Rating.GOOD, false)
        val saved = LearnerStore(directory).load()
        assertEquals(1, saved.reviews.size)
        assertTrue(saved.nextCardId > 40)
        assertTrue(saved.card("$remoteId:Reading")!!.lastReview.isAfter(remoteCard.lastReview))
    }

    @Test fun failedRestorePreservesTheSessionAndLibrary() = withModel { model, directory ->
        model.library.add("une idée")
        model.start(SessionKind.Practice, false)
        val screen = model.screen
        val backup = model.library.backup()
        val changed = JSONObject(backup).apply { getJSONObject("data").put("extraEntries", JSONArray()) }.toString()
        val blocked = File(directory, "learning-v2.json.new").apply { mkdir() }
        try {
            try { model.restore(changed); fail("Restore write succeeded") } catch (_: IOException) { }
        } finally { blocked.delete() }

        assertEquals(screen, model.screen)
        assertEquals(backup, model.library.backup())
        assertEquals("une idée", model.library.entries.last().word)
        assertEquals("une idée", LearnerStore(directory).load().extraEntries.single().word)
    }
}
