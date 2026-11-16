package com.randspy.langocard

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.drop
import java.text.Collator
import java.util.Locale

fun Entry.matches(query: String): Boolean =
    query.isBlank() || word.contains(query, ignoreCase = true) || english.contains(query, ignoreCase = true)

private val french = Collator.getInstance(Locale.FRENCH).apply { strength = Collator.PRIMARY }

/**
 * Not [Entry.lexeme], which keeps the "le", "la" or "l'" of a personal entry. Every pack entry has a lemma, so the
 * article regex runs only for personal entries. Running it on every comparison made A–Z take over a second on 20,000 entries.
 */
private val alphabetical: Comparator<Entry> = compareBy(french) { it.lemma.ifBlank { Gender.noun(it.word) } }

/** A–Z ignores articles, accents and case. */
enum class VocabularySort(val label: String, val order: Comparator<Entry>) {
    /** Most frequent first; personal entries have no rank, so they come last, A–Z. */
    Frequency("Frequency", compareBy<Entry> { it.rank }.then(alphabetical)),
    Alphabetical("A–Z", alphabetical),
}

fun List<Entry>.browse(query: String, sort: VocabularySort): List<Entry> =
    filter { it.matches(query) }.sortedWith(sort.order)

private val openIdsSaver = Saver<Set<String>, ArrayList<String>>(save = { ArrayList(it) }, restore = { it.toSet() })

/** Open rows, the search and the sort survive rotation but reset on leaving the screen. */
@Composable
fun VocabularyList(entries: List<Entry>, speech: FrenchSpeech, modifier: Modifier = Modifier) {
    var query by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable { mutableStateOf(VocabularySort.Frequency) }
    var openIds by rememberSaveable(stateSaver = openIdsSaver) { mutableStateOf(emptySet<String>()) }
    // A SnapshotStateList keeps its identity when its contents change, so it can't be a remember key.
    val visible by remember(entries) { derivedStateOf { entries.browse(query, sort) } }
    val list = rememberLazyListState()
    // The first value is the restored one after rotation, which must keep its scroll position.
    LaunchedEffect(list) { snapshotFlow { query to sort }.drop(1).collect { list.scrollToItem(0) } }
    Column(modifier) {
        OutlinedTextField(value = query, onValueChange = { query = it }, label = { Text("French or English") },
            singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            val count = visible.size
            val noun = if (query.isBlank()) (if (count == 1) "word" else "words") else (if (count == 1) "match" else "matches")
            Text("${"%,d".format(count)} $noun", Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Box {
                var choosing by remember { mutableStateOf(false) }
                TextButton(onClick = { choosing = true }) { Text("Sort: ${sort.label} ▾") }
                DropdownMenu(expanded = choosing, onDismissRequest = { choosing = false }) {
                    VocabularySort.entries.forEach { option ->
                        DropdownMenuItem(text = { Text(option.label) }, onClick = { sort = option; choosing = false },
                            trailingIcon = if (option == sort) ({ Text("✓") }) else null)
                    }
                }
            }
        }
        if (visible.isEmpty() && query.isNotBlank()) {
            Text("No words match \"$query\"", Modifier.padding(top = 16.dp))
            TextButton(onClick = { query = "" }) { Text("Clear search") }
        } else LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list) {
            itemsIndexed(visible, key = { _, entry -> entry.id }) { index, entry ->
                if (index > 0) HorizontalDivider()
                VocabularyRow(entry, entry.id in openIds, { openIds = if (entry.id in openIds) openIds - entry.id else openIds + entry.id }, speech)
            }
        }
    }
}

@Composable
private fun VocabularyRow(entry: Entry, open: Boolean, onToggle: () -> Unit, speech: FrenchSpeech) {
    val uriHandler = LocalUriHandler.current
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth()
            .clickable(onClickLabel = if (open) "Hide details" else "Show details", onClick = onToggle)
            .semantics { stateDescription = if (open) "Expanded" else "Collapsed" }
            .padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(entry.labelledWord, style = MaterialTheme.typography.titleMedium)
                Text(entry.english, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(if (open) "▾" else "▸", Modifier.padding(start = 12.dp).clearAndSetSemantics {},
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        AnimatedVisibility(open, enter = expandVertically(tween(200)) + fadeIn(tween(200)),
            exit = shrinkVertically(tween(200)) + fadeOut(tween(200))) {
            Column(Modifier.padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(entry.definition)
                entry.examples.forEach { example ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(example.text, Modifier.weight(1f))
                        if (speech.available) IconButton(onClick = { speech.say(example.text) },
                            modifier = Modifier.semantics { contentDescription = "Listen" }) { Text("🔊") }
                    }
                }
                if (entry.sourceUrl.isNotBlank()) Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Rank ${entry.rank} · ${entry.license}", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { uriHandler.openUri(entry.sourceUrl) }) { Text("Source ↗") }
                }
            }
        }
    }
}
