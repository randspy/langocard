package com.randspy.langocard

import android.app.Application
import android.content.Context
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.randspy.langocard.ui.theme.LangocardTheme
import io.github.openspacedrepetition.Card
import io.github.openspacedrepetition.Rating
import io.github.openspacedrepetition.State
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.time.Instant

class PresentationFlowTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private lateinit var folder: File
    private lateinit var model: LearningModel
    private lateinit var speech: FrenchSpeech

    private class IsolatedApp(context: Context, private val folder: File) : Application() {
        init { attachBaseContext(context) }
        override fun getFilesDir() = folder
    }

    @Before fun prepare() {
        folder = File(instrumentation.targetContext.cacheDir, "presentation-${System.nanoTime()}").apply { mkdirs() }
        instrumentation.runOnMainSync {
            model = LearningModel(IsolatedApp(instrumentation.targetContext, folder))
            model.skipPlacement()
            model.library.setMinimumRank(1)
            speech = FrenchSpeech(instrumentation.targetContext)
        }
    }

    @After fun close() {
        instrumentation.runOnMainSync { speech.close() }
        folder.deleteRecursively()
    }

    private fun show() = compose.setContent { LangocardTheme { PilotApp(model, speech) {} } }

    private fun start(skill: Skill, kind: SessionKind = SessionKind.Practice, spentSeconds: Int = 0) {
        instrumentation.runOnMainSync {
            val entry = model.library.entries.first { it.gender != null }
            val backup = JSONObject(model.library.backup())
            val card = Card.builder().cardId(1).state(State.REVIEW).stability(10.0).difficulty(5.0)
                .due(Instant.now().minusSeconds(3600)).lastReview(Instant.now().minusSeconds(86400)).build()
            backup.getJSONObject("data")
                .put("cards", JSONObject().put(entry.cardKey(skill), card.toJson()))
                .put("day", StudyPolicy.date(Instant.now()))
                .put("seconds", spentSeconds)
            model.restore(backup.toString())
            model.start(kind, audio = true)
            assertEquals(skill, model.review.card.prompt.skill)
        }
    }

    @Test fun practiceCountdownUpdatesWhileTheSameCardIsOpen() {
        start(Skill.Reading, spentSeconds = StudyPolicy.DAILY_SECONDS - 123)
        val card = model.review.card
        show()
        compose.onNodeWithText("3 min left").assertIsDisplayed()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithText("2 min left").fetchSemanticsNodes().isNotEmpty()
        }
        compose.runOnIdle { assertEquals(card, model.review.card) }
    }

    @Test fun typedAnswerRequiresConfirmationAndTheNextCardHasFreshPresentation() {
        start(Skill.Production)
        val answer = model.review.card.prompt.example.answer
        show()
        compose.onNodeWithText("Your answer (optional)").performTextInput(answer)
        compose.onNodeWithText("Reveal answer").performClick()
        compose.onNodeWithText("Confirm rating").assertIsDisplayed()
        compose.onNodeWithText("Good").assertIsSelected()
        compose.runOnIdle { assertEquals(0, model.sessionReviews) }
        compose.onNodeWithText("Easy").performClick()
        compose.onNodeWithText("Easy").assertIsSelected()
        compose.runOnIdle { assertEquals(Rating.EASY, model.review.card.ratingToConfirm) }
        compose.onNodeWithText("Confirm rating").performClick()
        compose.runOnIdle {
            assertEquals(1, model.sessionReviews)
            assertFalse(model.review.card.revealed)
            assertEquals("", model.review.card.typed)
            assertNull(model.review.card.ratingToConfirm)
        }
    }

    @Test fun readingRevealsForDirectRatingAndFinishShowsThePracticeSummary() {
        start(Skill.Reading)
        show()
        compose.onNodeWithText("Your answer (optional)").assertDoesNotExist()
        compose.onNodeWithText("Good").assertIsNotEnabled()
        compose.onNodeWithText("Reveal answer").performClick()
        compose.onNodeWithText("Good").performClick()
        compose.runOnIdle { assertEquals(1, model.sessionReviews) }
        compose.onNodeWithText("Finish session").performScrollTo().performClick()
        compose.onNodeWithText("Done for today").assertIsDisplayed()
        compose.onNodeWithText("Back to home").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(LearningScreen.Home, model.screen) }
    }

    @Test fun genderChoiceRevealsAndNextRecordsItsAutomaticGrade() {
        start(Skill.Gender)
        val expected = model.review.card.prompt.entry.gender!!
        show()
        compose.onNodeWithText("Reveal answer").assertDoesNotExist()
        compose.onNodeWithText(expected.article).performClick()
        compose.onNodeWithText("Next").assertIsDisplayed()
        compose.runOnIdle {
            assertTrue(model.review.card.revealed)
            assertEquals(Rating.GOOD, model.review.card.ratingToConfirm)
            assertEquals(0, model.sessionReviews)
        }
        compose.onNodeWithText("Next").performClick()
        compose.runOnIdle { assertEquals(1, model.sessionReviews) }
    }

    @Test fun listeningCannotRevealBeforePlaybackAndSkippingLeavesItsScheduleUntouched() {
        start(Skill.Listening)
        val prompt = model.review.card.prompt
        val before = model.state(prompt)!!.toJson()
        show()
        compose.onNodeWithText("Reveal answer").assertIsNotEnabled()
        compose.onNodeWithText("Skip listening").performScrollTo().performClick()
        compose.runOnIdle {
            assertTrue(model.listeningMuted)
            assertNotEquals(Skill.Listening, model.review.card.prompt.skill)
            assertEquals(before, model.state(prompt)!!.toJson())
            assertFalse(model.review.card.revealed)
        }
    }

    @Test fun placementPauseKeepsItsSessionKindAndHomeDiscardsTheCard() {
        start(Skill.Reading, SessionKind.Placement)
        show()
        compose.onNodeWithText("Pause placement").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(LearningScreen.Summary(SessionKind.Placement), model.screen) }
        compose.onNodeWithText("Back to home").performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals(LearningScreen.Home, model.screen)
            model.presentCard { it.type("ignored") }
            assertEquals(LearningScreen.Home, model.screen)
        }
    }

    private fun open(label: String) {
        val menu = compose.onNodeWithContentDescription("Open side menu")
        if (!menu.isDisplayed()) menu.performScrollTo()
        menu.performClick()
        compose.onNodeWithText(label).performScrollTo().performClick()
    }

    @Test fun drawerRoutesLibraryToolsReadingAndVocabularyPlacement() {
        show()
        open("My vocabulary")
        compose.onNodeWithText("French or English").assertExists()
        open("Add an entry")
        compose.onNodeWithText("Save entry").performScrollTo().assertExists()
        open("Vocabulary packs")
        compose.onNodeWithText("Import vocabulary pack").performScrollTo().assertIsDisplayed()
        open("Backup & restore")
        compose.onNodeWithText("Restore backup").performScrollTo().assertIsDisplayed()
        open("Cloud sync")
        compose.onNodeWithText("Keep your progress in your own Convex deployment and share it between devices. Studying always works offline; changes sync when the app opens and after each session.").assertIsDisplayed()
        open("Export to Anki")
        compose.onNodeWithText("Export cards to Anki").assertIsDisplayed()
        open("Content sources")
        compose.onNodeWithText("Original starter material and source-aligned dictionary packs are kept separate from your learning history. Dictionary packs are structurally checked, not independently language-reviewed.").assertIsDisplayed()
        open("Reading passage")
        compose.onNodeWithText("Read for meaning. Foreground reading and listening count toward your daily 15 minutes. Card schedules stay unchanged.").assertIsDisplayed()
        open("Vocabulary starting check")
        compose.onNodeWithText("Yes, I know it").performClick()
        compose.onNodeWithText("Pause and save").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(1, model.vocabularyAnswers.size) }
    }
}
