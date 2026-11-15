package com.randspy.langocard

import io.github.openspacedrepetition.Rating
import org.junit.Assert.*
import org.junit.Test

class SessionLearningTest {
    @Test fun `new meanings and siblings stop at the wind down boundary`() {
        val limit = StudyPolicy.DAILY_SECONDS
        val boundary = limit - StudyPolicy.WIND_DOWN_SECONDS
        assertTrue(StudyPolicy.introductionsOpen(boundary - 1, limit))
        assertFalse(StudyPolicy.introductionsOpen(boundary, limit))
    }

    @Test fun `introduced cards need another recall and failures rotate until recalled`() {
        val queue = SessionLearning()
        queue.reviewed("new", true, Rating.GOOD)
        queue.reviewed("failed", false, Rating.AGAIN)
        assertEquals("new", queue.next(listOf("new", "failed")) { true })
        queue.reviewed("new", false, Rating.AGAIN)
        assertEquals("failed", queue.next(listOf("new", "failed")) { true })
        queue.reviewed("failed", false, Rating.HARD)
        assertEquals("new", queue.next(listOf("new", "failed")) { true })
        queue.reviewed("new", false, Rating.GOOD)
        assertNull(queue.next(listOf("new", "failed")) { true })
    }

    @Test fun `cleanup is bounded and placement has no cap`() {
        val limit = StudyPolicy.DAILY_SECONDS
        val cap = limit + StudyPolicy.CLEANUP_SECONDS
        assertTrue(StudyPolicy.sessionOpen(false, cap - 1, limit, cleanup = true))
        assertFalse(StudyPolicy.sessionOpen(false, cap, limit, cleanup = true))
        assertTrue(StudyPolicy.sessionOpen(true, cap, limit, cleanup = true))
    }

    @Test fun `graduated unavailable and previous session cards do not return`() {
        val queue = SessionLearning()
        queue.reviewed("a", true, Rating.GOOD)
        assertNull(queue.next(listOf("a")) { false })
        assertNull(queue.next(emptyList()) { true })
        queue.clear()
        assertNull(queue.next(listOf("a")) { true })
    }
}
