package com.randspy.langocard

import io.github.openspacedrepetition.Rating
import java.text.Normalizer

/** How a typed gap-fill answer (Listening or Production) compares with the answer its sentence expects, and the rating that suggests. */
enum class AnswerMatch(val suggested: Rating, val label: String) {
    /** The same answer, ignoring case, surrounding whitespace and the apostrophe style. */
    Exact(Rating.GOOD, "✓ Right"),
    /**
     * The same letters with missing, wrong or extra accents, or "oe" for "œ". The word was
     * recalled, so it stays a pass, but accents are part of how it is written: ou and où differ.
     */
    Accents(Rating.HARD, "Check the accents"),
    /** The right noun with another article or none: the Gender card schedules the article. */
    Article(Rating.HARD, "Right word, wrong article"),
    Different(Rating.AGAIN, "✗ Not this time"),
}

/** A run of one answer's characters, [marked] when the other answer lacks them. */
data class AnswerPart(val text: String, val marked: Boolean)

/**
 * A learner's typed answer to a Listening or Production gap-fill, checked against the [Example.answer] of the
 * shown sentence. It only suggests a rating: the learner can still choose another.
 */
class TypedAnswer private constructor(typed: String, expected: String, noun: Boolean) {
    val typed = typed.spaced()
    val expected = expected.spaced()
    val match = when {
        this.typed.keyed() == this.expected.keyed() -> AnswerMatch.Exact
        this.typed.folded() == this.expected.folded() -> AnswerMatch.Accents
        noun && this.typed.article() != this.expected.article() &&
            Gender.noun(this.typed).folded() == Gender.noun(this.expected).folded() -> AnswerMatch.Article
        else -> AnswerMatch.Different
    }
    /** [typed] split into runs, marking letters the expected answer doesn't have. */
    val typedParts: List<AnswerPart>
    /** [expected] split into runs, marking letters the learner didn't type. */
    val expectedParts: List<AnswerPart>

    init {
        val a = this.typed.keyed(); val b = this.expected.keyed()
        // common[i][j]: length of the longest common subsequence of a from i and b from j.
        val common = Array(a.length + 1) { IntArray(b.length + 1) }
        for (i in a.indices.reversed()) for (j in b.indices.reversed()) {
            common[i][j] = if (a[i] == b[j]) common[i + 1][j + 1] + 1 else maxOf(common[i + 1][j], common[i][j + 1])
        }
        val typedMarks = BooleanArray(a.length) { true }; val expectedMarks = BooleanArray(b.length) { true }
        var i = 0; var j = 0
        while (i < a.length && j < b.length) when {
            a[i] == b[j] -> { typedMarks[i] = false; expectedMarks[j] = false; i++; j++ }
            common[i + 1][j] >= common[i][j + 1] -> i++
            else -> j++
        }
        typedParts = runs(this.typed, typedMarks)
        expectedParts = runs(this.expected, expectedMarks)
    }

    companion object {
        /** The check of [typed] against [example]'s answer, or null when nothing was typed. */
        fun of(typed: String, example: Example, noun: Boolean = false): TypedAnswer? =
            if (typed.isBlank()) null else TypedAnswer(typed, example.answer, noun)

        private val MARKS = Regex("\\p{Mn}+")
        private fun String.spaced() = Normalizer.normalize(trim(), Normalizer.Form.NFC)
        /** One-to-one per character, so indices still line up with the shown text. */
        private fun String.keyed() = map { if (it == '’') '\'' else it.lowercaseChar() }.joinToString("")
        private fun String.article() = removeSuffix(Gender.noun(this)).trim().keyed()
        private fun String.folded() = Normalizer.normalize(keyed(), Normalizer.Form.NFD).replace(MARKS, "")
            .replace("œ", "oe").replace("æ", "ae")
        private fun runs(text: String, marks: BooleanArray): List<AnswerPart> =
            text.indices.fold(mutableListOf()) { parts, k ->
                parts.apply {
                    if (isNotEmpty() && last().marked == marks[k]) set(lastIndex, last().copy(text = last().text + text[k]))
                    else add(AnswerPart(text[k].toString(), marks[k]))
                }
            }
    }
}
