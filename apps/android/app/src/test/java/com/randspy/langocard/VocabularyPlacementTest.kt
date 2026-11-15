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
}
