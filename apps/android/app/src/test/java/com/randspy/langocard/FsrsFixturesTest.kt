package com.randspy.langocard

import io.github.openspacedrepetition.Card
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.ReviewLog
import io.github.openspacedrepetition.Scheduler
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Duration
import java.time.Instant
import java.util.Random

/**
 * Writes `content/fsrs-fixtures.json` from the real java-fsrs, so the TypeScript port in
 * `apps/backend/convex/fsrs.ts` can prove it schedules identically. Fails when the committed
 * file is stale; delete it and run the test again to regenerate.
 */
class FsrsFixturesTest {
    private val file = File("../../../content/fsrs-fixtures.json")
    private val start = Instant.parse("2026-01-05T08:00:00Z")
    private val fitted = doubleArrayOf(
        0.3, 1.4, 3.9, 14.2, 6.8, 0.61, 1.9, 0.012, 1.48, 0.13, 0.98, 1.92,
        0.1, 0.31, 2.1, 0.25, 2.8, 0.6, 0.4, 0.15, 0.32)

    private fun schedulers() = linkedMapOf(
        "default" to { Scheduler.builder().enableFuzzing(false).build() },
        "fitted" to { Scheduler.builder().parameters(fitted).desiredRetention(0.85).enableFuzzing(false).build() },
        // Android schedules with fuzzing on; java.util.Random(42) makes it reproducible per scheduler.
        "fuzzed" to { Scheduler.builder().build() },
    )

    private fun schedulerJson(name: String, scheduler: Scheduler) = JSONObject().put("name", name)
        .put("parameters", JSONArray(scheduler.parameters.toList()))
        .put("desiredRetention", scheduler.desiredRetention)
        .put("enableFuzzing", scheduler.isEnableFuzzing)
        .put("randomSeed", scheduler.randomSeedNumber)

    /** A deterministic history: ratings at gaps from minutes to months, early, on time and late. */
    private fun case(name: String, schedulerName: String, scheduler: Scheduler, seed: Long, steps: Int): JSONObject {
        val random = Random(seed)
        var card = Card.builder().cardId(seed.toInt()).due(start).build()
        var now = start
        val rows = JSONArray()
        repeat(steps) {
            val rating = Rating.entries[random.nextInt(4)]
            val before = card.toJson()
            val result = scheduler.reviewCard(card, rating, now)
            rows.put(JSONObject().put("card", before).put("rating", rating.name).put("reviewDatetime", now.toString())
                .put("expectedCard", result.card().toJson()).put("expectedLog", result.reviewLog().toJson()))
            card = result.card()
            val untilDue = Duration.between(now, card.due).toMillis()
            val gap = when (random.nextInt(5)) {
                0 -> untilDue / 2                                 // early
                1 -> untilDue                                     // on time
                2 -> untilDue + random.nextInt(3 * 86_400) * 1000L // a little late
                3 -> untilDue * (2 + random.nextInt(3))          // much later
                else -> random.nextInt(600) * 1000L + 1000L      // minutes later, within the day
            }
            now = now.plusMillis(maxOf(gap, 1000L) + random.nextInt(1000))
        }
        return JSONObject().put("name", name).put("scheduler", schedulerName).put("steps", rows)
    }

    private fun intervals(): JSONArray {
        val now = Instant.parse("2026-03-01T10:00:00.250Z")
        return JSONArray(listOf(0L, 1L, 59_000L, 60_000L, 61_000L, 600_000L, 3_599_999L, 3_600_000L, 10_799_000L,
            86_399_000L, 86_400_000L, 4 * 86_400_000L + 3_600_000L, 365 * 86_400_000L, -5_000L).map { delta ->
            val due = now.plusMillis(delta)
            JSONObject().put("now", now.toString()).put("due", due.toString()).put("label", StudyPolicy.interval(now, due))
        })
    }

    private fun generate(): JSONObject {
        val cases = JSONArray()
        val names = JSONArray()
        for ((name, make) in schedulers()) {
            names.put(schedulerJson(name, make()))
            for (i in 0 until 20) cases.put(case("$name #$i", name, make(), 1_000L + i, 14))
        }
        // Phones may write micro- or nanosecond times; a review just short of a whole day is still the same day.
        for (last in listOf("2026-01-01T00:00:00.000001Z", "2026-01-01T00:00:00.000000001Z", "2026-01-01T00:00:00.123456Z")) {
            val lastReview = Instant.parse(last)
            val card = Card.builder().cardId(9).state(io.github.openspacedrepetition.State.REVIEW).stability(5.0).difficulty(5.0)
                .lastReview(lastReview).due(lastReview.plus(Duration.ofDays(5))).build()
            val scheduler = schedulers().getValue("default")()
            val at = Instant.parse("2026-01-02T00:00:00Z").plusMillis(lastReview.toEpochMilli() % 1000)
            val result = scheduler.reviewCard(card, Rating.GOOD, at)
            cases.put(JSONObject().put("name", "precise $last").put("scheduler", "default").put("steps", JSONArray().put(
                JSONObject().put("card", card.toJson()).put("rating", "GOOD").put("reviewDatetime", at.toString())
                    .put("expectedCard", result.card().toJson()).put("expectedLog", result.reviewLog().toJson()))))
        }
        // A card serialised before its first answer, as `Learner.newCard` builds it.
        val log = ReviewLog(7, Rating.HARD, Instant.parse("2026-01-05T08:00:00.123Z"), 3200)
        return JSONObject()
            .put("note", "Generated by FsrsFixturesTest from java-fsrs 1.0.0; do not edit.")
            .put("schedulers", names).put("cases", cases).put("intervals", intervals())
            .put("serialised", JSONObject().put("newCard", Card.builder().cardId(3).due(start).build().toJson())
                .put("logWithDuration", log.toJson()))
    }

    @Test fun `fixtures match java-fsrs`() {
        val text = generate().toString(1) + "\n"
        if (!file.exists()) file.writeText(text)
        assertEquals("content/fsrs-fixtures.json is stale; delete it and rerun this test", text, file.readText())
    }

    /** `content/fsrs-typescript-output.json` is written by the TypeScript port's tests. */
    @Test fun `cards and logs the TypeScript port writes parse unchanged`() {
        val output = JSONObject(File("../../../content/fsrs-typescript-output.json").readText())
        for (key in listOf("cards", "logs")) {
            val items = output.getJSONArray(key)
            assertTrue(items.length() > 10)
            for (i in 0 until items.length()) {
                val json = items.getString(i)
                assertEquals(json, if (key == "cards") Card.fromJson(json).toJson() else ReviewLog.fromJson(json).toJson())
            }
        }
    }
}
