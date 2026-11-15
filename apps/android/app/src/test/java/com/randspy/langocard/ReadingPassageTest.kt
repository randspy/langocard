package com.randspy.langocard

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class ReadingPassageTest {
    private fun entry(id: String, word: String) = Entry(id, word, "meaning", "definition", listOf(Example("{mot}")), "daily")
    private val vocabulary = PassageVocabulary((1..20).map { entry("$it", "ami") }, listOf(entry("due", "ami")))
    private val prose = List(10) { "Un ami est dans la rue." }.joinToString(" ")

    @Test fun `length coverage and due inclusion are mandatory`() {
        val v = vocabulary.copy(known = vocabulary.known + entry("rue", "rue"))
        assertTrue(PassageDrafter.accepts(prose, v))
        assertFalse(PassageDrafter.accepts("Un ami.", v))
        assertFalse(PassageDrafter.accepts(List(101) { "ami" }.joinToString(" "), v))
        assertFalse(PassageDrafter.accepts(List(50) { "inconnu" }.joinToString(" "), v))
        assertFalse(PassageDrafter.accepts(List(50) { "la" }.joinToString(" "), v))
    }
    @Test fun `retry rejects invalid output and prompt carries the vocabulary`() = runBlocking {
        val prompts = mutableListOf<String>()
        val valid = List(50) { "ami" }.joinToString(" ")
        val result = PassageDrafter { prompt -> prompts += prompt; if (prompts.size == 1) "bad" else valid }.draft(vocabulary)
        assertEquals(valid, result)
        assertEquals(2, prompts.size)
        assertTrue(prompts.first().contains("50 to 100"))
        assertTrue(prompts.first().contains("95%"))
        assertTrue(prompts.first().contains("ami"))
    }
    @Test fun `coverage threshold is enforced at token boundaries`() {
        val good = List(95) { "ami" } + List(5) { "inconnu" }
        val bad = List(94) { "ami" } + List(6) { "inconnu" }
        assertTrue(PassageDrafter.accepts(good.joinToString(" "), vocabulary))
        assertFalse(PassageDrafter.accepts(bad.joinToString(" "), vocabulary))
    }
    @Test fun `model is never called without enough known entries`() = runBlocking {
        try {
            PassageDrafter { error("Must not generate") }.draft(vocabulary.copy(known = emptyList()))
            fail("Expected vocabulary explanation")
        } catch (_: IllegalArgumentException) { }
    }
    @Test fun `two invalid replies report failure`() = runBlocking {
        var calls = 0
        try { PassageDrafter { calls++; "bad" }.draft(vocabulary); fail("Expected failure") }
        catch (_: IllegalStateException) { assertEquals(2, calls) }
    }
    @Test fun `lookup preserves accents and returns ambiguous library senses`() {
        val entries = listOf(entry("1", "un été"), entry("2", "été"), entry("3", "être"))
        assertEquals(2, PassageDrafter.meanings("ÉTÉ,", entries).size)
        assertEquals(listOf("l", "ami"), PassageDrafter.tokens("L’ami"))
        assertTrue(PassageDrafter.meanings("ete", entries).isEmpty())
    }
}
