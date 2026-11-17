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

/**
 * A French sentence that uses a meaning, with exactly one marked answer: "Il pleut, {pourtant} elle sort."
 * The answer is the word as this sentence uses it, so it may be an inflected form.
 * Mirrors `answerOf`, `textOf` and `clozeOf` in `apps/backend/convex/entryRules.ts`.
 */
data class Example(val marked: String) {
    val answer get() = marked.substringAfter("{").substringBefore("}")
    /** The sentence as read or spoken, without the answer marks. */
    val text get() = marked.replace("{", "").replace("}", "")
    /** The sentence with the answer replaced by a gap, as Production shows it. */
    val cloze get() = marked.replace("{$answer}", "________")
    override fun toString() = marked
}

/**
 * IDs identify meanings; changing examples must never change scheduling identity.
 * [examples] holds 1 to [ContentFiles.MAX_EXAMPLES] sentences; the first is the introductory example.
 */
data class Entry(val id: String, val word: String, val english: String, val definition: String,
                 val examples: List<Example>, val topic: String,
                 val lemma: String = "", val rank: Int = Int.MAX_VALUE,
                 val sourceUrl: String = "", val license: String = "", val gender: Gender? = null) {
    val lexeme get() = lemma.ifBlank { word.removePrefix("un ").removePrefix("une ") }
    /** The skills this entry has cards for: Gender only for nouns. */
    val skills get() = if (gender == null) Skill.entries - Skill.Gender else Skill.entries
    /** [word] with its gender tag for nouns: "une intrigue (f.)". */
    val labelledWord get() = gender?.let { "$word (${it.tag})" } ?: word
    /**
     * The example a meaning shows after [exposures] reviews: they rotate in order, starting
     * from the introductory example. Mirrors `exampleAt` in `entryRules.ts`.
     */
    fun exampleAt(exposures: Int): Example = examples[exposures % examples.size]
    /** How the learning file, sync and backups name this meaning's [skill] card: "<id>:<Skill>". */
    fun cardKey(skill: Skill) = "$id:${skill.name}"
}
enum class Skill(val label: String) {
    Reading("Read"), Listening("Listen"), Production("Speak"),
    /** Choosing un or une for a noun; graded by the app, not the learner. */
    Gender("Gender");
    /** Whether the card shows its example as a gap-fill the learner can answer by typing. */
    val fillsGap get() = this == Listening || this == Production
    companion object {
        /** The placement check samples these; Gender isn't part of it. */
        val placement = listOf(Reading, Listening, Production)
    }
}
/** One card to study, with the [example] it shows. The example never affects the card's [key]. */
data class Prompt(val entry: Entry, val skill: Skill, val example: Example = entry.examples.first()) {
    val key get() = entry.cardKey(skill)
}

object StudyPolicy {
    const val DAILY_SECONDS = 15 * 60
    const val WIND_DOWN_SECONDS = 2 * 60
    const val CLEANUP_SECONDS = 2 * 60
    const val NEW_SENSES = 5
    /** Standard daily Gender introductions, counted apart from new meanings. */
    const val NEW_GENDER_CARDS = 10
    fun introductionsOpen(seconds: Int, limit: Int) = seconds < limit - WIND_DOWN_SECONDS
    /** Whether a session may show another card; checked between cards, so the card on screen is always finished. */
    fun sessionOpen(placement: Boolean, seconds: Int, limit: Int, cleanup: Boolean = false) =
        placement || seconds < limit + (if (cleanup) CLEANUP_SECONDS else 0)
    fun date(now: Instant): String = now.atZone(java.time.ZoneId.systemDefault()).toLocalDate().toString()
}

/** What today's practice offers outside a session, once placement is done. */
enum class NextPractice { Session, ExtraBlock, MoreVocabulary, NothingLeft }

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
        val seconds = spent
        val current = block
        if (seconds < current.end && choose(audio, current, SessionLearning()) != null) return NextPractice.Session
        if (seconds >= StudyPolicy.DAILY_SECONDS) {
            val prospective = PracticeBlock.extra(seconds, ExtraMinutes.Five)
            if (choose(audio, prospective, SessionLearning()) != null) return NextPractice.ExtraBlock
        }
        val unstarted = entries.any { entry -> entry.rank >= minimumRank && entry.id !in retired && !learner.started(entry) }
        val now = System.currentTimeMillis()
        val genderOwners = genderOwners()
        val temporarilyBlocked = entries.any { entry -> entry.skills.any { skill ->
            val p = Prompt(entry, skill)
            val relevant = studiable(p, audio, genderOwners)
            val work = if (state(p) == null) learner.started(entry) else state(p)!!.due?.isAfter(Instant.now()) == false
            relevant && work && (learner.isBuried(p.key, today()) || learner.isPausedOrSuspended(p.key, now))
        } }
        return if (unstarted || temporarilyBlocked) NextPractice.NothingLeft else NextPractice.MoreVocabulary
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
    /** Meanings whose Gender card is studied; see [GenderCards]. */
    private fun genderOwners() = GenderCards.owners(entries) { learner.card(it)?.cardId }
    /** Whether [p] belongs in practice at all, before pausing, suspending, burying and scheduling. */
    private fun studiable(p: Prompt, audio: Boolean, genderOwners: Set<String>) =
        (p.skill != Skill.Listening || audio && !listeningMuted) && (p.skill != Skill.Gender || p.entry.id in genderOwners)
    /** Every card that could be studied now, before burying and scheduling. */
    private fun prompts(audio: Boolean): List<Prompt> {
        val owners = genderOwners()
        val now = System.currentTimeMillis()
        return entries.flatMap { e -> e.skills.map { Prompt(e, it) } }.filter { p ->
            studiable(p, audio, owners) && !learner.isPausedOrSuspended(p.key, now)
        }
    }
    fun dueCount(audio: Boolean): Int = prompts(audio).count { p -> state(p)?.due?.let { !it.isAfter(Instant.now()) } == true }
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
        val due = prompts(false).filter { it.skill == Skill.Reading && state(it)?.due?.isAfter(Instant.now()) == false }.take(3).map { it.entry }
        return PassageVocabulary(known, due)
    }
    fun resumeClock() { lastTick = android.os.SystemClock.elapsedRealtime() }
    fun persist() { save() }
    fun finish() { screen = "summary"; prompt = null; save(); sync() }
    fun home() { screen = "home"; prompt = null; listeningMuted = false; save() }
    fun skipPlacement() { learner.placementDone = true; placing = false; home() }
    val isPlacement get() = placing
    /**
     * How many times the meaning has been shown in a sentence: its logged Reading, Listening
     * and Production reviews, placement and other devices' reviews included. Gender cards
     * show no sentence, so they don't count.
     */
    private fun exposures(entry: Entry): Int {
        val shown = Skill.placement.map { entry.cardKey(it) }.toSet()
        return learner.reviews.count { it.key in shown }
    }
    /** [p] showing the meaning's next example, so each exposure meets the word in another sentence. */
    private fun shown(p: Prompt): Prompt {
        val count = exposures(p.entry)
        val until = learner.pausedUntil(p.key)
        val returning = until > 0 && until <= System.currentTimeMillis() &&
            (state(p)?.lastReview?.toEpochMilli() ?: 0L) < until
        val recent = if (returning) learner.reviews.filter { it.key == p.key }
            .sortedBy { it.reviewedAt }.takeLast(4)
            .mapNotNull { it.example.takeIf(String::isNotBlank) } else emptyList()
        return p.copy(example = if (returning) StuckWords.returningExample(p.entry, count, recent) else p.entry.exampleAt(count))
    }
    private fun next(audio: Boolean) {
        val current = block
        if (!StudyPolicy.sessionOpen(placing, spent, current.end, cleanup = true)) return finish()
        val chosen = choose(audio, current, sessionLearning)
        if (chosen != null) prompt = shown(chosen)
        else { if (placing) learner.placementDone = true; finish() }
    }
    private fun choose(audio: Boolean, block: PracticeBlock, session: SessionLearning): Prompt? {
        val limit = block.end
        val available = prompts(audio).filter { !learner.isBuried(it.key, today()) }
        val cleanup = session.next(available.map { it.key }) { key ->
            learner.card(key)?.state != io.github.openspacedrepetition.State.REVIEW
        }?.let { key -> available.first { it.key == key } }
        if (spent >= limit) return cleanup
        val due = available.filter { state(it)?.due?.let { date -> !date.isAfter(Instant.now()) } == true }
            .minByOrNull { state(it)!!.due }
        if (due != null) return due
        if (!StudyPolicy.introductionsOpen(spent, limit)) return cleanup
        // Existing senses gain additional skills on later days, before new senses.
        // Gender comes last, a few a day: it needs the meaning to be familiar first.
        val genderRoom = block.genderRoom(learner.genderIntroduced)
        val sibling = available.filter { p -> state(p) == null && (p.skill != Skill.Gender || genderRoom) &&
            learner.started(p.entry) }.minByOrNull { it.skill == Skill.Gender }
        if (sibling != null) return sibling
        if (block.meaningRoom(learner.introduced)) {
            return available.filter { state(it) == null && it.skill != Skill.Gender && !learner.started(it.entry) && it.entry.rank >= minimumRank && it.entry.id !in retired }.sortedBy { if (it.entry.id.startsWith("personal-")) -1 else it.entry.rank.coerceAtMost(1000000) / 100 * 100 + if (it.entry.topic in interests) 0 else 50 }.firstOrNull() ?: cleanup
        }
        return cleanup
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
        val missed = if (rating == Rating.AGAIN) learner.failures(p.key) + 1 else 0
        learner.setFailures(p.key, missed)
        if (StuckWords.needsHook(missed)) { hookOffer = p.entry; learner.pause(p.key, System.currentTimeMillis() + 3 * 86400000L); learner.setFailures(p.key, 0) }
        if (!placing) {
            // Bury siblings only: a failed card itself may return at its real FSRS due time.
            entries.filter { it.lexeme == p.entry.lexeme }.forEach { related ->
                related.skills.filter { related.id != p.entry.id || it != p.skill }.forEach { learner.bury(related.cardKey(it), today()) }
            }
            activeBlock.introduced(wasNewSense, wasNewGender).write(learner.document, today())
            if (wasNewSense) learner.introduced++
        } else {
            placementIndex++; learner.placementIndex = placementIndex
            // Placement starts the noun, so its Gender card waits for a later day like any sibling.
            if (p.entry.gender != null) learner.bury(p.entry.cardKey(Skill.Gender), today())
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
