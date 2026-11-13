package com.randspy.langocard

import org.json.JSONException
import org.json.JSONObject

/**
 * The fields of a personal entry that can be drafted from its English meaning. Gender's
 * values are [GENDER_VALUES]: "masculine", "feminine" or "none" (not a noun).
 */
enum class DraftField { Word, Gender, Definition, Example }

val GENDER_VALUES = Gender.entries.map { it.json } + "none"

/** A drafted gender value as the entry stores it; "none" (not a noun) is null. */
fun genderOf(value: String): Gender? = Gender.entries.firstOrNull { it.json == value }

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
 * rules is retried once, then only the fields that pass are returned. A noun's article
 * beats the model's gender: a gender contradicting the word's article doesn't pass, and a
 * word with "un"/"une" sets the gender itself. Failures of the model itself
 * (unavailable, quota) propagate from [generate].
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
        for (attempt in 1..ATTEMPTS) {
            // One attempt's fields belong together (the example uses that attempt's word), so attempts are never mixed.
            val fields = usable(generate(prompt), learner).filterKeys { it in wanted }
            if (fields.size >= best.size) best = fields
            if (best.size == wanted.size) break
        }
        best = withArticleGender(best, learner, wanted)
        return EntryDraft(best, wanted - best.keys)
    }

    /** A drafted gender follows the word's article whenever it has one. */
    private fun withArticleGender(draft: Map<DraftField, String>, learner: Map<DraftField, String>, wanted: Set<DraftField>): Map<DraftField, String> {
        if (DraftField.Gender !in wanted) return draft
        val word = draft[DraftField.Word] ?: learner[DraftField.Word] ?: return draft
        val stated = Gender.ofArticle(word) ?: return draft
        return draft + (DraftField.Gender to stated.json)
    }

    /** The reply's fields that pass the entry rules, given what the learner wrote. Anything unparseable yields none. */
    private fun usable(reply: String, learner: Map<DraftField, String>): Map<DraftField, String> {
        val start = reply.indexOf('{')
        val end = reply.lastIndexOf('}')
        if (start < 0 || end <= start) return emptyMap()
        val json = try { JSONObject(reply.substring(start, end + 1)) } catch (_: JSONException) { return emptyMap() }
        val fields = DraftField.entries.mapNotNull { field ->
            val value = (json.opt(key(field)) as? String)?.trim().orEmpty()
            val ok = when (field) {
                DraftField.Gender -> value in GENDER_VALUES
                DraftField.Example -> ContentFiles.validText(value) && ContentFiles.validAnswer(value)
                else -> ContentFiles.validText(value)
            }
            if (ok) field to value else null
        }.toMap()
        val word = fields[DraftField.Word] ?: learner[DraftField.Word]
        val stated = word?.let(Gender::ofArticle) ?: return fields
        val gender = (learner[DraftField.Gender] ?: fields[DraftField.Gender])?.let(::genderOf) ?: return fields
        if (gender == stated) return fields
        // The article and the gender disagree: drop whichever side the model wrote.
        return if (DraftField.Gender in learner) fields - DraftField.Word - DraftField.Example else fields - DraftField.Gender
    }

    private fun key(field: DraftField) = field.name.lowercase()

    private fun prompt(english: String, learner: Map<DraftField, String>) = buildString {
        append(INSTRUCTIONS)
        EXAMPLES.forEach { (input, reply) -> append("\n").append(input).append("\n").append(reply).append("\n") }
        append("\nEnglish meaning: ").append(english).append("\n")
        learner[DraftField.Word]?.let { append("French word: ").append(it).append("\n") }
        learner[DraftField.Gender]?.let { append("Gender: ").append(it).append("\n") }
        learner[DraftField.Definition]?.let { append("Definition: ").append(it).append("\n") }
        learner[DraftField.Example]?.let { append("Example: ").append(it).append("\n") }
    }

    private companion object {
        const val ATTEMPTS = 2
        val INSTRUCTIONS = """
            You write French vocabulary cards for an English-speaking learner at B2 level.
            Reply with only one JSON object with the keys "word", "gender", "definition" and "example".
            - word: the French word or expression for the English meaning. Nouns take their article (une intrigue), verbs are infinitive, pronominal verbs keep "se" (se méfier).
            - gender: "masculine" or "feminine" for a noun, matching its article; "none" for anything else.
            - definition: one short line of simple French. Never use the word itself.
            - example: one natural French sentence of 6 to 15 words using the word. Put the word, exactly as it appears in the sentence, inside one pair of {braces}. Use no other braces.
            When a French word, gender, definition or example is given, keep it unchanged and make the other fields agree with it.
        """.trimIndent() + "\n"
        /** Entries from the built-in library, so drafts match its style. */
        val EXAMPLES = listOf(
            "English meaning: however" to
                """{"word":"pourtant","gender":"none","definition":"Malgré ce qui vient d'être dit.","example":"Il pleut, {pourtant} elle sort."}""",
            "English meaning: a plot" to
                """{"word":"une intrigue","gender":"feminine","definition":"Ensemble des événements d'une fiction.","example":"Ce roman développe {une intrigue} complexe."}""",
            "English meaning: to be wary\nFrench word: se méfier" to
                """{"word":"se méfier","gender":"none","definition":"Ne pas accorder facilement sa confiance.","example":"Il faut {se méfier} des offres trop belles."}""",
        )
    }
}
