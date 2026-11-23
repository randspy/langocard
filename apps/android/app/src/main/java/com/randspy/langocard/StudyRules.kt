package com.randspy.langocard

import io.github.openspacedrepetition.State
import java.time.Instant

/** Study decisions shared by session selection and home offers, without clocks or Android state. */
class StudyRules(entries: List<Entry>, private val learner: Learner, private val retired: Set<String>,
                 private val supported: Set<Skill> = Skill.entries.toSet(), order: StudyOrder? = null) {
    private val entries = if (order == null) entries else entries.sortedBy { order.key(it.id) }
    private fun genderOwners() = GenderCards.owners(entries) { learner.card(it)?.cardId }

    private fun studiable(p: Prompt, audio: Boolean, genderOwners: Set<String>) =
        (p.skill != Skill.Listening || audio) && (p.skill != Skill.Gender || p.entry.id in genderOwners)

    /** Includes buried cards so due counts and passage vocabulary keep their existing meaning. */
    fun prompts(audio: Boolean, now: Instant): List<Prompt> {
        val owners = genderOwners()
        return entries.flatMap { e -> e.skills.map { Prompt(e, it) } }.filter { p ->
            p.skill in supported && studiable(p, audio, owners) && !learner.isPausedOrSuspended(p.key, now.toEpochMilli())
        }
    }

    fun dueCount(audio: Boolean, now: Instant): Int = prompts(audio, now).count { due(it, now) }

    /** Up to 100 recalled reading cards in library order; resets remove them until studied again. */
    fun knownReadingVocabulary(): List<Entry> = entries.asSequence().filter { entry ->
        val key = entry.cardKey(Skill.Reading)
        learner.recalled(key) && learner.card(key) != null
    }.take(100).toList()

    private fun due(p: Prompt, now: Instant) = learner.card(p.key)?.due?.let { !it.isAfter(now) } == true

    /** Due cards precede new skills, then new meanings; cleanup can recall learning cards early. */
    fun choose(audio: Boolean, block: PracticeBlock, session: SessionLearning, now: Instant, day: String): Prompt? {
        val available = prompts(audio, now).filter { !learner.isBuried(it.key, day) }
        val cleanup = session.next(available.map { it.key }) { key ->
            learner.card(key)?.state != State.REVIEW
        }?.let { key -> available.first { it.key == key } }
        if (learner.seconds >= block.end) return cleanup
        val due = available.filter { due(it, now) }.minByOrNull { learner.card(it.key)!!.due }
        if (due != null) return due
        if (!StudyPolicy.introductionsOpen(learner.seconds, block.end)) return cleanup
        val genderRoom = block.genderRoom(learner.genderIntroduced)
        val sibling = available.filter { p -> learner.card(p.key) == null && (p.skill != Skill.Gender || genderRoom) &&
            learner.started(p.entry) }.minByOrNull { it.skill == Skill.Gender }
        if (sibling != null) return sibling
        if (block.meaningRoom(learner.introduced)) {
            return available.filter { learner.card(it.key) == null && it.skill != Skill.Gender && !learner.started(it.entry) &&
                it.entry.rank >= learner.minimumRank && it.entry.id !in retired }
                .sortedBy { if (it.entry.id.startsWith("personal-")) -1 else it.entry.rank.coerceAtMost(1000000) / 100 * 100 +
                    if (it.entry.topic in learner.interests) 0 else 50 }
                .firstOrNull() ?: cleanup
        }
        return cleanup
    }

    /** A fresh session has no cleanup debt; an extra grant has its own introduction allowances. */
    fun nextPractice(audio: Boolean, block: PracticeBlock, now: Instant, day: String): NextPractice {
        if (learner.seconds < block.end && choose(audio, block, SessionLearning(), now, day) != null) return NextPractice.Session
        if (learner.seconds >= StudyPolicy.DAILY_SECONDS) {
            val prospective = PracticeBlock.extra(learner.seconds, ExtraMinutes.Five)
            if (choose(audio, prospective, SessionLearning(), now, day) != null) return NextPractice.ExtraBlock
        }
        val unstarted = entries.any { entry -> entry.rank >= learner.minimumRank && entry.id !in retired && !learner.started(entry) }
        val owners = genderOwners()
        val temporarilyBlocked = entries.any { entry -> entry.skills.any { skill ->
            val p = Prompt(entry, skill)
            val work = if (learner.card(p.key) == null) learner.started(entry) else due(p, now)
            p.skill in supported && studiable(p, audio, owners) && work &&
                (learner.isBuried(p.key, day) || learner.isPausedOrSuspended(p.key, now.toEpochMilli()))
        } }
        return if (unstarted || temporarilyBlocked) NextPractice.NothingLeft else NextPractice.MoreVocabulary
    }

    /** Bury only siblings so a failed card can return at its FSRS due time or during cleanup. */
    fun siblingsToBury(p: Prompt, placement: Boolean): List<String> {
        // Placement starts the noun, but only its Gender card waits for a later day.
        if (placement) return if (p.entry.gender != null) listOf(p.entry.cardKey(Skill.Gender)) else emptyList()
        return entries.filter { it.lexeme == p.entry.lexeme }.flatMap { related ->
            related.skills.filter { related.id != p.entry.id || it != p.skill }.map { related.cardKey(it) }
        }
    }

    /** Rotate across sentence-bearing skills and devices; a paused card returns in a fresh context. */
    fun shown(p: Prompt, now: Instant): Prompt {
        val count = learner.exposures(p.entry)
        val until = learner.pausedUntil(p.key)
        val returning = until > 0 && until <= now.toEpochMilli() &&
            (learner.card(p.key)?.lastReview?.toEpochMilli() ?: 0L) < until
        val recent = if (returning) learner.recentExamples(p.key) else emptyList()
        return p.copy(example = if (returning) StuckWords.returningExample(p.entry, count, recent) else p.entry.exampleAt(count))
    }
}
