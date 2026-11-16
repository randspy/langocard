package com.randspy.langocard

import java.text.Collator
import java.util.Locale

fun Entry.matches(query: String): Boolean =
    query.isBlank() || word.contains(query, ignoreCase = true) || english.contains(query, ignoreCase = true)

private val french = Collator.getInstance(Locale.FRENCH).apply { strength = Collator.PRIMARY }

/**
 * Not [Entry.lexeme], which keeps the "le", "la" or "l'" of a personal entry. Every pack entry has a lemma, so the
 * article regex runs only for personal entries. Running it on every comparison made A–Z take over a second on 20,000 entries.
 */
private val alphabetical: Comparator<Entry> = compareBy(french) { it.lemma.ifBlank { Gender.noun(it.word) } }

/** A–Z ignores articles, accents and case. */
enum class VocabularySort(val label: String, val order: Comparator<Entry>) {
    /** Most frequent first; personal entries have no rank, so they come last, A–Z. */
    Frequency("Frequency", compareBy<Entry> { it.rank }.then(alphabetical)),
    Alphabetical("A–Z", alphabetical),
}

fun List<Entry>.browse(query: String, sort: VocabularySort): List<Entry> =
    filter { it.matches(query) }.sortedWith(sort.order)
