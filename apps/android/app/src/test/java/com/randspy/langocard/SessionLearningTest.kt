package com.randspy.langocard

import io.github.openspacedrepetition.Rating
import org.junit.Assert.*
import org.junit.Test

class SessionLearningTest {
    @Test fun `new meanings and siblings stop at the wind down boundary`() {
        val boundary = StudyPolicy.DAILY_SECONDS - StudyPolicy.WIND_DOWN_SECONDS
        assertTrue(StudyPolicy.introductionsOpen(boundary - 1))
        assertFalse(StudyPolicy.introductionsOpen(boundary))
        assertFalse(StudyPolicy.canIntroduce(0, boundary, 0))
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
        val cap = StudyPolicy.DAILY_SECONDS + StudyPolicy.CLEANUP_SECONDS
        assertTrue(StudyPolicy.sessionOpen(false, cap - 1, cleanup = true))
        assertFalse(StudyPolicy.sessionOpen(false, cap, cleanup = true))
        assertTrue(StudyPolicy.sessionOpen(true, cap, cleanup = true))
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
