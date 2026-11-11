package com.randspy.langocard

import io.github.openspacedrepetition.Card
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.Scheduler
import io.github.openspacedrepetition.State
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.time.Instant

class PilotTest {
    @Test fun `inflected clozes preserve the rest of the sentence literally`() {
        val entry = Entry("beau", "avoir beau", "in vain", "Sans résultat.", "Il {a beau} insister, elle refuse.", "daily")
        assertEquals("a beau", entry.answer)
        assertEquals("Il ________ insister, elle refuse.", entry.cloze)
        assertEquals("Il a beau insister, elle refuse.", entry.example)
    }

    @Test fun `backlog and daily budget block new vocabulary`() {
        assertTrue(StudyPolicy.canIntroduce(0, 899, 4))
        assertFalse(StudyPolicy.canIntroduce(1, 0, 0))
        assertFalse(StudyPolicy.canIntroduce(0, 900, 0))
        assertFalse(StudyPolicy.canIntroduce(0, 0, 5))
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

    @Test fun `all 200 entries have unique identities and usable sense specific clozes`() {
        val rows = File("src/main/assets/pilot.tsv").readLines().filter(String::isNotBlank).map { it.split('|') }
        assertEquals(200, rows.size)
        assertEquals(200, rows.map { it.first() }.distinct().size)
        rows.forEach { row ->
            assertEquals(6, row.size)
            assertTrue(row.all(String::isNotBlank))
            val e = Entry(row[0], row[1], row[2], row[3], row[4], row[5])
            assertEquals(1, Regex("\\{[^}]+}").findAll(e.markedExample).count())
            assertTrue(e.answer.isNotBlank())
            assertFalse(e.example.contains('{'))
            assertTrue(e.cloze.contains("________"))
            assertTrue(e.topic in setOf("daily", "culture", "news"))
        }
    }
}
