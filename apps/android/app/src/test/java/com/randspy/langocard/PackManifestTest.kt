package com.randspy.langocard

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import org.json.JSONArray
import java.io.File

class PackManifestTest {
    @Test fun `bundled catalogue and dictionaries have matching identities and valid entries`() {
        val packs = PackManifest.parse(File("src/main/assets/catalogue.json").readText())
        assertEquals(3, packs.size)
        assertEquals(1116, packs.sumOf { it.meanings })
        val frequent = File("src/main/assets/frequent-pack.json").readText()
        PackManifest.verifyPayload(frequent, packs.first())
        val entries = ContentFiles.readEntries(JSONObject(frequent).getJSONArray("entries"))
        assertEquals(501, entries.size)
        assertTrue(entries.all { it.rank in 1..2500 && it.lemma.isNotBlank() && it.sourceUrl.isNotBlank() })
        val restored = ContentFiles.readEntries(JSONArray().put(ContentFiles.entryJson(entries.first()))).single()
        assertEquals(entries.first(), restored)
    }
    @Test fun `catalogue rejects plain HTTP and modified payload identity`() {
        val text = File("src/main/assets/catalogue.json").readText()
        try { PackManifest.parse(text.replace("https://", "http://")); fail("HTTP accepted") }
        catch (_: IllegalArgumentException) { }
        val pack = PackManifest.parse(text).first()
        val payload = JSONObject(File("src/main/assets/frequent-pack.json").readText()).put("packId", "other").toString()
        try { PackManifest.verifyPayload(payload, pack); fail("Wrong ID accepted") }
        catch (_: IllegalArgumentException) { }
    }
}
