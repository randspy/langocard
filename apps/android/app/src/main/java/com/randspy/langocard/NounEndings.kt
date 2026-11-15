package com.randspy.langocard

import java.text.Normalizer
import java.util.Locale

/** Ending tendencies teach a cue, never override a noun's recorded gender. */
object NounEndings {
    data class Rule(val ending: String, val gender: Gender)
    data class Match(val rule: Rule, val follows: Boolean) {
        val feedback: String get() = "-${rule.ending}: usually ${rule.gender.json}. " +
            if (follows) "This noun follows the rule." else "This noun is an exception."
    }

    val rules = listOf(
        Rule("ation", Gender.Feminine), Rule("tion", Gender.Feminine),
        Rule("sion", Gender.Feminine), Rule("ence", Gender.Feminine),
        Rule("ance", Gender.Feminine), Rule("ette", Gender.Feminine),
        Rule("ité", Gender.Feminine), Rule("age", Gender.Masculine),
        Rule("ment", Gender.Masculine), Rule("isme", Gender.Masculine),
        Rule("eau", Gender.Masculine),
    )

    /** The most specific cue for a single noun, or none when gender or a reliable ending is absent. */
    fun match(word: String, gender: Gender?): Match? {
        if (gender == null) return null
        val noun = Normalizer.normalize(Gender.noun(word), Normalizer.Form.NFC).lowercase(Locale.ROOT)
        if (noun.any { it.isWhitespace() || it == '-' }) return null
        val rule = rules.filter { noun.endsWith(it.ending) }.maxByOrNull { it.ending.length } ?: return null
        return Match(rule, gender == rule.gender)
    }
}
