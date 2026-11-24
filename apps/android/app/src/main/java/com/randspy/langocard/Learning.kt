package com.randspy.langocard

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import io.github.openspacedrepetition.Card as MemoryCard
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.Scheduler
import org.json.JSONArray
import java.time.Instant

class LearningModel(application: Application) : AndroidViewModel(application) {
    val library = LearningLibrary(application)
    private val learner get() = library.learner
    /** Built once per fit, so a fit synced from another device takes effect on the next answer. */
    private var schedulerFit: String? = null
    private var cachedScheduler: Scheduler? = null
    private val scheduler: Scheduler get() {
        val fit = learner.fittedSettings
        val json = fit?.toJson()?.toString()
        if (cachedScheduler == null || json != schedulerFit) {
            cachedScheduler = fit?.scheduler() ?: Scheduler.builder().desiredRetention(0.9).build()
            schedulerFit = json
        }
        return cachedScheduler!!
    }
    val schedulingDescription: String get() = learner.fittedSettings?.let {
        "FSRS · ${(it.retention * 100).toInt()}% target recall · fitted with ${it.reviewCount} reviews on ${it.fitDate}"
    } ?: "FSRS defaults · 90% target recall"
    fun importFittedSettings(text: String) {
        val fit = FittedSettings.parse(text)
        fit.scheduler()
        learner.fittedSettings = fit
        library.save()
    }
    fun resetFittedSettings() {
        learner.fittedSettings = null
        library.save()
    }
    var screen by androidx.compose.runtime.mutableStateOf<LearningScreen>(LearningScreen.Home); private set
    var hookOffer by androidx.compose.runtime.mutableStateOf<Entry?>(null); private set
    fun memoryHook(entryId: String): String = learner.hook(entryId)
    fun dismissHook() { hookOffer = null }
    fun saveMemoryHook(text: String) {
        val entry = hookOffer ?: return
        require(text.length <= 500)
        learner.setHook(entry.id, text.trim())
        hookOffer = null; library.save()
    }
    var sessionReviews by mutableIntStateOf(0); private set
    var sessionRecalled by mutableIntStateOf(0); private set
    var sessionSeconds by mutableIntStateOf(0); private set
    private var placementIndex = learner.placementIndex
    private val sessionLearning = SessionLearning()
    private val lastAnswered = mutableMapOf<String, Int>()
    private var lastTick = android.os.SystemClock.elapsedRealtime()
    val placementDone get() = learner.placementDone
    val vocabularyPlacement = VocabularyPlacement(JSONArray(getApplication<Application>().assets.open("placement-items.json").bufferedReader().use { it.readText() }).let { a ->
        (0 until a.length()).map { i -> a.getJSONObject(i).let { PlacementItem(it.getString("word"), it.getInt("band")) } }
    })
    val vocabularyAnswers get() = learner.vocabularyAnswers
    fun openVocabularyPlacement() { screen = LearningScreen.VocabularyPlacement }
    fun answerVocabularyPlacement(known: Boolean) {
        if (vocabularyAnswers.size >= vocabularyPlacement.items.size) return
        learner.answerVocabulary(known); library.save()
    }
    fun retakeVocabularyPlacement() { learner.retakeVocabulary(); library.save() }
    fun acceptVocabularyPlacement(rank: Int) {
        require(vocabularyAnswers.size == vocabularyPlacement.items.size)
        library.setMinimumRank(rank)
        learner.placementDone = true; home()
    }
    val placementProgress get() = "$placementIndex / 18"
    private fun today() = StudyPolicy.date(Instant.now())
    private fun rollover() = learner.rollover(today())
    val spent: Int get() { rollover(); return learner.seconds }
    /** Today's block: the daily target, or the extra block picked after it. */
    val block: PracticeBlock get() = PracticeBlock.read(learner.document, today(), spent)
    /** Offers a resume only when the current block can produce work; fresh grants never reuse usage. */
    fun nextPractice(audio: Boolean): NextPractice {
        val current = block
        val now = Instant.now()
        return studyRules.nextPractice(audio && !listeningMuted, current, now, StudyPolicy.date(now))
    }
    /** Starts an extra block of [length]; does nothing unless one is on offer, so a second tap is harmless. */
    fun startExtraBlock(length: ExtraMinutes, audio: Boolean) {
        if (screen is LearningScreen.Review || nextPractice(audio) != NextPractice.ExtraBlock) return
        PracticeBlock.extra(spent, length).write(learner.document, today()); library.save()
        start(SessionKind.Practice, audio)
    }
    val studied get() = library.entries.count { e -> e.skills.any { learner.hasCard(e.cardKey(it)) } }
    val pausedCount get() = learner.pausedCount(System.currentTimeMillis())
    val suspendedCount get() = learner.suspendedCount(System.currentTimeMillis())
    fun state(p: Prompt): MemoryCard? = learner.card(p.key)
    private val studyRules get() = StudyRules(library.entries, learner, library.retired, order = library.studyOrder)
    fun dueCount(audio: Boolean): Int = studyRules.dueCount(audio && !listeningMuted, Instant.now())
    fun restore(text: String) {
        library.restore(text)
        placementIndex = learner.placementIndex
        home()
    }

    fun start(kind: SessionKind, audio: Boolean) {
        rollover(); sessionReviews = 0; sessionRecalled = 0; sessionSeconds = 0
        sessionLearning.clear()
        lastAnswered.clear()
        lastTick = android.os.SystemClock.elapsedRealtime(); next(kind, audio)
    }
    fun tick() {
        val now = android.os.SystemClock.elapsedRealtime()
        val seconds = ((now - lastTick) / 1000).toInt()
        if (screen !is LearningScreen.Review && !readingPassageActive) {
            if (seconds >= 60) { lastTick = now; rollover(); library.changed() }
            return
        }
        if (seconds > 0) {
            lastTick += seconds * 1000L; rollover()
            sessionSeconds += seconds; learner.seconds = spent + seconds; library.changed()
            if (sessionSeconds % 10 == 0) library.save()
            val review = screen as? LearningScreen.Review
            if (review?.isRepeat == true && spent >= block.end) finish(review.kind)
        }
    }
    var readingPassageActive = false
    /** Reading recall history supplies vocabulary without mutating scheduling. */
    fun passageVocabulary(): PassageVocabulary {
        val known = studyRules.knownReadingVocabulary()
        val now = Instant.now()
        val due = studyRules.prompts(false, now).filter { it.skill == Skill.Reading && state(it)?.due?.isAfter(now) == false }.take(3).map { it.entry }
        return PassageVocabulary(known, due)
    }
    fun resumeClock() { lastTick = android.os.SystemClock.elapsedRealtime() }
    fun finish() {
        val review = screen as? LearningScreen.Review ?: return
        finish(review.kind)
    }
    private fun finish(kind: SessionKind) { screen = LearningScreen.Summary(kind); library.save(); cloudSync.sync() }
    fun home() { screen = LearningScreen.Home; listeningMuted = false; library.save() }
    fun skipPlacement() { learner.placementDone = true; home() }
    /** Applies an interaction only to the currently shown card, without changing its scheduling identity. */
    fun presentCard(change: (ReviewCard) -> ReviewCard) {
        val review = screen as? LearningScreen.Review ?: return
        val card = change(review.card)
        require(card.prompt == review.card.prompt)
        screen = review.copy(card = card)
    }
    private fun next(kind: SessionKind, audio: Boolean) {
        val placing = kind == SessionKind.Placement
        val current = block
        if (!StudyPolicy.sessionOpen(placing, spent, current.end, cleanup = true)) return finish(kind)
        val now = Instant.now()
        val rules = studyRules
        val withAudio = audio && !listeningMuted
        val scheduled = rules.choose(withAudio, current, sessionLearning, now, StudyPolicy.date(now),
            allowMoreMeanings = !placing)
        val chosen = scheduled ?: if (placing) null else rules.repeat(withAudio, current, now, lastAnswered)
        if (chosen != null) {
            screen = LearningScreen.Review(ReviewCard.question(rules.shown(chosen, now)), kind, isRepeat = scheduled == null)
        } else { if (placing) learner.placementDone = true; finish(kind) }
    }
    fun rate(rating: Rating, audio: Boolean) {
        val review = screen as? LearningScreen.Review ?: return
        val p = review.card.prompt
        if (review.isRepeat) {
            recordSessionAnswer(p, rating)
            next(review.kind, audio)
            return
        }
        val placing = review.kind == SessionKind.Placement
        val activeBlock = block
        val wasNewGender = p.skill == Skill.Gender && state(p) == null
        val wasNewSense = !learner.started(p.entry)
        if (wasNewGender && !placing) learner.genderIntroduced++
        val card = state(p) ?: learner.newCard()
        val result = scheduler.reviewCard(card, rating)
        if (!placing) sessionLearning.reviewed(p.key, state(p) == null, rating)
        learner.answered(p.key, result.card(), result.reviewLog(), p.example, placing)
        val now = Instant.now()
        val day = StudyPolicy.date(now)
        if (learner.recordRecall(p.key, rating, now)) hookOffer = p.entry
        studyRules.siblingsToBury(p, placing).forEach { learner.bury(it, day) }
        if (!placing) {
            activeBlock.introduced(wasNewSense, wasNewGender).write(learner.document, day)
            if (wasNewSense) learner.introduced++
        } else {
            placementIndex++; learner.placementIndex = placementIndex
        }
        recordSessionAnswer(p, rating)
        library.save(); next(review.kind, audio)
    }
    private fun recordSessionAnswer(prompt: Prompt, rating: Rating) {
        sessionReviews++
        if (rating != Rating.AGAIN) sessionRecalled++
        lastAnswered[prompt.key] = sessionReviews
    }
    /** Set for the rest of the sitting, until [home]; skipping leaves the card's schedule untouched. */
    var listeningMuted by androidx.compose.runtime.mutableStateOf(false); private set
    fun muteListening() {
        listeningMuted = true
        val review = screen as? LearningScreen.Review
        if (review?.card?.prompt?.skill == Skill.Listening) next(review.kind, audio = false)
    }
    fun unmuteListening() { listeningMuted = false }
    fun interval(rating: Rating): String {
        val review = screen as? LearningScreen.Review ?: return ""
        if (review.isRepeat) return ""
        val p = review.card.prompt
        val card = state(p) ?: MemoryCard.builder().cardId(learner.nextCardId).build()
        val now = Instant.now()
        return StudyPolicy.interval(now, scheduler.reviewCard(card, rating, now).card().due)
    }

    val cloudSync = LearningSync(application, viewModelScope, library,
        reviewing = { screen is LearningScreen.Review },
        onMerged = {
            if ((screen as? LearningScreen.Review)?.kind != SessionKind.Placement) placementIndex = learner.placementIndex
        })
}
