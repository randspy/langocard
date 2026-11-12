package com.randspy.langocard

import io.github.openspacedrepetition.Card
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ContentFilesTest {
    private val entry = Entry("personal-test", "une rencontre", "a meeting", "Moment partagé.", "Elle prépare {une rencontre}.", "culture")
    @Test fun `custom meanings round trip with exact cloze and stable identity`() {
        val restored = ContentFiles.readEntries(JSONArray().put(ContentFiles.entryJson(entry))).single()
        assertEquals(entry, restored)
        assertEquals("Elle prépare ________.", restored.cloze)
    }
    @Test fun `duplicate identities and broken examples reject the whole import`() {
        fun rejected(action: () -> Unit) {
            try { action(); fail("Expected rejection") } catch (_: IllegalArgumentException) { }
        }
        rejected { ContentFiles.readEntries(JSONArray().put(ContentFiles.entryJson(entry)).put(ContentFiles.entryJson(entry))) }
        rejected { ContentFiles.validateEntry(entry.copy(markedExample = "No answer")) }
        rejected { ContentFiles.validateEntry(entry.copy(markedExample = "{two} {answers}")) }
        rejected { ContentFiles.validateEntry(entry.copy(markedExample = "}bad{")) }
    }
    @Test fun `backup retains memory and personal entries and rejects dangling cards`() {
        val card = Card.builder().cardId(33).build()
        val data = JSONObject().put("version", 1).put("cards", JSONObject().put("personal-test:Reading", card.toJson()))
            .put("extraEntries", JSONArray().put(ContentFiles.entryJson(entry)))
        val backup = JSONObject().put("format", "langocard-backup").put("version", 1).put("data", data)
        val restored = ContentFiles.backupData(backup.toString(), setOf("base"))
        assertEquals(card, Card.fromJson(restored.getJSONObject("cards").getString("personal-test:Reading")))
        data.getJSONObject("cards").put("unknown:Reading", card.toJson())
        try { ContentFiles.backupData(backup.toString(), setOf("base")); fail("Accepted orphan") }
        catch (_: IllegalArgumentException) { }
    }
    @Test fun `Anki export escapes markup and preserves source credits`() {
        val result = ContentFiles.anki(listOf(entry.copy(english = "<script>\t\n\"quote\"")), JSONArray().put("Source author CC BY"))
        assertTrue(result.contains("&lt;script&gt;"))
        assertTrue(result.contains("&quot;quote&quot;"))
        assertFalse(result.contains("<script>"))
        assertTrue(result.contains("Source author CC BY"))
        assertEquals(2, result.lines().count { it.endsWith("reading") || it.endsWith("production") })
    }
}
