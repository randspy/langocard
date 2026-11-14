package com.randspy.langocard

import io.github.openspacedrepetition.Rating
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class GenderTest {
    private fun noun(id: String, word: String, gender: Gender? = Gender.ofArticle(word)) =
        Entry(id, word, "meaning $id", "Définition.", listOf(Example("Voici {$word}.")), "daily", gender = gender)

    @Test fun `the article states the gender and the noun is the word without it`() {
        assertEquals(Gender.Feminine, Gender.ofArticle("une intrigue"))
        assertEquals(Gender.Masculine, Gender.ofArticle("Le problème"))
        assertNull(Gender.ofArticle("l'arbre"))
        assertNull(Gender.ofArticle("unique"))
        assertEquals("intrigue", Gender.noun("une intrigue"))
        assertEquals("arbre", Gender.noun("l’arbre"))
    }

    @Test fun `content written before gender existed takes the article gender`() {
        val legacy = JSONObject().put("id", "personal-1").put("word", "une intrigue").put("english", "a plot")
            .put("definition", "Récit.").put("examples", JSONArray().put("Voici {une intrigue}.")).put("topic", "daily")
        assertEquals(Gender.Feminine, ContentFiles.readEntries(JSONArray().put(legacy)).single().gender)
        assertNull(ContentFiles.readEntries(JSONArray().put(JSONObject(legacy.toString()).put("gender", JSONObject.NULL))).single().gender)
    }

    @Test fun `gender survives a round trip and sync rows`() {
        val entry = noun("personal-1", "l'arbre", Gender.Masculine)
        assertEquals(entry, ContentFiles.readEntries(JSONArray().put(ContentFiles.entryJson(entry))).single())
        assertEquals("masculine", SyncData.entryRow(entry).getString("gender"))
        assertEquals(Gender.Masculine, SyncData.rowEntry(SyncData.entryRow(entry))?.gender)
    }

    @Test fun `only nouns are studied for gender`() {
        assertFalse(Skill.Gender in noun("a", "pourtant").skills)
        assertTrue(Skill.Gender in noun("b", "une intrigue").skills)
        assertEquals(listOf(Skill.Reading, Skill.Listening, Skill.Production), Skill.placement)
    }

    @Test fun `a gender card grades itself`() {
        assertEquals(Rating.GOOD, Gender.Feminine.grade(Gender.Feminine))
        assertEquals(Rating.AGAIN, Gender.Feminine.grade(Gender.Masculine))
    }

    @Test fun `one meaning per noun owns the gender card - the first introduced`() {
        val point1 = noun("p1", "un point"); val point2 = noun("p2", "un point"); val plot = noun("i1", "une intrigue")
        val cards = mapOf("p1:Reading" to 7, "p2:Reading" to 3, "p2:Production" to 9)
        assertEquals(setOf("p2"), GenderCards.owners(listOf(point1, point2, plot), cards::get))
    }

    @Test fun `a meaning that already has a gender card keeps it`() {
        val point1 = noun("p1", "un point"); val point2 = noun("p2", "un point")
        val cards = mapOf("p1:Reading" to 7, "p1:Gender" to 8, "p2:Reading" to 3)
        assertEquals(setOf("p1"), GenderCards.owners(listOf(point1, point2), cards::get))
        // Deleting the owner hands the role to the next meaning.
        assertEquals(setOf("p2"), GenderCards.owners(listOf(point2), cards::get))
    }

    @Test fun `homographs of different gender are separate nouns`() {
        val book = noun("l1", "un livre"); val pound = noun("l2", "une livre")
        val cards = mapOf("l1:Reading" to 1, "l2:Reading" to 2)
        assertEquals(setOf("l1", "l2"), GenderCards.owners(listOf(book, pound), cards::get))
    }
}
