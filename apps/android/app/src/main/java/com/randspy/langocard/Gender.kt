package com.randspy.langocard

import io.github.openspacedrepetition.Rating
import org.json.JSONObject

/**
 * Grammatical gender of a noun; an entry without one is not a noun. Mirrors `Gender`,
 * `articleGender` and `nounOf` in `apps/backend/convex/entryRules.ts`.
 */
enum class Gender(val json: String, val article: String, val tag: String) {
    Masculine("masculine", "un", "m."), Feminine("feminine", "une", "f.");

    /** A Gender card grades itself: choosing this noun's article is Good, anything else Again. */
    fun grade(choice: Gender): Rating = if (choice == this) Rating.GOOD else Rating.AGAIN

    companion object {
        private val ARTICLE = Regex("^(un|une|le|la)\\s+(?=\\S)", RegexOption.IGNORE_CASE)
        private val ELISION = Regex("^l['’]\\s*(?=\\S)", RegexOption.IGNORE_CASE)

        /** The gender a leading article in [word] states ("une intrigue" → Feminine); null for "l'arbre" or "pourtant". */
        fun ofArticle(word: String): Gender? = when (ARTICLE.find(word.trim())?.groupValues?.get(1)?.lowercase()) {
            "un", "le" -> Masculine
            "une", "la" -> Feminine
            else -> null
        }

        /** [word] without its leading article, as a Gender card shows it: "une intrigue" → "intrigue". */
        fun noun(word: String): String = word.trim().replace(ARTICLE, "").replace(ELISION, "")

        /**
         * The `gender` of an entry in JSON. Content written before gender existed has no key
         * and takes the article gender; `null` means not a noun.
         */
        fun read(o: JSONObject, word: String): Gender? = when {
            !o.has("gender") -> ofArticle(word)
            o.isNull("gender") -> null
            else -> o.getString("gender").let { value ->
                entries.firstOrNull { it.json == value } ?: throw IllegalArgumentException("Unknown gender")
            }
        }

        fun json(gender: Gender?): Any = gender?.json ?: JSONObject.NULL
    }
}

/**
 * Which meanings have a Gender card to study. Gender belongs to the noun, not to each
 * meaning, so of the meanings sharing a noun and gender only one is studied: the one that
 * already has a Gender card, or else the first one introduced (the lowest FSRS card ID
 * among its started cards). Deleting it hands the role to the next meaning.
 */
object GenderCards {
    /** [cardId] gives the card ID of a started card key ("<entryId>:<Skill>"), or null if unstarted. */
    fun owners(entries: List<Entry>, cardId: (key: String) -> Int?): Set<String> =
        entries.filter { it.gender != null }
            .groupBy { Gender.noun(it.word).lowercase() to it.gender }
            .values.flatMap { meanings ->
                val studied = meanings.filter { cardId("${it.id}:${Skill.Gender.name}") != null }
                studied.ifEmpty {
                    listOfNotNull(meanings.mapNotNull { e ->
                        Skill.entries.mapNotNull { cardId("${e.id}:${it.name}") }.minOrNull()?.let { e to it }
                    }.minByOrNull { it.second }?.first)
                }
            }.map { it.id }.toSet()
}
