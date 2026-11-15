package com.randspy.langocard

import android.app.Application
import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import io.github.openspacedrepetition.Rating
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.time.Instant

class SessionCleanupTest {
    private class IsolatedApp(context: Context, private val folder: File) : Application() {
        init { attachBaseContext(context) }
        override fun getFilesDir() = folder
    }

    @Test fun lateFailureReturnsBeforeDueAndSuccessfulRecallEndsSession() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val folder = File(instrumentation.targetContext.cacheDir, "cleanup-${System.nanoTime()}").apply { mkdirs() }
        try {
            instrumentation.runOnMainSync {
                val app = IsolatedApp(instrumentation.targetContext, folder)
                val model = LearningModel(app)
                model.skipPlacement()
                model.start(false, false)
                val key = model.prompt!!.key
                val data = JSONObject(model.backup()).getJSONObject("data")
                data.put("seconds", StudyPolicy.DAILY_SECONDS - StudyPolicy.WIND_DOWN_SECONDS - 1)
                model.restore(JSONObject().put("format", "langocard-backup").put("version", ContentFiles.BACKUP_VERSION).put("data", data).toString())
                model.start(false, false)
                assertEquals(key, model.prompt!!.key)
                LearningModel::class.java.getDeclaredField("lastTick").apply { isAccessible = true }
                    .setLong(model, android.os.SystemClock.elapsedRealtime() - 2000)
                model.tick()
                model.rate(Rating.AGAIN, false)
                // With no other due material or introductions allowed, the same learning card returns early.
                assertEquals(key, model.prompt!!.key)
                assertTrue(model.state(model.prompt!!)!!.due.isAfter(Instant.now()))
                model.rate(Rating.GOOD, false)
                assertEquals("summary", model.screen)
                val reviews = JSONObject(model.backup()).getJSONObject("data").getJSONArray("reviews")
                assertEquals(2, reviews.length())
            }
        } finally { folder.deleteRecursively() }
    }
}
