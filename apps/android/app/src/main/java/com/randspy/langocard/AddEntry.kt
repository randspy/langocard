package com.randspy.langocard

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * The page for adding a personal entry. With on-device AI enabled, the learner can type
 * just the English meaning and let the model draft the rest, then review it before saving.
 *
 * Drafted fields stay "drafted" until the learner edits them; regenerating replaces only
 * drafted fields, so the learner's own writing is never lost. The same goes for each
 * example: the AI adds examples next to the learner's, up to three, and regenerating
 * replaces only the drafted ones.
 */
@Composable
fun AddEntry(model: LearningModel) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val onDevice = remember { OnDeviceModel.get(context) }
    // The loaded model holds 2–3 GB of memory; give it back when the page closes.
    DisposableEffect(onDevice) { onDispose { onDevice.release() } }
    val drafter = remember(onDevice) { EntryDrafter(onDevice::generate) }
    val availability by onDevice.availability.collectAsState()

    var english by remember { mutableStateOf("") }
    val fields = remember { mutableStateMapOf(DraftField.Word to "", DraftField.Gender to "", DraftField.Definition to "") }
    val examples = remember { mutableStateListOf(ExampleField()) }
    var drafted by remember { mutableStateOf(emptySet<DraftField>()) }
    var message by remember { mutableStateOf("") }
    var drafting by remember { mutableStateOf<Job?>(null) }
    val busy = drafting != null

    fun draft() {
        val kept = fields.filterKeys { it !in drafted }
        val ownExamples = examples.filter { !it.drafted && it.text.isNotBlank() }
        drafting = scope.launch {
            try {
                val draft = drafter.draft(english, kept, ownExamples.map { it.text })
                draft.filled.forEach { (field, value) -> fields[field] = value }
                // Drafted examples are replaced; a stale one that couldn't be redrafted goes too.
                val next = ownExamples + draft.examples.map { ExampleField(it, drafted = true) }
                examples.clear(); examples.addAll(next.ifEmpty { listOf(ExampleField()) })
                // A stale drafted value that couldn't be redrafted no longer matches; the learner writes it.
                draft.unfilled.forEach { if (it in drafted) fields[it] = "" }
                drafted = drafted - draft.unfilled + draft.filled.keys
                message = if (draft.unfilled.isEmpty()) "Check the draft before saving"
                else "Couldn't draft ${draft.unfilled.joinToString(" or ") { "the " + it.name.lowercase() }}. Write ${if (draft.unfilled.size == 1 && DraftField.Examples !in draft.unfilled) "it" else "them"} yourself."
            } catch (e: CancellationException) {
                message = "Drafting cancelled"; throw e
            } catch (e: Exception) {
                message = e.message ?: "Could not draft this entry"
            } finally { drafting = null }
        }
    }

    Text("Search the library first in either language. If the meaning is missing, add it here.")
    if (availability == OnDeviceModel.Availability.Available) {
        Text("Type the English meaning, and the French word if you know it. On-device AI can draft the rest for you to check.", style = MaterialTheme.typography.bodySmall)
    }
    if (message.isNotEmpty()) Text(message)
    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())

    OutlinedTextField(english, { english = it }, label = { Text("English meaning") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
    DraftedField(DraftField.Word, fields, drafted, !busy) { drafted = drafted - DraftField.Word }
    val existing = fields.getValue(DraftField.Word).trim().let { word ->
        if (word.isEmpty()) emptyList() else model.entries.filter { it.word.equals(word, ignoreCase = true) }
    }
    if (existing.isNotEmpty()) Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text("Already in your library", style = MaterialTheme.typography.titleSmall)
            existing.forEach { Text("${it.word} — ${it.english}: ${it.definition}", style = MaterialTheme.typography.bodySmall) }
            Text("Save anyway if this is a different meaning.", style = MaterialTheme.typography.bodySmall)
        }
    }
    GenderChoice(fields, drafted, !busy) { drafted = drafted - DraftField.Gender }
    DraftedField(DraftField.Definition, fields, drafted, !busy) { drafted = drafted - DraftField.Definition }
    Examples(examples, !busy)

    when (val state = availability) {
        OnDeviceModel.Availability.Unavailable -> Unit
        is OnDeviceModel.Availability.Downloadable -> {
            state.problem?.let { Text("Could not download on-device AI: $it", color = MaterialTheme.colorScheme.error) }
            OutlinedButton(onClick = onDevice::download) { Text("Enable AI fill") }
            Text("Downloads the Gemma 4 model once (2.6 GB, Wi-Fi recommended). It then runs offline on this phone.", style = MaterialTheme.typography.bodySmall)
        }
        is OnDeviceModel.Availability.Downloading -> {
            OutlinedButton(onClick = {}, enabled = false) { Text("Downloading on-device AI… ${(state.progress * 100).toInt()}%") }
            LinearProgressIndicator({ state.progress }, Modifier.fillMaxWidth())
            Text("You can keep using the app; keep it open until the download finishes.", style = MaterialTheme.typography.bodySmall)
        }
        OnDeviceModel.Availability.Available -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val anythingToDraft = fields.any { (field, value) -> value.isBlank() || field in drafted } ||
                examples.any { it.drafted } || examples.count { it.text.isNotBlank() } < 3
            OutlinedButton(onClick = ::draft, enabled = !busy && english.isNotBlank() && anythingToDraft) {
                Text(if (drafted.isEmpty()) "Fill with AI" else "Regenerate")
            }
            if (busy) TextButton(onClick = { drafting?.cancel() }) { Text("Cancel") }
        }
    }
    Button(onClick = {
        message = try {
            model.addEntry(fields.getValue(DraftField.Word), english, fields.getValue(DraftField.Definition),
                // An example row left empty is unused, not an error.
                examples.map { it.text }.filter { it.isNotBlank() }, effectiveGender(fields)?.let(::genderOf))
            english = ""; fields.keys.forEach { fields[it] = "" }; drafted = emptySet()
            examples.clear(); examples.add(ExampleField())
            "Entry added to your library"
        } catch (e: Exception) { e.message ?: "Could not save this entry" }
    }, enabled = !busy) { Text("Save entry") }
    if (availability == OnDeviceModel.Availability.Available) {
        TextButton(onClick = onDevice::remove, enabled = !busy) { Text("Remove on-device AI (frees 2.6 GB)") }
    }
}

/** The chosen gender value, or while none is chosen, the one the word's article states. */
private fun effectiveGender(fields: Map<DraftField, String>): String? =
    fields.getValue(DraftField.Gender).ifBlank { null } ?: Gender.ofArticle(fields.getValue(DraftField.Word))?.json

/** Masculine · Feminine · Not a noun. Choosing one makes it the learner's, like editing a text field. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GenderChoice(fields: MutableMap<DraftField, String>, drafted: Set<DraftField>, enabled: Boolean, onEdit: () -> Unit) {
    val current = effectiveGender(fields)
    Column {
        Text("Gender", style = MaterialTheme.typography.labelLarge)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("masculine" to "Masculine", "feminine" to "Feminine", "none" to "Not a noun").forEach { (value, label) ->
                FilterChip(selected = current == value, enabled = enabled, label = { Text(label) },
                    onClick = { fields[DraftField.Gender] = value; onEdit() })
            }
        }
        val note = when {
            DraftField.Gender in drafted -> "Drafted by on-device AI"
            fields.getValue(DraftField.Gender).isBlank() && current != null -> "From the article"
            else -> null
        }
        note?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}

/** One draftable field. Editing it makes it the learner's, so regenerating leaves it alone. */
@Composable
private fun DraftedField(field: DraftField, fields: MutableMap<DraftField, String>, drafted: Set<DraftField>, enabled: Boolean, onEdit: () -> Unit) {
    OutlinedTextField(
        value = fields.getValue(field),
        onValueChange = { fields[field] = it; onEdit() },
        label = { Text(label(field)) },
        supportingText = if (field in drafted) ({ Text("Drafted by on-device AI") }) else null,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun label(field: DraftField) = when (field) {
    DraftField.Word -> "French, including noun article"
    DraftField.Gender -> "Gender"
    DraftField.Definition -> "Simple French definition"
    DraftField.Examples -> "Examples"
}

/** One example being written. [drafted] until the learner edits it, like a drafted field. */
private data class ExampleField(val text: String = "", val drafted: Boolean = false)

/**
 * The entry's examples, in practice order: one text field each, with Remove (keeping one)
 * and Add example (up to [ContentFiles.MAX_EXAMPLES]).
 */
@Composable
private fun Examples(examples: MutableList<ExampleField>, enabled: Boolean) {
    Text("Examples", style = MaterialTheme.typography.labelLarge)
    Text("Mark the word in each with {braces}: Elle {se rend compte} du problème. Practice shows them in turn.",
        style = MaterialTheme.typography.bodySmall)
    examples.forEachIndexed { index, example ->
        OutlinedTextField(
            value = example.text,
            onValueChange = { examples[index] = ExampleField(it) },
            label = { Text("Example ${index + 1}") },
            supportingText = if (example.drafted) ({ Text("Drafted by on-device AI") }) else null,
            trailingIcon = if (examples.size > 1) ({
                TextButton(onClick = { examples.removeAt(index) }, enabled = enabled) { Text("Remove") }
            }) else null,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth(),
        )
    }
    if (examples.size < ContentFiles.MAX_EXAMPLES) {
        TextButton(onClick = { examples.add(ExampleField()) }, enabled = enabled) { Text("Add example") }
    }
}
