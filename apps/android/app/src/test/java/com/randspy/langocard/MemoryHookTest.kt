package com.randspy.langocard

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MemoryHookTest {
    @Test fun backupRetainsHooks() {
        val hook = JSONObject().put("entryId", "e").put("text", "image").put("editedAt", 20)
        val data = JSONObject().put("version", 2).put("cards", JSONObject()).put("hooks", JSONObject().put("e", hook))
        val envelope = JSONObject().put("format", "langocard-backup").put("version", 2).put("data", data)
        val restored = ContentFiles.backupData(envelope.toString(), setOf("e"))
        assertEquals("image", restored.getJSONObject("hooks").getJSONObject("e").getString("text"))
    }
    @Test fun offersOnlyAtStuckThreshold() {
        assertFalse(StuckWords.needsHook(3))
        assertTrue(StuckWords.needsHook(4))
    }
    @Test fun syncKeepsNewerLocalHookAndPropagatesClearing() {
        val data = JSONObject()
        fun hook(text: String, clock: Long) = JSONObject().put("entryId", "e").put("text", text).put("editedAt", clock)
        SyncData.apply(data, "hooks", listOf(hook("my image", 20)), setOf("e"))
        SyncData.apply(data, "hooks", listOf(hook("old", 10)), setOf("e"))
        assertEquals("my image", data.getJSONObject("hooks").getJSONObject("e").getString("text"))
        assertEquals("my image", SyncData.outbox(data, "2026-11-15").hooks.single().getString("text"))
        SyncData.apply(data, "hooks", listOf(hook("", 30)), setOf("e"))
        assertEquals("", data.getJSONObject("hooks").getJSONObject("e").getString("text"))
    }
}
