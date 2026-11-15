package com.randspy.langocard

import io.github.openspacedrepetition.Rating
import org.junit.Assert.*
import org.junit.Test

class TypedAnswerTest {
    private fun check(typed: String, answer: String) = TypedAnswer.of(typed, Example("Voici {$answer} ici."), noun = true)!!
    private fun suggested(typed: String, answer: String) = check(typed, answer).match.suggested
    private fun marked(parts: List<AnswerPart>) = parts.filter { it.marked }.map { it.text }

    @Test fun `an empty answer suggests nothing`() {
        assertNull(TypedAnswer.of("", Example("Voici {une intrigue}.")))
        assertNull(TypedAnswer.of("   ", Example("Voici {une intrigue}.")))
    }

    @Test fun `the same answer ignoring case and spacing suggests Good`() {
        assertEquals(Rating.GOOD, suggested("une intrigue", "une intrigue"))
        assertEquals(Rating.GOOD, suggested("  Une INTRIGUE ", "une intrigue"))
        assertEquals(Rating.GOOD, suggested("pourtant", "Pourtant"))
        assertEquals(Rating.GOOD, suggested("l'intrigue", "l’intrigue"))
    }

    @Test fun `the right noun with another article or none suggests Hard`() {
        assertEquals(Rating.HARD, suggested("un intrigue", "une intrigue"))
        assertEquals(Rating.HARD, suggested("intrigue", "une intrigue"))
        assertEquals(Rating.HARD, suggested("le arbre", "l'arbre"))
        assertEquals(Rating.HARD, suggested("la porte", "une porte"))
        assertEquals(AnswerMatch.Article, check("un intrigue", "une intrigue").match)
    }

    @Test fun `missing, wrong or extra accents suggest Hard`() {
        assertEquals(Rating.HARD, suggested("un probleme", "un problème"))
        assertEquals(Rating.HARD, suggested("un problême", "un problème"))
        assertEquals(Rating.HARD, suggested("fiablé", "fiable"))
        assertEquals(Rating.HARD, suggested("mettre en oeuvre", "mettre en œuvre"))
        assertEquals(AnswerMatch.Accents, check("se mefier", "se méfier").match)
    }

    @Test fun `anything else suggests Again`() {
        assertEquals(Rating.AGAIN, suggested("une intrige", "une intrigue"))
        assertEquals(Rating.AGAIN, suggested("une affaire", "une intrigue"))
        assertEquals(Rating.AGAIN, suggested("une", "une intrigue"))
        assertEquals(Rating.AGAIN, suggested("méfier", "se méfier"))
    }

    @Test fun `the answer is the form the sentence uses, not the dictionary word`() {
        val example = Example("Il s'en est {rendu compte} trop tard.")
        assertEquals(AnswerMatch.Exact, TypedAnswer.of("rendu compte", example)!!.match)
        assertEquals(AnswerMatch.Different, TypedAnswer.of("se rendre compte", example)!!.match)
    }

    @Test fun `the difference marks the letters each side lacks`() {
        val accents = check("probleme", "problème")
        assertEquals(listOf(AnswerPart("probl", false), AnswerPart("e", true), AnswerPart("me", false)), accents.typedParts)
        assertEquals(listOf(AnswerPart("probl", false), AnswerPart("è", true), AnswerPart("me", false)), accents.expectedParts)

        val article = check("un intrigue", "une intrigue")
        assertEquals(listOf(AnswerPart("un intrigue", false)), article.typedParts)
        assertEquals(listOf("e"), marked(article.expectedParts))
        assertEquals("une intrigue", article.expectedParts.joinToString("") { it.text })
    }

    @Test fun `the difference ignores what an exact match ignores`() {
        val answer = check(" Pourtant ", "pourtant")
        assertEquals(listOf(AnswerPart("Pourtant", false)), answer.typedParts)
        assertEquals(listOf(AnswerPart("pourtant", false)), answer.expectedParts)
        assertEquals(emptyList<String>(), marked(check("l'intrigue", "l’intrigue").typedParts))
    }

    @Test fun `articles do not turn a non noun into a partial recall`() {
        assertEquals(AnswerMatch.Different, TypedAnswer.of("la pourtant", Example("{pourtant}"))!!.match)
    }

    @Test fun `canonical unicode accents match and internal spaces matter`() {
        assertEquals(Rating.GOOD, suggested("ide\u0301e", "idée"))
        assertEquals(Rating.AGAIN, suggested("une  intrigue", "une intrigue"))
    }

    @Test fun `a missed space is marked`() {
        assertEquals(listOf(" "), marked(check("uneintrigue", "une intrigue").expectedParts))
    }
}
