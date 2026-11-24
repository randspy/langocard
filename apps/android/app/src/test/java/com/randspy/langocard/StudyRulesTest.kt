package com.randspy.langocard

import io.github.openspacedrepetition.Card
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.Scheduler
import io.github.openspacedrepetition.State
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class StudyRulesTest {
    private val now = Instant.parse("2026-11-17T12:00:00Z")
    private val day = "2026-11-17"

    @Test fun `oldest due card wins before siblings and fresh meanings with stable ties`() {
        val fresh = entry("fresh")
        val sibling = entry("sibling")
        val later = entry("later")
        val older = entry("older")
        val tied = entry("tied")
        val learner = learner(mapOf(
            sibling.cardKey(Skill.Reading) to card(1, 3600),
            later.cardKey(Skill.Reading) to card(2, -1),
            older.cardKey(Skill.Production) to card(3, -100),
            tied.cardKey(Skill.Reading) to card(4, -100),
        ))
        val rules = StudyRules(listOf(fresh, sibling, later, older, tied), learner, emptySet())
        assertEquals(older.cardKey(Skill.Production), choose(rules)?.key)
        learner.bury(older.cardKey(Skill.Production), day)
        assertEquals(tied.cardKey(Skill.Reading), choose(rules)?.key)
        learner.bury(tied.cardKey(Skill.Reading), day)
        assertEquals(later.cardKey(Skill.Reading), choose(rules)?.key)
    }

    @Test fun `due exactly now is eligible while future reviews wait`() {
        val entry = entry("due")
        val rules = StudyRules(listOf(entry), learner(mapOf(
            entry.cardKey(Skill.Reading) to card(1, 1),
            entry.cardKey(Skill.Production) to card(2, 0),
        )), emptySet())
        assertEquals(entry.cardKey(Skill.Production), choose(rules)?.key)
        assertEquals(1, rules.dueCount(true, now))
    }

    @Test fun `pauses suspensions audio and burials affect selection but buried cards still count due`() {
        val entries = (0..3).map { entry("word-$it") }
        val keys = entries.map { it.cardKey(Skill.Reading) }
        val listening = entries[3].cardKey(Skill.Listening)
        val learner = learner((keys + listening).mapIndexed { index, key -> key to card(index, -100) }.toMap()) {
            it.put("suspended", JSONObject().put(keys[1], now.toEpochMilli() + 1))
        }
        learner.pause(keys[0], now.toEpochMilli() + 1)
        learner.bury(keys[2], day)
        learner.bury(keys[3], day)
        val rules = StudyRules(entries, learner, emptySet())
        assertEquals(listening, choose(rules)?.key)
        assertEquals(3, rules.dueCount(true, now))
        assertEquals(2, rules.dueCount(false, now))
        val eligible = rules.prompts(false, now).map { it.key }
        assertFalse(keys[0] in eligible)
        assertFalse(keys[1] in eligible)
        assertTrue(keys[2] in eligible)
        assertFalse(listening in eligible)
        assertEquals(5, rules.dueCount(true, now.plusMillis(1)))
        assertEquals(keys[0], rules.choose(true, PracticeBlock.DAILY, SessionLearning(), now.plusMillis(1), day)?.key)
        assertEquals(keys[2], rules.choose(true, PracticeBlock.DAILY, SessionLearning(), now, "2026-11-18")?.key)
    }

    @Test fun `existing meanings gain non gender skills before gender or fresh meanings despite rank and retirement`() {
        val noun = entry("noun", gender = Gender.Feminine)
        val sibling = entry("sibling", rank = 1)
        val learner = learner(mapOf(
            noun.cardKey(Skill.Reading) to card(1, 3600),
            noun.cardKey(Skill.Listening) to card(2, 3600),
            noun.cardKey(Skill.Production) to card(3, 3600),
            sibling.cardKey(Skill.Reading) to card(4, 3600),
        ))
        val rules = StudyRules(listOf(noun, entry("fresh"), sibling), learner, setOf(sibling.id))
        assertEquals(sibling.cardKey(Skill.Listening), choose(rules)?.key)
        learner.bury(sibling.cardKey(Skill.Listening), day)
        assertEquals(sibling.cardKey(Skill.Production), choose(rules)?.key)
        learner.bury(sibling.cardKey(Skill.Production), day)
        assertEquals(noun.cardKey(Skill.Gender), choose(rules)?.key)
    }

    @Test fun `gender ownership follows the first started meaning and preserves already studied gender cards`() {
        val first = entry("first", gender = Gender.Feminine).copy(word = "une intrigue")
        val second = first.copy(id = "second")
        val learner = learner(mapOf(
            first.cardKey(Skill.Reading) to card(8, 3600),
            second.cardKey(Skill.Reading) to card(2, 3600),
        ))
        val rules = StudyRules(listOf(first, second), learner, emptySet())
        assertEquals(listOf(second.cardKey(Skill.Gender)), rules.prompts(true, now).filter { it.skill == Skill.Gender }.map { it.key })
        answer(learner, Prompt(first, Skill.Gender), Rating.GOOD)
        assertEquals(listOf(first.cardKey(Skill.Gender)), rules.prompts(true, now).filter { it.skill == Skill.Gender }.map { it.key })
    }

    @Test fun `personal meanings lead then rank bands prefer interests and preserve library and skill order`() {
        val unrelated = entry("unrelated", rank = 2510, topic = "business")
        val interested = entry("interested", rank = 2599, topic = "news")
        val tied = interested.copy(id = "tied")
        val nextBand = entry("next-band", rank = 2600)
        val personal = entry("personal-test", rank = 10000)
        val learner = learner()
        val rules = StudyRules(listOf(nextBand, unrelated, interested, tied, personal), learner, emptySet())
        assertEquals(personal.cardKey(Skill.Reading), choose(rules)?.key)
        personal.skills.forEach { learner.bury(personal.cardKey(it), day) }
        assertEquals(interested.cardKey(Skill.Reading), choose(rules)?.key)
        interested.skills.forEach { learner.bury(interested.cardKey(it), day) }
        assertEquals(tied.cardKey(Skill.Reading), choose(rules)?.key)
        tied.skills.forEach { learner.bury(tied.cardKey(it), day) }
        assertEquals(unrelated.cardKey(Skill.Reading), choose(rules)?.key)
    }

    @Test fun `fresh meanings below placement rank and retired meanings are not introduced`() {
        val below = entry("below", rank = 2500)
        val retired = entry("retired", rank = 2501)
        val allowed = entry("allowed", rank = 2501)
        val rules = StudyRules(listOf(below, retired, allowed), learner(), setOf(retired.id))
        assertEquals(allowed.cardKey(Skill.Reading), choose(rules)?.key)
    }

    @Test fun `daily meaning and gender caps are separate and siblings need no meaning allowance`() {
        val noun = entry("noun", gender = Gender.Feminine)
        val learner = learner(mapOf(
            noun.cardKey(Skill.Reading) to card(1, 3600),
            noun.cardKey(Skill.Listening) to card(2, 3600),
        ))
        learner.introduced = StudyPolicy.NEW_SENSES
        learner.genderIntroduced = StudyPolicy.NEW_GENDER_CARDS
        val rules = StudyRules(listOf(noun, entry("fresh")), learner, emptySet())
        assertEquals(noun.cardKey(Skill.Production), choose(rules)?.key)
        learner.bury(noun.cardKey(Skill.Production), day)
        assertNull(choose(rules))
        learner.genderIntroduced--
        assertEquals(noun.cardKey(Skill.Gender), choose(rules)?.key)
        learner.genderIntroduced++
        learner.introduced--
        assertEquals("fresh:Reading", choose(rules)?.key)
    }

    @Test fun `extra block quota survives daily caps and used allowances`() {
        val fresh = entry("fresh")
        val learner = learner()
        learner.seconds = 900
        learner.introduced = 99
        learner.genderIntroduced = 99
        val rules = StudyRules(listOf(fresh), learner, emptySet())
        val block = PracticeBlock.extra(900, ExtraMinutes.Five)
        assertEquals(fresh.cardKey(Skill.Reading), choose(rules, block)?.key)
        val used = block.introduced(true, false).introduced(true, false)
        assertNull(choose(rules, used))
        assertEquals(fresh.cardKey(Skill.Reading),
            rules.choose(true, used, SessionLearning(), now, day, allowMoreMeanings = true)?.key)
        learner.seconds = used.end - StudyPolicy.WIND_DOWN_SECONDS
        assertNull(rules.choose(true, used, SessionLearning(), now, day, allowMoreMeanings = true))
    }

    @Test fun `wind down stops introductions and returns only eligible learning cleanup after the target`() {
        val learning = entry("learning")
        val review = entry("review")
        val learner = learner(mapOf(
            learning.cardKey(Skill.Reading) to card(1, 3600, State.LEARNING),
            review.cardKey(Skill.Reading) to card(2, -1),
        ))
        val rules = StudyRules(listOf(entry("fresh"), learning, review), learner, emptySet())
        val session = SessionLearning().apply { reviewed(learning.cardKey(Skill.Reading), true, Rating.GOOD) }
        learner.seconds = 780
        assertEquals(review.cardKey(Skill.Reading), choose(rules, session = session)?.key)
        learner.bury(review.cardKey(Skill.Reading), day)
        assertEquals(learning.cardKey(Skill.Reading), choose(rules, session = session)?.key)
        learner.seconds = 900
        assertEquals(learning.cardKey(Skill.Reading), choose(rules, session = session)?.key)
        learner.pause(learning.cardKey(Skill.Reading), now.toEpochMilli() + 1)
        assertNull(choose(rules, session = session))
        assertNull(choose(rules))
    }

    @Test fun `cleanup skips graduated buried and suspended cards and failures rotate`() {
        val entries = (0..3).map { entry("word-$it") }
        val keys = entries.map { it.cardKey(Skill.Reading) }
        val learner = learner(keys.mapIndexed { index, key -> key to card(index, 3600,
            if (index == 0) State.REVIEW else State.LEARNING) }.toMap()) {
            it.put("suspended", JSONObject().put(keys[1], now.toEpochMilli() + 1))
        }
        learner.seconds = 900
        val rules = StudyRules(entries, learner, emptySet())
        val session = SessionLearning()
        keys.forEach { session.reviewed(it, true, Rating.GOOD) }
        assertEquals(keys[2], choose(rules, session = session)?.key)
        session.reviewed(keys[2], false, Rating.AGAIN)
        assertEquals(keys[3], choose(rules, session = session)?.key)
        learner.bury(keys[3], day)
        assertEquals(keys[2], choose(rules, session = session)?.key)
        session.reviewed(keys[2], false, Rating.HARD)
        assertNull(choose(rules, session = session))
    }

    @Test fun `sibling burials cover all meanings of the lexeme but keep the answered card eligible`() {
        val first = entry("first", gender = Gender.Feminine).copy(lemma = "intrigue")
        val related = first.copy(id = "related")
        val unrelated = entry("unrelated")
        val learner = learner(mapOf(first.cardKey(Skill.Reading) to card(1, 0)))
        val rules = StudyRules(listOf(first, related, unrelated), learner, emptySet())
        val siblings = rules.siblingsToBury(Prompt(first, Skill.Reading), placement = false)
        assertEquals(setOf("first:Listening", "first:Production", "first:Gender",
            "related:Reading", "related:Listening", "related:Production", "related:Gender"), siblings.toSet())
        siblings.forEach { learner.bury(it, day) }
        assertEquals(first.cardKey(Skill.Reading), choose(rules)?.key)
    }

    @Test fun `placement buries only the noun gender card`() {
        val noun = entry("noun", gender = Gender.Masculine)
        val plain = entry("plain")
        val rules = StudyRules(listOf(noun, plain), learner(), emptySet())
        assertEquals(listOf("noun:Gender"), rules.siblingsToBury(Prompt(noun, Skill.Listening), placement = true))
        assertEquals(emptyList<String>(), rules.siblingsToBury(Prompt(plain, Skill.Reading), placement = true))
    }

    @Test fun `next offer matches selection with a fresh session and a fresh extra allowance`() {
        val fresh = entry("fresh")
        val learner = learner()
        val rules = StudyRules(listOf(fresh), learner, emptySet())
        assertEquals(NextPractice.Session, offer(rules))
        learner.introduced = 5
        assertEquals(NextPractice.Session, offer(rules))
        learner.seconds = 900
        assertEquals(NextPractice.ExtraBlock, offer(rules))
        val extra = PracticeBlock.extra(900, ExtraMinutes.Ten)
        assertEquals(NextPractice.Session, rules.nextPractice(true, extra, now, day))
        fresh.skills.forEach { learner.bury(fresh.cardKey(it), day) }
        assertEquals(NextPractice.NothingLeft, offer(rules))
    }

    @Test fun `no suitable new vocabulary differs from temporarily blocked siblings`() {
        val entry = entry("known", rank = 1)
        val learner = learner()
        val rules = StudyRules(listOf(entry), learner, emptySet())
        assertEquals(NextPractice.MoreVocabulary, offer(rules))
        answer(learner, Prompt(entry, Skill.Reading), Rating.GOOD)
        entry.skills.forEach { learner.pause(entry.cardKey(it), now.toEpochMilli() + 1) }
        assertEquals(NextPractice.NothingLeft, offer(rules))
        val retired = StudyRules(listOf(entry("retired")), learner(), setOf("retired"))
        assertEquals(NextPractice.MoreVocabulary, offer(retired))
    }

    @Test fun `examples rotate across placement and sentence skills but gender and other meanings do not count`() {
        val entry = entry("rotate").copy(examples = listOf(Example("{Un}."), Example("{Deux}."), Example("{Trois}.")))
        val learner = learner()
        val rules = StudyRules(listOf(entry), learner, emptySet())
        val reading = Prompt(entry, Skill.Reading)
        assertEquals(entry.examples[0], rules.shown(reading, now).example)
        answer(learner, reading, Rating.GOOD, placement = true)
        assertEquals(entry.examples[1], rules.shown(reading, now).example)
        answer(learner, Prompt(entry, Skill.Gender), Rating.GOOD)
        answer(learner, Prompt(entry.copy(id = "other"), Skill.Reading), Rating.GOOD)
        assertEquals(entry.examples[1], rules.shown(reading, now).example)
        answer(learner, Prompt(entry, Skill.Listening, entry.examples[1]), Rating.AGAIN)
        assertEquals(entry.examples[2], rules.shown(reading, now).example)
        answer(learner, Prompt(entry, Skill.Production, entry.examples[2]), Rating.GOOD)
        assertEquals(entry.examples[0], rules.shown(reading, now).example)
    }

    @Test fun `return after a pause avoids recent contexts and resumes rotation after an answer`() {
        val entry = entry("return").copy(examples = listOf(Example("{Un}."), Example("{Deux}."), Example("{Trois}.")))
        val learner = learner()
        val rules = StudyRules(listOf(entry), learner, emptySet())
        val prompt = Prompt(entry, Skill.Reading)
        listOf(0, 1, 0, 1).forEachIndexed { index, example ->
            answer(learner, prompt.copy(example = entry.examples[example]), Rating.AGAIN, at = now.minusSeconds(10L - index))
        }
        learner.pause(prompt.key, now.toEpochMilli())
        assertEquals(entry.examples[1], rules.shown(prompt, now.minusMillis(1)).example)
        assertEquals(entry.examples[2], rules.shown(prompt, now).example)
        answer(learner, prompt.copy(example = entry.examples[2]), Rating.GOOD)
        assertEquals(entry.examples[2], rules.shown(prompt, now).example)
    }

    @Test fun `return examples use chronological recent history even if sync appended older reviews`() {
        val entry = entry("return").copy(examples = listOf(Example("{Un}."), Example("{Deux}."), Example("{Trois}.")))
        val learner = learner()
        val prompt = Prompt(entry, Skill.Reading)
        listOf(0 to 1L, 1 to 2L, 1 to 3L, 1 to 4L, 2 to 100L).forEach { (example, age) ->
            answer(learner, prompt.copy(example = entry.examples[example]), Rating.AGAIN, at = now.minusSeconds(age))
        }
        learner.pause(prompt.key, now.toEpochMilli())
        assertEquals(entry.examples[2], StudyRules(listOf(entry), learner, emptySet()).shown(prompt, now).example)
    }

    @Test fun `four consecutive failures pause only that card for three days and success clears the streak`() {
        val entry = entry("failure")
        val key = entry.cardKey(Skill.Reading)
        val learner = learner(mapOf(key to card(1, -1)))
        val rules = StudyRules(listOf(entry), learner, emptySet())
        repeat(3) { assertFalse(learner.recordRecall(key, Rating.AGAIN, now)) }
        assertEquals(3, learner.failures(key))
        assertEquals(key, choose(rules)?.key)
        assertFalse(learner.recordRecall(key, Rating.HARD, now))
        assertEquals(0, learner.failures(key))
        repeat(3) { assertFalse(learner.recordRecall(key, Rating.AGAIN, now)) }
        assertTrue(learner.recordRecall(key, Rating.AGAIN, now))
        assertEquals(0, learner.failures(key))
        assertEquals(now.plusSeconds(3 * 86400L).toEpochMilli(), learner.pausedUntil(key))
        assertEquals(0, rules.dueCount(true, now))
        assertTrue(entry.cardKey(Skill.Listening) in rules.prompts(true, now).map { it.key })
        assertEquals(1, rules.dueCount(true, now.plusSeconds(3 * 86400L)))
        val reloaded = Learner(JSONObject(learner.document.toString()))
        assertEquals(learner.pausedUntil(key), reloaded.pausedUntil(key))
        assertEquals(0, reloaded.failures(key))
    }

    private fun entry(id: String, rank: Int = 2501, topic: String = "daily", gender: Gender? = null) =
        Entry(id, id, id, "Un mot.", listOf(Example("Voici {$id}.")), topic, rank = rank, gender = gender)

    private fun learner(cards: Map<String, Card> = emptyMap(), edit: (JSONObject) -> Unit = {}): Learner =
        Learner(JSONObject().put("version", 2).put("day", day).put("cards", JSONObject().apply {
            cards.forEach { (key, card) -> put(key, card.toJson()) }
        }).put("reviews", JSONArray()).also(edit))

    private fun card(id: Int, dueIn: Long, state: State = State.REVIEW): Card = Card.builder().cardId(id)
        .state(state).stability(10.0).difficulty(5.0).due(now.plusSeconds(dueIn)).lastReview(now.minusSeconds(86400)).build()

    private fun choose(rules: StudyRules, block: PracticeBlock = PracticeBlock.DAILY, session: SessionLearning = SessionLearning()) =
        rules.choose(true, block, session, now, day)

    private fun offer(rules: StudyRules) = rules.nextPractice(true, PracticeBlock.DAILY, now, day)

    private fun answer(learner: Learner, prompt: Prompt, rating: Rating, placement: Boolean = false, at: Instant = now) {
        val scheduler = Scheduler.builder().desiredRetention(0.9).build()
        val result = scheduler.reviewCard(learner.card(prompt.key) ?: learner.newCard(), rating, at)
        learner.answered(prompt.key, result.card(), result.reviewLog(), prompt.example, placement)
    }
}
