package com.randspy.langocard

import org.json.JSONObject

/**
 * Builds the study library from the APK, local additions and synced Convex rows
 * (`remoteEntries`, keyed by entry ID). A synced row overrides the local copy of the
 * same entry, so edits made on the web apply to bundled and pack entries too.
 *
 * Packs stay opt-in: rows from a pack that isn't installed are kept but stay dormant
 * until it is. Deleted entries are left out; retired ones stay (they may have
 * progress) but aren't introduced as new.
 */
object StudyLibrary {
    class Active(val entries: List<Entry>, val retired: Set<String>)

    fun active(bundled: List<Entry>, extra: List<Entry>, remote: JSONObject, installed: (packId: String) -> Boolean): Active {
        val byId = LinkedHashMap<String, Entry>()
        bundled.forEach { byId[it.id] = it }
        extra.forEach { byId.putIfAbsent(it.id, it) }
        val retired = mutableSetOf<String>()
        remote.keys().forEach { id ->
            val row = remote.getJSONObject(id)
            val origin = row.optString("origin")
            val included = id in byId || origin == "bundled" || origin == "personal" ||
                (origin.startsWith("pack:") && installed(origin.removePrefix("pack:")))
            if (!included) return@forEach
            if (SyncData.isDeleted(row)) { byId.remove(id); return@forEach }
            val entry = SyncData.rowEntry(row) ?: return@forEach
            byId[id] = entry
            if (row.optBoolean("retired")) retired.add(id)
        }
        return Active(byId.values.toList(), retired)
    }
}
