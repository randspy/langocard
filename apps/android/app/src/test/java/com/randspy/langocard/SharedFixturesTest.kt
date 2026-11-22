package com.randspy.langocard

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Runs the cases shared with `apps/backend` so the Kotlin and TypeScript rules can't drift. */
class SharedFixturesTest {
    private fun fixtures(name: String) = JSONObject(File("../../../content/$name").readText())
    private val messages = mapOf(
        "id" to setOf("Invalid entry ID"),
        "fields" to setOf("Fill every field (maximum 2,000 characters each)"),
        "answer" to setOf("Mark exactly one answer with {braces} in the example"),
        "alternatives" to setOf("Alternatives must be different, non-empty words (at most 5)"),
        "examples" to setOf("Give 1 to 5 examples", "Each example must be different"),
        "metadata" to setOf("Invalid vocabulary metadata"),
        "sourceUrl" to setOf("Invalid source URL"),
        "topic" to setOf("Unknown topic"),
        "gender" to setOf("Unknown gender", "The gender doesn't match the article"),
    )

    @Test fun `entry rules match the backend`() {
        val cases = fixtures("entry-rules-fixtures.json").getJSONArray("cases")
        assertTrue(cases.length() > 10)
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val name = case.getString("name")
            val error = runCatching { ContentFiles.readEntries(JSONArray().put(case.getJSONObject("entry"))) }.exceptionOrNull()
            if (case.isNull("rule")) assertNull(name, error)
            else assertTrue("$name: ${error?.message}", error?.message in messages.getValue(case.getString("rule")))
        }
    }

    @Test fun `card merges match the backend`() {
        val cases = fixtures("merge-fixtures.json").getJSONArray("cards")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val merged = SyncData.mergeCard(case.getJSONObject("stored"), case.getJSONObject("incoming"))
            val expected = case.getJSONObject("expected")
            expected.keys().forEach { key ->
                assertEquals("${case.getString("name")}: $key", expected.get(key).toString(), merged.get(key).toString())
            }
        }
    }

    @Test fun `Anki export matches the web app`() {
        val case = fixtures("anki-fixtures.json")
        val entries = ContentFiles.readEntries(case.getJSONArray("entries"))
        // The Android export credits each source once, as LearningLibrary.ankiExport collects them.
        val credits = linkedSetOf<String>()
        val raw = case.getJSONArray("credits")
        for (i in 0 until raw.length()) raw.getJSONObject(i).let {
            credits.add(JSONObject().put("source", it.getString("source")).put("license", it.getString("license")).toString())
        }
        val sources = JSONArray().also { array -> credits.forEach { array.put(JSONObject(it)) } }
        // Android's org.json keeps insertion order ("source", then "license"); the JVM test
        // library orders keys by hash, so only the credits' key order may differ here.
        fun html(s: String) = s.replace("&", "&amp;").replace("\"", "&quot;")
        val deviceOrder = (0 until sources.length()).joinToString(",", "[", "]") { i ->
            val o = sources.getJSONObject(i)
            "{\"source\":${JSONObject.quote(o.getString("source"))},\"license\":${JSONObject.quote(o.getString("license"))}}"
        }
        val expected = case.getString("expected").replace(html(deviceOrder), html(sources.toString()))
        assertEquals(expected, ContentFiles.anki(entries, sources))
    }

    @Test fun `entry merges match the backend`() {
        val cases = fixtures("merge-fixtures.json").getJSONArray("entries")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val incoming = case.getJSONObject("incoming")
            assertEquals(case.getString("name"), case.getBoolean("incomingWins"), SyncData.entryWins(incoming, case.getJSONObject("stored")))
            assertEquals(case.getString("name"), case.getBoolean("deleted"), SyncData.isDeleted(incoming))
        }
    }
}
