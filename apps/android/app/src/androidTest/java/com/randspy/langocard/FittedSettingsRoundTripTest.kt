package com.randspy.langocard

import android.app.Application
import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import io.github.openspacedrepetition.Scheduler
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class FittedSettingsRoundTripTest {
    private class IsolatedApp(context: Context, private val directory: File) : Application() {
        init { attachBaseContext(context) }
        override fun getFilesDir() = directory
    }
    @Test fun fitPersistsRestoresAndResets() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.cacheDir, "fit-test-${System.nanoTime()}").apply { mkdirs() }
        try {
            instrumentation.runOnMainSync {
                val app = IsolatedApp(instrumentation.targetContext, directory)
                val model = LearningModel(app)
                val defaults = model.library.backup()
                val fit = JSONObject().put("format", "langocard-fsrs").put("version", 1)
                    .put("parameters", JSONArray(Scheduler.builder().build().parameters.toList()))
                    .put("desiredRetention", 0.8).put("reviewCount", 1200).put("fitDate", "2026-11-15T12:00:00Z")
                model.importFittedSettings(fit.toString())
                assertTrue(model.schedulingDescription.contains("80%"))
                assertTrue(LearningModel(app).schedulingDescription.contains("1200 reviews"))
                val backup = model.library.backup()
                try { model.importFittedSettings("{}"); fail("Accepted invalid fit") } catch (_: IllegalArgumentException) { }
                assertEquals(backup, model.library.backup())
                model.resetFittedSettings()
                assertTrue(LearningModel(app).schedulingDescription.contains("defaults"))
                model.restore(backup)
                assertTrue(model.schedulingDescription.contains("1200 reviews"))
                model.restore(defaults)
                assertTrue(model.schedulingDescription.contains("defaults"))
            }
        } finally { directory.deleteRecursively() }
    }
}
