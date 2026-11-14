package com.randspy.langocard

import org.json.JSONArray
import org.json.JSONObject
import io.github.openspacedrepetition.Card

/** Interchange formats never execute markup or import unvalidated scheduling state. */
object ContentFiles {
    const val MAX_BYTES = 20 * 1024 * 1024
    /** A meaning has at most this many examples; mirrors `MAX_EXAMPLES` in `entryRules.ts`. */
    const val MAX_EXAMPLES = 5
    /** Formats that carry `examples`; files of earlier versions are rejected, not converted. */
    const val PACK_VERSION = 2
    const val BACKUP_VERSION = 2
    const val DATA_VERSION = 2
    /** Mirrors `entryErrors` in `entryRules.ts`; throws the message of the first rule broken. */
    fun validateEntry(e: Entry) {
        require(e.id.matches(Regex("[a-zA-Z0-9_-]{1,100}"))) { "Invalid entry ID" }
        require((listOf(e.word, e.english, e.definition) + e.examples.map { it.marked }).all(::validText)) { "Fill every field (maximum 2,000 characters each)" }
        require(e.examples.all { validAnswer(it.marked) }) { "Mark exactly one answer with {braces} in the example" }
        require(e.examples.size in 1..MAX_EXAMPLES) { "Give 1 to $MAX_EXAMPLES examples" }
        require(e.examples.map { it.marked.trim() }.distinct().size == e.examples.size) { "Each example must be different" }
        require(e.rank > 0 && e.lemma.length <= 200 && e.license.length <= 500) { "Invalid vocabulary metadata" }
        require(e.sourceUrl.isBlank() || (e.sourceUrl.startsWith("https://") && e.sourceUrl.length <= 2000)) { "Invalid source URL" }
        require(e.topic in setOf("daily", "culture", "news")) { "Unknown topic" }
        require(e.gender == null || Gender.ofArticle(e.word).let { it == null || it == e.gender }) { "The gender doesn't match the article" }
    }
    /** A required text field: not blank and at most 2,000 characters. */
    fun validText(s: String) = s.isNotBlank() && s.length <= 2000
    /** The example marks exactly one non-blank answer with {braces}. */
    fun validAnswer(markedExample: String) = markedExample.count { it == '{' } == 1 && markedExample.count { it == '}' } == 1 &&
        markedExample.indexOf('{') < markedExample.indexOf('}') && markedExample.substringAfter("{").substringBefore("}").isNotBlank()
    fun entryJson(e: Entry) = JSONObject().put("id", e.id).put("word", e.word).put("english", e.english)
        .put("definition", e.definition).put("examples", examplesJson(e)).put("topic", e.topic)
        .put("lemma", e.lemma).put("rank", e.rank).put("sourceUrl", e.sourceUrl).put("license", e.license)
        .put("gender", Gender.json(e.gender))
    fun examplesJson(e: Entry) = JSONArray(e.examples.map { it.marked })
    /** The `examples` of an entry in JSON; missing or malformed gives none, which [validateEntry] rejects. */
    fun readExamples(o: JSONObject): List<Example> {
        val array = o.optJSONArray("examples") ?: return emptyList()
        return (0 until array.length()).map { Example(array.optString(it)) }
    }
    fun readEntries(array: JSONArray): List<Entry> {
        require(array.length() <= 30000) { "Pack is too large" }
        val result = (0 until array.length()).map { i ->
            val o = array.getJSONObject(i)
            Entry(o.getString("id"), o.getString("word"), o.getString("english"), o.getString("definition"), readExamples(o), o.getString("topic"),
                o.optString("lemma"), o.optInt("rank", Int.MAX_VALUE), o.optString("sourceUrl"), o.optString("license"),
                Gender.read(o, o.getString("word"))).also(::validateEntry)
        }
        require(result.map { it.id }.distinct().size == result.size) { "Duplicate entry IDs" }
        return result
    }
    /** Parses one stored FSRS card, rejecting unknown entries and out-of-range memory state. */
    fun validateCard(key: String, json: String, entryIds: Set<String>): Card {
        require(key.substringBefore(':') in entryIds && key.substringAfter(':') in Skill.entries.map { it.name }) { "Unknown card" }
        val card = Card.fromJson(json)
        require(card.due != null && card.state != null) { "Invalid card" }
        require(card.stability == null || (card.stability.isFinite() && card.stability > 0)) { "Invalid stability" }
        require(card.difficulty == null || card.difficulty in 1.0..10.0) { "Invalid difficulty" }
        return card
    }
    fun backupData(text: String, bundled: Set<String>): JSONObject {
        require(text.toByteArray().size <= MAX_BYTES) { "Backup is too large" }
        val envelope = JSONObject(text)
        require(envelope.getString("format") == "langocard-backup" && envelope.getInt("version") == BACKUP_VERSION) { "Unsupported backup" }
        val data = envelope.getJSONObject("data")
        require(data.getInt("version") == DATA_VERSION) { "Unsupported study data" }
        val extra = readEntries(data.optJSONArray("extraEntries") ?: JSONArray())
        require(extra.none { it.id in bundled }) { "Entry collides with built-in library" }
        // Synced library rows (web edits, entries from other devices) also own cards.
        val remote = data.optJSONObject("remoteEntries") ?: JSONObject()
        val ids = bundled + extra.map { it.id } + remote.keys().asSequence().filter { SyncData.rowEntry(remote.getJSONObject(it)) != null }
        val cards = data.getJSONObject("cards")
        cards.keys().forEach { key -> validateCard(key, cards.getString(key), ids) }
        require(data.optInt("seconds") >= 0 && data.optInt("introduced") >= 0 && data.optInt("placementIndex") in 0..18)
        if (data.has("minimumRank")) require(data.getInt("minimumRank") in listOf(1, 2501, 7001))
        // Validate optional collections before any file is replaced.
        for (key in listOf("buried", "failures", "paused", "suspended", "cardEdited", "resets")) if (data.has(key)) data.getJSONObject(key)
        if (data.has("reviews")) data.getJSONArray("reviews")
        if (data.has("sources")) data.getJSONArray("sources")
        return data
    }
    fun anki(entries: List<Entry>, sources: JSONArray): String {
        fun html(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace("\"", "&quot;").replace("\t", " ").replace("\r", "").replace("\n", "<br>")
        val attribution = html(sources.toString())
        return buildString {
            append("#separator:Tab\n#html:true\n#columns:Front\tBack\tTags\n")
            // One note per skill: fronts use the introductory example, backs list every example.
            entries.forEach { e ->
                val credit = "${html(e.sourceUrl)} ${html(e.license)}<br>$attribution"
                val first = e.examples.first()
                val all = e.examples.joinToString("<br>") { html(it.text) }
                val back = "${html(e.english)}<br>${html(e.definition)}<br>$all<br>$credit"
                append("${html(e.word)}<br>${html(first.text)}\t$back\tlangocard reading\n")
                append("${html(e.english)}<br>${html(first.cloze)}\t${html(e.word)}<br>$all<br>$credit\tlangocard production\n")
                if (e.gender != null) append("${html(Gender.noun(e.word))}<br>${html(e.english)}\t${html(e.gender.article + " " + Gender.noun(e.word))}<br>$all<br>$credit\tlangocard gender\n")
            }
        }
    }
}
