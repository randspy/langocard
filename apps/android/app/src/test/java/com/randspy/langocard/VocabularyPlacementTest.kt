package com.randspy.langocard

import org.junit.Assert.assertEquals
import org.junit.Test

class VocabularyPlacementTest {
    private val items = (0..2).flatMap { band -> List(20) { PlacementItem("word", band) } } + List(30) { PlacementItem("invented", -1) }
    private val test = VocabularyPlacement(items)

    @Test fun bundledItemsAreDistinctAndMatchTheScoringContract() {
        val json = org.json.JSONArray(java.io.File("src/main/assets/placement-items.json").readText())
        val bundled = (0 until json.length()).map { i -> json.getJSONObject(i).let { PlacementItem(it.getString("word"), it.getInt("band")) } }
        val actual = VocabularyPlacement(bundled)
        assertEquals(90, bundled.map { it.word }.distinct().size)
        assertEquals(7001, actual.startingRank(bundled.map { it.band >= 0 }))
        assertEquals(1, actual.startingRank(bundled.map { true }))
    }

    @Test fun guessingAndSilenceDoNotAdvance() {
        assertEquals(1, test.startingRank(List(90) { true }))
        assertEquals(1, test.startingRank(List(90) { false }))
        assertEquals(1, test.startingRank(List(90) { it % 2 == 0 }))
    }

    @Test fun requiresContiguousBandsAndPenalizesFalseAlarms() {
        assertEquals(7001, test.startingRank(List(90) { it < 60 }))
        assertEquals(2501, test.startingRank(List(90) { it < 20 }))
        assertEquals(1, test.startingRank(List(90) { it in 20..59 }))
        assertEquals(7001, test.startingRank(List(90) { it < 16 || it in 20..35 }))
        assertEquals(1, test.startingRank(List(90) { it < 16 || it in 20..35 || it == 60 }))
    }

    @Test fun `scoring matches the web on the shared fixtures`() {
        val items = org.json.JSONArray(java.io.File("../../../content/placement-items.json").readText()).let { a ->
            (0 until a.length()).map { i -> a.getJSONObject(i).let { PlacementItem(it.getString("word"), it.getInt("band")) } }
        }
        assertEquals("the app's copy is the shared file", java.io.File("../../../content/placement-items.json").readText(),
            java.io.File("src/main/assets/placement-items.json").readText())
        val placement = VocabularyPlacement(items)
        val cases = org.json.JSONObject(java.io.File("../../../content/placement-fixtures.json").readText()).getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val answers = case.getString("answers").map { it == '1' }
            assertEquals(case.getString("name"), case.getInt("startingRank"), placement.startingRank(answers))
            val hits = placement.adjustedHits(answers)
            val expected = case.getJSONArray("adjustedHits")
            for (band in 0..2) assertEquals(case.getString("name"), expected.getDouble(band), hits[band], 1e-9)
        }
    }
}
