package com.randspy.langocard

/** Repeated failures need a new way into the meaning after four misses. */
object StuckWords {
    fun needsHook(consecutiveFailures: Int) = consecutiveFailures >= 4
    /** On return, prefer an unseen context, otherwise the least recently failed context. */
    fun returningExample(entry: Entry, exposures: Int, recentFailures: List<String>): Example {
        if (entry.examples.size == 1) return entry.examples.first()
        val recent = recentFailures.ifEmpty { listOf(entry.exampleAt((exposures - 1).coerceAtLeast(0)).marked) }
        return entry.examples.firstOrNull { it.marked !in recent }
            ?: entry.examples.minBy { recent.lastIndexOf(it.marked) }
    }
}
