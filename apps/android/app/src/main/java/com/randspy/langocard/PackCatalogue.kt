package com.randspy.langocard

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URI
import java.security.MessageDigest
import javax.net.ssl.HttpsURLConnection

/** One bounded HTTPS transport for catalogue and pack data, with optional pinned digest. */
object PackDownloads {
    const val CATALOGUE_URL = "https://raw.githubusercontent.com/randspy/langocard/content-v2/content/catalogue.json"
    fun fetch(url: String, sha256: String? = null): String {
        val address = URI(url).toURL()
        require(address.protocol == "https" && address.userInfo == null) { "Use an HTTPS URL without credentials" }
        val connection = address.openConnection() as HttpsURLConnection
        connection.connectTimeout = 15000; connection.readTimeout = 30000; connection.instanceFollowRedirects = false
        try {
            require(connection.responseCode == 200) { "Download returned HTTP ${connection.responseCode}" }
            val bytes = connection.inputStream.use { it.readNBytes(ContentFiles.MAX_BYTES + 1) }
            require(bytes.size <= ContentFiles.MAX_BYTES) { "Download exceeds 20 MB" }
            if (sha256 != null) {
                val actual = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
                require(actual == sha256) { "Pack integrity check failed; nothing was installed" }
            }
            return bytes.toString(Charsets.UTF_8)
        } finally { connection.disconnect() }
    }
}

data class AvailablePack(val id: String, val title: String, val description: String,
                         val meanings: Int, val lemmas: Int, val url: String, val sha256: String)
object PackManifest {
    fun parse(text: String): List<AvailablePack> {
        val data = JSONObject(text)
        require(data.getString("format") == "langocard-catalogue" && data.getInt("version") == 1) { "Unsupported catalogue" }
        val packs = data.getJSONArray("packs")
        require(packs.length() <= 200)
        return (0 until packs.length()).map { i ->
            val p = packs.getJSONObject(i)
            AvailablePack(p.getString("id"), p.getString("title"), p.getString("description"),
                p.getInt("meanings"), p.getInt("lemmas"), p.getString("url"), p.getString("sha256")).also {
                require(it.id.matches(Regex("[a-z0-9-]{1,100}")) && it.sha256.matches(Regex("[a-f0-9]{64}")))
                require(it.title.length in 1..100 && it.description.length <= 1000)
                require(it.meanings in 1..30000 && it.lemmas in 1..it.meanings)
                val uri = URI(it.url)
                require(uri.scheme == "https" && uri.host != null && uri.userInfo == null)
            }
        }.also { require(it.map { p -> p.id }.distinct().size == it.size) { "Duplicate catalogue IDs" } }
    }
    fun verifyPayload(text: String, expected: AvailablePack) {
        val pack = JSONObject(text)
        require(pack.getString("packId") == expected.id) { "Unexpected pack identity" }
        require(pack.getJSONArray("entries").length() == expected.meanings) { "Unexpected entry count" }
    }
}

@Composable
fun PackCatalogue(model: LearningModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var packs by remember { mutableStateOf(context.assets.open("catalogue.json").bufferedReader().use { PackManifest.parse(it.readText()) }) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var activePack by remember { mutableStateOf<String?>(null) }
    Text("Dictionary definitions and examples, ordered by frequency. These packs haven’t had independent language review.", style = MaterialTheme.typography.bodyMedium)
    Text("New dictionary entries", style = MaterialTheme.typography.titleSmall)
    Text("Choose a frequency starting point. Existing reviews and starter cards continue.", style = MaterialTheme.typography.bodySmall)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(1 to "All ranks", 2501 to "2,501+", 7001 to "7,001+").forEach { (rank, label) ->
            FilterChip(selected = model.minimumRank == rank, onClick = { model.setMinimumRank(rank) }, label = { Text(label) })
        }
    }
    OutlinedButton(enabled = !busy, onClick = { scope.launch {
        busy = true; activePack = null; message = ""
        try {
            packs = withContext(Dispatchers.IO) { PackManifest.parse(PackDownloads.fetch(PackDownloads.CATALOGUE_URL)) }
            message = "Catalogue updated"
        } catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (e: Exception) { message = e.message ?: "Could not update catalogue" }
        finally { busy = false }
    } }) { Text("Refresh catalogue") }
    if (message.isNotBlank() && activePack == null) Text(message)
    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    packs.forEach { pack ->
        ElevatedCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(pack.title, style = MaterialTheme.typography.titleMedium)
                Text(pack.description)
                Text("${pack.meanings} meanings · ${pack.lemmas} dictionary words")
                val installed = model.installedPack(pack.id)
                Button(enabled = !busy && !installed, onClick = { scope.launch {
                    busy = true; activePack = pack.id; message = ""
                    try {
                        val text = withContext(Dispatchers.IO) {
                            PackDownloads.fetch(pack.url, pack.sha256).also { PackManifest.verifyPayload(it, pack) }
                        }
                        message = "Added ${model.importPack(text)} meanings. Ready offline."
                    } catch (e: kotlinx.coroutines.CancellationException) { throw e }
                    catch (e: Exception) { message = e.message ?: "Could not install pack" }
                    finally { busy = false }
                } }) { Text(if (installed) "Installed" else if (busy && activePack == pack.id) "Downloading…" else "Download pack") }
                if (activePack == pack.id && message.isNotBlank()) Text(message, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
