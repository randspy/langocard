package com.randspy.langocard

import android.content.Context
import io.github.openspacedrepetition.Card
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import javax.net.ssl.HttpsURLConnection

/**
 * Optional cloud sync with the Convex backend in `apps/backend`.
 *
 * Sync protocol v2. Local `learning-v2.json` is what the app studies from; studying never
 * waits for the network. Sync pushes local changes, then pulls rows the server merged.
 * The merge rules mirror `apps/backend/convex/merge.ts` (shared cases in
 * `content/merge-fixtures.json`): card review fields follow the newest review and the
 * manual suspension follows the newest card edit; entries are the whole library, kept
 * in `remoteEntries` and overriding local copies (see [StudyLibrary]); reviews and sources
 * are unions; buried siblings keep the latest day; settings use [SyncData.mergeSettings].
 * Every rule is idempotent, so a failed sync is simply retried.
 */
object SyncData {
    val TABLES = listOf("entries", "sources", "cards", "reviews", "buried", "settings")
    const val BATCH = 500
    /** Pulls overlap by a minute so writes committed while a pull ran aren't skipped. */
    const val CURSOR_OVERLAP_MS = 60_000L

    /** Bookkeeping kept in the learning file so it's written atomically with the data it tracks. */
    fun state(data: JSONObject): JSONObject = data.optJSONObject("sync") ?: reset(data)

    /** Marks everything local as unsent and pulls everything again (first sync, after restore). */
    fun reset(data: JSONObject): JSONObject {
        val pending = JSONObject()
        val cards = data.optJSONObject("cards") ?: JSONObject()
        cards.keys().forEach { pending.put(it, lastReview(cards.getString(it))) }
        val generation = data.optJSONObject("sync")?.optInt("generation") ?: 0
        return JSONObject().put("pending", pending).put("reviews", 0).put("entries", 0).put("sources", 0)
            .put("cursors", JSONObject()).put("generation", generation + 1).also { data.put("sync", it) }
    }

    fun markCard(data: JSONObject, key: String, lastReview: Long) {
        state(data).getJSONObject("pending").put(key, lastReview)
    }

    fun lastReview(cardJson: String): Long = Card.fromJson(cardJson).lastReview?.toEpochMilli() ?: 0L

    /** Convex sends numbers as doubles and missing values as null. */
    private fun JSONObject.longOrNull(key: String): Long? = if (isNull(key)) null else getDouble(key).toLong()

    // ---- Entries ----

    fun entryVersion(row: JSONObject): Long = maxOf(row.longOrNull("editedAt") ?: 0L, row.longOrNull("deletedAt") ?: 0L)
    fun entryWins(incoming: JSONObject, stored: JSONObject): Boolean = entryVersion(incoming) > entryVersion(stored)
    fun isDeleted(row: JSONObject): Boolean {
        val deletedAt = row.longOrNull("deletedAt") ?: return false
        return deletedAt >= (row.longOrNull("editedAt") ?: 0L)
    }

    /** The entry a synced row describes, or null if it breaks the entry rules. */
    fun rowEntry(row: JSONObject): Entry? = runCatching {
        val rank = row.longOrNull("rank")?.toInt() ?: Int.MAX_VALUE
        Entry(row.getString("entryId"), row.getString("word"), row.getString("english"), row.getString("definition"),
            ContentFiles.readExamples(row), row.getString("topic"), row.optString("lemma"), rank,
            row.optString("sourceUrl"), row.optString("license"), Gender.read(row, row.getString("word"))).also(ContentFiles::validateEntry)
    }.getOrNull()

    /** A local entry as a v2 push row; devices never edit, so both clocks are null. */
    fun entryRow(e: Entry): JSONObject = JSONObject().put("entryId", e.id).put("word", e.word).put("english", e.english)
        .put("definition", e.definition).put("examples", ContentFiles.examplesJson(e)).put("topic", e.topic).put("lemma", e.lemma)
        .put("rank", if (e.rank == Int.MAX_VALUE) JSONObject.NULL else e.rank)
        .put("sourceUrl", e.sourceUrl).put("license", e.license).put("gender", Gender.json(e.gender))
        .put("editedAt", JSONObject.NULL).put("deletedAt", JSONObject.NULL)

    // ---- Cards ----

    /** Mirrors `mergeCard` in merge.ts: review fields follow `lastReview`, manual fields `cardEditedAt`; ties keep stored. */
    fun mergeCard(stored: JSONObject, incoming: JSONObject): JSONObject {
        val review = if (incoming.getDouble("lastReview") > stored.getDouble("lastReview")) incoming else stored
        val manual = if (incoming.getDouble("cardEditedAt") > stored.getDouble("cardEditedAt")) incoming else stored
        return JSONObject().put("card", review.opt("card") ?: JSONObject.NULL)
            .put("lastReview", review.getDouble("lastReview").toLong()).put("failures", review.getDouble("failures").toInt())
            .put("pausedUntil", review.getDouble("pausedUntil").toLong())
            .put("suspendedUntil", manual.getDouble("suspendedUntil").toLong()).put("cardEditedAt", manual.getDouble("cardEditedAt").toLong())
    }

    /** This device's view of one card in the v2 row shape. A reset or unstudied card has `card: null`. */
    fun localCard(data: JSONObject, key: String): JSONObject {
        val cards = data.optJSONObject("cards") ?: JSONObject()
        val card = cards.optString(key).takeIf { cards.has(key) }
        return JSONObject().put("card", card ?: JSONObject.NULL)
            .put("lastReview", maxOf(card?.let(::lastReview) ?: 0L, data.optJSONObject("resets")?.optLong(key) ?: 0L))
            .put("failures", data.optJSONObject("failures")?.optInt(key) ?: 0)
            .put("pausedUntil", data.optJSONObject("paused")?.optLong(key) ?: 0L)
            .put("suspendedUntil", data.optJSONObject("suspended")?.optLong(key) ?: 0L)
            .put("cardEditedAt", data.optJSONObject("cardEdited")?.optLong(key) ?: 0L)
    }
    fun sourceId(source: JSONObject): String =
        source.optString("packId").ifBlank { "${source.optString("source")}|${source.optString("license")}" }
    fun reviewId(review: JSONObject): String =
        review.getString("key") + "@" + JSONObject(review.get("log").toString()).getString("review_datetime")

    fun settings(data: JSONObject): JSONObject = JSONObject()
        .put("placementDone", data.optBoolean("placementDone"))
        .put("placementIndex", data.optInt("placementIndex"))
        .put("nextCardId", data.optInt("nextCardId"))
        .put("minimumRank", data.optInt("minimumRank", 2501))
        .put("interests", data.optString("interests", "daily,culture,news"))
        .put("preferencesChangedAt", data.optLong("preferencesChangedAt"))
        .put("day", data.optString("day"))
        .put("seconds", data.optInt("seconds"))
        .put("introduced", data.optInt("introduced"))

    fun mergeSettings(a: JSONObject, b: JSONObject): JSONObject {
        val preferences = if (b.getLong("preferencesChangedAt") > a.getLong("preferencesChangedAt")) b else a
        val dayA = a.getString("day"); val dayB = b.getString("day")
        val daily = when {
            dayA == dayB -> JSONObject().put("day", dayA)
                .put("seconds", maxOf(a.getInt("seconds"), b.getInt("seconds")))
                .put("introduced", maxOf(a.getInt("introduced"), b.getInt("introduced")))
            dayA > dayB -> a
            else -> b
        }
        return JSONObject()
            .put("placementDone", a.getBoolean("placementDone") || b.getBoolean("placementDone"))
            .put("placementIndex", maxOf(a.getInt("placementIndex"), b.getInt("placementIndex")))
            .put("nextCardId", maxOf(a.getInt("nextCardId"), b.getInt("nextCardId")))
            .put("minimumRank", preferences.getInt("minimumRank"))
            .put("interests", preferences.getString("interests"))
            .put("preferencesChangedAt", preferences.getLong("preferencesChangedAt"))
            .put("day", daily.getString("day")).put("seconds", daily.getInt("seconds")).put("introduced", daily.getInt("introduced"))
    }

    class Outbox(val generation: Int, val cards: List<JSONObject>, val reviews: List<JSONObject>,
                 val entries: List<JSONObject>, val sources: List<JSONObject>, val buried: List<JSONObject>,
                 val settings: JSONObject, val reviewCount: Int, val entryCount: Int, val sourceCount: Int) {
        /** Push arguments in batches the backend accepts; settings travel with the first. */
        fun batches(): List<JSONObject> {
            val kinds = listOf("cards" to cards, "reviews" to reviews, "entries" to entries, "sources" to sources, "buried" to buried)
            val count = maxOf(1, kinds.maxOf { (it.second.size + BATCH - 1) / BATCH })
            return (0 until count).map { i ->
                JSONObject().also { args ->
                    kinds.forEach { (name, items) -> args.put(name, JSONArray(items.drop(i * BATCH).take(BATCH))) }
                    if (i == 0) args.put("settings", settings)
                }
            }
        }
    }

    fun outbox(data: JSONObject, today: String): Outbox {
        val sync = state(data)
        val pending = sync.getJSONObject("pending")
        val cards = data.optJSONObject("cards") ?: JSONObject()
        val failures = data.optJSONObject("failures") ?: JSONObject()
        val paused = data.optJSONObject("paused") ?: JSONObject()
        val logs = data.optJSONArray("reviews") ?: JSONArray()
        val extra = data.optJSONArray("extraEntries") ?: JSONArray()
        val sources = data.optJSONArray("sources") ?: JSONArray()
        val buried = data.optJSONObject("buried") ?: JSONObject()
        fun <T> range(array: JSONArray, from: String, map: (JSONObject) -> T) =
            (sync.optInt(from).coerceAtMost(array.length()) until array.length()).map { map(array.getJSONObject(it)) }
        return Outbox(
            generation = sync.getInt("generation"),
            cards = pending.keys().asSequence().filter(cards::has).map { key ->
                JSONObject().put("key", key).put("card", cards.getString(key)).put("lastReview", pending.getLong(key))
                    .put("failures", failures.optInt(key)).put("pausedUntil", paused.optLong(key))
                    .put("suspendedUntil", data.optJSONObject("suspended")?.optLong(key) ?: 0L)
                    .put("cardEditedAt", data.optJSONObject("cardEdited")?.optLong(key) ?: 0L)
            }.toList(),
            reviews = range(logs, "reviews") { review ->
                JSONObject().put("reviewId", reviewId(review)).put("key", review.getString("key"))
                    .put("placement", review.optBoolean("placement")).put("log", review.get("log").toString())
            },
            // Only personal entries are pushed; bundled and pack entries come from the server's seed.
            entries = range(extra, "entries") { it }.filter { it.getString("id").startsWith("personal-") }
                .mapNotNull { runCatching { entryRow(ContentFiles.readEntries(org.json.JSONArray().put(it)).single()) }.getOrNull() },
            sources = range(sources, "sources") { JSONObject().put("sourceId", sourceId(it)).put("source", it.toString()) },
            buried = buried.keys().asSequence().filter { buried.optString(it) >= today }
                .map { JSONObject().put("key", it).put("day", buried.getString(it)) }.toList(),
            settings = settings(data),
            reviewCount = logs.length(), entryCount = extra.length(), sourceCount = sources.length(),
        )
    }

    /** Clears what was sent, keeping anything that changed while the push was in flight. */
    fun markPushed(data: JSONObject, outbox: Outbox) {
        val sync = state(data)
        if (sync.getInt("generation") != outbox.generation) return
        val pending = sync.getJSONObject("pending")
        outbox.cards.forEach { card ->
            if (pending.optLong(card.getString("key"), -1) == card.getLong("lastReview")) pending.remove(card.getString("key"))
        }
        sync.put("reviews", maxOf(sync.optInt("reviews"), outbox.reviewCount))
            .put("entries", maxOf(sync.optInt("entries"), outbox.entryCount))
            .put("sources", maxOf(sync.optInt("sources"), outbox.sourceCount))
    }

    fun cursor(data: JSONObject, table: String): Long = state(data).getJSONObject("cursors").optLong(table)
    fun setCursor(data: JSONObject, table: String, serverTime: Long) {
        state(data).getJSONObject("cursors").put(table, maxOf(0L, serverTime - CURSOR_OVERLAP_MS))
    }

    /** What a pulled page changed: whether the library must be rebuilt, and cards set or reset. */
    class Applied(val library: Boolean = false, val cards: Map<String, Card> = emptyMap(), val resetCards: Set<String> = emptySet())

    /** Merges one page of remote rows into [data]. Invalid rows are skipped, not fatal. */
    fun apply(data: JSONObject, table: String, rows: List<JSONObject>, entryIds: Set<String>): Applied {
        when (table) {
            "entries" -> {
                // The server already merged these rows, so they replace what this device holds.
                val remote = data.optJSONObject("remoteEntries") ?: JSONObject().also { data.put("remoteEntries", it) }
                var changed = false
                rows.forEach { row ->
                    if (rowEntry(row) == null) return@forEach
                    val stored = JSONObject()
                    listOf("entryId", "word", "english", "definition", "examples", "topic", "lemma", "rank", "sourceUrl",
                        "license", "editedAt", "deletedAt", "origin", "retired").forEach { stored.put(it, row.opt(it) ?: JSONObject.NULL) }
                    // A row without gender predates it; leaving the key out keeps the article gender.
                    if (row.has("gender")) stored.put("gender", row.get("gender"))
                    remote.put(row.getString("entryId"), stored); changed = true
                }
                return Applied(library = changed)
            }
            "sources" -> {
                val sources = data.optJSONArray("sources") ?: JSONArray().also { data.put("sources", it) }
                val known = (0 until sources.length()).map { sourceId(sources.getJSONObject(it)) }.toMutableSet()
                rows.forEach { row ->
                    val source = runCatching { JSONObject(row.getString("source")) }.getOrNull() ?: return@forEach
                    if (source.optString("source").isNotBlank() && known.add(sourceId(source))) sources.put(source)
                }
                // A pack installed on another device becomes active here too.
                return Applied(library = true)
            }
            "cards" -> {
                val cards = data.optJSONObject("cards") ?: JSONObject().also { data.put("cards", it) }
                fun map(name: String) = data.optJSONObject(name) ?: JSONObject().also { data.put(name, it) }
                val pending = state(data).getJSONObject("pending")
                val changed = mutableMapOf<String, Card>()
                val reset = mutableSetOf<String>()
                rows.forEach { row ->
                    val key = row.getString("key")
                    if (key.substringBefore(':') !in entryIds || key.substringAfter(':') !in Skill.entries.map { it.name }) return@forEach
                    val remoteCard = if (row.isNull("card")) null
                        else runCatching { ContentFiles.validateCard(key, row.getString("card"), entryIds) }.getOrNull() ?: return@forEach
                    val local = localCard(data, key)
                    if (row.getDouble("lastReview") > local.getDouble("lastReview")) {
                        if (remoteCard == null) {
                            // A reset: the card is new again. Remember when, so older local reviews can't revive it.
                            cards.remove(key); map("resets").put(key, row.getDouble("lastReview").toLong()); reset.add(key)
                        } else { cards.put(key, row.getString("card")); map("resets").remove(key); changed[key] = remoteCard }
                        map("failures").put(key, row.getDouble("failures").toInt())
                        val pausedUntil = row.getDouble("pausedUntil").toLong()
                        if (pausedUntil > 0) map("paused").put(key, pausedUntil) else map("paused").remove(key)
                        pending.remove(key)
                    }
                    if (row.getDouble("cardEditedAt") > local.getDouble("cardEditedAt")) {
                        val until = row.getDouble("suspendedUntil").toLong()
                        if (until > 0) map("suspended").put(key, until) else map("suspended").remove(key)
                        map("cardEdited").put(key, row.getDouble("cardEditedAt").toLong())
                    }
                }
                return Applied(cards = changed, resetCards = reset)
            }
            "reviews" -> {
                val logs = data.optJSONArray("reviews") ?: JSONArray().also { data.put("reviews", it) }
                val known = (0 until logs.length()).mapNotNull { runCatching { reviewId(logs.getJSONObject(it)) }.getOrNull() }.toMutableSet()
                rows.forEach { row ->
                    if (known.add(row.getString("reviewId"))) logs.put(JSONObject().put("key", row.getString("key"))
                        .put("placement", row.optBoolean("placement")).put("log", row.getString("log")))
                }
            }
            "buried" -> {
                val buried = data.optJSONObject("buried") ?: JSONObject().also { data.put("buried", it) }
                rows.forEach { row ->
                    val day = row.getString("day")
                    if (day > buried.optString(row.getString("key"))) buried.put(row.getString("key"), day)
                }
            }
            "settings" -> rows.forEach { row ->
                // Convex returns every number as a double; convert explicitly.
                val remote = runCatching {
                    JSONObject().put("placementDone", row.getBoolean("placementDone"))
                        .put("placementIndex", row.getDouble("placementIndex").toInt())
                        .put("nextCardId", row.getDouble("nextCardId").toInt())
                        .put("minimumRank", row.getDouble("minimumRank").toInt())
                        .put("interests", row.getString("interests"))
                        .put("preferencesChangedAt", row.getDouble("preferencesChangedAt").toLong())
                        .put("day", row.getString("day"))
                        .put("seconds", row.getDouble("seconds").toInt())
                        .put("introduced", row.getDouble("introduced").toInt())
                        .also { s ->
                            require(s.getInt("minimumRank") in listOf(1, 2501, 7001) && s.getInt("placementIndex") in 0..18)
                            require(s.getString("interests").split(',').all { it in setOf("daily", "culture", "news") })
                            require(s.getInt("seconds") >= 0 && s.getInt("introduced") >= 0)
                        }
                }.getOrNull() ?: return@forEach
                val merged = mergeSettings(settings(data), remote)
                merged.keys().forEach { data.put(it, merged.get(it)) }
            }
            else -> error("Unknown sync table $table")
        }
        return Applied()
    }
}

/**
 * Deployment address and secret. Settings entered in the app (private preferences, never
 * in backups) take priority; otherwise the values compiled in from local.properties are
 * used, so a personal build syncs without any typing.
 */
data class SyncConfig(val url: String, val token: String) {
    companion object {
        private const val PREFS = "cloud-sync"
        /** Compiled-in settings, or null if the build has none or they are invalid. */
        val builtIn: SyncConfig? = runCatching { validated(BuildConfig.SYNC_URL, BuildConfig.SYNC_TOKEN) }.getOrNull()
        fun load(context: Context): SyncConfig? {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val url = prefs.getString("url", null)
            val token = prefs.getString("token", null)
            if (url != null && token != null) return SyncConfig(url, token)
            return builtIn.takeUnless { prefs.getBoolean("disconnected", false) }
        }
        fun validated(url: String, token: String): SyncConfig {
            val config = SyncConfig(normalize(url), token.trim())
            require(config.token.length >= 16) { "Use a sync token of at least 16 characters" }
            return config
        }
        fun save(context: Context, url: String, token: String) {
            val config = validated(url, token)
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("disconnected")
                .putString("url", config.url).putString("token", config.token).apply()
        }
        /** Returns to the compiled-in settings after a disconnect. */
        fun useBuiltIn(context: Context) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .remove("url").remove("token").remove("disconnected").apply()
        }
        fun clear(context: Context) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .remove("url").remove("token").putBoolean("disconnected", true).apply()
        }
        fun lastSynced(context: Context): Long = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("lastSynced", 0)
        fun markSynced(context: Context, at: Long) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong("lastSynced", at).apply()
        }
        fun normalize(url: String): String {
            val uri = runCatching { URI(url.trim().trimEnd('/')) }.getOrElse { throw IllegalArgumentException("Invalid deployment URL") }
            require(uri.scheme == "https" && uri.host != null && uri.userInfo == null && uri.query == null && uri.rawPath.isNullOrEmpty()) {
                "Use the deployment URL, like https://example-123.convex.cloud"
            }
            return uri.toString()
        }
    }
}

/** Calls public Convex functions over the HTTP API (`/api/query`, `/api/mutation`). */
class ConvexHttp(private val config: SyncConfig) {
    fun query(path: String, args: JSONObject) = call("query", path, args)
    fun mutation(path: String, args: JSONObject) = call("mutation", path, args)

    private fun call(kind: String, path: String, args: JSONObject): JSONObject {
        val body = JSONObject().put("path", path).put("args", JSONObject(args.toString()).put("token", config.token)).put("format", "json")
        val connection = URI("${config.url}/api/$kind").toURL().openConnection() as HttpsURLConnection
        connection.connectTimeout = 15000; connection.readTimeout = 30000; connection.instanceFollowRedirects = false
        connection.requestMethod = "POST"; connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        try {
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { it.readNBytes(ContentFiles.MAX_BYTES + 1) } ?: ByteArray(0)
            require(bytes.size <= ContentFiles.MAX_BYTES) { "Sync response exceeds 20 MB" }
            val response = runCatching { JSONObject(bytes.toString(Charsets.UTF_8)) }.getOrNull()
                ?: error("Sync server returned HTTP $code")
            if (response.optString("status") != "success") {
                error(response.opt("errorData")?.toString()?.takeIf { it.isNotBlank() && it != "null" }
                    ?: "Sync failed (HTTP $code)")
            }
            return response.getJSONObject("value")
        } finally { connection.disconnect() }
    }
}
