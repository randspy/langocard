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
    var word by remember { mutableStateOf("") }
    var english by remember { mutableStateOf("") }
    var definition by remember { mutableStateOf("") }
    var example by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    fun task(work: suspend () -> String) {
        scope.launch {
            busy = true
            message = try { work() } catch (e: Exception) { e.message ?: "Could not complete this operation" }
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
    if (section == "add") {
        Text("Search the library first in either language. If the meaning is missing, add it here.")
        OutlinedTextField(word, { word = it }, label = { Text("French, including noun article") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(english, { english = it }, label = { Text("English meaning") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(definition, { definition = it }, label = { Text("Simple French definition") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(example, { example = it }, label = { Text("Example: Elle {se rend compte} du problème.") }, modifier = Modifier.fillMaxWidth())
        Button(onClick = { task {
            model.addEntry(word, english, definition, example)
            word = ""; english = ""; definition = ""; example = ""
            "Entry added to your library"
        } }, enabled = !busy) { Text("Save entry") }
    }
    if (section == "packs") {
        Text("Add prepared vocabulary from a file or a direct download link. Imported meanings stay available offline.")
    OutlinedButton(onClick = { pack.launch(arrayOf("application/json", "text/plain")) }, enabled = !busy) { Text("Import vocabulary pack") }
    OutlinedTextField(url, { url = it }, label = { Text("HTTPS vocabulary pack URL") }, modifier = Modifier.fillMaxWidth())
    OutlinedButton(onClick = { task {
        val text = withContext(Dispatchers.IO) {
            val address = java.net.URI(url.trim()).toURL()
            require(address.protocol == "https" && address.userInfo == null) { "Use an HTTPS URL without credentials" }
            val connection = address.openConnection() as javax.net.ssl.HttpsURLConnection
            connection.connectTimeout = 15000; connection.readTimeout = 15000; connection.instanceFollowRedirects = false
            try {
                require(connection.responseCode == 200) { "Download returned HTTP ${connection.responseCode}; use a direct pack URL" }
                connection.inputStream.use {
                    val bytes = it.readNBytes(ContentFiles.MAX_BYTES + 1)
                    require(bytes.size <= ContentFiles.MAX_BYTES) { "Pack exceeds 20 MB" }
                    bytes.toString(Charsets.UTF_8)
                }
            } finally { connection.disconnect() }
        }
        "Downloaded ${model.importPack(text)} meanings; available offline"
    } }, enabled = !busy && url.isNotBlank()) { Text("Download pack") }
    }
    if (section == "backup") {
        Text("Save your vocabulary and learning progress, or restore a previous backup.")
    OutlinedButton(onClick = { backup.launch("langocard-backup.json") }, enabled = !busy) { Text("Save backup") }
    OutlinedButton(onClick = { restore.launch(arrayOf("application/json", "text/plain")) }, enabled = !busy) { Text("Restore backup") }
    }
    if (section == "export") {
        Text("Export reading and production cards for Anki. Review schedules and synthetic audio stay in Langocard.")
    OutlinedButton(onClick = { export.launch("langocard-anki.tsv") }, enabled = !busy) { Text("Export cards to Anki") }
    }
    if (pendingRestore != null) AlertDialog(onDismissRequest = { pendingRestore = null },
        title = { Text("Replace current progress?") }, text = { Text("This restores the library and progress from the selected backup. Save a backup of your current progress first if you need it.") },
        confirmButton = { TextButton(onClick = { val text = pendingRestore!!; pendingRestore = null; task { model.restore(text); "Backup restored" } }) { Text("Restore") } },
        dismissButton = { TextButton(onClick = { pendingRestore = null }) { Text("Cancel") } })
}
