package com.randspy.langocard

import org.junit.Assert.*
import org.junit.Test

class VocabularyListTest {
    private fun entry(word: String, english: String = "meaning of $word", rank: Int = Int.MAX_VALUE, lemma: String = "") =
        Entry("id-$word", word, english, "Définition.", listOf(Example("Voici {$word}.")), "daily", lemma = lemma, rank = rank)

    private fun List<Entry>.words() = map { it.word }

    @Test fun `a search finds the French word or the English meaning, ignoring case`() {
        val house = entry("une maison", "a house")
        assertTrue(house.matches(""))
        assertTrue(house.matches("  "))
        assertTrue(house.matches("maison"))
        assertTrue(house.matches("house"))
        assertTrue(house.matches("MAISON"))
        assertTrue(house.matches("House"))
        assertFalse(house.matches("chat"))
    }

    @Test fun `frequency puts the most frequent first and personal entries last, A to Z`() {
        val entries = listOf(
            entry("le zèbre"), entry("une vie", rank = 2500, lemma = "vie"), entry("une abeille"),
            entry("arriver", rank = 103, lemma = "arriver"), entry("l'arbre"), entry("pourtant", rank = 300, lemma = "pourtant"),
        )
        assertEquals(listOf("arriver", "pourtant", "une vie", "une abeille", "l'arbre", "le zèbre"),
            entries.browse("", VocabularySort.Frequency).words())
    }

    @Test fun `A to Z ignores rank, articles, accents and case`() {
        val entries = listOf(
            entry("être", rank = 5, lemma = "être"), entry("le zèbre"), entry("Étoile"), entry("une école", rank = 900),
            entry("été", rank = 40, lemma = "été"), entry("l’arbre"), entry("eau", rank = 3000, lemma = "eau"),
        )
        assertEquals(listOf("l’arbre", "eau", "une école", "été", "Étoile", "être", "le zèbre"),
            entries.browse("", VocabularySort.Alphabetical).words())
    }

    @Test fun `a search keeps the chosen order`() {
        val entries = listOf(entry("une abeille", "a bee"), entry("partir", "to leave", rank = 116), entry("une table", "a table", rank = 900))
        assertEquals(listOf("une table", "une abeille"), entries.browse("ab", VocabularySort.Frequency).words())
        assertEquals(listOf("une abeille", "une table"), entries.browse("ab", VocabularySort.Alphabetical).words())
    }
}
