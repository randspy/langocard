package com.randspy.langocard

import io.github.openspacedrepetition.Card
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.Scheduler
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class SyncDataTest {
    private val scheduler = Scheduler.builder().desiredRetention(0.9).build()
    private val entry = Entry("personal-sync", "une rencontre", "a meeting", "Moment partagé.", listOf(Example("Elle prépare {une rencontre}.")), "culture")
    private val ids = setOf("base", entry.id)

    private fun reviewed(at: Instant, id: Int = 1): Card = scheduler.reviewCard(Card.builder().cardId(id).build(), Rating.GOOD, at).card()
    private fun device() = JSONObject().put("version", 2).put("cards", JSONObject()).put("reviews", JSONArray())
        .put("extraEntries", JSONArray()).put("buried", JSONObject()).put("failures", JSONObject()).put("paused", JSONObject())

    /** Simulates one device pushing to a server and another pulling the same rows. */
    private fun transfer(from: JSONObject, to: JSONObject, today: String = "2026-11-12") {
        val outbox = SyncData.outbox(from, today)
        // The server marks pushed entries as personal (it refuses any other new entry).
        val entries = outbox.entries.map { JSONObject(it.toString()).put("origin", "personal").put("retired", false) }
        val rows = mapOf("cards" to outbox.cards, "reviews" to outbox.reviews, "entries" to entries,
            "sources" to outbox.sources, "buried" to outbox.buried, "settings" to listOf(outbox.settings))
        SyncData.TABLES.forEach { table ->
            val local = to.getJSONArray("extraEntries").let { a -> (0 until a.length()).map { a.getJSONObject(it).getString("id") } }
            val remote = to.optJSONObject("remoteEntries")?.keys()?.asSequence()?.toList() ?: emptyList()
            SyncData.apply(to, table, rows.getValue(table), setOf("base") + local + remote)
        }
        SyncData.markPushed(from, outbox)
    }

    @Test fun `existing progress is pending on first sync and cleared once pushed`() {
        val data = device()
        data.getJSONObject("cards").put("base:Reading", reviewed(Instant.parse("2026-11-10T10:00:00Z")).toJson())
        val outbox = SyncData.outbox(data, "2026-11-12")
        assertEquals(listOf("base:Reading"), outbox.cards.map { it.getString("key") })
        SyncData.markPushed(data, outbox)
        assertTrue(SyncData.outbox(data, "2026-11-12").cards.isEmpty())
    }

    @Test fun `a review made while pushing stays pending`() {
        val data = device()
        val key = "base:Reading"
        val first = reviewed(Instant.parse("2026-11-10T10:00:00Z"))
        data.getJSONObject("cards").put(key, first.toJson())
        val outbox = SyncData.outbox(data, "2026-11-12")
        val second = scheduler.reviewCard(first, Rating.GOOD, Instant.parse("2026-11-12T09:00:00Z")).card()
        data.getJSONObject("cards").put(key, second.toJson()); SyncData.markCard(data, key, second.lastReview.toEpochMilli())
        SyncData.markPushed(data, outbox)
        assertEquals(second.lastReview.toEpochMilli(), SyncData.outbox(data, "2026-11-12").cards.single().getLong("lastReview"))
    }

    @Test fun `newest review wins and carries its failure state`() {
        val phone = device(); val tablet = device()
        val key = "base:Production"
        phone.getJSONObject("cards").put(key, reviewed(Instant.parse("2026-11-11T08:00:00Z")).toJson())
        phone.getJSONObject("failures").put(key, 3)
        tablet.getJSONObject("cards").put(key, reviewed(Instant.parse("2026-11-12T08:00:00Z")).toJson())
        tablet.getJSONObject("paused").put(key, 123L)
        transfer(tablet, phone)
        assertEquals(Instant.parse("2026-11-12T08:00:00Z"), Card.fromJson(phone.getJSONObject("cards").getString(key)).lastReview)
        assertEquals(0, phone.getJSONObject("failures").getInt(key))
        assertEquals(123L, phone.getJSONObject("paused").getLong(key))
        // The older card doesn't overwrite the newer one in the other direction.
        transfer(phone, tablet)
        assertEquals(Instant.parse("2026-11-12T08:00:00Z"), Card.fromJson(tablet.getJSONObject("cards").getString(key)).lastReview)
    }

    @Test fun `entries, reviews and sources merge without duplicates`() {
        val phone = device(); val tablet = device()
        val card = scheduler.reviewCard(Card.builder().cardId(4).build(), Rating.GOOD, Instant.parse("2026-11-12T08:00:00Z"))
        phone.getJSONArray("extraEntries").put(ContentFiles.entryJson(entry))
        phone.getJSONObject("cards").put("${entry.id}:Reading", card.card().toJson())
        phone.getJSONArray("reviews").put(JSONObject().put("key", "${entry.id}:Reading").put("placement", false).put("log", card.reviewLog().toJson()))
        phone.put("sources", JSONArray().put(JSONObject().put("source", "Wiktionary").put("license", "CC BY-SA").put("packId", "fr-1")))
        transfer(phone, tablet); transfer(phone, tablet)
        assertEquals(listOf(entry.id), tablet.getJSONObject("remoteEntries").keys().asSequence().toList())
        assertTrue(tablet.getJSONArray("extraEntries").length() == 0)
        assertEquals(1, tablet.getJSONArray("reviews").length())
        assertEquals(1, tablet.getJSONArray("sources").length())
        assertTrue(tablet.getJSONObject("cards").has("${entry.id}:Reading"))
        // Pulled rows aren't echoed back once the pointers advance.
        transfer(tablet, device())
        val echo = SyncData.outbox(tablet, "2026-11-12")
        assertTrue(echo.reviews.isEmpty() && echo.entries.isEmpty() && echo.sources.isEmpty())
    }

    private fun cardRow(key: String, card: String?, lastReview: Long, cardEditedAt: Long = 0, suspendedUntil: Long = 0) =
        JSONObject().put("key", key).put("card", card ?: JSONObject.NULL).put("lastReview", lastReview.toDouble())
            .put("failures", 0.0).put("pausedUntil", 0.0).put("suspendedUntil", suspendedUntil.toDouble()).put("cardEditedAt", cardEditedAt.toDouble())

    @Test fun `only personal entries are pushed, in the typed v2 shape`() {
        val data = device()
        data.getJSONArray("extraEntries").put(ContentFiles.entryJson(entry)).put(ContentFiles.entryJson(entry.copy(id = "frw-pack-1")))
        val row = SyncData.outbox(data, "2026-11-12").entries.single()
        assertEquals(entry.id, row.getString("entryId"))
        assertEquals("[\"Elle prépare {une rencontre}.\"]", row.getJSONArray("examples").toString())
        assertTrue(row.isNull("rank") && row.isNull("editedAt") && row.isNull("deletedAt"))
    }

    @Test fun `a reset makes the card new and older local reviews can't revive it`() {
        val data = device()
        val key = "base:Reading"
        val reviewedAt = Instant.parse("2026-11-10T10:00:00Z")
        data.getJSONObject("cards").put(key, reviewed(reviewedAt).toJson())
        val resetAt = reviewedAt.toEpochMilli() + 1000
        val applied = SyncData.apply(data, "cards", listOf(cardRow(key, null, resetAt, cardEditedAt = resetAt)), ids)
        assertEquals(setOf(key), applied.resetCards)
        assertFalse(data.getJSONObject("cards").has(key))
        assertEquals(resetAt, SyncData.localCard(data, key).getLong("lastReview"))
        // The same reset pulled again (cursor overlap) changes nothing.
        assertTrue(SyncData.apply(data, "cards", listOf(cardRow(key, null, resetAt, cardEditedAt = resetAt)), ids).resetCards.isEmpty())
    }

    @Test fun `a web suspension applies without touching review state`() {
        val data = device()
        val key = "base:Listening"
        val card = reviewed(Instant.parse("2026-11-12T08:00:00Z"))
        data.getJSONObject("cards").put(key, card.toJson())
        // The row's review clock is older than the local review, but its suspension is new.
        SyncData.apply(data, "cards", listOf(cardRow(key, "{}", 1, cardEditedAt = 500, suspendedUntil = 253402300799999)), ids)
        assertEquals(card.toJson(), data.getJSONObject("cards").getString(key))
        assertEquals(253402300799999, data.getJSONObject("suspended").getLong(key))
        assertEquals(500, data.getJSONObject("cardEdited").getLong(key))
        // A later resume clears it.
        SyncData.apply(data, "cards", listOf(cardRow(key, "{}", 1, cardEditedAt = 600)), ids)
        assertFalse(data.getJSONObject("suspended").has(key))
    }

    @Test fun `invalid entry rows are skipped`() {
        val data = device()
        val bad = JSONObject(SyncData.entryRow(entry.copy(examples = listOf(Example("no answer")))).toString()).put("origin", "personal")
        assertFalse(SyncData.apply(data, "entries", listOf(bad), ids).library)
        assertFalse(data.has("remoteEntries") && data.getJSONObject("remoteEntries").length() > 0)
    }

    @Test fun `cards for unknown entries are skipped`() {
        val data = device()
        val row = cardRow("missing:Reading", reviewed(Instant.now()).toJson(), 1)
        SyncData.apply(data, "cards", listOf(row), ids)
        assertFalse(data.getJSONObject("cards").has("missing:Reading"))
    }

    @Test fun `settings merge keeps newest preferences and the current day`() {
        val a = SyncData.settings(JSONObject().put("minimumRank", 7001).put("preferencesChangedAt", 50L).put("day", "2026-11-12").put("seconds", 300).put("placementIndex", 4))
        val b = SyncData.settings(JSONObject().put("minimumRank", 1).put("preferencesChangedAt", 10L).put("day", "2026-11-12").put("seconds", 120).put("introduced", 2).put("placementDone", true))
        val merged = SyncData.mergeSettings(a, b)
        assertEquals(7001, merged.getInt("minimumRank"))
        assertEquals(300, merged.getInt("seconds"))
        assertEquals(2, merged.getInt("introduced"))
        assertTrue(merged.getBoolean("placementDone"))
        assertEquals(merged.toString(), SyncData.mergeSettings(b, a).toString())
        val newer = SyncData.settings(JSONObject().put("day", "2026-11-13").put("seconds", 30))
        assertEquals(30, SyncData.mergeSettings(a, newer).getInt("seconds"))
    }

    @Test fun `remote settings with numbers as doubles are applied`() {
        val data = device().put("day", "2026-11-12")
        val row = JSONObject().put("placementDone", true).put("placementIndex", 18.0).put("nextCardId", 40.0).put("minimumRank", 7001.0)
            .put("interests", "news").put("preferencesChangedAt", 99.0).put("day", "2026-11-12").put("seconds", 61.0).put("introduced", 1.0).put("updatedAt", 5.0)
        SyncData.apply(data, "settings", listOf(row), ids)
        assertEquals(7001, data.getInt("minimumRank"))
        assertEquals("news", data.getString("interests"))
        assertEquals(40, data.getInt("nextCardId"))
        assertTrue(data.getBoolean("placementDone"))
    }

    @Test fun `deployment URL must be a bare https origin`() {
        assertEquals("https://happy-cat-123.convex.cloud", SyncConfig.normalize(" https://happy-cat-123.convex.cloud/ "))
        listOf("http://happy-cat-123.convex.cloud", "https://user@x.convex.cloud", "https://x.convex.cloud/api", "not a url").forEach {
            try { SyncConfig.normalize(it); fail("Accepted $it") } catch (_: IllegalArgumentException) { }
        }
    }
}
