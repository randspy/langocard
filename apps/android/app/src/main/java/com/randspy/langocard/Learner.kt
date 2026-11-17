package com.randspy.langocard

import io.github.openspacedrepetition.Card as MemoryCard
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.ReviewLog
import org.json.JSONArray
import org.json.JSONObject

/**
 * What this device has saved about the learner: FSRS cards and the answers behind them, burials,
 * failure streaks, pauses, today's counters, placement, preferences, memory hooks, fitted FSRS
 * settings and library additions. It reads and writes [document], the JSON kept in
 * `learning-v2.json`, so a restore swaps in another Learner. Sync and practice blocks use
 * [document] in their own formats; remote rows come in through [merge].
 * Confined to its owner's thread. Persistence receives serialized copies, never this live state.
 */
class Learner(val document: JSONObject) {
    init {
        if (document.optJSONArray("extraEntries") == null) document.put("extraEntries", JSONArray())
        if (document.optJSONObject("cards") == null) document.put("cards", JSONObject())
        if (document.optJSONArray("reviews") == null) document.put("reviews", JSONArray())
        for (name in listOf("buried", "failures", "paused")) if (document.optJSONObject(name) == null) document.put(name, JSONObject())
    }

    private val cards get() = document.getJSONObject("cards")
    private val buried get() = document.getJSONObject("buried")
    private val failureStreaks get() = document.getJSONObject("failures")
    private val paused get() = document.getJSONObject("paused")
    /** Manual suspensions made in the web app (synced; this app only honours them). */
    private val suspended get() = document.optJSONObject("suspended") ?: JSONObject()
    private val memory = cards.keys().asSequence().associateWith { MemoryCard.fromJson(cards.getString(it)) }.toMutableMap()
    /** The ID the next new card takes; it never goes back, even when a sync resets the newest card. */
    var nextCardId = maxOf(document.optInt("nextCardId"), maxCardId() + 1); private set
    private fun maxCardId() = memory.values.maxOfOrNull { it.cardId } ?: -1

    fun card(key: String): MemoryCard? = memory[key]
    fun hasCard(key: String) = cards.has(key)
    /** Whether any skill of [entry] has a card, which makes it a started meaning rather than a new one. */
    fun started(entry: Entry) = Skill.entries.any { hasCard(entry.cardKey(it)) }
    /** A card for a first answer, taking [nextCardId]. */
    fun newCard(): MemoryCard = MemoryCard.builder().cardId(nextCardId++).build().also { document.put("nextCardId", nextCardId) }

    /** Saves the card an answer to [key] produced, for the next sync push too, and logs the answer with the [example] shown. */
    fun answered(key: String, card: MemoryCard, log: ReviewLog, example: Example, placement: Boolean) {
        cards.put(key, card.toJson())
        SyncData.markCard(document, key, card.lastReview?.toEpochMilli() ?: 0L)
        memory[key] = card
        document.getJSONArray("reviews").put(JSONObject().put("key", key).put("placement", placement)
            .put("log", JSONObject(log.toJson()).put("example", example.marked).toString()))
    }

    /** Merges one page of synced rows; see [SyncData.apply]. Returns whether the library changed. */
    fun merge(table: String, rows: List<JSONObject>, entryIds: Set<String>): Boolean {
        val applied = SyncData.apply(document, table, rows, entryIds)
        memory.putAll(applied.cards)
        applied.resetCards.forEach(memory::remove)
        nextCardId = maxOf(nextCardId, document.optInt("nextCardId"), maxCardId() + 1)
        document.put("nextCardId", nextCardId)
        return applied.library
    }

    /** Every answer in the order logged locally or appended by sync, which can bring older answers. */
    val reviews: List<Review> get() = document.getJSONArray("reviews").let { a -> (0 until a.length()).map { Review(a.getJSONObject(it)) } }

    /** One logged answer: its card [key] and the FSRS review log, which also records the example shown. */
    class Review(private val row: JSONObject) {
        val key: String get() = row.optString("key")
        private val log by lazy { JSONObject(row.get("log").toString()) }
        val rating: Rating get() = Rating.valueOf(log.getString("rating"))
        /** The ISO-8601 time of the answer, so it sorts in time order. */
        val reviewedAt: String get() = log.optString("review_datetime")
        val example: String get() = log.optString("example")
    }

    fun isBuried(key: String, day: String) = buried.optString(key) == day
    fun bury(key: String, day: String) { buried.put(key, day) }
    /** Consecutive failed answers to [key]. */
    fun failures(key: String) = failureStreaks.optInt(key)
    fun setFailures(key: String, count: Int) { failureStreaks.put(key, count) }
    fun pausedUntil(key: String) = paused.optLong(key)
    fun pause(key: String, until: Long) { paused.put(key, until) }
    fun isPausedOrSuspended(key: String, now: Long) = paused.optLong(key) > now || suspended.optLong(key) > now
    fun pausedCount(now: Long) = paused.let { p -> p.keys().asSequence().count { p.optLong(it) > now } }
    fun suspendedCount(now: Long) = suspended.let { s -> s.keys().asSequence().count { s.optLong(it) > now } }

    /** Starts [day]'s counters at zero if they count another day. */
    fun rollover(day: String) {
        if (document.optString("day") != day) document.put("day", day).put("seconds", 0).put("introduced", 0).put("genderIntroduced", 0)
    }
    /** Foreground practice seconds today, across sessions and devices. */
    var seconds: Int
        get() = document.optInt("seconds")
        set(value) { document.put("seconds", value) }
    /** New meanings introduced today. */
    var introduced: Int
        get() = document.optInt("introduced")
        set(value) { document.put("introduced", value) }
    /** Gender cards introduced today, counted apart from meanings. */
    var genderIntroduced: Int
        get() = document.optInt("genderIntroduced")
        set(value) { document.put("genderIntroduced", value) }

    var placementIndex: Int
        get() = document.optInt("placementIndex")
        set(value) { document.put("placementIndex", value) }
    var placementDone: Boolean
        get() = document.optBoolean("placementDone")
        set(value) { document.put("placementDone", value) }
    val vocabularyAnswers: List<Boolean> get() = document.optJSONArray("vocabularyPlacementV1")?.let { a ->
        (0 until a.length()).map { a.getBoolean(it) }
    } ?: emptyList()
    fun answerVocabulary(known: Boolean) { document.put("vocabularyPlacementV1", JSONArray(vocabularyAnswers + known)) }
    fun retakeVocabulary() { document.remove("vocabularyPlacementV1") }

    val minimumRank get() = document.optInt("minimumRank", 2501)
    fun setMinimumRank(rank: Int) { document.put("minimumRank", rank).put("preferencesChangedAt", System.currentTimeMillis()) }
    val interests get() = document.optString("interests", "daily,culture,news").split(',').toSet()
    fun setInterests(topics: Set<String>) {
        document.put("interests", topics.joinToString(",")).put("preferencesChangedAt", System.currentTimeMillis())
    }

    fun hook(entryId: String): String = document.optJSONObject("hooks")?.optJSONObject(entryId)?.optString("text") ?: ""
    fun setHook(entryId: String, text: String) {
        val hooks = document.optJSONObject("hooks") ?: JSONObject().also { document.put("hooks", it) }
        val clock = maxOf(System.currentTimeMillis(), (hooks.optJSONObject(entryId)?.optLong("editedAt") ?: 0L) + 1)
        hooks.put(entryId, JSONObject().put("entryId", entryId).put("text", text).put("editedAt", clock))
    }

    var fittedSettings: FittedSettings?
        get() = document.optJSONObject("fittedSettings")?.let { FittedSettings.parse(it.toString()) }
        set(value) { if (value == null) document.remove("fittedSettings") else document.put("fittedSettings", value.toJson()) }

    /** Entries added on this device: personal ones and imported packs. */
    var extraEntries: List<Entry>
        get() = ContentFiles.readEntries(document.getJSONArray("extraEntries"))
        set(value) { document.put("extraEntries", JSONArray(value.map(ContentFiles::entryJson))) }
    fun addEntries(entries: List<Entry>) { entries.forEach { document.getJSONArray("extraEntries").put(ContentFiles.entryJson(it)) } }
    /** Synced library rows by entry ID; see [StudyLibrary]. */
    val remoteEntries: JSONObject get() = document.optJSONObject("remoteEntries") ?: JSONObject()
    /** The IDs in [extraEntries] and [remoteEntries], read without validating the entries. */
    fun entryIds(): Set<String> = remoteEntries.keys().asSequence().toHashSet().apply {
        val extra = document.getJSONArray("extraEntries")
        (0 until extra.length()).forEach { add(extra.getJSONObject(it).getString("id")) }
    }
    /** Where installed packs came from, with their licences. */
    val sources: List<JSONObject> get() = document.optJSONArray("sources")?.let { a -> (0 until a.length()).map(a::getJSONObject) } ?: emptyList()
    fun addSource(source: JSONObject) { (document.optJSONArray("sources") ?: JSONArray().also { document.put("sources", it) }).put(source) }

    /**
     * The learner a validated [backup] holds. It continues this device's sync generations, so a
     * sync in flight stops, and the next sync pushes every restored card again; newer cloud
     * reviews still win.
     */
    fun restoredFrom(backup: JSONObject): Learner = Learner(backup).also { restored ->
        restored.document.put("sync", document.optJSONObject("sync") ?: JSONObject())
        SyncData.reset(restored.document)
    }
}
