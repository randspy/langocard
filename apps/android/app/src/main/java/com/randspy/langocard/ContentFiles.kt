package com.randspy.langocard

import org.json.JSONArray
import org.json.JSONObject
import io.github.openspacedrepetition.Card

/** Interchange formats never execute markup or import unvalidated scheduling state. */
object ContentFiles {
    const val MAX_BYTES = 20 * 1024 * 1024
    fun validateEntry(e: Entry) {
        require(e.id.matches(Regex("[a-zA-Z0-9_-]{1,100}"))) { "Invalid entry ID" }
        require(listOf(e.word, e.english, e.definition, e.markedExample).all { it.isNotBlank() && it.length <= 2000 }) { "Fill every field (maximum 2,000 characters each)" }
        require(e.markedExample.count { it == '{' } == 1 && e.markedExample.count { it == '}' } == 1 &&
            e.markedExample.indexOf('{') < e.markedExample.indexOf('}') && e.answer.isNotBlank()) { "Mark exactly one answer with {braces} in the example" }
        require(e.topic in setOf("daily", "culture", "news")) { "Unknown topic" }
    }
    fun entryJson(e: Entry) = JSONObject().put("id", e.id).put("word", e.word).put("english", e.english)
        .put("definition", e.definition).put("example", e.markedExample).put("topic", e.topic)
    fun readEntries(array: JSONArray): List<Entry> {
        require(array.length() <= 30000) { "Pack is too large" }
        val result = (0 until array.length()).map { i ->
            val o = array.getJSONObject(i)
            Entry(o.getString("id"), o.getString("word"), o.getString("english"), o.getString("definition"), o.getString("example"), o.getString("topic")).also(::validateEntry)
        }
        require(result.map { it.id }.distinct().size == result.size) { "Duplicate entry IDs" }
        return result
    }
    fun backupData(text: String, bundled: Set<String>): JSONObject {
        require(text.toByteArray().size <= MAX_BYTES) { "Backup is too large" }
        val envelope = JSONObject(text)
        require(envelope.getString("format") == "langocard-backup" && envelope.getInt("version") == 1) { "Unsupported backup" }
        val data = envelope.getJSONObject("data")
        require(data.getInt("version") == 1) { "Unsupported study data" }
        val extra = readEntries(data.optJSONArray("extraEntries") ?: JSONArray())
        require(extra.none { it.id in bundled }) { "Entry collides with built-in library" }
        val ids = bundled + extra.map { it.id }
        val cards = data.getJSONObject("cards")
        cards.keys().forEach { key ->
            require(key.substringBefore(':') in ids && key.substringAfter(':') in Skill.entries.map { it.name }) { "Unknown card" }
            val card = Card.fromJson(cards.getString(key))
            require(card.due != null && card.state != null) { "Invalid card" }
            require(card.stability == null || (card.stability.isFinite() && card.stability > 0)) { "Invalid stability" }
            require(card.difficulty == null || card.difficulty in 1.0..10.0) { "Invalid difficulty" }
        }
        require(data.optInt("seconds") >= 0 && data.optInt("introduced") >= 0 && data.optInt("placementIndex") in 0..18)
        // Validate optional collections before any file is replaced.
        for (key in listOf("buried", "failures", "paused")) if (data.has(key)) data.getJSONObject(key)
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
            entries.forEach { e ->
                val back = "${html(e.english)}<br>${html(e.definition)}<br>${html(e.example)}<br>$attribution"
                append("${html(e.word)}\t$back\tlangocard reading\n")
                append("${html(e.english)}<br>${html(e.cloze)}\t${html(e.word)}<br>${html(e.example)}<br>$attribution\tlangocard production\n")
            }
        }
    }
}
