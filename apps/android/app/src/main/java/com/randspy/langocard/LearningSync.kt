package com.randspy.langocard

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.Instant

/**
 * Pushes and merges cloud progress within the ViewModel's lifetime. Every response is checked
 * against the current learner's restore generation before it can acknowledge or merge data.
 */
class LearningSync(
    private val application: Application,
    private val scope: CoroutineScope,
    private val library: LearningLibrary,
    private val reviewing: () -> Boolean,
    private val onMerged: () -> Unit,
) {
    private val learner get() = library.learner
    private fun today() = StudyPolicy.date(Instant.now())
    var syncStatus by mutableStateOf(""); private set
    var syncing by mutableStateOf(false); private set
    /** Whether a sync target is set; refresh with [refreshSyncConfig] after changing it. */
    var syncConfigured by mutableStateOf(SyncConfig.load(application) != null); private set
    var syncFailed by mutableStateOf(false); private set
    fun refreshSyncConfig() { syncConfigured = SyncConfig.load(application) != null; if (!syncConfigured) syncFailed = false }

    /** Pushes local changes and merges other devices' changes; a no-op until sync is set up. */
    fun sync(manual: Boolean = false) {
        refreshSyncConfig()
        val config = SyncConfig.load(application) ?: run { if (manual) syncStatus = "Set up sync first"; return }
        if (syncing || (reviewing() && !manual)) return
        syncing = true; syncStatus = "Syncing…"
        scope.launch {
            syncStatus = try {
                runSync(ConvexHttp(config))
                SyncConfig.markSynced(application, System.currentTimeMillis())
                syncFailed = false
                "Synced"
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { syncFailed = true; "Sync failed: ${e.message ?: e.javaClass.simpleName}" }
            finally { syncing = false }
        }
    }

    internal suspend fun runSync(client: SyncClient) {
        val generation = SyncData.generation(learner.document)
        fun current() = SyncData.generation(learner.document) == generation
        learner.rollover(today())
        val outbox = SyncData.outbox(learner.document, today())
        for (args in outbox.batches()) {
            withContext(Dispatchers.IO) { client.mutation("sync:push", args) }
            if (!current()) return
        }
        SyncData.markPushed(learner.document, outbox); library.save()
        for (table in SyncData.TABLES) {
            val since = SyncData.cursor(learner.document, table)
            var cursor: String? = null
            var serverTime: Long? = null
            do {
                val args = JSONObject().put("table", table).put("since", since).put("cursor", cursor ?: JSONObject.NULL)
                val result = withContext(Dispatchers.IO) { client.query("sync:pull", args) }
                if (!current()) return // a restore replaced the data mid-sync; the next sync starts over
                if (serverTime == null) serverTime = result.getDouble("serverTime").toLong()
                val page = result.getJSONArray("page")
                val rows = (0 until page.length()).map(page::getJSONObject)
                if (rows.isNotEmpty()) {
                    library.applyRemote(table, rows)
                    onMerged()
                }
                cursor = result.getString("continueCursor")
            } while (!result.getBoolean("isDone"))
            SyncData.setCursor(learner.document, table, serverTime!!)
            library.save()
        }
    }

}
