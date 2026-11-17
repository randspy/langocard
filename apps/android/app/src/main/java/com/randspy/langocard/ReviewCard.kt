package com.randspy.langocard

import io.github.openspacedrepetition.Rating

/** Transient answer interaction for one shown prompt, separate from its durable FSRS card. */
class ReviewCard private constructor(val prompt: Prompt, val response: Response) {
    sealed interface Response {
        data object Reading : Response
        data class Production(val typed: String = "") : Response
        data class Listening(val typed: String = "", val played: Boolean = false) : Response
        data class GenderQuestion(val expected: Gender) : Response
        data object Recalled : Response
        data class Compared(val comparison: TypedAnswer, val selected: Rating) : Response
        data class GenderAnswer(val expected: Gender, val chosen: Gender) : Response
    }

    val revealed get() = when (response) {
        Response.Recalled, is Response.Compared, is Response.GenderAnswer -> true
        else -> false
    }
    val typed get() = when (response) {
        is Response.Production -> response.typed
        is Response.Listening -> response.typed
        else -> ""
    }
    val played get() = (response as? Response.Listening)?.played == true ||
        (prompt.skill == Skill.Listening && revealed)
    val comparison get() = (response as? Response.Compared)?.comparison
    val chosen get() = (response as? Response.GenderAnswer)?.chosen
    val ratingToConfirm get() = when (response) {
        is Response.Compared -> response.selected
        is Response.GenderAnswer -> response.expected.grade(response.chosen)
        else -> null
    }

    fun type(text: String): ReviewCard = with(when (response) {
        is Response.Production -> response.copy(typed = text.take(200))
        is Response.Listening -> response.copy(typed = text.take(200))
        else -> response
    })

    /** Only successful playback unlocks listening; a failed replay does not undo it. */
    fun played(success: Boolean): ReviewCard = with(when (response) {
        is Response.Listening -> response.copy(played = response.played || success)
        else -> response
    })

    fun canReveal(audioAvailable: Boolean, speaking: Boolean): Boolean = when (response) {
        Response.Reading, is Response.Production -> true
        is Response.Listening -> response.played && audioAvailable && !speaking
        else -> false
    }

    /** Freezes typed feedback and its suggested rating when the answer is revealed. */
    fun reveal(audioAvailable: Boolean, speaking: Boolean): ReviewCard {
        if (!canReveal(audioAvailable, speaking)) return this
        val comparison = TypedAnswer.of(typed, prompt.example, prompt.entry.gender != null)
        return with(comparison?.let { Response.Compared(it, it.match.suggested) } ?: Response.Recalled)
    }

    fun choose(gender: Gender): ReviewCard = with(when (response) {
        is Response.GenderQuestion -> Response.GenderAnswer(response.expected, gender)
        else -> response
    })

    fun select(rating: Rating): ReviewCard = with(when (response) {
        is Response.Compared -> response.copy(selected = rating)
        else -> response
    })

    private fun with(response: Response) = ReviewCard(prompt, response)

    companion object {
        fun question(prompt: Prompt) = ReviewCard(prompt, when (prompt.skill) {
            Skill.Reading -> Response.Reading
            Skill.Production -> Response.Production()
            Skill.Listening -> Response.Listening()
            Skill.Gender -> Response.GenderQuestion(requireNotNull(prompt.entry.gender))
        })
    }
}
