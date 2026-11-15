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
import java.time.LocalDate

class ExtraPracticeTest {
    private class IsolatedApp(context: Context, private val folder: File) : Application() {
        init { attachBaseContext(context) }
        override fun getFilesDir() = folder
    }

    private val today = StudyPolicy.date(Instant.now())
    private val yesterday = LocalDate.parse(today).minusDays(1).toString()
    private lateinit var base: String

    private fun withModel(test: (LearningModel) -> Unit) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val folder = File(instrumentation.targetContext.cacheDir, "extra-${System.nanoTime()}").apply { mkdirs() }
        try {
            instrumentation.runOnMainSync {
                val model = LearningModel(IsolatedApp(instrumentation.targetContext, folder))
                model.skipPlacement()
                // These session tests need eligible words from the bundled Frequent French pack.
                model.setMinimumRank(1)
                base = model.backup()
                test(model)
            }
        } finally { folder.deleteRecursively() }
    }

    /** Replaces the model's data with a fresh day's counters and [cards], as a restore or a sync leaves them. */
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

    private fun reviewed(id: Int, due: Instant) = Card.builder().cardId(id).state(State.REVIEW).stability(10.0).difficulty(5.0)
        .due(due).lastReview(Instant.now().minusSeconds(86400)).build()

    @Test fun extraBlockUnlocksIntroductionsAndEndsAtItsOwnLimit() = withModel { model ->
        model.restoreToday(seconds = StudyPolicy.DAILY_SECONDS)
        model.start(false, false)
        assertEquals("summary", model.screen)
        assertEquals(NextPractice.ExtraBlock, model.nextPractice(false))

        model.startExtraBlock(ExtraMinutes.Five, false)
        assertEquals("review", model.screen)
        assertNull("a new meaning is introduced", model.state(model.prompt!!))
        assertEquals(PracticeBlock.extra(StudyPolicy.DAILY_SECONDS, ExtraMinutes.Five), model.block)

        val introduced = model.prompt!!.key
        model.practise(5 * 60 + StudyPolicy.CLEANUP_SECONDS - 1)
        model.rate(Rating.GOOD, false)
        assertEquals("cleanup brings the new card back before the block's cleanup ends", introduced, model.prompt?.key)
        model.practise(1)
        model.rate(Rating.GOOD, false)
        assertEquals("summary", model.screen)
    }

    @Test fun nothingLeftOnceTodaysNewMeaningsAreUsedAndNothingIsDue() = withModel { model ->
        model.restoreToday(seconds = StudyPolicy.DAILY_SECONDS, introduced = StudyPolicy.NEW_SENSES)
        assertEquals(NextPractice.NothingLeft, model.nextPractice(false))
        model.startExtraBlock(ExtraMinutes.Ten, false)
        assertEquals("home", model.screen)
        assertEquals(PracticeBlock.DAILY, model.block)

        model.restoreToday(seconds = StudyPolicy.DAILY_SECONDS, introduced = StudyPolicy.NEW_SENSES - 1)
        assertEquals(NextPractice.ExtraBlock, model.nextPractice(false))
    }

    @Test fun extraPracticeShowsDueReviewsBeforeNewMeanings() = withModel { model ->
        val key = "${model.entries.first().id}:Reading"
        model.restoreToday(StudyPolicy.DAILY_SECONDS, cards = mapOf(
            key to reviewed(1, Instant.now().minusSeconds(3600))
        ))
        model.startExtraBlock(ExtraMinutes.Ten, false)
        assertEquals(key, model.prompt?.key)
        model.rate(Rating.GOOD, false)
        assertNotNull(model.prompt)
        assertNull("after due reviews, the normal mix can introduce a meaning", model.state(model.prompt!!))
    }

    @Test fun partlyUsedBlockResumesWithoutGrantingMoreTime() = withModel { model ->
        model.restoreToday(StudyPolicy.DAILY_SECONDS)
        model.startExtraBlock(ExtraMinutes.Ten, false)
        val granted = model.block
        model.practise(60)
        model.finish()
        model.home()
        assertEquals(NextPractice.Session, model.nextPractice(false))
        model.startExtraBlock(ExtraMinutes.Fifteen, false)
        assertEquals("home", model.screen)
        model.start(false, false)
        assertEquals("review", model.screen)
        assertEquals(granted, model.block)
        assertEquals(1, model.block.minutesIn(model.spent))
    }

    @Test fun yesterdaysBlockDoesNotExtendTodayAfterASyncedDayChange() = withModel { model ->
        val block = PracticeBlock.extra(StudyPolicy.DAILY_SECONDS, ExtraMinutes.Fifteen)
        model.restoreToday(seconds = 950) { block.write(it, today) }
        assertEquals(block, model.block)
        assertEquals(NextPractice.Session, model.nextPractice(false))

        model.restoreToday(seconds = 950) { block.write(it, yesterday) }
        assertEquals(PracticeBlock.DAILY, model.block)
        assertEquals(NextPractice.ExtraBlock, model.nextPractice(false))
    }

    @Test fun offerMatchesWhatASessionWouldShow() = withModel { model ->
        val word = model.entries.first()
        val noun = model.entries.first { it.gender != null }
        val learned = listOf(Skill.Reading, Skill.Listening, Skill.Production).mapIndexed { i, skill ->
            "${noun.id}:${skill.name}" to reviewed(i + 1, Instant.now().plusSeconds(5 * 86400))
        }.toMap()
        class Day(val name: String, val offered: Boolean, val introduced: Int, val genderIntroduced: Int = 0, val cards: Map<String, Card> = emptyMap())
        val days = listOf(
            Day("a due card", true, StudyPolicy.NEW_SENSES, cards = mapOf("${word.id}:Reading" to reviewed(1, Instant.now().minusSeconds(3600)))),
            Day("room to introduce", true, 0),
            Day("new meanings used up, nothing due", false, StudyPolicy.NEW_SENSES),
            Day("gender cap reached, nothing else", false, StudyPolicy.NEW_SENSES, StudyPolicy.NEW_GENDER_CARDS, learned),
            Day("room for one gender card", true, StudyPolicy.NEW_SENSES, StudyPolicy.NEW_GENDER_CARDS - 1, learned),
        )
        days.forEach { day ->
            val seconds = StudyPolicy.DAILY_SECONDS
            model.restoreToday(seconds, day.introduced, day.genderIntroduced, day.cards)
            val offered = model.nextPractice(false) == NextPractice.ExtraBlock
            assertEquals(day.name, day.offered, offered)

            model.restoreToday(seconds, day.introduced, day.genderIntroduced, day.cards) {
                PracticeBlock.extra(seconds, ExtraMinutes.Ten).write(it, today)
            }
            model.start(false, false)
            assertEquals(day.name, offered, model.prompt != null)
        }
    }
}
