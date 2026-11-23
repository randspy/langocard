package com.randspy.langocard

import io.github.openspacedrepetition.Card
import io.github.openspacedrepetition.State
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.time.Instant

/** The same cases invoke real StudyRules on Android and study.next/answer in Convex. */
class SharedStudyRulesFixturesTest {
    @Test fun `shared selection and burials for the skills the web presents`() {
        val fixtures = JSONObject(File("../../../content/study-rules-fixtures.json").readText())
        val now = Instant.parse(fixtures.getString("now"))
        val day = fixtures.getString("day")
        val order = StudyOrder(JSONObject(File("../../../content/study-order.json").readText()))
        val cases = fixtures.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val fixture = cases.getJSONObject(i)
            val name = fixture.getString("name")
            val rows = fixture.getJSONArray("entries")
            val entries = (0 until rows.length()).map { j ->
                val e = rows.getJSONObject(j)
                val examples = e.optJSONArray("examples")?.let { a -> (0 until a.length()).map { Example(a.getString(it)) } }
                    ?: listOf(Example("{Avoir} un."), Example("{Avoir} deux."))
                Entry(e.getString("id"), e.optString("word", "avoir"), "have", "Posséder.", examples,
                    e.optString("topic", "daily"), lemma = e.optString("lemma", ""),
                    rank = if (e.has("rank") && e.isNull("rank")) Int.MAX_VALUE else e.optInt("rank", 2501),
                    gender = Gender.entries.firstOrNull { it.json == e.optString("gender") })
            }
            val cards = JSONObject()
            val paused = JSONObject()
            val memory = fixture.optJSONArray("cards") ?: JSONArray()
            for (j in 0 until memory.length()) {
                val c = memory.getJSONObject(j)
                cards.put(c.getString("key"), Card.builder().cardId(j).state(State.REVIEW).stability(10.0).difficulty(5.0)
                    .due(now.plusSeconds(c.getLong("due"))).lastReview(now.plusSeconds(c.optLong("lastReview", -86400))).build().toJson())
                if (c.has("pausedUntil")) paused.put(c.getString("key"), now.plusSeconds(c.getLong("pausedUntil")).toEpochMilli())
            }
            val reviews = JSONArray()
            val answers = fixture.optJSONArray("reviews") ?: JSONArray()
            for (j in 0 until answers.length()) {
                val r = answers.getJSONObject(j)
                reviews.put(JSONObject().put("key", r.getString("key")).put("placement", false).put("log", JSONObject()
                    .put("cardId", 0).put("rating", "AGAIN").put("review_datetime", now.plusSeconds(r.getLong("at")).toString())
                    .put("reviewDuration", JSONObject.NULL).put("example", r.getString("example")).toString()))
            }
            val learner = Learner(JSONObject().put("version", 2).put("day", day).put("cards", cards).put("reviews", reviews).put("paused", paused)
                .put("seconds", fixture.optInt("seconds")).put("introduced", fixture.optInt("introduced")).put("genderIntroduced", fixture.optInt("genderIntroduced"))
                .put("minimumRank", fixture.optInt("minimumRank", 1)).put("interests", fixture.optJSONArray("interests")?.let { a -> (0 until a.length()).joinToString(",") { a.getString(it) } } ?: "daily,culture,news"))
            val rules = StudyRules(entries, learner, emptySet(), supported = setOf(Skill.Reading, Skill.Production, Skill.Gender), order = order)
            val chosen = rules.choose(false, PracticeBlock.DAILY, SessionLearning(), now, day)
            val expected = if (fixture.isNull("next")) null else fixture.getString("next")
            assertEquals(name, expected, chosen?.key)
            if (chosen != null) {
                assertEquals(name, fixture.optString("example", "{Avoir} un."), rules.shown(chosen, now).example.marked)
                if (fixture.has("burials")) {
                    val expectedBurials = fixture.getJSONArray("burials").let { a -> (0 until a.length()).map { a.getString(it) } }
                    assertEquals(name, expectedBurials.sorted(), rules.siblingsToBury(chosen, false).sorted())
                }
            }
        }
    }
}
