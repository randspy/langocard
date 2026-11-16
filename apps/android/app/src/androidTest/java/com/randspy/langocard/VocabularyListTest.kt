package com.randspy.langocard

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Rule
import org.junit.Test

class VocabularyListTest {
    @get:Rule val compose = createComposeRule()
    private val speech = FrenchSpeech(InstrumentationRegistry.getInstrumentation().targetContext)

    @After fun closeSpeech() = speech.close()

    private fun entry(id: String, word: String, english: String, definition: String) =
        Entry(id, word, english, definition, listOf(Example("Voici {$word}.")), "daily")

    @Test fun rowsOpenTogetherAndEachClosesOnASecondTap() {
        val entries = listOf(
            entry("house", "une maison", "a house", "Bâtiment où l'on habite."),
            entry("leave", "partir", "to leave", "Quitter un lieu."),
            entry("however", "pourtant", "however", "Malgré ce qui vient d'être dit."),
        )
        compose.setContent { VocabularyList(entries, speech, Modifier.fillMaxSize()) }

        compose.onNodeWithText("une maison").performClick()
        compose.onNodeWithText("partir").performClick()
        compose.onNodeWithText("Bâtiment où l'on habite.").assertIsDisplayed()
        compose.onNodeWithText("Quitter un lieu.").assertIsDisplayed()

        compose.onNodeWithText("une maison").performClick()
        compose.onNodeWithText("Bâtiment où l'on habite.").assertDoesNotExist()
        compose.onNodeWithText("Quitter un lieu.").assertIsDisplayed()
    }
}
