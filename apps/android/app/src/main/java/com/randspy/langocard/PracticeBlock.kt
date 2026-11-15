package com.randspy.langocard

import org.json.JSONObject

/** Lengths the learner can pick once today's block is used up. */
enum class ExtraMinutes(val minutes: Int) {
    Five(5), Ten(10), Fifteen(15);
    val seconds get() = minutes * 60
}

/**
 * The stretch of today's practised seconds a session may fill: the daily target, or one extra
 * block picked after it. [start] and [end] sit on today's synced `seconds` counter, so wind-down
 * and cleanup are measured from [end] whichever block it is.
 */
data class PracticeBlock(val start: Int, val end: Int) {
    val isExtra get() = this != DAILY
    val minutes get() = (end - start) / 60
    /** Whole minutes practised in this block; cleanup may push it past [minutes]. */
    fun minutesIn(seconds: Int) = (seconds - start).coerceAtLeast(0) / 60

    /** Stores this block for [day]. Nothing resets it; [read] retires it by its day tag. */
    fun write(data: JSONObject, day: String) {
        data.put(KEY, JSONObject().put("day", day).put("start", start).put("minutes", minutes))
    }

    companion object {
        private const val KEY = "extraBlock"
        val DAILY = PracticeBlock(0, StudyPolicy.DAILY_SECONDS)

        /** A block from where the learner is now, so a cleanup overrun never shortens it. */
        fun extra(seconds: Int, length: ExtraMinutes) = PracticeBlock(seconds, seconds + length.seconds)

        /**
         * Today's block. A stored block counts only if it was written on [today], its length is on
         * offer, and today's [seconds] have reached its start. A sync can move `day` to another
         * device's date without a rollover, so the tag is compared with the clock, never with `day`.
         */
        fun read(data: JSONObject, today: String, seconds: Int): PracticeBlock {
            val stored = data.optJSONObject(KEY) ?: return DAILY
            if (stored.optString("day") != today) return DAILY
            val length = ExtraMinutes.entries.firstOrNull { it.minutes == stored.optInt("minutes") } ?: return DAILY
            val start = stored.optInt("start", -1)
            if (start < StudyPolicy.DAILY_SECONDS || start > seconds) return DAILY
            return extra(start, length)
        }
    }
}
