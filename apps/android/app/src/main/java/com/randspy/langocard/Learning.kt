package com.randspy.langocard

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import io.github.openspacedrepetition.Card as MemoryCard
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.Scheduler
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

class LearningModel(application: Application) : AndroidViewModel(application) {
    private val bundledPack = application.assets.open("frequent-pack.json").bufferedReader().use { JSONObject(it.readText()) }
    private val bundled = ContentFiles.readEntries(bundledPack.getJSONArray("entries"))
    private val bundledIds = bundled.map { it.id }.toSet()
    private val store = LearnerStore(application.filesDir)
    private var learner = store.load()
    /** The active study library; see [StudyLibrary.active]. */
    val entries = androidx.compose.runtime.mutableStateListOf<Entry>()
    /** Entries removed from the shipped content: kept for their progress, never introduced as new. */
    private var retired = emptySet<String>()
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
    private var scheduler = learner.fittedSettings?.scheduler() ?: Scheduler.builder().desiredRetention(0.9).build()
    val schedulingDescription: String get() = learner.fittedSettings?.let {
        "FSRS · ${(it.retention * 100).toInt()}% target recall · fitted with ${it.reviewCount} reviews on ${it.fitDate}"
    } ?: "FSRS defaults · 90% target recall"
    fun importFittedSettings(text: String) {
        val fit = FittedSettings.parse(text)
        val replacement = fit.scheduler()
        learner.fittedSettings = fit
        scheduler = replacement
        save()
    }
    fun resetFittedSettings() {
        learner.fittedSettings = null
        scheduler = Scheduler.builder().desiredRetention(0.9).build()
        save()
    }
    var revision by mutableIntStateOf(0); private set
    var screen by androidx.compose.runtime.mutableStateOf("home"); private set
    var prompt by androidx.compose.runtime.mutableStateOf<Prompt?>(null); private set
    var hookOffer by androidx.compose.runtime.mutableStateOf<Entry?>(null); private set
    fun memoryHook(entryId: String): String = learner.hook(entryId)
    fun dismissHook() { hookOffer = null }
    fun saveMemoryHook(text: String) {
        val entry = hookOffer ?: return
        require(text.length <= 500)
        learner.setHook(entry.id, text.trim())
        hookOffer = null; save()
    }
    var sessionReviews by mutableIntStateOf(0); private set
    var sessionRecalled by mutableIntStateOf(0); private set
    var sessionSeconds by mutableIntStateOf(0); private set
    private var placementIndex = learner.placementIndex
    private var placing = false
    private val sessionLearning = SessionLearning()
    private var lastTick = android.os.SystemClock.elapsedRealtime()
    val placementDone get() = learner.placementDone
    val vocabularyPlacement = VocabularyPlacement(JSONArray(getApplication<Application>().assets.open("placement-items.json").bufferedReader().use { it.readText() }).let { a ->
        (0 until a.length()).map { i -> a.getJSONObject(i).let { PlacementItem(it.getString("word"), it.getInt("band")) } }
    })
    val vocabularyAnswers get() = learner.vocabularyAnswers
    fun openVocabularyPlacement() { screen = "vocabularyPlacement" }
    fun answerVocabularyPlacement(known: Boolean) {
        if (vocabularyAnswers.size >= vocabularyPlacement.items.size) return
        learner.answerVocabulary(known); save()
    }
    fun retakeVocabularyPlacement() { learner.retakeVocabulary(); save() }
    fun acceptVocabularyPlacement(rank: Int) {
        require(vocabularyAnswers.size == vocabularyPlacement.items.size)
        setMinimumRank(rank)
        learner.placementDone = true; home()
    }
    val placementProgress get() = "$placementIndex / 18"
    val minimumRank get() = learner.minimumRank
    fun setMinimumRank(rank: Int) {
        require(rank in listOf(1, 2501, 7001))
        learner.setMinimumRank(rank); save()
    }
    val interests get() = learner.interests
    private fun today() = StudyPolicy.date(Instant.now())
    private fun rollover() = learner.rollover(today())
    val spent: Int get() { rollover(); return learner.seconds }
    /** Today's block: the daily target, or the extra block picked after it. */
    val block: PracticeBlock get() = PracticeBlock.read(learner.document, today(), spent)
    /** Offers a resume only when the current block can produce work; fresh grants never reuse usage. */
    fun nextPractice(audio: Boolean): NextPractice {
        val current = block
        val now = Instant.now()
        return studyRules.nextPractice(audio && !listeningMuted, current, now, StudyPolicy.date(now))
    }
    /** Starts an extra block of [length]; does nothing unless one is on offer, so a second tap is harmless. */
    fun startExtraBlock(length: ExtraMinutes, audio: Boolean) {
        if (screen == "review" || nextPractice(audio) != NextPractice.ExtraBlock) return
        PracticeBlock.extra(spent, length).write(learner.document, today()); save()
        start(placement = false, audio)
    }
    val studied get() = entries.count { e -> e.skills.any { learner.hasCard(e.cardKey(it)) } }
    val pausedCount get() = learner.pausedCount(System.currentTimeMillis())
    val suspendedCount get() = learner.suspendedCount(System.currentTimeMillis())
    fun state(p: Prompt): MemoryCard? = learner.card(p.key)
    private val studyRules get() = StudyRules(entries, learner, retired)
    fun dueCount(audio: Boolean): Int = studyRules.dueCount(audio && !listeningMuted, Instant.now())
    private fun save() { store.save(learner); revision++ }
    fun backup(): String {
        persist()
        return store.backup(learner)
    }
    fun validateBackup(text: String) { ContentFiles.backupData(text, bundledIds) }
    fun restore(text: String) {
        learner = store.restore(text, bundledIds, learner)
        scheduler = learner.fittedSettings?.scheduler() ?: Scheduler.builder().desiredRetention(0.9).build()
        rebuildEntries()
        placementIndex = learner.placementIndex; placing = false
        home()
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
    fun toggleInterest(topic: String) {
        val next = interests.toMutableSet().apply { if (!add(topic)) remove(topic) }
        if (next.isNotEmpty()) { learner.setInterests(next); save() }
    }
    fun start(placement: Boolean, audio: Boolean) {
        rollover(); placing = placement; sessionReviews = 0; sessionRecalled = 0; sessionSeconds = 0
        sessionLearning.clear()
        screen = "review"; lastTick = android.os.SystemClock.elapsedRealtime(); next(audio)
    }
    fun tick() {
        val now = android.os.SystemClock.elapsedRealtime()
        val seconds = ((now - lastTick) / 1000).toInt()
        if (screen != "review" && !readingPassageActive) {
            if (seconds >= 60) { lastTick = now; rollover(); revision++ }
            return
        }
        if (seconds > 0) {
            lastTick += seconds * 1000L; rollover()
            sessionSeconds += seconds; learner.seconds = spent + seconds; revision++
            if (sessionSeconds % 10 == 0) save()
        }
    }
    var readingPassageActive = false
    /** Reading recall history supplies vocabulary without mutating scheduling. */
    fun passageVocabulary(): PassageVocabulary {
        val recalled = learner.reviews.filter { it.rating != Rating.AGAIN }.map { it.key }.toSet()
        val known = entries.filter { it.cardKey(Skill.Reading).let { key -> key in recalled && learner.card(key) != null } }.take(100)
        val now = Instant.now()
        val due = studyRules.prompts(false, now).filter { it.skill == Skill.Reading && state(it)?.due?.isAfter(now) == false }.take(3).map { it.entry }
        return PassageVocabulary(known, due)
    }
    fun resumeClock() { lastTick = android.os.SystemClock.elapsedRealtime() }
    fun persist() { save() }
    fun finish() { screen = "summary"; prompt = null; save(); sync() }
    fun home() { screen = "home"; prompt = null; listeningMuted = false; save() }
    fun skipPlacement() { learner.placementDone = true; placing = false; home() }
    val isPlacement get() = placing
    private fun next(audio: Boolean) {
        val current = block
        if (!StudyPolicy.sessionOpen(placing, spent, current.end, cleanup = true)) return finish()
        val now = Instant.now()
        val rules = studyRules
        val chosen = rules.choose(audio && !listeningMuted, current, sessionLearning, now, StudyPolicy.date(now))
        if (chosen != null) prompt = rules.shown(chosen, now)
        else { if (placing) learner.placementDone = true; finish() }
    }
    fun rate(rating: Rating, audio: Boolean) {
        val p = prompt ?: return
        val activeBlock = block
        val wasNewGender = p.skill == Skill.Gender && state(p) == null
        val wasNewSense = !learner.started(p.entry)
        if (wasNewGender && !placing) learner.genderIntroduced++
        val card = state(p) ?: learner.newCard()
        val result = scheduler.reviewCard(card, rating)
        if (!placing) sessionLearning.reviewed(p.key, state(p) == null, rating)
        learner.answered(p.key, result.card(), result.reviewLog(), p.example, placing)
        val now = Instant.now()
        val day = StudyPolicy.date(now)
        if (learner.recordRecall(p.key, rating, now)) hookOffer = p.entry
        studyRules.siblingsToBury(p, placing).forEach { learner.bury(it, day) }
        if (!placing) {
            activeBlock.introduced(wasNewSense, wasNewGender).write(learner.document, day)
            if (wasNewSense) learner.introduced++
        } else {
            placementIndex++; learner.placementIndex = placementIndex
        }
        sessionReviews++; if (rating != Rating.AGAIN) sessionRecalled++
        save(); next(audio)
    }
    /** Set for the rest of the sitting, until [home]; skipping leaves the card's schedule untouched. */
    var listeningMuted by androidx.compose.runtime.mutableStateOf(false); private set
    fun muteListening() {
        listeningMuted = true
        if (prompt?.skill == Skill.Listening) next(audio = false)
    }
    fun unmuteListening() { listeningMuted = false }
    fun interval(rating: Rating): String {
        val p = prompt ?: return ""
        val card = state(p) ?: MemoryCard.builder().cardId(learner.nextCardId).build()
        val result = scheduler.reviewCard(card, rating)
        val minutes = ((java.time.Duration.between(Instant.now(), result.card().due).seconds + 59) / 60).coerceAtLeast(1)
        return if (minutes < 60) "${minutes}m" else if (minutes < 1440) "${minutes / 60}h" else "${minutes / 1440}d"
    }

    var syncStatus by androidx.compose.runtime.mutableStateOf(""); private set
    var syncing by androidx.compose.runtime.mutableStateOf(false); private set
    /** Whether a sync target is set; refresh with [refreshSyncConfig] after changing it. */
    var syncConfigured by androidx.compose.runtime.mutableStateOf(SyncConfig.load(application) != null); private set
    var syncFailed by androidx.compose.runtime.mutableStateOf(false); private set
    fun refreshSyncConfig() { syncConfigured = SyncConfig.load(getApplication()) != null; if (!syncConfigured) syncFailed = false }

    /** Pushes local changes and merges other devices' changes; a no-op until sync is set up. */
    fun sync(manual: Boolean = false) {
        refreshSyncConfig()
        val config = SyncConfig.load(getApplication()) ?: run { if (manual) syncStatus = "Set up sync first"; return }
        if (syncing || (screen == "review" && !manual)) return
        syncing = true; syncStatus = "Syncing…"
        viewModelScope.launch {
            syncStatus = try {
                runSync(ConvexHttp(config))
                SyncConfig.markSynced(getApplication(), System.currentTimeMillis())
                syncFailed = false
                "Synced"
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { syncFailed = true; "Sync failed: ${e.message ?: e.javaClass.simpleName}" }
            finally { syncing = false }
        }
    }

    private suspend fun runSync(client: ConvexHttp) {
        val generation = SyncData.generation(learner.document)
        fun current() = SyncData.generation(learner.document) == generation
        rollover()
        val outbox = SyncData.outbox(learner.document, today())
        for (args in outbox.batches()) {
            withContext(Dispatchers.IO) { client.mutation("sync:push", args) }
            if (!current()) return
        }
        SyncData.markPushed(learner.document, outbox); save()
        for (table in SyncData.TABLES) {
            val since = SyncData.cursor(learner.document, table)
            var cursor: String? = null
            var serverTime: Long? = null
            do {
                val args = JSONObject().put("table", table).put("since", since).put("cursor", cursor ?: JSONObject.NULL)
                val result = withContext(Dispatchers.IO) { client.query("sync:pull", args) }
                if (!current()) return // a restore replaced the data mid-sync; the next sync starts over
                if (serverTime == null) serverTime = result.getDouble("serverTime").toLong()
                val page = result.getJSONArray("page")
                applyRemote(table, (0 until page.length()).map(page::getJSONObject))
                cursor = result.getString("continueCursor")
            } while (!result.getBoolean("isDone"))
            SyncData.setCursor(learner.document, table, serverTime!!)
            save()
        }
    }

    private fun applyRemote(table: String, rows: List<JSONObject>) {
        if (rows.isEmpty()) return
        if (table == "settings") rollover()
        if (learner.merge(table, rows, knownIds())) rebuildEntries()
        if (!placing) placementIndex = learner.placementIndex
    }
}
