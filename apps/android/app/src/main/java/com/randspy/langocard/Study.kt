package com.randspy.langocard

import java.time.Instant

/**
 * A French sentence that uses a meaning, with exactly one marked answer: "Il pleut, {pourtant} elle sort."
 * The answer is the word as this sentence uses it, so it may be an inflected form.
 * Mirrors `answerOf`, `textOf` and `clozeOf` in `apps/backend/convex/entryRules.ts`.
 */
data class Example(val marked: String) {
    val answer get() = marked.substringAfter("{").substringBefore("}")
    /** The sentence as read or spoken, without the answer marks. */
    val text get() = marked.replace("{", "").replace("}", "")
    /** The sentence with the answer replaced by a gap, as Production shows it. */
    val cloze get() = marked.replace("{$answer}", "________")
    override fun toString() = marked
}

/**
 * IDs identify meanings; changing examples must never change scheduling identity.
 * [examples] holds 1 to [ContentFiles.MAX_EXAMPLES] sentences; the first is the introductory example.
 */
data class Entry(val id: String, val word: String, val english: String, val definition: String,
                 val examples: List<Example>, val topic: String,
                 val lemma: String = "", val rank: Int = Int.MAX_VALUE,
                 val sourceUrl: String = "", val license: String = "", val gender: Gender? = null) {
    val lexeme get() = lemma.ifBlank { word.removePrefix("un ").removePrefix("une ") }
    /** The skills this entry has cards for: Gender only for nouns. */
    val skills get() = if (gender == null) Skill.entries - Skill.Gender else Skill.entries
    /** [word] with its gender tag for nouns: "une intrigue (f.)". */
    val labelledWord get() = gender?.let { "$word (${it.tag})" } ?: word
    /**
     * The example a meaning shows after [exposures] reviews: they rotate in order, starting
     * from the introductory example. Mirrors `exampleAt` in `entryRules.ts`.
     */
    fun exampleAt(exposures: Int): Example = examples[exposures % examples.size]
    /** How the learning file, sync and backups name this meaning's [skill] card: "<id>:<Skill>". */
    fun cardKey(skill: Skill) = "$id:${skill.name}"
}
enum class Skill(val label: String) {
    Reading("Read"), Listening("Listen"), Production("Speak"),
    /** Choosing un or une for a noun; graded by the app, not the learner. */
    Gender("Gender");
    companion object {
        /** The placement check samples these; Gender isn't part of it. */
        val placement = listOf(Reading, Listening, Production)
    }
}
/** One card to study, with the [example] it shows. The example never affects the card's [key]. */
data class Prompt(val entry: Entry, val skill: Skill, val example: Example = entry.examples.first()) {
    val key get() = entry.cardKey(skill)
}

object StudyPolicy {
    const val DAILY_SECONDS = 15 * 60
    const val WIND_DOWN_SECONDS = 2 * 60
    const val CLEANUP_SECONDS = 2 * 60
    const val NEW_SENSES = 5
    /** Standard daily Gender introductions, counted apart from new meanings. */
    const val NEW_GENDER_CARDS = 10
    fun introductionsOpen(seconds: Int, limit: Int) = seconds < limit - WIND_DOWN_SECONDS
    /** Whether a session may show another card; checked between cards, so the card on screen is always finished. */
    fun sessionOpen(placement: Boolean, seconds: Int, limit: Int, cleanup: Boolean = false) =
        placement || seconds < limit + (if (cleanup) CLEANUP_SECONDS else 0)
    fun date(now: Instant): String = now.atZone(java.time.ZoneId.systemDefault()).toLocalDate().toString()
}

/** What today's practice offers outside a session, once placement is done. */
enum class NextPractice { Session, ExtraBlock, MoreVocabulary, NothingLeft }

