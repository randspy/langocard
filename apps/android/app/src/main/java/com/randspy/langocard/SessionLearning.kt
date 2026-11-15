package com.randspy.langocard

import io.github.openspacedrepetition.Rating

/** Cards needing one successful recall this session. Repeated failures rotate behind other cards. */
class SessionLearning {
    private val pending = linkedSetOf<String>()

    fun clear() = pending.clear()

    fun reviewed(key: String, introduced: Boolean, rating: Rating) {
        pending.remove(key)
        if (rating == Rating.AGAIN || introduced) pending.add(key)
    }

    /** Uses current eligibility and scheduler state, without changing a card's due time. */
    fun next(eligible: List<String>, learning: (String) -> Boolean): String? =
        pending.firstOrNull { it in eligible && learning(it) }
}
