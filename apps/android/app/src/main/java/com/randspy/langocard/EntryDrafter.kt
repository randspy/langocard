package com.randspy.langocard

import org.json.JSONException
import org.json.JSONObject

/**
 * The fields of a personal entry that can be drafted from its English meaning. Gender's
 * values are [GENDER_VALUES]: "masculine", "feminine" or "none" (not a noun). Examples are
 * a list, so they travel apart from the single-value fields (see [EntryDraft.examples]).
 */
enum class DraftField { Word, Gender, Definition, Examples }

val GENDER_VALUES = Gender.entries.map { it.json } + "none"

/** A drafted gender value as the entry stores it; "none" (not a noun) is null. */
fun genderOf(value: String): Gender? = Gender.entries.firstOrNull { it.json == value }

/**
 * What a draft produced. [filled] holds the single-value fields and [examples] the new
 * examples, all passing the entry rules; [unfilled] lists the fields the learner still has
 * to write themselves ([DraftField.Examples] when no example could be drafted).
 */
data class EntryDraft(val filled: Map<DraftField, String>, val unfilled: Set<DraftField>, val examples: List<String> = emptyList())

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
     * Drafts every single-value field not in [kept], and new examples until the entry has
     * [EXAMPLES_WANTED]. [kept] and [keptExamples] are what the learner wrote; they are never
     * replaced, the draft is written to agree with them, and drafted examples differ from them.
     */
    suspend fun draft(english: String, kept: Map<DraftField, String>, keptExamples: List<String> = emptyList()): EntryDraft {
        require(english.isNotBlank()) { "Enter the English meaning first" }
        val learner = kept.filterKeys { it != DraftField.Examples }.filterValues { it.isNotBlank() }.mapValues { it.value.trim() }
        val ownExamples = keptExamples.map { it.trim() }.filter { it.isNotBlank() }
        val room = (EXAMPLES_WANTED - ownExamples.size).coerceAtLeast(0)
        val wanted = DraftField.entries.toSet() - learner.keys - (if (room == 0) setOf(DraftField.Examples) else emptySet())
        if (wanted.isEmpty()) return EntryDraft(emptyMap(), emptySet())
        val prompt = prompt(english.trim(), learner, ownExamples)
        val single = wanted - DraftField.Examples
        val examplesWanted = if (DraftField.Examples in wanted) room else 0
        var best = Reply(emptyMap(), emptyList())
        for (attempt in 1..ATTEMPTS) {
            // One attempt's fields belong together (the examples use that attempt's word), so attempts are never mixed.
            val reply = usable(generate(prompt), learner, ownExamples).let { r ->
                Reply(r.fields.filterKeys { it in single }, r.examples.take(examplesWanted))
            }
            if (reply.score >= best.score) best = reply
            if (best.fields.keys == single && best.examples.size == examplesWanted) break
        }
        val fields = withArticleGender(best.fields, learner, wanted)
        val unfilled = wanted - fields.keys - (if (best.examples.isNotEmpty()) setOf(DraftField.Examples) else emptySet())
        return EntryDraft(fields, unfilled, best.examples)
    }

    /** One reply's usable content. More drafted fields win (the examples count as one), then more examples. */
    private class Reply(val fields: Map<DraftField, String>, val examples: List<String>) {
        val score get() = (fields.size + (if (examples.isEmpty()) 0 else 1)) * 10 + examples.size
    }

    /** A drafted gender follows the word's article whenever it has one. */
    private fun withArticleGender(draft: Map<DraftField, String>, learner: Map<DraftField, String>, wanted: Set<DraftField>): Map<DraftField, String> {
        if (DraftField.Gender !in wanted) return draft
        val word = draft[DraftField.Word] ?: learner[DraftField.Word] ?: return draft
        val stated = Gender.ofArticle(word) ?: return draft
        return draft + (DraftField.Gender to stated.json)
    }

    /**
     * The reply's content that passes the entry rules, given what the learner wrote: examples
     * each with one answer, different from each other and from the learner's. Anything
     * unparseable yields none.
     */
    private fun usable(reply: String, learner: Map<DraftField, String>, ownExamples: List<String>): Reply {
        val none = Reply(emptyMap(), emptyList())
        val start = reply.indexOf('{')
        val end = reply.lastIndexOf('}')
        if (start < 0 || end <= start) return none
        val json = try { JSONObject(reply.substring(start, end + 1)) } catch (_: JSONException) { return none }
        val fields = listOf(DraftField.Word, DraftField.Gender, DraftField.Definition).mapNotNull { field ->
            val value = (json.opt(key(field)) as? String)?.trim().orEmpty()
            val ok = if (field == DraftField.Gender) value in GENDER_VALUES else ContentFiles.validText(value)
            if (ok) field to value else null
        }.toMap()
        val array = json.optJSONArray("examples")
        val seen = ownExamples.toMutableSet()
        val examples = (0 until (array?.length() ?: 0)).mapNotNull { (array!!.opt(it) as? String)?.trim() }
            .filter { ContentFiles.validText(it) && ContentFiles.validAnswer(it) && seen.add(it) }
        val word = fields[DraftField.Word] ?: learner[DraftField.Word]
        val stated = word?.let(Gender::ofArticle) ?: return Reply(fields, examples)
        val gender = (learner[DraftField.Gender] ?: fields[DraftField.Gender])?.let(::genderOf) ?: return Reply(fields, examples)
        if (gender == stated) return Reply(fields, examples)
        // The article and the gender disagree: drop whichever side the model wrote.
        return if (DraftField.Gender in learner) Reply(fields - DraftField.Word, emptyList()) else Reply(fields - DraftField.Gender, examples)
    }

    private fun key(field: DraftField) = field.name.lowercase()

    private fun prompt(english: String, learner: Map<DraftField, String>, ownExamples: List<String>) = buildString {
        append(INSTRUCTIONS)
        EXAMPLES.forEach { (input, reply) -> append("\n").append(input).append("\n").append(reply).append("\n") }
        append("\nEnglish meaning: ").append(english).append("\n")
        learner[DraftField.Word]?.let { append("French word: ").append(it).append("\n") }
        learner[DraftField.Gender]?.let { append("Gender: ").append(it).append("\n") }
        learner[DraftField.Definition]?.let { append("Definition: ").append(it).append("\n") }
        ownExamples.forEach { append("Example: ").append(it).append("\n") }
    }

    private companion object {
        const val ATTEMPTS = 2
        /** A drafted entry has this many examples, the learner's included. */
        const val EXAMPLES_WANTED = 3
        val INSTRUCTIONS = """
            You write French vocabulary cards for an English-speaking learner at B2 level.
            Reply with only one JSON object with the keys "word", "gender", "definition" and "examples".
            - word: the French word or expression for the English meaning. Nouns take their article (une intrigue), verbs are infinitive, pronominal verbs keep "se" (se méfier).
            - gender: "masculine" or "feminine" for a noun, matching its article; "none" for anything else.
            - definition: one short line of simple French. Never use the word itself.
            - examples: a list of 3 natural French sentences of 6 to 15 words, each using the word in a different situation. Vary the form when it is natural (conjugation, plural, elided article). In each sentence put the word, exactly as it appears there, inside one pair of {braces}. Use no other braces.
            When a French word, gender, definition or examples are given, keep them unchanged and make the other fields agree with them. Write examples that differ from the given ones.
        """.trimIndent() + "\n"
        /** Entries from the built-in library, so drafts match its style. */
        val EXAMPLES = listOf(
            "English meaning: however" to
                """{"word":"pourtant","gender":"none","definition":"Malgré ce qui vient d'être dit.","examples":["Il pleut, {pourtant} elle sort.","Le film était long, {pourtant} personne ne s'est ennuyé.","Il avait tout préparé, et {pourtant} rien n'a marché."]}""",
            "English meaning: a plot" to
                """{"word":"une intrigue","gender":"feminine","definition":"Ensemble des événements d'une fiction.","examples":["Ce roman développe {une intrigue} complexe.","Les spectateurs ont deviné {l'intrigue} dès le début.","La série suit {une intrigue} pleine de rebondissements."]}""",
            "English meaning: to be wary\nFrench word: se méfier" to
                """{"word":"se méfier","gender":"none","definition":"Ne pas accorder facilement sa confiance.","examples":["Il faut {se méfier} des offres trop belles.","Elle {se méfie} toujours des inconnus.","Ils {se sont méfiés} de cette rumeur."]}""",
        )
    }
}
