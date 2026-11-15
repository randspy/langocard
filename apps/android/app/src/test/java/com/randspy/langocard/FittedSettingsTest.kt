package com.randspy.langocard

import io.github.openspacedrepetition.Scheduler
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class FittedSettingsTest {
    private fun fit() = JSONObject().put("format", "langocard-fsrs").put("version", 1)
        .put("parameters", JSONArray(Scheduler.builder().build().parameters.toList()))
        .put("desiredRetention", 0.8).put("reviewCount", 1200)
        .put("fitDate", "2026-11-15T12:00:00Z")

    @Test fun `import builds scheduler with supplied weights and retention`() {
        val json = fit()
        val weights = json.getJSONArray("parameters").put(0, 0.5)
        val settings = FittedSettings.parse(json.toString())
        val scheduler = settings.scheduler()
        assertEquals(0.8, scheduler.desiredRetention, 0.0)
        assertEquals(0.5, scheduler.parameters[0], 0.0)
        assertEquals(weights.toString(), settings.toJson().getJSONArray("parameters").toString())
        assertEquals(1200, settings.reviewCount)
    }

    @Test fun `invalid settings are rejected with a reason`() {
        val invalid = listOf(fit().put("version", 2), fit().put("parameters", JSONArray()),
            fit().put("desiredRetention", 1.0), fit().put("reviewCount", 999),
            fit().put("fitDate", "yesterday"), fit().apply { getJSONArray("parameters").put(20, 0.0) })
        invalid.forEach {
            try { FittedSettings.parse(it.toString()); fail("Accepted invalid settings") }
            catch (e: IllegalArgumentException) { assertTrue(e.message!!.isNotBlank()) }
        }
    }
}
