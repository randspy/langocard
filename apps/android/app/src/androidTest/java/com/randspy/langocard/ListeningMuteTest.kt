package com.randspy.langocard

import android.app.Application
import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import io.github.openspacedrepetition.Card
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.State
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.time.Instant

class ListeningMuteTest {
    private class IsolatedApp(context: Context, private val folder: File) : Application() {
        init { attachBaseContext(context) }
        override fun getFilesDir() = folder
    }

    private val today = StudyPolicy.date(Instant.now())
    private lateinit var base: String

    private fun withModel(test: (LearningModel) -> Unit) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val folder = File(instrumentation.targetContext.cacheDir, "mute-${System.nanoTime()}").apply { mkdirs() }
        try {
            instrumentation.runOnMainSync {
                val model = LearningModel(IsolatedApp(instrumentation.targetContext, folder))
                model.skipPlacement()
                model.library.setMinimumRank(1)
                base = model.library.backup()
                test(model)
            }
        } finally { folder.deleteRecursively() }
    }

    private fun LearningModel.restoreToday(seconds: Int, introduced: Int = 0, genderIntroduced: Int = 0,
                                           cards: Map<String, Card> = emptyMap(), edit: (JSONObject) -> Unit = {}) {
        val data = JSONObject(base).getJSONObject("data")
            .put("day", today).put("seconds", seconds).put("introduced", introduced).put("genderIntroduced", genderIntroduced)
            .put("cards", JSONObject().apply { cards.forEach { (key, card) -> put(key, card.toJson()) } })
        edit(data)
        restore(JSONObject().put("format", "langocard-backup").put("version", ContentFiles.BACKUP_VERSION).put("data", data).toString())
    }

    private fun LearningModel.practise(seconds: Int) {
        LearningModel::class.java.getDeclaredField("lastTick").apply { isAccessible = true }
            .setLong(this, android.os.SystemClock.elapsedRealtime() - seconds * 1000L)
        tick()
    }

    /** Answers every card with sound available, failing if a Listening card is shown. */
    private fun LearningModel.drainHearing() {
        var remaining = 100
        while (screen is LearningScreen.Review && remaining-- > 0) {
            assertNotEquals("muted listening stays out of the session", Skill.Listening, review.card.prompt.skill)
            if (review.isRepeat) {
                practise(block.end - spent)
                break
            }
            rate(Rating.GOOD, true)
        }
        assertTrue("session eventually exhausts eligible work", remaining > 0)
        assertEquals(LearningScreen.Summary(SessionKind.Practice), screen)
    }

    private fun LearningModel.scheduling() = JSONObject(library.backup()).getJSONObject("data").let { data ->
        listOf("cards", "reviews", "buried", "failures", "paused").associateWith { data.opt(it)?.toString() }
    }

    private fun reviewed(id: Int, due: Instant) = Card.builder().cardId(id).state(State.REVIEW).stability(10.0).difficulty(5.0)
        .due(due).lastReview(Instant.now().minusSeconds(86400)).build()

    private val LearningModel.heard get() = library.entries.first()
    private val LearningModel.read get() = library.entries.first { it.lexeme != heard.lexeme }
    private val LearningModel.listeningKey get() = "${heard.id}:Listening"
    private val LearningModel.readingKey get() = "${read.id}:Reading"

    private fun LearningModel.startOnDueListening() {
        restoreToday(0, cards = mapOf(
            listeningKey to reviewed(1, Instant.now().minusSeconds(7200)),
            readingKey to reviewed(2, Instant.now().minusSeconds(3600))))
        start(SessionKind.Practice, true)
        assertEquals(listeningKey, (screen as? LearningScreen.Review)?.card?.prompt?.key)
    }

    @Test fun skippingMovesOnWithoutTouchingTheSchedule() = withModel { model ->
        model.startOnDueListening()
        val before = model.scheduling()
        model.muteListening()
        assertEquals(model.readingKey, (model.screen as? LearningScreen.Review)?.card?.prompt?.key)
        assertEquals("no rating, log, bury or failure is recorded", before, model.scheduling())
        assertEquals(1, model.dueCount(false))
    }

    @Test fun skippingTheOnlyCardEndsTheSession() = withModel { model ->
        val due = reviewed(1, Instant.now().minusSeconds(3600))
        model.restoreToday(StudyPolicy.DAILY_SECONDS - StudyPolicy.WIND_DOWN_SECONDS,
            StudyPolicy.NEW_SENSES, StudyPolicy.NEW_GENDER_CARDS, mapOf(model.listeningKey to due)) { data ->
            data.put("buried", JSONObject().apply {
                model.heard.skills.filter { it != Skill.Listening }.forEach { put("${model.heard.id}:${it.name}", today) }
            })
        }
        model.start(SessionKind.Practice, true)
        assertEquals(model.listeningKey, (model.screen as? LearningScreen.Review)?.card?.prompt?.key)
        model.muteListening()
        assertEquals(LearningScreen.Summary(SessionKind.Practice), model.screen)
        assertEquals(due.toJson(), JSONObject(model.library.backup()).getJSONObject("data").getJSONObject("cards").getString(model.listeningKey))
    }

    @Test fun mutedListeningStaysOutForTheRestOfTheSittingIncludingExtraBlocks() = withModel { model ->
        model.startOnDueListening()
        model.muteListening()
        model.rate(Rating.GOOD, true)
        assertNotEquals("rating with sound on does not bring it back", Skill.Listening, (model.screen as? LearningScreen.Review)?.card?.prompt?.skill)
        model.practise(StudyPolicy.DAILY_SECONDS)
        model.drainHearing()
        assertEquals(0, model.dueCount(true))

        assertEquals(NextPractice.ExtraBlock, model.nextPractice(true))
        model.startExtraBlock(ExtraMinutes.Five, true)
        assertTrue(model.screen is LearningScreen.Review)
        model.practise(ExtraMinutes.Five.seconds - StudyPolicy.WIND_DOWN_SECONDS)
        model.drainHearing()
        assertEquals(0, model.dueCount(true))
        assertNotEquals("the due Listening card is not offered as more practice", NextPractice.Session, model.nextPractice(true))
    }

    @Test fun turningListeningBackOnKeepsTheCurrentCardAndReturnsTheDueOne() = withModel { model ->
        model.startOnDueListening()
        model.muteListening()
        model.unmuteListening()
        assertEquals(model.readingKey, (model.screen as? LearningScreen.Review)?.card?.prompt?.key)
        assertEquals("the due Listening card counts again", model.dueCount(false) + 1, model.dueCount(true))
        model.rate(Rating.GOOD, true)
        assertEquals(model.listeningKey, (model.screen as? LearningScreen.Review)?.card?.prompt?.key)
    }

    @Test fun goingHomeEndsTheMute() = withModel { model ->
        model.startOnDueListening()
        model.muteListening()
        model.finish()
        model.home()
        assertEquals("the due Listening card counts again", model.dueCount(false) + 1, model.dueCount(true))
        model.start(SessionKind.Practice, true)
        assertEquals(model.listeningKey, (model.screen as? LearningScreen.Review)?.card?.prompt?.key)
    }
}
