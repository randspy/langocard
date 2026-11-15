package com.randspy.langocard

import io.github.openspacedrepetition.Scheduler
import org.json.JSONObject
import java.time.OffsetDateTime

/** A validated FSRS-6 fit shared by file import, backups and scheduler construction. */
class FittedSettings private constructor(private val json: JSONObject) {
    val retention = json.getDouble("desiredRetention")
    val reviewCount = json.getInt("reviewCount")
    val fitDate = json.getString("fitDate")
    fun scheduler(): Scheduler = Scheduler.builder()
        .parameters(DoubleArray(21) { json.getJSONArray("parameters").getDouble(it) })
        .desiredRetention(retention).build()
    fun toJson() = JSONObject(json.toString())

    companion object {
        fun parse(text: String): FittedSettings {
            val json = try { JSONObject(text) } catch (e: Exception) {
                throw IllegalArgumentException("Settings must be a JSON object", e)
            }
            try {
                require(json.getString("format") == "langocard-fsrs" && json.get("version") == 1) { "Unsupported FSRS settings format or version" }
                val weights = json.getJSONArray("parameters")
                require(weights.length() == 21) { "FSRS-6 requires 21 parameters" }
                val bounds = listOf(
                    0.001..100.0, 0.001..100.0, 0.001..100.0, 0.001..100.0,
                    1.0..10.0, 0.001..4.0, 0.001..4.0, 0.001..0.75,
                    0.0..4.5, 0.0..0.8, 0.001..3.5, 0.001..5.0,
                    0.001..0.25, 0.001..0.9, 0.0..4.0, 0.0..1.0,
                    1.0..6.0, 0.0..2.0, 0.0..2.0, 0.0..0.8, 0.1..0.8)
                for (i in 0 until 21) require(weights.get(i) is Number && weights.getDouble(i) in bounds[i]) { "Parameter ${i + 1} is outside the FSRS-6 range" }
                require(json.get("desiredRetention") is Number && json.getDouble("desiredRetention") in 0.7..0.95) { "Retention must be between 0.70 and 0.95" }
                require(json.get("reviewCount") is Number && json.getDouble("reviewCount") == json.getInt("reviewCount").toDouble() && json.getInt("reviewCount") >= 1000) { "Fit requires at least 1000 reviews" }
                OffsetDateTime.parse(json.getString("fitDate"))
                return FittedSettings(JSONObject(json.toString()))
            } catch (e: IllegalArgumentException) { throw e }
            catch (e: Exception) { throw IllegalArgumentException("Missing or invalid FSRS settings field: ${e.message}", e) }
        }
    }
}
