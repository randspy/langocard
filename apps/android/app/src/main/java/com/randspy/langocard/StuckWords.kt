package com.randspy.langocard

/** Repeated failures need a new way into the meaning after four misses. */
object StuckWords {
    fun needsHook(consecutiveFailures: Int) = consecutiveFailures >= 4
    /** On return, prefer an unseen context, otherwise the least recently failed context. */
    fun returningExample(entry: Entry, exposures: Int, recentFailures: List<String>): Example {
        if (entry.examples.size == 1) return entry.examples.first()
        // Failures name an example by its marked text; alternatives added since don't make it another example.
        val recent = recentFailures.map { Example(it).withoutAlternatives }
            .ifEmpty { listOf(entry.exampleAt((exposures - 1).coerceAtLeast(0)).withoutAlternatives) }
        return entry.examples.firstOrNull { it.withoutAlternatives !in recent }
            ?: entry.examples.minBy { recent.lastIndexOf(it.withoutAlternatives) }
    }
}
