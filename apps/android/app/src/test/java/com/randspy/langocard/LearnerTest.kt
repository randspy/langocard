package com.randspy.langocard

import io.github.openspacedrepetition.Card
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.Scheduler
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class LearnerTest {
    private val scheduler = Scheduler.builder().desiredRetention(0.9).build()
    private val entry = Entry("personal-pluie", "la pluie", "the rain", "Eau qui tombe.", listOf(Example("Voici {la pluie}.")), "daily")
    private val reading = entry.cardKey(Skill.Reading)
    private val listening = entry.cardKey(Skill.Listening)
    private val day = "2026-11-12"

    private fun reviewed(id: Int, at: String) = scheduler.reviewCard(Card.builder().cardId(id).build(), Rating.GOOD, Instant.parse(at))
    private fun cardRow(key: String, card: Card?, lastReview: Long) = JSONObject().put("key", key)
        .put("card", card?.toJson() ?: JSONObject.NULL).put("lastReview", lastReview.toDouble()).put("failures", 0.0)
        .put("pausedUntil", 0.0).put("suspendedUntil", 0.0).put("cardEditedAt", 0.0)

    @Test fun `an existing file loads unchanged and reads back as saved`() {
        val card = reviewed(1, "2026-11-10T08:00:00Z")
        val document = JSONObject().put("version", 2)
            .put("extraEntries", JSONArray().put(ContentFiles.entryJson(entry)))
            .put("cards", JSONObject().put(reading, card.card().toJson()))
            .put("reviews", JSONArray().put(JSONObject().put("key", reading).put("placement", false).put("log", card.reviewLog().toJson())))
            .put("buried", JSONObject().put(listening, day)).put("failures", JSONObject().put(reading, 2))
            .put("paused", JSONObject().put(reading, 300L)).put("suspended", JSONObject().put(listening, 400L))
            .put("nextCardId", 4).put("day", day).put("seconds", 310).put("introduced", 2).put("genderIntroduced", 1)
            .put("placementDone", true).put("placementIndex", 18).put("minimumRank", 7001).put("interests", "news,culture")
            .put("preferencesChangedAt", 10L).put("vocabularyPlacementV1", JSONArray().put(true).put(false))
            .put("hooks", JSONObject().put(entry.id, JSONObject().put("entryId", entry.id).put("text", "image").put("editedAt", 20L)))
            .put("sources", JSONArray().put(JSONObject().put("source", "Wiktionary").put("license", "CC BY-SA").put("packId", "fr-1")))
            .put("sync", JSONObject().put("pending", JSONObject()).put("reviews", 1).put("entries", 1).put("sources", 1)
                .put("cursors", JSONObject()).put("generation", 2))
        val saved = document.toString()

        val learner = Learner(document)

        assertEquals("loading changes nothing in the file", saved, document.toString())
        assertEquals(card.card(), learner.card(reading))
        assertTrue(learner.started(entry))
        assertEquals(listOf(entry), learner.extraEntries)
        assertEquals(Rating.GOOD, learner.reviews.single().rating)
        assertTrue(learner.isBuried(listening, day))
        assertFalse(learner.isBuried(reading, day))
        assertEquals(2, learner.failures(reading))
        assertEquals(300L, learner.pausedUntil(reading))
        assertEquals(1, learner.pausedCount(299L))
        assertEquals(1, learner.suspendedCount(399L))
        assertTrue(learner.isPausedOrSuspended(listening, 399L))
        assertFalse(learner.isPausedOrSuspended(listening, 400L))
        assertEquals(4, learner.nextCardId)
        assertEquals(listOf(310, 2, 1), listOf(learner.seconds, learner.introduced, learner.genderIntroduced))
        assertTrue(learner.placementDone)
        assertEquals(18, learner.placementIndex)
        assertEquals(listOf(true, false), learner.vocabularyAnswers)
        assertEquals(7001, learner.minimumRank)
        assertEquals(setOf("news", "culture"), learner.interests)
        assertEquals("image", learner.hook(entry.id))
        assertEquals(listOf("fr-1"), learner.sources.map { it.getString("packId") })
    }

    @Test fun `an answer is saved for sync and logged as backups and the FSRS fit read it`() {
        val learner = Learner(JSONObject().put("version", 2))
        SyncData.markPushed(learner.document, SyncData.outbox(learner.document, day))
        val result = scheduler.reviewCard(learner.newCard(), Rating.GOOD, Instant.parse("2026-11-12T08:00:00Z"))

        learner.answered(reading, result.card(), result.reviewLog(), entry.examples.single(), placement = false)

        assertEquals(result.card(), learner.card(reading))
        val pushed = SyncData.outbox(learner.document, day).cards.single()
        assertEquals(reading, pushed.getString("key"))
        assertEquals(Instant.parse("2026-11-12T08:00:00Z").toEpochMilli(), pushed.getLong("lastReview"))
        val row = learner.document.getJSONArray("reviews").getJSONObject(0)
        assertEquals(setOf("key", "placement", "log"), row.keys().asSequence().toSet())
        assertEquals(reading, row.getString("key"))
        assertFalse(row.getBoolean("placement"))
        val log = JSONObject(row.getString("log"))
        assertEquals("2026-11-12T08:00:00Z", log.getString("review_datetime"))
        assertEquals("Voici {la pluie}.", log.getString("example"))
        assertEquals("Voici {la pluie}.", learner.reviews.single().example)
        assertEquals(Rating.GOOD, learner.reviews.single().rating)
    }

    @Test fun `new cards take IDs past every card, and a synced reset never hands an ID out again`() {
        val newest = reviewed(7, "2026-11-10T08:00:00Z").card()
        val learner = Learner(JSONObject().put("version", 2).put("nextCardId", 5).put("cards", JSONObject()
            .put(reading, reviewed(3, "2026-11-10T08:00:00Z").card().toJson()).put(listening, newest.toJson())))
        learner.merge("cards", listOf(cardRow(listening, null, newest.lastReview.toEpochMilli() + 1)), setOf(entry.id))
        assertNull(learner.card(listening))
        assertEquals(8, learner.newCard().cardId)
        assertEquals(9, SyncData.settings(learner.document).getInt("nextCardId"))

        val production = entry.cardKey(Skill.Production)
        val fromTablet = reviewed(20, "2026-11-11T08:00:00Z").card()
        learner.merge("cards", listOf(cardRow(production, fromTablet, fromTablet.lastReview.toEpochMilli())), setOf(entry.id))
        assertEquals(21, learner.newCard().cardId)
        assertEquals(22, SyncData.settings(learner.document).getInt("nextCardId"))
    }

    @Test fun `a restore continues sync generations and pushes every restored card again`() {
        val current = Learner(JSONObject().put("version", 2))
        SyncData.reset(current.document); SyncData.reset(current.document)
        val backup = JSONObject().put("version", 2).put("cards", JSONObject()
            .put(reading, reviewed(1, "2026-11-10T08:00:00Z").card().toJson())
            .put(listening, reviewed(2, "2026-11-11T08:00:00Z").card().toJson()))

        val restored = current.restoredFrom(backup)

        assertEquals(3, SyncData.generation(restored.document))
        assertEquals(setOf(reading, listening), SyncData.outbox(restored.document, day).cards.map { it.getString("key") }.toSet())
        assertEquals("the live learner is untouched", 2, SyncData.generation(current.document))
    }

    @Test fun `daily rollover clears only daily usage and keeps placement preferences and progress`() {
        val learner = Learner(JSONObject().put("version", 2))
        learner.rollover(day)
        learner.seconds = 100
        learner.introduced = 3
        learner.genderIntroduced = 4
        learner.placementIndex = 12
        learner.placementDone = true
        learner.answerVocabulary(true)
        learner.answerVocabulary(false)
        learner.setMinimumRank(7001)
        learner.setInterests(setOf("news"))
        learner.addEntries(listOf(entry))
        learner.bury(reading, day)
        learner.pause(listening, 500L)
        learner.setFailures(listening, 2)
        val result = reviewed(learner.newCard().cardId, "2026-11-12T08:00:00Z")
        learner.answered(reading, result.card(), result.reviewLog(), entry.examples.single(), true)

        learner.rollover(day)
        assertEquals(listOf(100, 3, 4), listOf(learner.seconds, learner.introduced, learner.genderIntroduced))
        learner.rollover("2026-11-13")
        val reloaded = Learner(JSONObject(learner.document.toString()))

        assertEquals(listOf(0, 0, 0), listOf(reloaded.seconds, reloaded.introduced, reloaded.genderIntroduced))
        assertEquals(12, reloaded.placementIndex)
        assertTrue(reloaded.placementDone)
        assertEquals(listOf(true, false), reloaded.vocabularyAnswers)
        assertEquals(7001, reloaded.minimumRank)
        assertEquals(setOf("news"), reloaded.interests)
        assertEquals(listOf(entry), reloaded.extraEntries)
        assertEquals(result.card(), reloaded.card(reading))
        assertEquals(Rating.GOOD, reloaded.reviews.single().rating)
        assertTrue(reloaded.isBuried(reading, day))
        assertFalse(reloaded.isBuried(reading, "2026-11-13"))
        assertEquals(500L, reloaded.pausedUntil(listening))
        assertEquals(2, reloaded.failures(listening))
        reloaded.retakeVocabulary()
        assertTrue(reloaded.vocabularyAnswers.isEmpty())
        assertFalse(reloaded.document.has("vocabularyPlacementV1"))
    }

    @Test fun `synced settings advance card IDs without losing daily usage or newer preferences`() {
        val learner = Learner(JSONObject().put("version", 2).put("day", day).put("seconds", 100)
            .put("introduced", 3).put("minimumRank", 2501).put("interests", "culture").put("preferencesChangedAt", 20L))
        val remote = SyncData.settings(JSONObject().put("day", day).put("seconds", 80).put("introduced", 4)
            .put("placementDone", true).put("placementIndex", 18).put("nextCardId", 50)
            .put("minimumRank", 7001).put("interests", "news").put("preferencesChangedAt", 10L))

        learner.merge("settings", listOf(remote), emptySet())

        assertEquals(50, learner.newCard().cardId)
        assertEquals(100, learner.seconds)
        assertEquals(4, learner.introduced)
        assertEquals(2501, learner.minimumRank)
        assertEquals(setOf("culture"), learner.interests)
        assertTrue(learner.placementDone)
        assertEquals(18, learner.placementIndex)
        assertEquals(51, Learner(JSONObject(learner.document.toString())).newCard().cardId)
    }

    @Test fun `editing a hook preserves a clock ahead of this device and survives serialization`() {
        val future = System.currentTimeMillis() + 60_000L
        val learner = Learner(JSONObject().put("version", 2).put("hooks", JSONObject().put(entry.id,
            JSONObject().put("entryId", entry.id).put("text", "before").put("editedAt", future))))

        learner.setHook(entry.id, "after")

        val reloaded = Learner(JSONObject(learner.document.toString()))
        assertEquals("after", reloaded.hook(entry.id))
        assertEquals("", reloaded.hook("unknown-entry"))
        val pushed = SyncData.outbox(reloaded.document, day).hooks.single()
        assertEquals("after", pushed.getString("text"))
        assertEquals(future + 1, pushed.getLong("editedAt"))
    }
}
