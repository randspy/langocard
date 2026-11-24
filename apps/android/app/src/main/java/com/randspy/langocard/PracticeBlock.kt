package com.randspy.langocard

import org.json.JSONObject

/** Lengths the learner can pick, each with an independent allowance for meanings and Gender cards. */
enum class ExtraMinutes(val minutes: Int, internal val introductions: Int) {
    Five(5, 2), Ten(10, 3), Fifteen(15, 5);
    val seconds get() = minutes * 60
}

/**
 * One stretch of today's practised seconds, with its own local introduction usage.
 * Daily totals remain separate: remote study must not consume a device's extra allowance.
 */
@ConsistentCopyVisibility
data class PracticeBlock private constructor(
    val start: Int,
    private val length: ExtraMinutes?,
    private val meaningsUsed: Int = 0,
    private val gendersUsed: Int = 0,
    private val reviewOnly: Boolean = false,
) {
    val end get() = start + (length?.seconds ?: StudyPolicy.DAILY_SECONDS)
    val isExtra get() = length != null
    val minutes get() = (end - start) / 60
    /** Whole minutes practised in this block, including cleanup. */
    fun minutesIn(seconds: Int) = (seconds - start).coerceAtLeast(0) / 60
    fun meaningRoom(dailyIntroduced: Int, allowMore: Boolean = false) = !reviewOnly &&
        (allowMore || (length?.let { meaningsUsed < it.introductions } ?: (dailyIntroduced < StudyPolicy.NEW_SENSES)))
    fun genderRoom(dailyIntroduced: Int) = length?.let { gendersUsed < it.introductions }
        ?: (dailyIntroduced < StudyPolicy.NEW_GENDER_CARDS)

    /** Records only first introductions; repeated answers spend no allowance. */
    fun introduced(newMeaning: Boolean, newGender: Boolean): PracticeBlock = length?.let {
        copy(meaningsUsed = (meaningsUsed + if (newMeaning) 1 else 0).coerceAtMost(it.introductions),
            gendersUsed = (gendersUsed + if (newGender) 1 else 0).coerceAtMost(it.introductions))
    } ?: this

    /** Stores local usage with its day tag; replacing a grant discards all unused allowance. */
    fun write(data: JSONObject, day: String) {
        if (!isExtra || reviewOnly) return
        data.put(KEY, JSONObject().put("day", day).put("start", start).put("minutes", minutes)
            .put("meaningsUsed", meaningsUsed).put("gendersUsed", gendersUsed))
    }

    companion object {
        private const val KEY = "extraBlock"
        val DAILY = PracticeBlock(0, null)

        /** A fresh grant starting now, so cleanup overruns never shorten the selected duration. */
        fun extra(seconds: Int, length: ExtraMinutes): PracticeBlock {
            require(seconds in StudyPolicy.DAILY_SECONDS..(Int.MAX_VALUE - length.seconds - StudyPolicy.CLEANUP_SECONDS))
            return PracticeBlock(seconds, length)
        }

        /**
         * Parses local state against the clock's date, even when sync changes the saved daily date.
         * Missing or malformed usage makes a valid old duration review-only, deterministically on
         * every read. Coercible strings and fractional numbers cannot mint a fresh allowance.
         */
        fun read(data: JSONObject, today: String, seconds: Int): PracticeBlock {
            val stored = data.optJSONObject(KEY) ?: return DAILY
            if (stored.optString("day") != today) return DAILY
            val length = ExtraMinutes.entries.firstOrNull { it.minutes == integer(stored, "minutes") } ?: return DAILY
            val start = integer(stored, "start") ?: return DAILY
            if (start < StudyPolicy.DAILY_SECONDS || start > seconds ||
                start > Int.MAX_VALUE - length.seconds - StudyPolicy.CLEANUP_SECONDS) return DAILY
            val meanings = integer(stored, "meaningsUsed")?.takeIf { it in 0..length.introductions }
            val genders = integer(stored, "gendersUsed")?.takeIf { it in 0..length.introductions }
            return if (meanings == null || genders == null) PracticeBlock(start, length, length.introductions, length.introductions, reviewOnly = true)
                else PracticeBlock(start, length, meanings, genders)
        }

        private fun integer(data: JSONObject, key: String): Int? = when (val value = data.opt(key)) {
            is Int -> value
            is Long -> value.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()
            else -> null
        }
    }
}
