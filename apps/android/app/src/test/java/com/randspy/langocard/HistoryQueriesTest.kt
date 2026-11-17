package com.randspy.langocard

import io.github.openspacedrepetition.Card
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.Scheduler
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class HistoryQueriesTest {
    private val now = Instant.parse("2026-11-17T12:00:00Z")
    private val entry = Entry("history", "un mot", "a word", "Un exemple.",
        listOf(Example("{Un}."), Example("{Deux}."), Example("{Trois}.")), "daily", gender = Gender.Masculine)
    private val key = entry.cardKey(Skill.Reading)

    @Test fun `loaded equal timestamp reviews retain append order when a paused card returns`() {
        val rows = listOf(2, 0, 0, 1, 1).map { row(key, now.minusSeconds(10), entry.examples[it].marked) }
        val learner = learner(rows)
        learner.pause(key, now.toEpochMilli())

        assertEquals(entry.examples[2], shown(learner))
        assertEquals(rows.map { JSONObject(it.getString("log")).getString("example") }, learner.reviews.map { it.example })
        assertEquals(entry.examples[2], shown(Learner(JSONObject(learner.document.toString()))))
    }

    @Test fun `rotation includes placement and sync union while excluding gender and other meanings`() {
        val learner = learner(listOf(row(key, now.minusSeconds(10), entry.examples[0].marked).put("placement", true)))
        assertEquals(entry.examples[1], shown(learner))
        val local = Scheduler.builder().build().reviewCard(learner.newCard(), Rating.GOOD, now)
        learner.answered(entry.cardKey(Skill.Listening), local.card(), local.reviewLog(), entry.examples[1], false)
        assertEquals(entry.examples[2], shown(learner))

        val remote = row(entry.cardKey(Skill.Production), now.minusSeconds(100), entry.examples[2].marked)
        val page = listOf(remote, remote, row(entry.cardKey(Skill.Gender), now, ""), row("other:Reading", now, "{Autre}."))
        learner.merge("reviews", page.map(::remote), setOf(entry.id, "other"))
        assertEquals(entry.examples[0], shown(learner))
        learner.merge("reviews", page.map(::remote), setOf(entry.id, "other"))
        assertEquals(entry.examples[0], shown(learner))
        assertEquals(5, learner.reviews.size)

        val reloaded = Learner(JSONObject(learner.document.toString()))
        reloaded.merge("reviews", page.map(::remote), setOf(entry.id, "other"))
        assertEquals(5, reloaded.reviews.size)
        assertEquals(entry.examples[0], shown(reloaded))
        val restored = learner.restoredFrom(JSONObject().put("version", 2).put("reviews", JSONArray()))
        assertEquals(entry.examples[0], shown(restored))
        restored.merge("reviews", listOf(remote(remote)), setOf(entry.id))
        assertEquals(entry.examples[1], shown(restored))
        assertEquals(entry.examples[0], shown(learner))
    }

    @Test fun `recent contexts take four answers before dropping blanks and retain equal timestamp order`() {
        val learner = learner(listOf(
            row(key, now.minusSeconds(30), "old"),
            row(key, now.minusSeconds(10), "first tie"),
            row(key, now.minusSeconds(20), "earlier"),
            row(key, now.minusSeconds(10), "second tie"),
            row(key, now.minusSeconds(10), ""),
            row(key, now.minusSeconds(10), "last tie"),
        ))
        assertEquals(listOf("first tie", "second tie", "last tie"), learner.recentExamples(key))
        val older = row(key, now.minusSeconds(100), "synced old")
        learner.merge("reviews", listOf(remote(older)), setOf(entry.id))
        assertEquals(listOf("first tie", "second tie", "last tie"), learner.recentExamples(key))
        val fresh = row(key, now, "new")
        learner.merge("reviews", listOf(remote(fresh), remote(fresh)), setOf(entry.id))
        assertEquals(listOf("second tie", "last tie", "new"), learner.recentExamples(key))
        assertQueriesMatchHistory(learner)
        assertQueriesMatchHistory(Learner(JSONObject(learner.document.toString())))
    }

    @Test fun `query results match saved history after local answers sync pages reload and replacement restore`() {
        val learner = learner()
        assertQueriesMatchHistory(learner)
        Skill.entries.forEachIndexed { index, skill ->
            answer(learner, entry.cardKey(skill), Rating.entries[index], now.minusSeconds(index.toLong()), placement = index == 1)
            assertQueriesMatchHistory(learner)
        }
        val backup = JSONObject(learner.document.toString())
        val localEchoes = SyncData.outbox(learner.document, "2026-11-17").reviews
        val old = remote(row(key, now.minusSeconds(1000), "old", Rating.GOOD))
        val recent = remote(row(key, now.plusSeconds(1), "new", Rating.AGAIN))
        listOf(localEchoes + old, listOf(old, recent, recent), localEchoes + recent).forEach { page ->
            learner.merge("reviews", page, setOf(entry.id))
            assertQueriesMatchHistory(learner)
        }
        assertEquals(6, learner.reviews.size)
        assertEquals(5, learner.exposures(entry))
        val reloaded = Learner(JSONObject(learner.document.toString()))
        reloaded.merge("reviews", localEchoes + old + recent, setOf(entry.id))
        assertEquals(6, reloaded.reviews.size)
        assertQueriesMatchHistory(reloaded)

        val restored = learner.restoredFrom(backup)
        assertEquals(4, restored.reviews.size)
        assertEquals(3, restored.exposures(entry))
        assertQueriesMatchHistory(restored)
        restored.merge("reviews", listOf(old, recent), setOf(entry.id))
        assertEquals(6, restored.reviews.size)
        assertQueriesMatchHistory(restored)
        answer(restored, key, Rating.AGAIN, now.plusSeconds(2))
        assertEquals(7, restored.reviews.size)
        assertQueriesMatchHistory(restored)
        assertEquals(6, learner.reviews.size)
    }

    @Test fun `local answers sharing an identity still count while their sync echoes do not`() {
        val learner = learner()
        repeat(5) { index ->
            answer(learner, key, Rating.AGAIN, now, example = entry.examples[index % 3])
        }
        assertEquals(5, learner.exposures(entry))
        assertEquals(listOf("{Deux}.", "{Trois}.", "{Un}.", "{Deux}."), learner.recentExamples(key))
        val echo = SyncData.outbox(learner.document, "2026-11-17").reviews
        learner.merge("reviews", echo, setOf(entry.id))
        assertEquals(5, learner.exposures(entry))
        assertQueriesMatchHistory(learner)
        val restored = learner.restoredFrom(JSONObject(learner.document.toString()))
        restored.merge("reviews", echo, setOf(entry.id))
        assertEquals(5, restored.exposures(entry))
        assertQueriesMatchHistory(restored)
    }

    @Test fun `review merge keeps loaded card allocation visible to sync settings`() {
        val card = Card.builder().cardId(88).build()
        val learner = Learner(JSONObject().put("version", 2).put("cards", JSONObject().put(key, card.toJson())))
        learner.merge("reviews", listOf(remote(row(key, now, "", Rating.GOOD))), setOf(entry.id))
        assertEquals(89, SyncData.settings(learner.document).getInt("nextCardId"))
        assertEquals(89, learner.newCard().cardId)
        assertEquals(88, learner.card(key)!!.cardId)
    }

    @Test fun `known reading vocabulary keeps library order and limit rather than review order`() {
        val entries = (0..105).map { entry.copy(id = "word-$it") }
        val learner = learner()
        entries.reversed().forEachIndexed { index, word ->
            answer(learner, word.cardKey(Skill.Reading), if (word.id == "word-2") Rating.AGAIN else Rating.HARD,
                now.minusSeconds(index.toLong()))
        }
        val listeningOnly = entry.copy(id = "listening-only")
        answer(learner, listeningOnly.cardKey(Skill.Listening), Rating.EASY, now)
        val cardWithoutRecall = entry.copy(id = "card-only")
        val card = Scheduler.builder().build().reviewCard(Card.builder().cardId(999).build(), Rating.GOOD, now).card()
        learner.merge("cards", listOf(cardRow(cardWithoutRecall.cardKey(Skill.Reading), card)), setOf(cardWithoutRecall.id))
        val noCard = entry.copy(id = "history-only")
        learner.merge("reviews", listOf(remote(row(noCard.cardKey(Skill.Reading), now, "", Rating.GOOD))), setOf(noCard.id))
        val library = listOf(listeningOnly, cardWithoutRecall, noCard) + entries
        assertEquals((0..100).filter { it != 2 }.map { "word-$it" },
            StudyRules(library, learner, emptySet()).knownReadingVocabulary().map { it.id })
        assertQueriesMatchHistory(learner, library)
        assertQueriesMatchHistory(Learner(JSONObject(learner.document.toString())), library)
    }

    @Test fun `reset and library deletion hide recalled vocabulary without erasing exposure history`() {
        val learner = learner()
        answer(learner, key, Rating.GOOD, now.minusSeconds(20))
        answer(learner, key, Rating.AGAIN, now.minusSeconds(10))
        assertEquals(listOf(entry), StudyRules(listOf(entry), learner, emptySet()).knownReadingVocabulary())
        val reset = cardRow(key, null).put("lastReview", now.toEpochMilli())
        learner.merge("cards", listOf(reset), setOf(entry.id))
        assertTrue(StudyRules(listOf(entry), learner, emptySet()).knownReadingVocabulary().isEmpty())
        assertEquals(2, learner.exposures(entry))
        assertTrue(learner.recalled(key))
        assertQueriesMatchHistory(learner)
        answer(learner, key, Rating.AGAIN, now.plusSeconds(1))
        assertEquals(listOf(entry), StudyRules(listOf(entry), learner, emptySet()).knownReadingVocabulary())

        val deleted = SyncData.entryRow(entry).put("origin", "personal").put("editedAt", 1).put("deletedAt", 2)
        learner.merge("entries", listOf(deleted), setOf(entry.id))
        val active = StudyLibrary.active(emptyList(), listOf(entry), learner.remoteEntries) { false }.entries
        assertTrue(StudyRules(active, learner, emptySet()).knownReadingVocabulary().isEmpty())
        assertEquals(3, learner.exposures(entry))
        assertQueriesMatchHistory(learner, active)
        val restored = learner.restoredFrom(JSONObject().put("version", 2))
        assertEquals(0, restored.exposures(entry))
        assertFalse(restored.recalled(key))
        assertEquals(emptyList<String>(), restored.recentExamples(key))
    }

    private fun assertQueriesMatchHistory(learner: Learner, entries: List<Entry> = listOf(entry)) {
        val history = learner.reviews
        (entries + entry).forEach { word ->
            val sentenceKeys = Skill.placement.map(word::cardKey).toSet()
            assertEquals(history.count { it.key in sentenceKeys }, learner.exposures(word))
            Skill.entries.forEach { skill ->
                val key = word.cardKey(skill)
                val answers = history.filter { it.key == key }
                assertEquals(answers.any { it.rating != Rating.AGAIN }, learner.recalled(key))
                assertEquals(answers.sortedBy { it.reviewedAt }.takeLast(4).mapNotNull { it.example.takeIf(String::isNotBlank) },
                    learner.recentExamples(key))
            }
        }
        val recalled = history.filter { it.rating != Rating.AGAIN }.map { it.key }.toSet()
        val expected = entries.filter { it.cardKey(Skill.Reading).let { key -> key in recalled && learner.card(key) != null } }.take(100)
        assertEquals(expected, StudyRules(entries, learner, emptySet()).knownReadingVocabulary())
    }

    private fun answer(learner: Learner, key: String, rating: Rating, at: Instant, placement: Boolean = false,
                       example: Example = entry.examples.first()) {
        val result = Scheduler.builder().build().reviewCard(learner.card(key) ?: learner.newCard(), rating, at)
        learner.answered(key, result.card(), result.reviewLog(), example, placement)
    }

    private fun cardRow(key: String, card: Card?) = JSONObject().put("key", key).put("card", card?.toJson() ?: JSONObject.NULL)
        .put("lastReview", card?.lastReview?.toEpochMilli() ?: now.toEpochMilli()).put("failures", 0)
        .put("pausedUntil", 0).put("suspendedUntil", 0).put("cardEditedAt", 0)

    private fun learner(rows: List<JSONObject> = emptyList()) =
        Learner(JSONObject().put("version", 2).put("reviews", JSONArray(rows)))

    private fun row(key: String, at: Instant, example: String, rating: Rating = Rating.AGAIN) =
        JSONObject().put("key", key).put("placement", false).put("log", JSONObject()
            .put("review_datetime", at.toString()).put("rating", rating.name).put("example", example).toString())

    private fun remote(row: JSONObject) = JSONObject(row.toString()).put("reviewId", SyncData.reviewId(row))

    private fun shown(learner: Learner) =
        StudyRules(listOf(entry), learner, emptySet()).shown(Prompt(entry, Skill.Reading), now).example
}
