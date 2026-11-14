package com.randspy.langocard

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class StudyLibraryTest {
    private val base = Entry("b1", "pourtant", "however", "Malgré cela.", listOf(Example("Il pleut, {pourtant} elle sort.")), "daily")
    private fun row(id: String, origin: String, word: String = "mot", editedAt: Long? = null, deletedAt: Long? = null, retired: Boolean = false) =
        JSONObject(SyncData.entryRow(base.copy(id = id, word = word)).toString())
            .put("origin", origin).put("retired", retired)
            .put("editedAt", editedAt ?: JSONObject.NULL).put("deletedAt", deletedAt ?: JSONObject.NULL)
    private fun active(vararg rows: JSONObject, installed: Set<String> = emptySet()) =
        StudyLibrary.active(listOf(base), emptyList(), JSONObject().also { r -> rows.forEach { r.put(it.getString("entryId"), it) } }) { it in installed }

    @Test fun `a synced row overrides the bundled copy`() {
        assertEquals("néanmoins", active(row("b1", "bundled", word = "néanmoins", editedAt = 5)).entries.single().word)
    }

    @Test fun `deleted entries leave the library and come back when restored`() {
        assertTrue(active(row("b1", "bundled", editedAt = 5, deletedAt = 6)).entries.isEmpty())
        assertEquals(1, active(row("b1", "bundled", editedAt = 7, deletedAt = 6)).entries.size)
    }

    @Test fun `pack entries stay dormant until the pack is installed`() {
        val packRow = row("p1", "pack:fr-extra")
        assertEquals(listOf("b1"), active(packRow).entries.map { it.id })
        assertEquals(listOf("b1", "p1"), active(packRow, installed = setOf("fr-extra")).entries.map { it.id })
    }

    @Test fun `personal entries from other devices join the library`() {
        assertEquals(listOf("b1", "personal-2"), active(row("personal-2", "personal")).entries.map { it.id })
    }

    @Test fun `retired entries stay but are marked`() {
        val result = active(row("b1", "bundled", retired = true))
        assertEquals(1, result.entries.size)
        assertEquals(setOf("b1"), result.retired)
    }
}
