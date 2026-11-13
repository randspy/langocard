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
