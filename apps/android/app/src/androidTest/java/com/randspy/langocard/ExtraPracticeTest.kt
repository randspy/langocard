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
                model.library.setMinimumRank(1)
                base = model.library.backup()
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

    private fun LearningModel.drain() {
        var remaining = 100
        while (screen is LearningScreen.Review && !review.isRepeat && remaining-- > 0) {
            val learner = library.learner
            if (!block.meaningRoom(learner.introduced) && !learner.started(review.card.prompt.entry)) break
            rate(Rating.GOOD, false)
        }
        assertTrue("session eventually exhausts the regular queue", remaining > 0)
        if (screen is LearningScreen.Review) {
            practise(block.end - spent)
            finish()
        }
        assertEquals(LearningScreen.Summary(SessionKind.Practice), screen)
    }

    private fun reviewed(id: Int, due: Instant) = Card.builder().cardId(id).state(State.REVIEW).stability(10.0).difficulty(5.0)
        .due(due).lastReview(Instant.now().minusSeconds(86400)).build()

    @Test fun dailyPracticeRepeatsUntilFifteenMinutesWithoutRescheduling() = withModel { model ->
        val entry = model.library.entries.first()
        val key = entry.cardKey(Skill.Reading)
        val card = reviewed(1, Instant.now().plusSeconds(86400))
        model.restoreToday(StudyPolicy.DAILY_SECONDS - 60, cards = mapOf(key to card))
        assertEquals(NextPractice.Session, model.nextPractice(false))
        model.start(SessionKind.Practice, false)
        assertTrue(model.review.isRepeat)
        assertEquals(key, model.review.card.prompt.key)
        model.rate(Rating.AGAIN, false)
        assertEquals(card.toJson(), model.state(model.review.card.prompt)?.toJson())
        assertEquals(0, JSONObject(model.library.backup()).getJSONObject("data").getJSONArray("reviews").length())
        model.practise(59)
        assertTrue(model.screen is LearningScreen.Review)
        model.practise(1)
        assertEquals(LearningScreen.Summary(SessionKind.Practice), model.screen)
    }

    @Test fun extraBlockUnlocksIntroductionsAndEndsAtItsOwnLimit() = withModel { model ->
        model.restoreToday(seconds = StudyPolicy.DAILY_SECONDS)
        model.start(SessionKind.Practice, false)
        assertEquals(LearningScreen.Summary(SessionKind.Practice), model.screen)
        assertEquals(NextPractice.ExtraBlock, model.nextPractice(false))

        model.startExtraBlock(ExtraMinutes.Five, false)
        assertTrue(model.screen is LearningScreen.Review)
        assertNull("a new meaning is introduced", model.state(model.review.card.prompt))
        assertEquals(PracticeBlock.extra(StudyPolicy.DAILY_SECONDS, ExtraMinutes.Five), model.block)

        val introduced = model.review.card.prompt.key
        model.practise(5 * 60 + StudyPolicy.CLEANUP_SECONDS - 1)
        model.rate(Rating.GOOD, false)
        assertEquals("cleanup brings the new card back before the block's cleanup ends", introduced, (model.screen as? LearningScreen.Review)?.card?.prompt?.key)
        model.practise(1)
        model.rate(Rating.GOOD, false)
        assertEquals(LearningScreen.Summary(SessionKind.Practice), model.screen)
    }

    @Test fun dailyCapsDoNotConsumeAFreshExtension() = withModel { model ->
        model.restoreToday(StudyPolicy.DAILY_SECONDS, StudyPolicy.NEW_SENSES, StudyPolicy.NEW_GENDER_CARDS)
        assertEquals(NextPractice.ExtraBlock, model.nextPractice(false))
        model.startExtraBlock(ExtraMinutes.Five, false)
        assertTrue(model.screen is LearningScreen.Review)
        model.drain()
        assertEquals(LearningScreen.Summary(SessionKind.Practice), model.screen)
        assertEquals(NextPractice.ExtraBlock, model.nextPractice(false))
    }

    @Test fun buriedOverdueCardsDoNotBlockFreshMeaningsInAnExtension() = withModel { model ->
        val buriedWord = model.library.entries.first()
        val buriedKey = "${buriedWord.id}:Reading"
        val overdue = reviewed(1, Instant.now().minusSeconds(3600))
        model.restoreToday(1217, StudyPolicy.NEW_SENSES, StudyPolicy.NEW_GENDER_CARDS,
            cards = mapOf(buriedKey to overdue)) { data ->
            data.put("buried", JSONObject().apply {
                buriedWord.skills.forEach { put("${buriedWord.id}:${it.name}", today) }
            })
        }
        assertEquals(1, model.dueCount(false))
        assertEquals(NextPractice.ExtraBlock, model.nextPractice(false))

        model.startExtraBlock(ExtraMinutes.Five, false)
        assertTrue(model.screen is LearningScreen.Review)
        assertNotEquals(buriedWord.id, model.review.card.prompt.entry.id)
        assertNull("the extension introduces an unburied meaning", model.state(model.review.card.prompt))
        model.rate(Rating.GOOD, false)

        val saved = JSONObject(model.library.backup()).getJSONObject("data")
        assertEquals(overdue.toJson(), saved.getJSONObject("cards").getString(buriedKey))
        assertEquals(today, saved.getJSONObject("buried").getString(buriedKey))
    }

    @Test fun everyLengthGrantsExactSeparateMeaningAndGenderQuotas() = withModel { model ->
        val nouns = model.library.entries.filter { it.gender != null }.take(8)
        val learned = nouns.flatMapIndexed { index, noun -> Skill.placement.mapIndexed { skillIndex, skill ->
            "${noun.id}:${skill.name}" to reviewed(index * 3 + skillIndex, Instant.now().plusSeconds(864000))
        } }.toMap()
        listOf(ExtraMinutes.Five to 2, ExtraMinutes.Ten to 3, ExtraMinutes.Fifteen to 5).forEach { (length, quota) ->
            model.restoreToday(900, 5, 10, learned)
            model.startExtraBlock(length, false)
            assertEquals(Skill.Gender, model.review.card.prompt.skill)
            model.drain()
            val saved = JSONObject(model.library.backup()).getJSONObject("data")
            assertEquals(5 + quota, saved.getInt("introduced"))
            assertEquals(10 + quota, saved.getInt("genderIntroduced"))
            assertEquals(quota, saved.getJSONObject("extraBlock").getInt("meaningsUsed"))
            assertEquals(quota, saved.getJSONObject("extraBlock").getInt("gendersUsed"))
            assertEquals(NextPractice.ExtraBlock, model.nextPractice(false))
        }
    }

    @Test fun failedIntroductionCountsOnceAndResumeRestoreAndRestartKeepUsage() = withModel { model ->
        model.restoreToday(900, 5, 10)
        model.startExtraBlock(ExtraMinutes.Five, false)
        val key = model.review.card.prompt.key
        model.rate(Rating.AGAIN, false)
        assertEquals(1, JSONObject(model.library.backup()).getJSONObject("data").getJSONObject("extraBlock").getInt("meaningsUsed"))
        model.finish(); model.home()
        val backup = model.library.backup()
        model.restore(backup)
        model.start(SessionKind.Practice, false)
        model.drain()
        val saved = JSONObject(model.library.backup()).getJSONObject("data")
        assertEquals(7, saved.getInt("introduced"))
        assertTrue(saved.getJSONObject("cards").has(key))
        assertEquals(2, saved.getJSONObject("extraBlock").getInt("meaningsUsed"))
        val restarted = LearningModel(model.getApplication())
        assertFalse(restarted.block.meaningRoom(0))
        assertEquals(NextPractice.ExtraBlock, restarted.nextPractice(false))
    }

    @Test fun freshGrantDiscardsUnusedQuotaAndDuplicateTapCannotReplaceReview() = withModel { model ->
        model.restoreToday(900, 5, 10)
        model.startExtraBlock(ExtraMinutes.Five, false)
        model.rate(Rating.GOOD, false)
        val partial = model.block
        model.startExtraBlock(ExtraMinutes.Fifteen, false)
        assertEquals(partial, model.block)
        model.practise(300)
        model.finish()
        model.startExtraBlock(ExtraMinutes.Five, false)
        assertEquals(1200, model.block.start)
        model.drain()
        assertEquals(8, JSONObject(model.library.backup()).getJSONObject("data").getInt("introduced"))
    }

    @Test fun syncedDailyCountsDoNotConsumeLocalUsage() = withModel { model ->
        model.restoreToday(900, 5)
        model.startExtraBlock(ExtraMinutes.Five, false)
        model.rate(Rating.GOOD, false)
        val backup = JSONObject(model.library.backup())
        val data = backup.getJSONObject("data")
        val local = SyncData.settings(data)
        val remote = JSONObject(local.toString()).put("introduced", 99).put("seconds", 901)
        val merged = SyncData.mergeSettings(local, remote)
        data.put("introduced", merged.getInt("introduced"))
        data.put("seconds", merged.getInt("seconds"))
        model.restore(backup.toString())
        model.start(SessionKind.Practice, false)
        model.drain()
        assertEquals(100, JSONObject(model.library.backup()).getJSONObject("data").getInt("introduced"))
    }

    @Test fun dailyPracticeIntroducesMoreMeaningsWhenTheRegularQueueRunsOut() = withModel { model ->
        model.restoreToday(0, 5, 10)
        assertEquals(NextPractice.Session, model.nextPractice(false))
        model.startExtraBlock(ExtraMinutes.Five, false)
        assertEquals(PracticeBlock.DAILY, model.block)
        model.start(SessionKind.Practice, false)
        assertFalse(model.review.isRepeat)
        assertNull(model.state(model.review.card.prompt))
        model.rate(Rating.GOOD, false)
        assertEquals(6, JSONObject(model.library.backup()).getJSONObject("data").getInt("introduced"))
    }

    @Test fun catalogueAbsenceIsDistinctFromTemporaryExhaustionAndHonoursRank() = withModel { model ->
        model.restoreToday(900) { it.put("minimumRank", 7001) }
        assertEquals(NextPractice.MoreVocabulary, model.nextPractice(false))
        model.restoreToday(900) { data ->
            data.put("buried", JSONObject().apply { model.library.entries.forEach { entry -> entry.skills.forEach { put("${entry.id}:${it.name}", today) } } })
        }
        assertEquals(NextPractice.NothingLeft, model.nextPractice(false))
        model.restoreToday(900) { data ->
            data.put("suspended", JSONObject().apply { model.library.entries.forEach { entry -> entry.skills.forEach { put("${entry.id}:${it.name}", System.currentTimeMillis() + 86400000) } } })
        }
        assertEquals(NextPractice.NothingLeft, model.nextPractice(false))
    }

    @Test fun retiredMeaningsDoNotMakeAnExtensionAvailable() = withModel { model ->
        val entry = model.library.entries.first().copy(rank = 8000)
        model.restoreToday(900) { data ->
            data.put("minimumRank", 7001)
            data.put("remoteEntries", JSONObject().put(entry.id, SyncData.entryRow(entry).put("origin", "bundled").put("retired", true)))
        }
        assertEquals(NextPractice.MoreVocabulary, model.nextPractice(false))
    }

    @Test fun blockedSiblingsAreTemporaryEvenWhenNoSuitableNewMeaningsRemain() = withModel { model ->
        val noun = model.library.entries.first { it.gender != null }
        val learned = mapOf("${noun.id}:Reading" to reviewed(1, Instant.now().plusSeconds(864000)))
        model.restoreToday(900, cards = learned) { data ->
            data.put("minimumRank", 7001)
            data.put("paused", JSONObject().apply { noun.skills.forEach { put("${noun.id}:${it.name}", System.currentTimeMillis() + 86400000) } })
        }
        assertEquals(NextPractice.NothingLeft, model.nextPractice(false))
    }

    @Test fun standardDailyGenderQuotaStaysTen() = withModel { model ->
        val nouns = model.library.entries.filter { it.gender != null }.take(12)
        val learned = nouns.flatMapIndexed { index, noun -> Skill.placement.mapIndexed { skillIndex, skill ->
            "${noun.id}:${skill.name}" to reviewed(index * 3 + skillIndex, Instant.now().plusSeconds(864000))
        } }.toMap()
        model.restoreToday(0, 5, cards = learned)
        model.start(SessionKind.Practice, false)
        model.drain()
        assertEquals(10, JSONObject(model.library.backup()).getJSONObject("data").getInt("genderIntroduced"))
    }

    @Test fun extraPracticeShowsDueReviewsBeforeNewMeanings() = withModel { model ->
        val key = "${model.library.entries.first().id}:Reading"
        model.restoreToday(StudyPolicy.DAILY_SECONDS, 5, 10, cards = mapOf(
            key to reviewed(1, Instant.now().minusSeconds(3600))
        ))
        model.startExtraBlock(ExtraMinutes.Ten, false)
        assertEquals(key, (model.screen as? LearningScreen.Review)?.card?.prompt?.key)
        model.rate(Rating.GOOD, false)
        assertTrue(model.screen is LearningScreen.Review)
        assertNull("after due reviews, the normal mix can introduce a meaning", model.state(model.review.card.prompt))
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
        assertEquals(LearningScreen.Home, model.screen)
        model.start(SessionKind.Practice, false)
        assertTrue(model.screen is LearningScreen.Review)
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
        val word = model.library.entries.first()
        val noun = model.library.entries.first { it.gender != null }
        val learned = listOf(Skill.Reading, Skill.Listening, Skill.Production).mapIndexed { i, skill ->
            "${noun.id}:${skill.name}" to reviewed(i + 1, Instant.now().plusSeconds(5 * 86400))
        }.toMap()
        class Day(val name: String, val offered: Boolean, val introduced: Int, val genderIntroduced: Int = 0, val cards: Map<String, Card> = emptyMap())
        val days = listOf(
            Day("a due card", true, StudyPolicy.NEW_SENSES, cards = mapOf("${word.id}:Reading" to reviewed(1, Instant.now().minusSeconds(3600)))),
            Day("room to introduce", true, 0),
            Day("daily meanings used up", true, StudyPolicy.NEW_SENSES),
            Day("daily gender cap reached", true, StudyPolicy.NEW_SENSES, StudyPolicy.NEW_GENDER_CARDS, learned),
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
            model.start(SessionKind.Practice, false)
            assertEquals(day.name, offered, model.screen is LearningScreen.Review)
        }
    }
}
