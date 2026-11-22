package com.randspy.langocard

import org.junit.Assert.assertEquals
import org.junit.Test

class ExampleTest {
    @Test fun aLoneAnswerIsTheTarget() {
        val example = Example("Il pleut, {pourtant} elle sort.")
        assertEquals("pourtant", example.answer)
        assertEquals(emptyList<String>(), example.alternatives)
        assertEquals("Il pleut, pourtant elle sort.", example.text)
        assertEquals("Il pleut, ________ elle sort.", example.cloze)
    }

    @Test fun alternativesFollowTheTargetAndStayOutOfTheSentence() {
        val example = Example("Le train devrait {arriver | parvenir|atteindre la gare} à la gare.")
        assertEquals("arriver", example.answer)
        assertEquals(listOf("parvenir", "atteindre la gare"), example.alternatives)
        assertEquals("Le train devrait arriver à la gare.", example.text)
        assertEquals("Le train devrait ________ à la gare.", example.cloze)
        assertEquals("Le train devrait {arriver} à la gare.", example.withoutAlternatives)
    }

    @Test fun aBarOutsideTheAnswerIsText() {
        val example = Example("A | B : {arriver}.")
        assertEquals("A | B : arriver.", example.text)
        assertEquals(emptyList<String>(), example.alternatives)
    }
}
