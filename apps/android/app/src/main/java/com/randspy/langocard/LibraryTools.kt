package com.randspy.langocard

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun LibraryTools(model: LearningModel, section: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var pendingRestore by remember { mutableStateOf<String?>(null) }
    var url by remember { mutableStateOf("") }
    fun task(work: suspend () -> String) {
        scope.launch {
            busy = true
            message = try { work() } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { e.message ?: "Could not complete this operation" }
            finally { busy = false }
        }
    }
    suspend fun read(uri: android.net.Uri) = withContext(Dispatchers.IO) {
        context.contentResolver.openInputStream(uri)!!.use { stream ->
            val bytes = stream.readNBytes(ContentFiles.MAX_BYTES + 1)
            require(bytes.size <= ContentFiles.MAX_BYTES) { "File exceeds 20 MB" }; bytes.toString(Charsets.UTF_8)
        }
    }
    val backup = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) task {
            val text = model.backup()
            withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri, "wt")!!.bufferedWriter().use { it.write(text) } }
            "Backup saved"
        }
    }
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/tab-separated-values")) { uri ->
        if (uri != null) task {
            val text = model.ankiExport()
            withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri, "wt")!!.bufferedWriter().use { it.write(text) } }
            "Anki file saved. Import as Basic cards with HTML enabled. Scheduling and synthetic audio are not exported."
        }
    }
    val restore = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) task {
            val text = read(uri)
            model.validateBackup(text)
            pendingRestore = text
            "Backup ready to restore"
        }
    }
    val pack = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) task { "Added ${model.importPack(read(uri))} meanings" }
    }
    if (message.isNotEmpty()) Text(message)
    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    if (section == "add") AddEntry(model)
    if (section == "packs") {
        PackCatalogue(model)
        HorizontalDivider(Modifier.padding(vertical = 12.dp))
        Text("Other packs", style = MaterialTheme.typography.titleMedium)
        Text("Import a prepared file, or use a direct HTTPS link.")
    OutlinedButton(onClick = { pack.launch(arrayOf("application/json", "text/plain")) }, enabled = !busy) { Text("Import vocabulary pack") }
    OutlinedTextField(url, { url = it }, label = { Text("HTTPS vocabulary pack URL") }, modifier = Modifier.fillMaxWidth())
    OutlinedButton(onClick = { task {
        val text = withContext(Dispatchers.IO) { PackDownloads.fetch(url.trim()) }
        "Downloaded ${model.importPack(text)} meanings; available offline"
    } }, enabled = !busy && url.isNotBlank()) { Text("Download pack") }
    }
    if (section == "backup") {
        Text("Save your vocabulary and learning progress, or restore a previous backup.")
    OutlinedButton(onClick = { backup.launch("langocard-backup.json") }, enabled = !busy) { Text("Save backup") }
    OutlinedButton(onClick = { restore.launch(arrayOf("application/json", "text/plain")) }, enabled = !busy) { Text("Restore backup") }
    }
    if (section == "sync") CloudSyncSettings(model)
    if (section == "export") {
        Text("Export reading and production cards for Anki. Review schedules and synthetic audio stay in Langocard.")
    OutlinedButton(onClick = { export.launch("langocard-anki.tsv") }, enabled = !busy) { Text("Export cards to Anki") }
    }
    if (pendingRestore != null) AlertDialog(onDismissRequest = { pendingRestore = null },
        title = { Text("Replace current progress?") }, text = { Text("This restores the library and progress from the selected backup. Save a backup of your current progress first if you need it.") },
        confirmButton = { TextButton(onClick = { val text = pendingRestore!!; pendingRestore = null; task { model.restore(text); "Backup restored" } }) { Text("Restore") } },
        dismissButton = { TextButton(onClick = { pendingRestore = null }) { Text("Cancel") } })
}

@Composable
private fun CloudSyncSettings(model: LearningModel) {
    val context = LocalContext.current
    val configured = model.syncConfigured
    var url by remember { mutableStateOf(SyncConfig.load(context)?.url ?: "") }
    var token by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    Text("Keep your progress in your own Convex deployment and share it between devices. Studying always works offline; changes sync when the app opens and after each session.")
    if (configured) {
        Text("Connected to $url", style = MaterialTheme.typography.bodyMedium)
        val last = SyncConfig.lastSynced(context)
        val lastText = if (last == 0L) "Not synced yet" else "Last synced " + java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT).format(java.util.Date(last))
        Text(lastText, style = MaterialTheme.typography.bodySmall)
        if (model.syncStatus.isNotBlank()) Text(model.syncStatus)
        if (model.syncing) LinearProgressIndicator(Modifier.fillMaxWidth())
        Button(onClick = { model.sync(manual = true) }, enabled = !model.syncing) { Text("Sync now") }
        OutlinedButton(onClick = { SyncConfig.clear(context); model.refreshSyncConfig(); token = "" }, enabled = !model.syncing) { Text("Disconnect this device") }
        Text("Disconnecting keeps your local progress and the cloud copy.", style = MaterialTheme.typography.bodySmall)
    } else {
        if (SyncConfig.builtIn != null) {
            Button(onClick = { SyncConfig.useBuiltIn(context); url = SyncConfig.builtIn.url; model.sync(manual = true) }) {
                Text("Connect with this build's settings")
            }
            Text("Or enter another deployment:", style = MaterialTheme.typography.bodySmall)
        }
        OutlinedTextField(url, { url = it }, label = { Text("Deployment URL (https://….convex.cloud)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(token, { token = it }, label = { Text("Sync token") }, singleLine = true,
            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
        Text("Use the same value you set with: npx convex env set SYNC_TOKEN …", style = MaterialTheme.typography.bodySmall)
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        Button(onClick = {
            error = try { SyncConfig.save(context, url, token); url = SyncConfig.load(context)!!.url; model.sync(manual = true); "" }
            catch (e: IllegalArgumentException) { e.message ?: "Invalid settings" }
        }, enabled = url.isNotBlank() && token.isNotBlank()) { Text("Connect and sync") }
    }
}
