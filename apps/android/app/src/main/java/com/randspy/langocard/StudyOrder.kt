package com.randspy.langocard

import org.json.JSONObject

/** Study-only tie order: shared shipped ordinal, then deterministic IDs for additions. */
class StudyOrder(private val ordinals: JSONObject) {
    fun key(id: String): String = if (ordinals.has(id)) "0:${ordinals.getInt(id).toString().padStart(8, '0')}" else "1:$id"
}
