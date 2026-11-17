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
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.Role
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
        // Answer input and reveal state last only for this Activity instance.
        model.presentCard { ReviewCard.question(it.prompt) }
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
internal fun PilotApp(model: LearningModel, speech: FrenchSpeech, settings: () -> Unit) {
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(model, lifecycle) {
        lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            model.resumeClock()
            while (true) { delay(1000); model.tick() }
        }
    }
    var destination by rememberSaveable { mutableStateOf(Destination.Study) }
    val screen = model.screen
    val review = screen as? LearningScreen.Review
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val revision = model.revision
    val scroll = rememberScrollState()
    LaunchedEffect(screen::class, destination, review?.card?.prompt?.key, model.sessionReviews) { scroll.scrollTo(0) }
    BackHandler(screen != LearningScreen.Home || destination != Destination.Study) {
        speech.stop()
        if (screen is LearningScreen.Review) model.finish() else { model.home(); destination = Destination.Study }
    }
    model.hookOffer?.let { entry ->
        var hook by remember(entry.id) { mutableStateOf(model.memoryHook(entry.id)) }
        AlertDialog(onDismissRequest = model::dismissHook,
            title = { Text("A new way to remember ${entry.word}") },
            text = { Column { Text("This skill is paused for three days. Add a personal memory hook.")
                OutlinedTextField(value = hook, onValueChange = { if (it.length <= 500) hook = it }, label = { Text("Memory hook") }) } },
            confirmButton = { TextButton(onClick = { model.saveMemoryHook(hook) }) { Text("Save") } },
            dismissButton = { TextButton(onClick = model::dismissHook) { Text("Skip") } })
    }
    ModalNavigationDrawer(
        drawerState = drawer,
        gesturesEnabled = screen == LearningScreen.Home,
        drawerContent = {
            ModalDrawerSheet {
                Column(Modifier.widthIn(max = 320.dp).fillMaxHeight().verticalScroll(rememberScrollState()).padding(vertical = 24.dp)) {
                    Text("langocard", modifier = Modifier.padding(horizontal = 28.dp), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Your French, every day", modifier = Modifier.padding(start = 28.dp, top = 4.dp, bottom = 28.dp),
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Destination.entries.forEachIndexed { index, item ->
                        if (index == 3) {
                            HorizontalDivider(Modifier.padding(horizontal = 28.dp, vertical = 16.dp))
                            Text("MANAGE", modifier = Modifier.padding(start = 28.dp, bottom = 8.dp),
                                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        DrawerRow(item.label, selected = destination == item, badge = if (item == Destination.Library) model.entries.size.toString() else null) {
                            if (item == Destination.Placement) model.openVocabularyPlacement() else destination = item; scope.launch { drawer.close() }
                        }
                    }
                }
            }
        },
    ) {
    Scaffold(bottomBar = {
        if (review != null) {
            if (review.card.prompt.skill == Skill.Gender) GenderControls(model, speech, review.card)
            else ReviewControls(model, speech, review.card)
        }
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).then(if (screen == LearningScreen.Home && destination == Destination.Library) Modifier else Modifier.verticalScroll(scroll)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    if (screen == LearningScreen.Home) {
                        IconButton(onClick = { scope.launch { drawer.open() } },
                            modifier = Modifier.semantics { contentDescription = "Open side menu" }) {
                            Text("☰", style = MaterialTheme.typography.headlineSmall)
                        }
                    }
                    Text("langocard", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                if (review != null) SessionProgress(model, review.kind)
                SyncIndicator(model, onClick = if (screen == LearningScreen.Home) ({ destination = Destination.Sync }) else null)
            }
            when (screen) {
                LearningScreen.VocabularyPlacement -> VocabularyPlacementScreen(model)
                is LearningScreen.Review -> Review(model, speech, screen.card, screen.kind)
                is LearningScreen.Summary -> {
                    Text(if (screen.kind == SessionKind.Placement) { if (model.placementDone) "Starting point saved" else "Starting check paused" } else "Done for today", style = MaterialTheme.typography.headlineLarge)
                    Text("${model.sessionReviews} assessments · ${model.sessionRecalled} recalled")
                    Text("${model.sessionSeconds / 60}m ${model.sessionSeconds % 60}s of focused practice")
                    Text("${model.dueCount(speech.available)} reviews remain due. Related skills wait until another day; progress is saved.")
                    if (model.pausedCount > 0) Text("Repeatedly missed cards get a three-day pause. Review their examples in the library.")
                    if (model.suspendedCount > 0) Text("${model.suspendedCount} cards are suspended in the web app.")
                    if (screen.kind != SessionKind.Placement) when (model.nextPractice(speech.available)) {
                        NextPractice.ExtraBlock -> ExtraBlockChoice(model, speech.available)
                        NextPractice.MoreVocabulary -> VocabularyNeeded { model.home(); destination = Destination.Packs }
                        NextPractice.NothingLeft -> Text("Nothing left for today. Come back tomorrow.")
                        NextPractice.Session -> Button(onClick = { model.start(SessionKind.Practice, speech.available) }, modifier = Modifier.fillMaxWidth()) {
                            Text("Resume practice")
                        }
                    }
                    Button(onClick = model::home, modifier = Modifier.fillMaxWidth()) { Text("Back to home") }
                }
                LearningScreen.Home -> when (destination) {
                    Destination.Library -> VocabularyList(model.entries, speech, Modifier.weight(1f))
                    Destination.Add, Destination.Packs, Destination.Backup, Destination.Sync, Destination.Export -> {
                        Text(destination.label, style = MaterialTheme.typography.headlineMedium)
                        key(destination) { LibraryTools(model, requireNotNull(destination.tool)) }
                    }
                    Destination.Sources -> {
                        Text(destination.label, style = MaterialTheme.typography.headlineMedium)
                        ContentSources()
                    }
                    Destination.Placement -> VocabularyPlacementScreen(model)
                    Destination.Reading -> ReadingPassagePage(model, speech, drawer.currentValue == DrawerValue.Closed && drawer.targetValue == DrawerValue.Closed)
                    Destination.Study -> {
                        ElevatedCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text("TODAY", style = MaterialTheme.typography.labelLarge)
                                Text("${model.spent / 60} / 15 minutes", style = MaterialTheme.typography.headlineMedium)
                                LinearProgressIndicator(progress = { (model.spent / StudyPolicy.DAILY_SECONDS.toFloat()).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                                if (model.spent >= StudyPolicy.DAILY_SECONDS) Text("Goal met", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                                Text("${model.dueCount(speech.available)} due · ${model.studied} / ${model.entries.size} meanings started")
                                if (!model.placementDone) Button(onClick = model::openVocabularyPlacement, modifier = Modifier.fillMaxWidth()) {
                                    Text("Find my starting point")
                                } else when (model.nextPractice(speech.available)) {
                                    NextPractice.Session -> Button(onClick = { model.start(SessionKind.Practice, speech.available) }, modifier = Modifier.fillMaxWidth()) {
                                        Text("Start a session")
                                    }
                                    NextPractice.ExtraBlock -> ExtraBlockChoice(model, speech.available)
                                    NextPractice.MoreVocabulary -> VocabularyNeeded { model.home(); destination = Destination.Packs }
                                    NextPractice.NothingLeft -> Text("Nothing left for today. Come back tomorrow.")
                                }
                            }
                        }
                        if (!model.placementDone) {
                            Text("An optional vocabulary starting check, about five minutes. Pause and resume any time. This is an estimate, not a CEFR test.")
                            TextButton(onClick = { model.skipPlacement() }) { Text("Skip placement and start fresh") }
                        }
                        Text("Your interests", style = MaterialTheme.typography.titleMedium)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf("daily" to "Daily life", "culture" to "Culture", "news" to "News").forEach { (id, label) ->
                                FilterChip(selected = id in model.interests, onClick = { model.toggleInterest(id) }, label = { Text(label) })
                            }
                        }
                        if (!speech.available) {
                            Text("Listening cards wait until an offline voice is available.")
                            OutlinedButton(onClick = settings) { Text("Open speech settings") }
                        }
                    }
                }
            }
        }
    }
}

}

@Composable
private fun DrawerRow(label: String, selected: Boolean, badge: String?, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val content = if (selected) colors.onPrimaryContainer else colors.onSurfaceVariant
    Row(Modifier.fillMaxWidth().height(56.dp)
        .drawBehind { if (selected) {
            drawRect(colors.primaryContainer.copy(alpha = 0.45f))
            drawRect(colors.primary, size = Size(4.dp.toPx(), size.height))
        } }
        .selectable(selected, role = Role.Tab, onClick = onClick)
        .padding(horizontal = 28.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = content, style = MaterialTheme.typography.bodyLarge)
        badge?.let { Text(it, color = content, style = MaterialTheme.typography.bodyLarge) }
    }
}

@Composable
private fun Review(model: LearningModel, speech: FrenchSpeech, card: ReviewCard, kind: SessionKind) {
    val p = card.prompt
    val revealed = card.revealed
    val comparison = card.comparison
    val chosen = card.chosen
    DisposableEffect(p.key) { onDispose { speech.stop() } }
    if (model.listeningMuted) Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Text("Listening paused ·", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = model::unmuteListening) { Text("Turn back on") }
    }
    Text(p.skill.label, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        when (p.skill) {
            Skill.Reading -> {
                Text(p.entry.word, style = MaterialTheme.typography.headlineMedium)
                Text(p.example.text)
                Text("Recall the meaning before revealing.", style = MaterialTheme.typography.bodySmall)
            }
            Skill.Production -> {
                Text(p.entry.english, style = MaterialTheme.typography.headlineMedium)
                GapFill(p.example, card) { text -> model.presentCard { it.type(text) } }
                Text("Say the missing French aloud, or think it silently. Include the article for nouns and use the form that fits the sentence. Right word, wrong article? Rate Hard.", style = MaterialTheme.typography.bodySmall)
            }
            Skill.Gender -> {
                Text(Gender.noun(p.entry.word), style = MaterialTheme.typography.headlineMedium)
                Text(p.entry.english, style = MaterialTheme.typography.titleMedium)
                Text("Un or une?", style = MaterialTheme.typography.bodySmall)
            }
            Skill.Listening -> {
                Button(onClick = { val success = speech.say(p.example.text); model.presentCard { it.played(success) } }, enabled = speech.available) {
                    Text(if (card.played) "Play again" else "Play French sentence")
                }
                if (!speech.available) Text(speech.message)
                TextButton(onClick = model::muteListening) { Text("Can't listen now: skip listening this session") }
                GapFill(p.example, card) { text -> model.presentCard { it.type(text) } }
                Text("Listen for the missing French, then type it or say it aloud. Write it as you hear it in the sentence. Then recall what it means.", style = MaterialTheme.typography.bodySmall)
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
            if (comparison != null) TypedAnswerFeedback(comparison)
            Text(p.entry.labelledWord, style = MaterialTheme.typography.headlineMedium)
            if (p.skill == Skill.Gender) {
                NounEndings.match(p.entry.word, p.entry.gender)?.let { hint ->
                    Text(hint.feedback, style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (!p.example.answer.equals(p.entry.word, ignoreCase = true)) Text("In this sentence: ${p.example.answer}")
            Text(p.entry.english, style = MaterialTheme.typography.titleMedium)
            Text(p.entry.definition)
            model.memoryHook(p.entry.id).takeIf { it.isNotBlank() }?.let { Text("Memory hook: $it") }
            Text(p.example.text)
            if (speech.available) OutlinedButton(onClick = { speech.say(p.example.text) }) { Text("Hear example") }
        }
    }
    TextButton(onClick = { speech.stop(); model.finish() }, contentPadding = PaddingValues(0.dp)) { Text(if (kind == SessionKind.Placement) "Pause placement" else "Finish session") }
}

/** Time or progress through the running session, shown in the top bar. Extra blocks lead with "+". */
@Composable
private fun SessionProgress(model: LearningModel, kind: SessionKind) {
    val block = model.block
    Text(when {
        kind == SessionKind.Placement -> model.placementProgress
        block.isExtra -> "+${block.minutesIn(model.spent)} / ${block.minutes} min"
        else -> "${model.spent / 60} / 15 min"
    }, modifier = Modifier.padding(4.dp), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
}

/** The example with its answer blanked out, and an optional field to type the missing French. */
@Composable
private fun GapFill(example: Example, card: ReviewCard, type: (String) -> Unit) {
    Text(example.cloze, style = MaterialTheme.typography.titleLarge)
    if (!card.revealed) OutlinedTextField(value = card.typed, onValueChange = type,
        label = { Text("Your answer (optional)") }, singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
            autoCorrectEnabled = false, capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.None))
}

@Composable
private fun VocabularyNeeded(openPacks: () -> Unit) {
    Text("No unstarted words remain in your selected frequency range. Browse vocabulary packs to add more.")
    OutlinedButton(onClick = openPacks, modifier = Modifier.fillMaxWidth()) { Text("Vocabulary packs") }
}

@Composable
private fun ExtraBlockChoice(model: LearningModel, audio: Boolean) {
    Text("Keep practising?", style = MaterialTheme.typography.titleMedium)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ExtraMinutes.entries.forEach { length ->
            OutlinedButton(onClick = { model.startExtraBlock(length, audio) }, modifier = Modifier.weight(1f)) {
                Text("+${length.minutes} min")
            }
        }
    }
}

/** A Gender card grades itself: choose un or une, see the answer, then go on. */
@Composable
private fun GenderControls(model: LearningModel, speech: FrenchSpeech, card: ReviewCard) {
    val rating = card.ratingToConfirm
    Surface(tonalElevation = 3.dp, shadowElevation = 6.dp) {
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!card.revealed) Gender.entries.forEach { option ->
                OutlinedButton(onClick = { model.presentCard { it.choose(option) } }, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) {
                    Text(option.article, style = MaterialTheme.typography.titleLarge)
                }
            } else Button(onClick = { speech.stop(); rating?.let { model.rate(it, speech.available) } },
                modifier = Modifier.weight(1f).heightIn(min = 56.dp)) { Text("Next") }
        }
    }
}

/** Kept outside the scrolling card so every rating remains reachable without scrolling. */
@Composable
private fun ReviewControls(model: LearningModel, speech: FrenchSpeech, card: ReviewCard) {
    val p = card.prompt
    val revealed = card.revealed
    val comparison = card.comparison
    val selected = card.ratingToConfirm
    Surface(tonalElevation = 3.dp, shadowElevation = 6.dp) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!revealed) {
                Button(onClick = { model.presentCard { it.reveal(speech.available, speech.speaking) } },
                    enabled = card.canReveal(speech.available, speech.speaking), modifier = Modifier.fillMaxWidth()) { Text("Reveal answer") }
            }
            listOf(listOf(Rating.AGAIN to "Again", Rating.HARD to "Hard"),
                listOf(Rating.GOOD to "Good", Rating.EASY to "Easy")).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { (rating, label) ->
                        val interval = if (revealed) remember(p.key, model.sessionReviews, rating) { model.interval(rating) } else ""
                        OutlinedButton(onClick = { if (comparison != null) model.presentCard { it.select(rating) } else { speech.stop(); model.rate(rating, speech.available) } },
                            colors = ButtonDefaults.outlinedButtonColors(containerColor = if (comparison != null && revealed && selected == rating) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface),
                            enabled = revealed, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) {
                            Column(horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                                Text(if (comparison != null && revealed && selected == rating) "✓ $label" else label, fontWeight = FontWeight.Bold)
                                if (revealed) Text("~$interval", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            }
            if (revealed && comparison != null) {
                Text("Suggested ${comparison.match.suggested.name.lowercase()}. Change it if needed.", style = MaterialTheme.typography.bodySmall)
                Button(onClick = { selected?.let { speech.stop(); model.rate(it, speech.available) } },
                    modifier = Modifier.fillMaxWidth()) { Text("Confirm rating") }
            }
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

@Composable
private fun VocabularyPlacementScreen(model: LearningModel) {
    val answers = remember(model.revision) { model.vocabularyAnswers }
    val test = model.vocabularyPlacement
    Text("Vocabulary starting check", style = MaterialTheme.typography.headlineMedium)
    if (answers.size < test.items.size) {
        Text("${answers.size} / ${test.items.size} · about 5 minutes total")
        Text("Do you know a meaning of this French word? Some words are invented. Choose No if unsure.")
        Text(test.items[answers.size].word, style = MaterialTheme.typography.headlineLarge)
        Button(onClick = { model.answerVocabularyPlacement(true) }) { Text("Yes, I know it") }
        OutlinedButton(onClick = { model.answerVocabularyPlacement(false) }) { Text("No / unsure") }
        TextButton(onClick = { model.home() }) { Text("Pause and save") }
    } else {
        Text("Suggested starting rank: ${test.startingRank(answers)}")
        Text("Adjusted recognition by band: ${test.adjustedHits(answers).joinToString { "%.1f / 20".format(it) }}")
        Text("This unvalidated estimate changes only which new words appear first. No cards are marked known. Choose a rank to save; you can change it in Vocabulary packs.")
        listOf(1, 2501, 7001).forEach { rank ->
            Button(onClick = { model.acceptVocabularyPlacement(rank) }) { Text("Start at rank $rank") }
        }
        TextButton(onClick = { model.retakeVocabularyPlacement() }) { Text("Retake check") }
        TextButton(onClick = { model.home() }) { Text("Keep current rank and close") }
    }
}
