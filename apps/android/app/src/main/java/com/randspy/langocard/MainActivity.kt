package com.randspy.langocard

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.randspy.langocard.ui.theme.LangocardTheme
import io.github.openspacedrepetition.Rating
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription

class MainActivity : ComponentActivity() {
    private lateinit var model: LearningModel
    private lateinit var speech: FrenchSpeech
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        model = ViewModelProvider(this)[LearningModel::class.java]
        speech = FrenchSpeech(this)
        setContent { LangocardTheme { PilotApp(model, speech) {
            runCatching { startActivity(Intent("com.android.settings.TTS_SETTINGS")) }
        } } }
    }
    override fun onStart() {
        super.onStart()
        if (::model.isInitialized) { model.resumeClock(); model.sync() }
    }
    override fun onStop() {
        if (::model.isInitialized) { model.tick(); model.persist() }
        if (::speech.isInitialized) speech.stop()
        super.onStop()
    }
    override fun onDestroy() { if (::speech.isInitialized) speech.close(); super.onDestroy() }
}

@Composable
private fun PilotApp(model: LearningModel, speech: FrenchSpeech, settings: () -> Unit) {
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(model, lifecycle) {
        lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            model.resumeClock()
            while (true) { delay(1000); model.tick() }
        }
    }
    var destination by rememberSaveable { mutableStateOf("study") }
    val destinations = mapOf("study" to "Daily practice", "library" to "My vocabulary", "add" to "Add an entry", "packs" to "Vocabulary packs", "backup" to "Backup & restore", "sync" to "Cloud sync", "export" to "Export to Anki", "sources" to "Content sources")
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val revision = model.revision
    val scroll = rememberScrollState()
    LaunchedEffect(model.screen, destination, model.prompt?.key, model.sessionReviews) { scroll.scrollTo(0) }
    BackHandler(model.screen != "home" || destination != "study") {
        speech.stop()
        if (model.screen == "review") model.finish() else { model.home(); destination = "study" }
    }
    val current = model.prompt
    var revealed by remember(current?.key, model.sessionReviews) { mutableStateOf(false) }
    var played by remember(current?.key, model.sessionReviews) { mutableStateOf(false) }
    /** The article chosen on a Gender card; choosing reveals the answer. */
    var chosen by remember(current?.key, model.sessionReviews) { mutableStateOf<Gender?>(null) }
    ModalNavigationDrawer(
        drawerState = drawer,
        gesturesEnabled = model.screen == "home",
        drawerContent = {
            ModalDrawerSheet {
                Column(Modifier.widthIn(max = 320.dp).fillMaxHeight().verticalScroll(rememberScrollState()).padding(vertical = 24.dp)) {
                    Text("langocard", modifier = Modifier.padding(horizontal = 28.dp), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Your French, every day", modifier = Modifier.padding(start = 28.dp, top = 4.dp, bottom = 28.dp),
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    destinations.entries.forEachIndexed { index, (id, label) ->
                        if (index == 3) {
                            HorizontalDivider(Modifier.padding(horizontal = 28.dp, vertical = 16.dp))
                            Text("MANAGE", modifier = Modifier.padding(start = 28.dp, bottom = 8.dp),
                                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        NavigationDrawerItem(
                            label = { Text(label) }, selected = destination == id,
                            colors = NavigationDrawerItemDefaults.colors(
                                selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                                selectedTextColor = MaterialTheme.colorScheme.onPrimaryContainer,
                                selectedBadgeColor = MaterialTheme.colorScheme.onPrimaryContainer),
                            onClick = { destination = id; scope.launch { drawer.close() } },
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp),
                            badge = if (id == "library") ({ Text(model.entries.size.toString()) }) else null,
                        )
                    }
                }
            }
        },
    ) {
    Scaffold(bottomBar = {
        if (model.screen == "review" && current != null) {
            if (current.skill == Skill.Gender) GenderControls(model, speech, chosen) { chosen = it }
            else ReviewControls(model, speech, revealed,
                canReveal = current.skill != Skill.Listening || (played && !speech.speaking && speech.available),
                reveal = { revealed = true })
        }
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(scroll).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    if (model.screen == "home") {
                        IconButton(onClick = { scope.launch { drawer.open() } },
                            modifier = Modifier.semantics { contentDescription = "Open side menu" }) {
                            Text("☰", style = MaterialTheme.typography.headlineSmall)
                        }
                    }
                    Text("langocard", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                SyncIndicator(model, onClick = if (model.screen == "home") ({ destination = "sync" }) else null)
            }
            when (if (model.screen == "home") destination else model.screen) {
                "library", "add", "packs", "backup", "sync", "export", "sources" -> {
                    Text(destinations.getValue(destination), style = MaterialTheme.typography.headlineMedium)
                    if (destination == "sources") ContentSources()
                    else if (destination == "library") Library(model, speech, alwaysOpen = true)
                    else key(destination) { LibraryTools(model, destination) }
                }
                "review" -> Review(model, speech, revealed || chosen != null, played, chosen) { played = speech.say(current!!.entry.example) || played }
                "summary" -> {
                    Text(if (model.isPlacement) { if (model.placementDone) "Starting point saved" else "Starting check paused" } else "Done for today", style = MaterialTheme.typography.headlineLarge)
                    Text("${model.sessionReviews} assessments · ${model.sessionRecalled} recalled")
                    Text("${model.sessionSeconds / 60}m ${model.sessionSeconds % 60}s of focused practice")
                    Text("${model.dueCount(speech.available)} reviews remain due. Related skills wait until another day; progress is saved.")
                    if (model.pausedCount > 0) Text("Repeatedly missed cards get a three-day pause. Review their examples in the library.")
                    if (model.suspendedCount > 0) Text("${model.suspendedCount} cards are suspended in the web app.")
                    Button(onClick = model::home, modifier = Modifier.fillMaxWidth()) { Text("Back to home") }
                }
                else -> {
                    Text("A little French.\nEvery day.", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
                    Text("Read, listen, and find the words to speak. Your daily target is 15 minutes.")
                    ElevatedCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("TODAY", style = MaterialTheme.typography.labelLarge)
                            Text("${model.spent / 60} / 15 minutes", style = MaterialTheme.typography.headlineMedium)
                            LinearProgressIndicator(progress = { (model.spent / 900f).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                            Text("${model.dueCount(speech.available)} due · ${model.studied} / ${model.entries.size} meanings started")
                            Button(onClick = { model.start(!model.placementDone, speech.available) },
                                enabled = model.spent < 900 || !model.placementDone, modifier = Modifier.fillMaxWidth()) {
                                Text(if (!model.placementDone) "Find my starting point" else "Start a session")
                            }
                        }
                    }
                    if (!model.placementDone) {
                        Text("An optional B2 starting check: six entries across three skills. This is a sample, not a CEFR test.")
                        TextButton(onClick = { model.skipPlacement() }) { Text("Skip placement and start fresh") }
                    }
                    Text("Your interests", style = MaterialTheme.typography.titleMedium)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("daily" to "Daily life", "culture" to "Culture", "news" to "News").forEach { (id, label) ->
                            FilterChip(selected = id in model.interests, onClick = { model.toggleInterest(id) }, label = { Text(label) })
                        }
                    }
                    Text(speech.message, style = MaterialTheme.typography.bodySmall)
                    if (!speech.available) {
                        Text("Listening cards wait until an offline voice is available.")
                        OutlinedButton(onClick = settings) { Text("Open speech settings") }
                    }
                    Text("${model.bundledCount} built-in meanings · Includes the original 200 drafts and frequency-ranked dictionary content. Further packs are available in the menu.", style = MaterialTheme.typography.bodySmall)
                    Text("FSRS · 90% target recall · up to 5 new meanings per day. Again means forgotten; Hard means recalled with difficulty.", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

}

@Composable
private fun Review(model: LearningModel, speech: FrenchSpeech, revealed: Boolean, played: Boolean, chosen: Gender?, play: () -> Unit) {
    val p = model.prompt ?: return
    DisposableEffect(p.key) { onDispose { speech.stop() } }
    Text(if (model.isPlacement) "STARTING CHECK · ${model.placementProgress}" else "DAILY PRACTICE · ${model.spent / 60} / 15 min",
        style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
    Text(p.skill.label, style = MaterialTheme.typography.headlineLarge)
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            when (p.skill) {
                Skill.Reading -> {
                    Text(p.entry.word, style = MaterialTheme.typography.headlineMedium)
                    Text(p.entry.example)
                    Text("Recall the meaning before revealing.", style = MaterialTheme.typography.bodySmall)
                }
                Skill.Production -> {
                    Text(p.entry.english, style = MaterialTheme.typography.headlineMedium)
                    Text(p.entry.cloze, style = MaterialTheme.typography.titleLarge)
                    Text("Say the missing French aloud, or think it silently. Include the article for nouns and use the form that fits the sentence. Right word, wrong article? Rate Hard.", style = MaterialTheme.typography.bodySmall)
                }
                Skill.Gender -> {
                    Text(Gender.noun(p.entry.word), style = MaterialTheme.typography.headlineMedium)
                    Text(p.entry.english, style = MaterialTheme.typography.titleMedium)
                    Text("Un or une?", style = MaterialTheme.typography.bodySmall)
                }
                Skill.Listening -> {
                    Text("Listen, then recall the meaning.", style = MaterialTheme.typography.titleLarge)
                    Button(onClick = play, enabled = speech.available) {
                        Text(if (played) "Play again" else "Play French sentence")
                    }
                    if (!speech.available) {
                        Text(speech.message)
                        TextButton(onClick = model::deferAudio) { Text("Continue without listening") }
                    }
                }
            }
            if (revealed) {
                HorizontalDivider()
                if (chosen != null && p.entry.gender != null) {
                    val right = chosen == p.entry.gender
                    Text(if (right) "✓ Right" else "✗ Not ${chosen.article}",
                        color = if (right) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.titleMedium)
                }
                Text(p.entry.labelledWord, style = MaterialTheme.typography.headlineMedium)
                if (!p.entry.answer.equals(p.entry.word, ignoreCase = true)) Text("In this sentence: ${p.entry.answer}")
                Text(p.entry.english, style = MaterialTheme.typography.titleMedium)
                Text(p.entry.definition)
                Text(p.entry.example)
                if (speech.available) OutlinedButton(onClick = { speech.say(p.entry.example) }) { Text("Hear example") }
            }
        }
    }
    TextButton(onClick = { speech.stop(); model.finish() }) { Text(if (model.isPlacement) "Pause placement" else "Finish session") }
}

/** A Gender card grades itself: choose un or une, see the answer, then go on. */
@Composable
private fun GenderControls(model: LearningModel, speech: FrenchSpeech, chosen: Gender?, choose: (Gender) -> Unit) {
    val p = model.prompt ?: return
    val gender = p.entry.gender ?: return
    Surface(tonalElevation = 3.dp, shadowElevation = 6.dp) {
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (chosen == null) Gender.entries.forEach { option ->
                OutlinedButton(onClick = { choose(option) }, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) {
                    Text(option.article, style = MaterialTheme.typography.titleLarge)
                }
            } else Button(onClick = { speech.stop(); model.rate(gender.grade(chosen), speech.available) },
                modifier = Modifier.weight(1f).heightIn(min = 56.dp)) { Text("Next") }
        }
    }
}

/** Kept outside the scrolling card so every rating remains reachable without scrolling. */
@Composable
private fun ReviewControls(model: LearningModel, speech: FrenchSpeech, revealed: Boolean,
                           canReveal: Boolean, reveal: () -> Unit) {
    val p = model.prompt ?: return
    Surface(tonalElevation = 3.dp, shadowElevation = 6.dp) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!revealed) {
                Button(onClick = reveal, enabled = canReveal, modifier = Modifier.fillMaxWidth()) { Text("Reveal answer") }
            } else {
                Text("How well did you recall it?", style = MaterialTheme.typography.titleSmall)
            }
            listOf(listOf(Rating.AGAIN to "Again", Rating.HARD to "Hard"),
                listOf(Rating.GOOD to "Good", Rating.EASY to "Easy")).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { (rating, label) ->
                        val interval = if (revealed) remember(p.key, model.sessionReviews, rating) { model.interval(rating) } else ""
                        OutlinedButton(onClick = { speech.stop(); model.rate(rating, speech.available) },
                            enabled = revealed, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) {
                            Column(horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                                Text(label, fontWeight = FontWeight.Bold)
                                if (revealed) Text("~$interval", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Library(model: LearningModel, speech: FrenchSpeech, alwaysOpen: Boolean = false) {
    var expanded by remember { mutableStateOf(alwaysOpen) }
    var search by remember { mutableStateOf("") }
    val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
    if (!alwaysOpen) TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Close library" else "Browse library") }
    if (expanded) {
        OutlinedTextField(value = search, onValueChange = { search = it }, label = { Text("French or English") }, modifier = Modifier.fillMaxWidth())
        val matches = model.entries.filter { it.word.contains(search, true) || it.english.contains(search, true) }
        var page by remember(search) { mutableIntStateOf(0) }
        val shownPage = page.coerceAtMost((matches.size - 1).coerceAtLeast(0) / 50)
        Text("${matches.size} meanings found", style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(enabled = shownPage > 0, onClick = { page = shownPage - 1 }) { Text("Previous") }
            TextButton(enabled = (shownPage + 1) * 50 < matches.size, onClick = { page = shownPage + 1 }) { Text("Next 50") }
        }
        matches.drop(shownPage * 50).take(50).forEach { entry ->
            HorizontalDivider()
            Text(entry.labelledWord, style = MaterialTheme.typography.titleMedium)
            Text(entry.english)
            Text(entry.definition)
            Text(entry.example)
            if (entry.sourceUrl.isNotBlank()) {
                Text("Frequency rank ${entry.rank} · ${entry.license}", style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { uriHandler.openUri(entry.sourceUrl) }) { Text("Dictionary source") }
            }
            if (speech.available) TextButton(onClick = { speech.say(entry.example) }) { Text("Listen") }
        }
    }
}

@Composable
private fun ContentSources() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val notice = remember { context.assets.open("CONTENT-NOTICE.md").bufferedReader().use { it.readText() } }
    Text("Original starter material and source-aligned dictionary packs are kept separate from your learning history. Dictionary packs are structurally checked, not independently language-reviewed.")
    Text(notice, style = MaterialTheme.typography.bodyMedium)
}

/** Top-right status: local-only, syncing, synced, or the last sync failed (still works offline). */
@Composable
private fun SyncIndicator(model: LearningModel, onClick: (() -> Unit)?) {
    val (label, color) = when {
        !model.syncConfigured -> "OFFLINE" to MaterialTheme.colorScheme.primary
        model.syncing -> "SYNCING…" to MaterialTheme.colorScheme.onSurfaceVariant
        model.syncFailed -> "NOT SYNCED" to MaterialTheme.colorScheme.error
        else -> "SYNCED" to MaterialTheme.colorScheme.primary
    }
    val modifier = if (onClick != null) Modifier.clickable(onClickLabel = "Open cloud sync", onClick = onClick) else Modifier
    Text("$label · FR", modifier = modifier.padding(4.dp), color = color, style = MaterialTheme.typography.labelLarge)
}
