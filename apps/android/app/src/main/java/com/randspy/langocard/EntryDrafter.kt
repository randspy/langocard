package com.randspy.langocard

import org.json.JSONException
import org.json.JSONObject

/** The fields of a personal entry that can be drafted from its English meaning. */
enum class DraftField { Word, Definition, Example }

/**
 * What a draft produced. [filled] holds only values that pass the entry rules;
 * [unfilled] lists the fields the learner still has to write themselves.
 */
data class EntryDraft(val filled: Map<DraftField, String>, val unfilled: Set<DraftField>)

/**
 * Drafts the missing fields of a personal entry from its English meaning, using a
 * text-generating model (on-device Gemma in the app). The learner reviews a
 * draft before saving it; nothing here touches the library.
 *
 * Hides the prompt, the reply format and model mistakes: a reply that breaks the entry
 * rules is retried once, then only the fields that pass are returned. Failures of the
 * model itself (unavailable, quota) propagate from [generate].
 */
class EntryDrafter(private val generate: suspend (prompt: String) -> String) {

    /**
     * Drafts every field not in [kept]. [kept] is what the learner wrote; it is never
     * replaced, and the draft is written to agree with it.
     */
    suspend fun draft(english: String, kept: Map<DraftField, String>): EntryDraft {
        require(english.isNotBlank()) { "Enter the English meaning first" }
        val learner = kept.filterValues { it.isNotBlank() }.mapValues { it.value.trim() }
        val wanted = DraftField.entries.toSet() - learner.keys
        if (wanted.isEmpty()) return EntryDraft(emptyMap(), emptySet())
        val prompt = prompt(english.trim(), learner)
        var best = emptyMap<DraftField, String>()
        repeat(ATTEMPTS) {
            // One attempt's fields belong together (the example uses that attempt's word), so attempts are never mixed.
            val attempt = usable(generate(prompt)).filterKeys { it in wanted }
            if (attempt.size >= best.size) best = attempt
            if (best.size == wanted.size) return EntryDraft(best, emptySet())
        }
        return EntryDraft(best, wanted - best.keys)
    }

    /** The reply's fields that pass the entry rules. Anything unparseable yields none. */
    private fun usable(reply: String): Map<DraftField, String> {
        val start = reply.indexOf('{')
        val end = reply.lastIndexOf('}')
        if (start < 0 || end <= start) return emptyMap()
        val json = try { JSONObject(reply.substring(start, end + 1)) } catch (_: JSONException) { return emptyMap() }
        return DraftField.entries.mapNotNull { field ->
            val value = (json.opt(key(field)) as? String)?.trim().orEmpty()
            val ok = ContentFiles.validText(value) && (field != DraftField.Example || ContentFiles.validAnswer(value))
            if (ok) field to value else null
        }.toMap()
    }

    private fun key(field: DraftField) = field.name.lowercase()

    private fun prompt(english: String, learner: Map<DraftField, String>) = buildString {
        append(INSTRUCTIONS)
        EXAMPLES.forEach { (input, reply) -> append("\n").append(input).append("\n").append(reply).append("\n") }
        append("\nEnglish meaning: ").append(english).append("\n")
        learner[DraftField.Word]?.let { append("French word: ").append(it).append("\n") }
        learner[DraftField.Definition]?.let { append("Definition: ").append(it).append("\n") }
        learner[DraftField.Example]?.let { append("Example: ").append(it).append("\n") }
    }

    private companion object {
        const val ATTEMPTS = 2
        val INSTRUCTIONS = """
            You write French vocabulary cards for an English-speaking learner at B2 level.
            Reply with only one JSON object with the keys "word", "definition" and "example".
            - word: the French word or expression for the English meaning. Nouns take their article (une intrigue), verbs are infinitive, pronominal verbs keep "se" (se méfier).
            - definition: one short line of simple French. Never use the word itself.
            - example: one natural French sentence of 6 to 15 words using the word. Put the word, exactly as it appears in the sentence, inside one pair of {braces}. Use no other braces.
            When a French word, definition or example is given, keep it unchanged and make the other fields agree with it.
        """.trimIndent() + "\n"
        /** Entries from the built-in library, so drafts match its style. */
        val EXAMPLES = listOf(
            "English meaning: however" to
                """{"word":"pourtant","definition":"Malgré ce qui vient d'être dit.","example":"Il pleut, {pourtant} elle sort."}""",
            "English meaning: a plot" to
                """{"word":"une intrigue","definition":"Ensemble des événements d'une fiction.","example":"Ce roman développe {une intrigue} complexe."}""",
            "English meaning: to be wary\nFrench word: se méfier" to
                """{"word":"se méfier","definition":"Ne pas accorder facilement sa confiance.","example":"Il faut {se méfier} des offres trop belles."}""",
        )
    }
}
