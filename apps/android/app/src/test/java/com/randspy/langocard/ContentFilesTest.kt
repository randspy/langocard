package com.randspy.langocard

import io.github.openspacedrepetition.Card
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ContentFilesTest {
    private val entry = Entry("personal-test", "une rencontre", "a meeting", "Moment partagé.", listOf(Example("Elle prépare {une rencontre}.")), "culture")
    private val twoExamples = entry.copy(examples = entry.examples + Example("Nous fêtons {la rencontre} ce soir."))
    @Test fun `custom meanings round trip with exact cloze and stable identity`() {
        val restored = ContentFiles.readEntries(JSONArray().put(ContentFiles.entryJson(entry))).single()
        assertEquals(entry, restored)
        assertEquals("Elle prépare ________.", restored.examples.single().cloze)
        assertEquals(twoExamples, ContentFiles.readEntries(JSONArray().put(ContentFiles.entryJson(twoExamples))).single())
    }
    @Test fun `duplicate identities and broken examples reject the whole import`() {
        fun rejected(action: () -> Unit) {
            try { action(); fail("Expected rejection") } catch (_: IllegalArgumentException) { }
        }
        rejected { ContentFiles.readEntries(JSONArray().put(ContentFiles.entryJson(entry)).put(ContentFiles.entryJson(entry))) }
        rejected { ContentFiles.validateEntry(entry.copy(examples = listOf(Example("No answer")))) }
        rejected { ContentFiles.validateEntry(entry.copy(examples = listOf(Example("{two} {answers}")))) }
        rejected { ContentFiles.validateEntry(entry.copy(examples = listOf(Example("}bad{")))) }
        rejected { ContentFiles.validateEntry(entry.copy(examples = emptyList())) }
        rejected { ContentFiles.validateEntry(entry.copy(examples = entry.examples + Example("Elle prépare {une rencontre}. "))) }
        rejected { ContentFiles.validateEntry(entry.copy(examples = (1..6).map { Example("Phrase $it avec {une rencontre}.") })) }
    }
    @Test fun `backup retains memory and personal entries and rejects dangling cards`() {
        val card = Card.builder().cardId(33).build()
        val data = JSONObject().put("version", 2).put("cards", JSONObject().put("personal-test:Reading", card.toJson()))
            .put("extraEntries", JSONArray().put(ContentFiles.entryJson(entry)))
        val backup = JSONObject().put("format", "langocard-backup").put("version", 2).put("data", data)
        val restored = ContentFiles.backupData(backup.toString(), setOf("base"))
        try { ContentFiles.backupData(JSONObject(backup.toString()).put("version", 1).toString(), setOf("base")); fail("Accepted a v1 backup") }
        catch (_: IllegalArgumentException) { }
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
    @Test fun `Anki fronts use the introductory example and backs list every example`() {
        val lines = ContentFiles.anki(listOf(twoExamples), JSONArray()).lines()
        val production = lines.single { it.endsWith("production") }.split('\t')
        assertEquals("a meeting<br>Elle prépare ________.", production[0])
        assertTrue(production[1].contains("Elle prépare une rencontre.<br>Nous fêtons la rencontre ce soir."))
        assertFalse(lines.single { it.endsWith("reading") }.split('\t')[0].contains("Nous fêtons"))
    }
}
