package com.randspy.langocard

/** A band is a sampled frequency range; -1 identifies an invented control item. */
data class PlacementItem(val word: String, val band: Int)

/** Estimates a conservative starting rank without assessing or scheduling any card. */
class VocabularyPlacement(val items: List<PlacementItem>) {
    init {
        require(items.size == 90 && items.count { it.band == -1 } == 30)
        require((0..2).all { band -> items.count { it.band == band } == 20 })
    }

    fun adjustedHits(answers: List<Boolean>): List<Double> {
        require(answers.size == items.size)
        val falseAlarms = items.indices.count { items[it].band == -1 && answers[it] }
        return (0..2).map { band ->
            (items.indices.count { items[it].band == band && answers[it] } - 20.0 * falseAlarms / 30).coerceAtLeast(0.0)
        }
    }

    fun startingRank(answers: List<Boolean>): Int {
        val hits = adjustedHits(answers)
        return if (hits[0] < 16) 1 else if (hits[1] < 16) 2501 else 7001
    }
}
