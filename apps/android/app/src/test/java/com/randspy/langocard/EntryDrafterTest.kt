package com.randspy.langocard

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class EntryDrafterTest {
    private val realise = listOf("Elle {s'est rendu compte} du problème.", "Je {me rends compte} de mon erreur.", "Ils vont {se rendre compte} du danger.")
    private val complete = """{"word":"se rendre compte","gender":"none","definition":"Comprendre soudain quelque chose.","examples":${json(realise)}}"""
    private val plot = """{"word":"une intrigue","gender":"feminine","definition":"Ensemble des événements d'une fiction.","examples":["Ce roman développe {une intrigue} complexe.","On devine vite {l'intrigue}.","La série suit {une intrigue} pleine de surprises."]}"""
    private fun json(examples: List<String>) = org.json.JSONArray(examples).toString()

    /** A model that answers with each reply in turn and remembers the prompts it was given. */
    private class FakeModel(vararg replies: String) {
        private val queue = ArrayDeque(replies.toList())
        val prompts = mutableListOf<String>()
        val generate: suspend (String) -> String = { prompt -> prompts += prompt; queue.removeFirst() }
    }

    @Test fun `drafts every field the learner left blank`() = runBlocking {
        val model = FakeModel("Sure! Here it is:\n```json\n$complete\n```")
        val draft = EntryDrafter(model.generate).draft("to realise", kept = emptyMap())
        assertEquals(mapOf(
            DraftField.Word to "se rendre compte",
            DraftField.Gender to "none",
            DraftField.Definition to "Comprendre soudain quelque chose.",
        ), draft.filled)
        assertEquals(realise, draft.examples)
        assertTrue(draft.unfilled.isEmpty())
        assertEquals(1, model.prompts.size)
        assertTrue(model.prompts.single().contains("English meaning: to realise"))
    }

    @Test fun `never replaces what the learner wrote and tells the model about it`() = runBlocking {
        val model = FakeModel(complete)
        val draft = EntryDrafter(model.generate).draft("to realise", kept = mapOf(DraftField.Word to "réaliser"))
        assertEquals(setOf(DraftField.Gender, DraftField.Definition), draft.filled.keys)
        assertEquals(3, draft.examples.size)
        assertTrue(model.prompts.single().contains("French word: réaliser"))
    }

    @Test fun `adds examples next to the learner's, up to three, never repeating them`() = runBlocking {
        val model = FakeModel(complete)
        val own = "Je {me rends compte} de mon erreur."
        val draft = EntryDrafter(model.generate).draft("to realise", kept = emptyMap(), keptExamples = listOf(own))
        assertEquals(listOf(realise[0], realise[2]), draft.examples)
        assertTrue(model.prompts.single().contains("Example: $own"))
    }

    @Test fun `drafts no examples when the learner wrote three`() = runBlocking {
        val model = FakeModel(complete)
        val draft = EntryDrafter(model.generate).draft("to realise", kept = emptyMap(), keptExamples = listOf("{a} b.", "{c} d.", "{e} f."))
        assertTrue(draft.examples.isEmpty())
        assertFalse(DraftField.Examples in draft.unfilled)
    }

    @Test fun `keeps the usable examples of a reply and retries for the rest`() = runBlocking {
        val partly = complete.replace(json(realise), json(listOf(realise[0], "Sans réponse.", realise[0])))
        val model = FakeModel(partly, partly)
        val draft = EntryDrafter(model.generate).draft("to realise", kept = emptyMap())
        assertEquals(2, model.prompts.size)
        assertEquals(listOf(realise[0]), draft.examples)
        assertTrue(draft.unfilled.isEmpty())
    }

    @Test fun `retries once when the reply is unusable`() = runBlocking {
        val model = FakeModel("Désolé, je ne peux pas.", complete)
        val draft = EntryDrafter(model.generate).draft("to realise", kept = emptyMap())
        assertEquals(3, draft.filled.size)
        assertEquals(3, draft.examples.size)
        assertEquals(2, model.prompts.size)
    }

    @Test fun `keeps the better attempt and reports fields it could not draft`() = runBlocking {
        val noAnswer = """{"word":"se rendre compte","gender":"none","definition":"Comprendre soudain quelque chose.","examples":["Elle s'est rendu compte du problème."]}"""
        val twoAnswers = """{"word":"","definition":"","examples":["{Elle} {comprend}."]}"""
        val model = FakeModel(noAnswer, twoAnswers)
        val draft = EntryDrafter(model.generate).draft("to realise", kept = emptyMap())
        assertEquals(setOf(DraftField.Word, DraftField.Gender, DraftField.Definition), draft.filled.keys)
        assertEquals(setOf(DraftField.Examples), draft.unfilled)
        assertEquals(2, model.prompts.size)
    }

    @Test fun `treats non-text values as missing`() = runBlocking {
        val model = FakeModel("""{"word":false,"definition":123,"examples":["Elle {s'est rendu compte} du problème.", 7]}""", """{"word":null}""")
        val draft = EntryDrafter(model.generate).draft("to realise", kept = emptyMap())
        assertTrue(draft.filled.isEmpty())
        assertEquals(listOf("Elle {s'est rendu compte} du problème."), draft.examples)
        assertEquals(setOf(DraftField.Word, DraftField.Gender, DraftField.Definition), draft.unfilled)
    }

    @Test fun `drafts a noun's gender`() = runBlocking {
        val draft = EntryDrafter(FakeModel(plot).generate).draft("a plot", kept = emptyMap())
        assertEquals("feminine", draft.filled[DraftField.Gender])
    }

    @Test fun `a gender contradicting the article is retried, then the article decides`() = runBlocking {
        val wrong = plot.replace("\"feminine\"", "\"masculine\"")
        val model = FakeModel(wrong, wrong)
        val draft = EntryDrafter(model.generate).draft("a plot", kept = emptyMap())
        assertEquals(2, model.prompts.size)
        assertEquals("feminine", draft.filled[DraftField.Gender])
        assertTrue(draft.unfilled.isEmpty())
    }

    @Test fun `the learner's word decides the gender, and their gender is kept`() = runBlocking {
        val fromWord = EntryDrafter(FakeModel(plot.replace("\"feminine\"", "\"none\"")).generate)
            .draft("a plot", kept = mapOf(DraftField.Word to "une intrigue"))
        assertEquals("feminine", fromWord.filled[DraftField.Gender])

        val model = FakeModel(plot, plot)
        val kept = EntryDrafter(model.generate).draft("a tree", kept = mapOf(DraftField.Gender to "masculine"))
        assertTrue(model.prompts.first().contains("Gender: masculine"))
        assertFalse(DraftField.Gender in kept.filled)
        // "une intrigue" contradicts the learner's masculine, so the word and its example aren't used.
        assertTrue(DraftField.Word !in kept.filled && kept.examples.isEmpty())
    }

    @Test fun `does not ask the model when nothing is left to draft`() = runBlocking {
        val model = FakeModel()
        val kept = mapOf(DraftField.Word to "réaliser", DraftField.Gender to "none", DraftField.Definition to "Comprendre.")
        val draft = EntryDrafter(model.generate).draft("to realise", kept, listOf("Il {réalise}.", "Elle {réalise} tout.", "On {réalise} enfin."))
        assertTrue(draft.filled.isEmpty() && draft.unfilled.isEmpty())
        assertTrue(model.prompts.isEmpty())
    }

    @Test(expected = IllegalArgumentException::class)
    fun `needs the English meaning`(): Unit = runBlocking {
        EntryDrafter(FakeModel().generate).draft("  ", kept = emptyMap())
    }
}
