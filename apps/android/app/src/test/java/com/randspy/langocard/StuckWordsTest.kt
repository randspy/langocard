package com.randspy.langocard

import org.junit.Assert.assertEquals
import org.junit.Test

class StuckWordsTest {
    private val a = Example("A {mot}.")
    private val b = Example("B {mot}.")
    private val c = Example("C {mot}.")
    private val entry = Entry("e", "mot", "word", "Un mot.", listOf(a, b, c), "daily")
    @Test fun returnPrefersAnExampleAbsentFromRecentFailures() {
        assertEquals(c, StuckWords.returningExample(entry, 6, listOf(a.marked, b.marked, a.marked, b.marked)))
    }
    @Test fun allFailedUsesLeastRecentlyFailedExample() {
        assertEquals(c, StuckWords.returningExample(entry, 6, listOf(a.marked, c.marked, a.marked, b.marked)))
    }
    @Test fun oldHistoryAvoidsPreviousRotationExample() {
        assertEquals(b, StuckWords.returningExample(entry, 4, emptyList()))
    }
    @Test fun failuresRecordedBeforeAlternativesStillCount() {
        val withAlternatives = entry.copy(examples = listOf(Example("A {mot|terme}."), b, c))
        assertEquals(c, StuckWords.returningExample(withAlternatives, 6, listOf(a.marked, b.marked)))
    }
    @Test fun singleExampleFallsBack() {
        assertEquals(a, StuckWords.returningExample(entry.copy(examples = listOf(a)), 4, listOf(a.marked)))
    }
}
