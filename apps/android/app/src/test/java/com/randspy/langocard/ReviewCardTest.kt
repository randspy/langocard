package com.randspy.langocard

import io.github.openspacedrepetition.Rating
import org.junit.Assert.*
import org.junit.Test

class ReviewCardTest {
    private val noun = Entry("noun", "une idée", "an idea", "Une pensée.",
        listOf(Example("Voici {une idée}."), Example("Elle a {des idées}.")), "daily", gender = Gender.Feminine)

    private fun card(skill: Skill, example: Example = noun.examples.first()) = ReviewCard.question(Prompt(noun, skill, example))

    @Test fun `reading can reveal without sound and never accepts typed or gender input`() {
        val question = card(Skill.Reading).type("une idée").choose(Gender.Masculine).played(true)
        assertFalse(question.revealed)
        assertEquals("", question.typed)
        assertNull(question.chosen)
        assertFalse(question.played)
        assertTrue(question.canReveal(audioAvailable = false, speaking = true))
        val answer = question.reveal(audioAvailable = false, speaking = true)
        assertTrue(answer.revealed)
        assertNull(answer.comparison)
        assertNull(answer.select(Rating.EASY).ratingToConfirm)
    }

    @Test fun `production compares the sentence form and freezes feedback and selection after reveal`() {
        val question = card(Skill.Production, noun.examples[1]).type("des idees")
        assertNull(question.comparison)
        val answer = question.reveal(audioAvailable = false, speaking = true)
        assertTrue(answer.revealed)
        assertEquals("des idées", answer.comparison!!.expected)
        assertEquals(AnswerMatch.Accents, answer.comparison!!.match)
        assertEquals(Rating.HARD, answer.ratingToConfirm)
        val selected = answer.select(Rating.GOOD).type("wrong").choose(Gender.Masculine)
        assertEquals("des idees", selected.comparison!!.typed)
        assertEquals(Rating.GOOD, selected.reveal(true, false).ratingToConfirm)
        assertNull(selected.chosen)
        assertEquals(noun.cardKey(Skill.Production), selected.prompt.key)
    }

    @Test fun `an empty or whitespace gap answer reveals for direct self rating`() {
        listOf("", "  ").forEach { typed ->
            val answer = card(Skill.Production).type(typed).reveal(false, false)
            assertTrue(answer.revealed)
            assertNull(answer.comparison)
            assertNull(answer.ratingToConfirm)
        }
    }

    @Test fun `typing uses the existing length limit and noun article comparison`() {
        assertEquals(200, card(Skill.Production).type("a".repeat(201)).typed.length)
        val answer = card(Skill.Production).type("un idée").reveal(true, false)
        assertEquals(AnswerMatch.Article, answer.comparison!!.match)
        assertEquals(Rating.HARD, answer.ratingToConfirm)
    }

    @Test fun `listening requires successful playback that has finished with audio still available`() {
        val question = card(Skill.Listening).type("une idée")
        assertFalse(question.canReveal(true, false))
        assertFalse(question.reveal(true, false).revealed)
        assertFalse(question.played(false).canReveal(true, false))
        val played = question.played(true).played(false)
        assertTrue(played.played)
        assertFalse(played.reveal(true, true).revealed)
        assertFalse(played.reveal(false, false).revealed)
        val answer = played.reveal(true, false)
        assertTrue(answer.revealed)
        assertTrue(answer.played)
        assertEquals(AnswerMatch.Exact, answer.comparison!!.match)
        assertEquals(Rating.GOOD, answer.ratingToConfirm)
    }

    @Test fun `gender choice reveals once and supplies its own grade`() {
        val question = card(Skill.Gender).type("une").played(true)
        assertFalse(question.canReveal(true, false))
        assertFalse(question.reveal(true, false).revealed)
        Gender.entries.forEach { choice ->
            val answer = question.choose(choice)
            assertTrue(answer.revealed)
            assertEquals(choice, answer.chosen)
            assertEquals(Gender.Feminine.grade(choice), answer.select(Rating.EASY).ratingToConfirm)
            assertEquals(choice, answer.choose(Gender.Masculine).chosen)
            assertNull(answer.comparison)
        }
    }

    @Test fun `a repeated prompt starts with fresh input playback feedback and rating`() {
        val prompt = Prompt(noun, Skill.Listening)
        val answered = ReviewCard.question(prompt).type("une idée").played(true).reveal(true, false).select(Rating.EASY)
        val repeated = ReviewCard.question(answered.prompt)
        assertFalse(repeated.revealed)
        assertFalse(repeated.played)
        assertEquals("", repeated.typed)
        assertNull(repeated.comparison)
        assertNull(repeated.ratingToConfirm)
        assertEquals(answered.prompt.key, repeated.prompt.key)
    }
}
