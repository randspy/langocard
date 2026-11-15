package com.randspy.langocard

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PracticeBlockTest {
    @Test fun `the daily target is today's block when nothing extra was picked`() {
        val block = PracticeBlock.read(JSONObject(), "2026-11-15", 300)
        assertEquals(PracticeBlock.DAILY, block)
        assertEquals(15 * 60, block.end)
        assertFalse(block.isExtra)
    }

    @Test fun `an extra block starts where the learner is, so a cleanup overrun does not shorten it`() {
        val block = PracticeBlock.extra(1020, ExtraMinutes.Ten)
        assertEquals(1020, block.start)
        assertEquals(1620, block.end)
        assertEquals(10, block.minutes)
        assertTrue(block.isExtra)
    }

    @Test fun `wind-down and cleanup are measured from an extra block's own end`() {
        val limit = PracticeBlock.extra(1020, ExtraMinutes.Ten).end
        assertTrue(StudyPolicy.introductionsOpen(1499, limit))
        assertFalse(StudyPolicy.introductionsOpen(1500, limit))
        assertTrue(StudyPolicy.sessionOpen(false, 1619, limit))
        assertFalse(StudyPolicy.sessionOpen(false, 1620, limit))
        assertTrue(StudyPolicy.sessionOpen(false, 1739, limit, cleanup = true))
        assertFalse(StudyPolicy.sessionOpen(false, 1740, limit, cleanup = true))
        assertTrue(StudyPolicy.canIntroduce(0, 1499, 4, limit))
        assertFalse(StudyPolicy.canIntroduce(0, 1499, 5, limit))
    }

    @Test fun `a block written on another day reads as the daily target`() {
        val data = JSONObject()
        val block = PracticeBlock.extra(900, ExtraMinutes.Five)
        block.write(data, "2026-11-14")
        assertEquals(block, PracticeBlock.read(data, "2026-11-14", 900))
        assertEquals(PracticeBlock.DAILY, PracticeBlock.read(data, "2026-11-15", 900))
    }

    @Test fun `a block above today's counter reads as the daily target`() {
        val data = JSONObject()
        val block = PracticeBlock.extra(1020, ExtraMinutes.Fifteen)
        block.write(data, "2026-11-15")
        assertEquals(block, PracticeBlock.read(data, "2026-11-15", 1020))
        assertEquals(PracticeBlock.DAILY, PracticeBlock.read(data, "2026-11-15", 0))
    }

    @Test fun `a stored length that is not on offer reads as the daily target`() {
        val data = JSONObject()
        PracticeBlock(1020, 1020 + 7 * 60).write(data, "2026-11-15")
        assertEquals(PracticeBlock.DAILY, PracticeBlock.read(data, "2026-11-15", 1100))
    }

    @Test fun `the header counts minutes into the block`() {
        assertEquals(3, PracticeBlock.extra(900, ExtraMinutes.Ten).minutesIn(1080))
    }

    @Test fun `every extra length leaves time to introduce before its wind-down`() {
        ExtraMinutes.entries.forEach { assertTrue(it.name, it.seconds > StudyPolicy.WIND_DOWN_SECONDS) }
    }
}
