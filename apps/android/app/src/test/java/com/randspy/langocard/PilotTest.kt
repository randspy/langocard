package com.randspy.langocard

import io.github.openspacedrepetition.Card
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.Scheduler
import io.github.openspacedrepetition.State
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class PilotTest {
    @Test fun `inflected clozes preserve the rest of the sentence literally`() {
        val example = Example("Il {a beau} insister, elle refuse.")
        assertEquals("a beau", example.answer)
        assertEquals("Il ________ insister, elle refuse.", example.cloze)
        assertEquals("Il a beau insister, elle refuse.", example.text)
    }

    @Test fun `examples rotate in order from the introductory one`() {
        val entry = Entry("e", "pourtant", "however", "Malgré cela.",
            listOf("Il pleut, {pourtant} elle sort.", "Il est las, {pourtant} il reste.", "Rien ne va, {pourtant} on rit.").map(::Example), "daily")
        assertEquals(listOf(0, 1, 2, 0, 1), (0..4).map { entry.examples.indexOf(entry.exampleAt(it)) })
        assertEquals(entry.examples.first(), entry.copy(examples = entry.examples.take(1)).exampleAt(7))
    }

    @Test fun `a prompt's example never changes its card key`() {
        val entry = Entry("e", "pourtant", "however", "Malgré cela.",
            listOf("Il pleut, {pourtant} elle sort.", "Il est las, {pourtant} il reste.").map(::Example), "daily")
        assertEquals(Prompt(entry, Skill.Reading).key, Prompt(entry, Skill.Reading, entry.examples[1]).key)
        assertEquals("e:Reading", Prompt(entry, Skill.Reading, entry.examples[1]).key)
    }

    @Test fun `reaching the daily target mid-card ends the session at the next card, not before`() {
        val limit = StudyPolicy.DAILY_SECONDS
        assertTrue(StudyPolicy.sessionOpen(placement = false, seconds = 899, limit = limit))
        assertFalse(StudyPolicy.sessionOpen(placement = false, seconds = 900, limit = limit))
        assertFalse(StudyPolicy.sessionOpen(placement = false, seconds = 1200, limit = limit))
        assertTrue(StudyPolicy.sessionOpen(placement = true, seconds = 1200, limit = limit))
    }

    @Test fun `FSRS survives serialization and skills remain independent`() {
        val now = Instant.parse("2026-11-11T12:00:00Z")
        val reading = Card.builder().cardId(1).due(now).build()
        val production = Card.builder().cardId(2).due(now).build()
        val scheduler = Scheduler.builder().enableFuzzing(false).desiredRetention(0.9).build()
        val result = scheduler.reviewCard(reading, Rating.EASY, now).card()
        val restored = Card.fromJson(result.toJson())
        assertEquals(result, restored)
        assertTrue(restored.due.isAfter(now))
        assertNull(production.lastReview)
        assertNull(reading.lastReview) // previews must not mutate the saved card
        val forgotten = scheduler.reviewCard(restored, Rating.AGAIN, restored.due).card()
        assertTrue(forgotten.due.isAfter(restored.due))
        assertTrue(forgotten.due.isBefore(restored.due.plusSeconds(86400)))
    }

    @Test fun `higher target retention schedules earlier review`() {
        val now = Instant.parse("2026-11-11T12:00:00Z")
        val card = Card.builder().cardId(1).state(State.REVIEW).stability(20.0)
            .difficulty(5.0).due(now).lastReview(now.minusSeconds(20 * 86400)).build()
        fun due(retention: Double) = Scheduler.builder().desiredRetention(retention).enableFuzzing(false).build()
            .reviewCard(card, Rating.GOOD, now).card().due
        assertTrue(due(0.95).isBefore(due(0.9)))
    }
}
