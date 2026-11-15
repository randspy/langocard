package com.randspy.langocard

/** Repeated failures need a new way into the meaning after four misses. */
object StuckWords {
    fun needsHook(consecutiveFailures: Int) = consecutiveFailures >= 4
}
