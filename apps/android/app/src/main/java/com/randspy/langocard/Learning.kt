package com.randspy.langocard

import android.app.Application
import android.util.AtomicFile
import androidx.lifecycle.AndroidViewModel
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import io.github.openspacedrepetition.Card as MemoryCard
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.Scheduler
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

/** IDs identify meanings; changing examples must never change scheduling identity. */
data class Entry(val id: String, val word: String, val english: String, val definition: String,
                 val markedExample: String, val topic: String,
                 val lemma: String = "", val rank: Int = Int.MAX_VALUE,
                 val sourceUrl: String = "", val license: String = "") {
    val lexeme get() = lemma.ifBlank { word.removePrefix("un ").removePrefix("une ") }
    val answer get() = markedExample.substringAfter("{").substringBefore("}")
    val example get() = markedExample.replace("{", "").replace("}", "")
    val cloze get() = markedExample.replace("{$answer}", "________")
}
enum class Skill(val label: String) { Reading("Read"), Listening("Listen"), Production("Speak") }
data class Prompt(val entry: Entry, val skill: Skill) { val key get() = "${entry.id}:${skill.name}" }

object StudyPolicy {
    const val DAILY_SECONDS = 15 * 60
    const val NEW_SENSES = 5
    fun canIntroduce(overdue: Int, seconds: Int, introduced: Int) =
        overdue == 0 && seconds < DAILY_SECONDS && introduced < NEW_SENSES
    fun date(now: Instant): String = now.atZone(java.time.ZoneId.systemDefault()).toLocalDate().toString()
}

class LearningModel(application: Application) : AndroidViewModel(application) {
    private val pilot = application.assets.open("pilot.tsv").bufferedReader().useLines { lines ->
        lines.filter { it.isNotBlank() }.map { line ->
            val c = line.split('|'); require(c.size == 6)
            Entry(c[0], c[1], c[2], c[3], c[4], c[5])
        }.toList().also { require(it.size == 200 && it.map(Entry::id).distinct().size == 200) }
    }
    private val bundledPack = application.assets.open("frequent-pack.json").bufferedReader().use { JSONObject(it.readText()) }
    private val bundled = pilot + ContentFiles.readEntries(bundledPack.getJSONArray("entries"))
    val bundledCount get() = bundled.size
    private val file = AtomicFile(File(application.filesDir, "learning-v1.json"))
    private val data = if (file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()) {
        file.openRead().bufferedReader().use { JSONObject(it.readText()) }
    } else JSONObject().put("version", 1)
    val entries = androidx.compose.runtime.mutableStateListOf<Entry>().apply {
        addAll(bundled)
        addAll(ContentFiles.readEntries(data.optJSONArray("extraEntries") ?: JSONArray()).filter { extra -> bundled.none { it.id == extra.id } })
    }
    init {
        val extra = ContentFiles.readEntries(data.optJSONArray("extraEntries") ?: JSONArray()).filter { item -> bundled.none { it.id == item.id } }
        data.put("extraEntries", JSONArray().also { array -> extra.forEach { array.put(ContentFiles.entryJson(it)) } })
    }
    private val cards = data.optJSONObject("cards") ?: JSONObject().also { data.put("cards", it) }
    private val memory = cards.keys().asSequence().associateWith { MemoryCard.fromJson(cards.getString(it)) }.toMutableMap()
    private var nextCardId = maxOf(data.optInt("nextCardId"), (memory.values.maxOfOrNull { it.cardId } ?: -1) + 1)
    private val logs = data.optJSONArray("reviews") ?: JSONArray().also { data.put("reviews", it) }
    private val buried = data.optJSONObject("buried") ?: JSONObject().also { data.put("buried", it) }
    private val failures = data.optJSONObject("failures") ?: JSONObject().also { data.put("failures", it) }
    private val paused = data.optJSONObject("paused") ?: JSONObject().also { data.put("paused", it) }
    private val scheduler = Scheduler.builder().desiredRetention(0.9).build()
    var revision by mutableIntStateOf(0); private set
    var screen by androidx.compose.runtime.mutableStateOf("home"); private set
    var prompt by androidx.compose.runtime.mutableStateOf<Prompt?>(null); private set
    var sessionReviews by mutableIntStateOf(0); private set
    var sessionRecalled by mutableIntStateOf(0); private set
    var sessionSeconds by mutableIntStateOf(0); private set
    private var placementIndex = data.optInt("placementIndex")
    private var placing = false
    private var lastTick = android.os.SystemClock.elapsedRealtime()
    private val placementEntries = listOf("pourtant", "un enjeu", "se méfier", "une intrigue", "mettre en œuvre", "fiable")
        .map { word -> entries.first { it.word == word } }
    val placementDone get() = data.optBoolean("placementDone")
    val placementProgress get() = "$placementIndex / 18"
    val interests get() = data.optString("interests", "daily,culture,news").split(',').toSet()
    private fun today() = StudyPolicy.date(Instant.now())
    private fun rollover() {
        if (data.optString("day") != today()) {
            data.put("day", today()).put("seconds", 0).put("introduced", 0)
        }
    }
    val spent: Int get() { rollover(); return data.optInt("seconds") }
    val studied get() = entries.count { e -> Skill.entries.any { cards.has("${e.id}:${it.name}") } }
    val pausedCount get() = paused.keys().asSequence().count { paused.optLong(it) > System.currentTimeMillis() }
    fun state(p: Prompt): MemoryCard? = memory[p.key]
    private fun eligible(p: Prompt, audio: Boolean) = (p.skill != Skill.Listening || audio) &&
        paused.optLong(p.key) <= System.currentTimeMillis()
    fun dueCount(audio: Boolean): Int = entries.sumOf { e -> Skill.entries.count { skill ->
        val p = Prompt(e, skill)
        eligible(p, audio) && (state(p)?.due?.let { !it.isAfter(Instant.now()) } == true)
    } }
    private fun save() {
        val stream = file.startWrite()
        try { stream.write(data.toString().toByteArray()); file.finishWrite(stream) }
        catch (e: Exception) { file.failWrite(stream); throw e }
        revision++
    }
    fun backup(): String {
        persist()
        return JSONObject().put("format", "langocard-backup").put("version", 1)
            .put("data", JSONObject(data.toString())).toString(2)
    }
    fun validateBackup(text: String) { ContentFiles.backupData(text, bundled.map { it.id }.toSet()) }
    fun restore(text: String) {
        val restored = ContentFiles.backupData(text, bundled.map { it.id }.toSet())
        // Validate first; write the replacement atomically before changing live state.
        val stream = file.startWrite()
        try { stream.write(restored.toString().toByteArray()); file.finishWrite(stream) }
        catch (e: Exception) { file.failWrite(stream); throw e }
        fun replace(target: JSONObject, source: JSONObject) {
            target.keys().asSequence().toList().forEach(target::remove)
            source.keys().forEach { target.put(it, source.get(it)) }
        }
        replace(cards, restored.optJSONObject("cards") ?: JSONObject())
        while (logs.length() > 0) logs.remove(logs.length() - 1)
        val importedLogs = restored.optJSONArray("reviews") ?: JSONArray()
        for (i in 0 until importedLogs.length()) logs.put(importedLogs.get(i))
        replace(buried, restored.optJSONObject("buried") ?: JSONObject())
        replace(failures, restored.optJSONObject("failures") ?: JSONObject())
        replace(paused, restored.optJSONObject("paused") ?: JSONObject())
        replace(data, restored)
        data.put("cards", cards).put("reviews", logs).put("buried", buried).put("failures", failures).put("paused", paused)
        memory.clear(); cards.keys().forEach { memory[it] = MemoryCard.fromJson(cards.getString(it)) }
        nextCardId = maxOf(data.optInt("nextCardId"), (memory.values.maxOfOrNull { it.cardId } ?: -1) + 1)
        entries.clear(); entries.addAll(bundled)
        entries.addAll(ContentFiles.readEntries(data.optJSONArray("extraEntries") ?: JSONArray()).filter { extra -> bundled.none { it.id == extra.id } })
        placementIndex = data.optInt("placementIndex"); placing = false
        home()
    }

    fun importPack(text: String): Int {
        val pack = JSONObject(text)
        require(pack.getString("format") == "langocard-pack" && pack.getInt("version") == 1) { "Unsupported pack format" }
        require(pack.getString("source").isNotBlank() && pack.getString("license").isNotBlank()) { "Pack must include source and license" }
        val incoming = ContentFiles.readEntries(pack.getJSONArray("entries"))
        require(incoming.isNotEmpty()) { "Empty pack" }
        val installedIds = entries.map { it.id }.toHashSet()
        require(incoming.none { it.id in installedIds }) { "Pack contains an existing entry; no changes made" }
        val extra = data.optJSONArray("extraEntries") ?: JSONArray().also { data.put("extraEntries", it) }
        incoming.forEach { extra.put(ContentFiles.entryJson(it)) }
        val sources = data.optJSONArray("sources") ?: JSONArray().also { data.put("sources", it) }
        sources.put(JSONObject().put("source", pack.getString("source")).put("license", pack.getString("license"))
            .put("packId", pack.optString("packId")).put("packVersion", pack.optInt("packVersion", 1)))
        save(); entries.addAll(incoming); return incoming.size
    }
    fun installedPack(id: String): Boolean {
        if (id == bundledPack.getString("packId")) return true
        val sources = data.optJSONArray("sources") ?: return false
        return (0 until sources.length()).any { sources.getJSONObject(it).optString("packId") == id }
    }
    fun addEntry(word: String, english: String, definition: String, example: String) {
        val entry = Entry("personal-" + java.util.UUID.randomUUID(), word.trim(), english.trim(), definition.trim(), example.trim(), "daily")
        ContentFiles.validateEntry(entry)
        val extra = data.optJSONArray("extraEntries") ?: JSONArray().also { data.put("extraEntries", it) }
        extra.put(ContentFiles.entryJson(entry)); save(); entries.add(entry)
    }
    fun ankiExport(): String {
        val credits = linkedSetOf<String>()
        fun credit(source: JSONObject) {
            credits.add(JSONObject().put("source", source.getString("source")).put("license", source.getString("license")).toString())
        }
        credit(bundledPack)
        val sources = data.optJSONArray("sources") ?: JSONArray()
        for (i in 0 until sources.length()) credit(sources.getJSONObject(i))
        return ContentFiles.anki(entries, JSONArray().also { array -> credits.forEach { array.put(JSONObject(it)) } })
    }
    fun toggleInterest(topic: String) {
        val next = interests.toMutableSet().apply { if (!add(topic)) remove(topic) }
        if (next.isNotEmpty()) { data.put("interests", next.joinToString(",")); save() }
    }
    fun start(placement: Boolean, audio: Boolean) {
        rollover(); placing = placement; sessionReviews = 0; sessionRecalled = 0; sessionSeconds = 0
        screen = "review"; lastTick = android.os.SystemClock.elapsedRealtime(); next(audio)
    }
    fun tick() {
        val now = android.os.SystemClock.elapsedRealtime()
        val seconds = ((now - lastTick) / 1000).toInt()
        if (screen != "review") {
            if (seconds >= 60) { lastTick = now; rollover(); revision++ }
            return
        }
        if (seconds > 0) {
            lastTick += seconds * 1000L; rollover()
            sessionSeconds += seconds; data.put("seconds", spent + seconds); revision++
            if (sessionSeconds % 10 == 0) save()
            if (!placing && spent >= StudyPolicy.DAILY_SECONDS) finish()
        }
    }
    fun resumeClock() { lastTick = android.os.SystemClock.elapsedRealtime() }
    fun persist() { save() }
    fun finish() { screen = "summary"; prompt = null; save() }
    fun home() { screen = "home"; prompt = null; save() }
    fun skipPlacement() { data.put("placementDone", true); placing = false; home() }
    val isPlacement get() = placing
    private fun next(audio: Boolean) {
        if (placing) {
            while (placementIndex < 18) {
                val p = Prompt(placementEntries[placementIndex % 6], Skill.entries[placementIndex / 6])
                if (p.skill != Skill.Listening || audio) { prompt = p; return }
                placementIndex++ // unavailable audio remains unassessed, not marked known
            }
            data.put("placementDone", true); finish(); return
        }
        val all = entries.flatMap { e -> Skill.entries.map { Prompt(e, it) } }
        val available = all.filter { eligible(it, audio) && buried.optString(it.key) != today() }
        val due = available.filter { state(it)?.due?.let { date -> !date.isAfter(Instant.now()) } == true }
            .minByOrNull { state(it)!!.due }
        if (due != null) { prompt = due; return }
        // Existing senses gain additional skills on later days, before new senses.
        val sibling = available.firstOrNull { p -> state(p) == null && Skill.entries.any { cards.has("${p.entry.id}:${it.name}") } }
        if (dueCount(audio) == 0 && sibling != null && spent < StudyPolicy.DAILY_SECONDS) { prompt = sibling; return }
        if (StudyPolicy.canIntroduce(dueCount(audio), spent, data.optInt("introduced"))) {
            prompt = available.filter { state(it) == null }.sortedBy { if (it.entry.id.startsWith("personal-")) -1 else it.entry.rank.coerceAtMost(1000000) / 100 * 100 + if (it.entry.topic in interests) 0 else 50 }.firstOrNull()
            if (prompt != null) return
        }
        finish()
    }
    fun rate(rating: Rating, audio: Boolean) {
        val p = prompt ?: return
        val wasNewSense = Skill.entries.none { cards.has("${p.entry.id}:${it.name}") }
        val card = state(p) ?: MemoryCard.builder().cardId(nextCardId).build()
        if (state(p) == null) { nextCardId++; data.put("nextCardId", nextCardId) }
        val result = scheduler.reviewCard(card, rating)
        cards.put(p.key, result.card().toJson())
        memory[p.key] = result.card()
        logs.put(JSONObject().put("key", p.key).put("placement", placing).put("log", result.reviewLog().toJson()))
        val missed = if (rating == Rating.AGAIN) failures.optInt(p.key) + 1 else 0
        failures.put(p.key, missed)
        if (missed >= 4) { paused.put(p.key, System.currentTimeMillis() + 3 * 86400000L); failures.put(p.key, 0) }
        if (!placing) {
            // Bury siblings only: a failed card itself may return at its real FSRS due time.
            entries.filter { it.lexeme == p.entry.lexeme }.forEach { related ->
                Skill.entries.filter { related.id != p.entry.id || it != p.skill }.forEach { buried.put("${related.id}:${it.name}", today()) }
            }
            if (wasNewSense) data.put("introduced", data.optInt("introduced") + 1)
        } else { placementIndex++; data.put("placementIndex", placementIndex) }
        sessionReviews++; if (rating != Rating.AGAIN) sessionRecalled++
        save(); next(audio)
    }
    fun deferAudio() { if (prompt?.skill == Skill.Listening) next(false) }
    fun interval(rating: Rating): String {
        val p = prompt ?: return ""
        val card = state(p) ?: MemoryCard.builder().cardId(nextCardId).build()
        val result = scheduler.reviewCard(card, rating)
        val minutes = ((java.time.Duration.between(Instant.now(), result.card().due).seconds + 59) / 60).coerceAtLeast(1)
        return if (minutes < 60) "${minutes}m" else if (minutes < 1440) "${minutes / 60}h" else "${minutes / 1440}d"
    }
}
