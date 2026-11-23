package com.randspy.langocard

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject

/**
 * The device's current learner and active content. Restore, library edits and sync all use this
 * owner, so replacing a backup cannot leave another owner writing to the previous learner.
 * Confined to the main thread; [LearnerStore] finishes each atomic write before publishing a save.
 */
class LearningLibrary(application: Application) {
    internal val studyOrder = StudyOrder(application.assets.open("study-order.json").bufferedReader().use { JSONObject(it.readText()) })
    private val bundledPack = application.assets.open("frequent-pack.json").bufferedReader().use { JSONObject(it.readText()) }
    private val bundled = ContentFiles.readEntries(bundledPack.getJSONArray("entries"))
    private val bundledIds = bundled.map { it.id }.toSet()
    private val store = LearnerStore(application.filesDir)
    internal var learner = store.load(); private set
    /** The active study library; see [StudyLibrary.active]. */
    val entries = androidx.compose.runtime.mutableStateListOf<Entry>()
    /** Entries removed from the shipped content: kept for their progress, never introduced as new. */
    internal var retired = emptySet<String>(); private set
    init {
        learner.extraEntries = learner.extraEntries.filter { it.id !in bundledIds }
        rebuildEntries()
    }
    private fun rebuildEntries() {
        val extra = learner.extraEntries.filter { it.id !in bundledIds }
        val active = StudyLibrary.active(bundled, extra, learner.remoteEntries, ::installedPack)
        entries.clear(); entries.addAll(active.entries); retired = active.retired
    }
    /** Every entry ID this device knows, including deleted and dormant ones, so their cards are kept. */
    private fun knownIds(): Set<String> = entries.map { it.id }.toHashSet().apply { addAll(bundledIds); addAll(learner.entryIds()) }
    var revision by mutableIntStateOf(0); private set
    /** Invalidates views of learner fields that are not Compose state. */
    internal fun changed() { revision++ }
    /** Returns only once the complete learner is durably saved. */
    fun save() { store.save(learner); changed() }
    fun backup(): String {
        save()
        return store.backup(learner)
    }
    fun validateBackup(text: String) { ContentFiles.backupData(text, bundledIds) }
    /** Publishes a replacement learner only after its atomic restore succeeds. */
    internal fun restore(text: String) {
        learner = store.restore(text, bundledIds, learner)
        rebuildEntries()
    }
    /** Merges into the current learner and updates the active library when its content changes. */
    internal fun applyRemote(table: String, rows: List<JSONObject>) {
        if (rows.isEmpty()) return
        if (table == "settings") learner.rollover(StudyPolicy.date(java.time.Instant.now()))
        if (learner.merge(table, rows, knownIds())) rebuildEntries()
    }

    val minimumRank get() = learner.minimumRank
    fun setMinimumRank(rank: Int) {
        require(rank in listOf(1, 2501, 7001))
        learner.setMinimumRank(rank); save()
    }
    val interests get() = learner.interests
    fun toggleInterest(topic: String) {
        val next = interests.toMutableSet().apply { if (!add(topic)) remove(topic) }
        if (next.isNotEmpty()) { learner.setInterests(next); save() }
    }
    fun importPack(text: String): Int {
        val pack = JSONObject(text)
        require(pack.getString("format") == "langocard-pack" && pack.getInt("version") == ContentFiles.PACK_VERSION) { "Unsupported pack format" }
        require(pack.getString("source").isNotBlank() && pack.getString("license").isNotBlank()) { "Pack must include source and license" }
        val incoming = ContentFiles.readEntries(pack.getJSONArray("entries"))
        require(incoming.isNotEmpty()) { "Empty pack" }
        val installedIds = entries.map { it.id }.toHashSet() + bundledIds
        require(incoming.none { it.id in installedIds }) { "Pack contains an existing entry; no changes made" }
        learner.addEntries(incoming)
        learner.addSource(JSONObject().put("source", pack.getString("source")).put("license", pack.getString("license"))
            .put("packId", pack.optString("packId")).put("packVersion", pack.optInt("packVersion", 1)))
        // Rebuild rather than append: synced edits and deletions for these entries apply on top.
        save(); rebuildEntries(); return incoming.size
    }
    fun installedPack(id: String): Boolean =
        id == bundledPack.getString("packId") || learner.sources.any { it.optString("packId") == id }
    fun addEntry(word: String, english: String, definition: String, examples: List<String>, gender: Gender?) {
        val entry = Entry("personal-" + java.util.UUID.randomUUID(), word.trim(), english.trim(), definition.trim(),
            examples.map { Example(it.trim()) }, "daily", gender = gender)
        ContentFiles.validateEntry(entry)
        learner.addEntries(listOf(entry)); save(); rebuildEntries()
    }
    fun ankiExport(): String {
        val credits = linkedSetOf<String>()
        fun credit(source: JSONObject) {
            credits.add(JSONObject().put("source", source.getString("source")).put("license", source.getString("license")).toString())
        }
        credit(bundledPack)
        learner.sources.forEach(::credit)
        return ContentFiles.anki(entries, JSONArray().also { array -> credits.forEach { array.put(JSONObject(it)) } })
    }
}
