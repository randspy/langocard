package com.randspy.langocard

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReadingPassagePage(model: LearningModel, speech: FrenchSpeech, visible: Boolean) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val engine = remember { OnDeviceModel.get(context) }
    val availability by engine.availability.collectAsState()
    val scope = rememberCoroutineScope()
    var passage by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var lookup by remember { mutableStateOf<String?>(null) }
    val vocabulary = remember { model.passageVocabulary() }
    DisposableEffect(engine) {
        onDispose { engine.release() }
    }
    DisposableEffect(passage, visible, lookup) {
        model.resumeClock()
        model.readingPassageActive = passage != null && visible && lookup == null
        onDispose {
            model.tick()
            model.readingPassageActive = false
            model.library.save()
            speech.stop()
        }
    }
    Text("Reading passage", style = MaterialTheme.typography.headlineMedium)
    Text("Read for meaning. Foreground reading and listening count toward your daily 15 minutes. Card schedules stay unchanged.")
    if (availability != OnDeviceModel.Availability.Available) {
        Text(if (availability == OnDeviceModel.Availability.Unavailable)
            "This phone cannot run the on-device drafting model. Reviews still work offline."
        else "Enable the on-device AI model on Add an entry first. Once downloaded, passages work offline.")
        return
    }
    if (!vocabulary.ready) {
        Text("Recall at least 20 reading entries before generating a passage.")
        return
    }
    Button(enabled = !busy, onClick = {
        passage = null; problem = null; busy = true
        scope.launch {
            try { passage = PassageDrafter(engine::generate).draft(vocabulary) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { problem = e.message ?: "Generation failed. Try again." }
            finally { busy = false }
        }
    }) { Text(if (busy) "Generating…" else if (passage == null) "Generate passage" else "New passage") }
    problem?.let { Text(it) }
    passage?.let { text ->
        Text("Generated on this phone. Tap a word for library meanings.", style = MaterialTheme.typography.bodySmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Regex("\\S+").findAll(text).forEach { match ->
                Text(match.value, style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.clickable { lookup = match.value }.padding(vertical = 6.dp))
            }
        }
        OutlinedButton(enabled = speech.available, onClick = { if (speech.speaking) speech.stop() else speech.say(text) }) {
            Text(if (speech.speaking) "Stop" else "Listen · synthetic French")
        }
        Text(speech.message, style = MaterialTheme.typography.bodySmall)
    }
    lookup?.let { token ->
        val matches = PassageDrafter.meanings(token, model.library.entries)
        AlertDialog(onDismissRequest = { lookup = null }, title = { Text("Library matches for $token") },
            text = {
                if (matches.isEmpty()) Text("No matching meaning in your library.")
                else LazyColumn(Modifier.heightIn(max = 360.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(matches, key = { it.id }) { Text("${it.word} · ${it.english}\n${it.definition}") }
                }
            },
            confirmButton = { TextButton(onClick = { lookup = null }) { Text("Close") } })
    }
}
