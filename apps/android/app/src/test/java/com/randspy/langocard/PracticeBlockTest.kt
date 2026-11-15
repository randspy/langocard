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
        data.put("extraBlock", JSONObject().put("day", "2026-11-15").put("start", 1020).put("minutes", 7))
        assertEquals(PracticeBlock.DAILY, PracticeBlock.read(data, "2026-11-15", 1100))
    }

    @Test fun `the header counts minutes into the block`() {
        assertEquals(3, PracticeBlock.extra(900, ExtraMinutes.Ten).minutesIn(1080))
    }

    @Test fun `every extra length leaves time to introduce before its wind-down`() {
        ExtraMinutes.entries.forEach { assertTrue(it.name, it.seconds > StudyPolicy.WIND_DOWN_SECONDS) }
    }
    @Test fun `each length owns separate quotas unaffected by daily counters`() {
        listOf(ExtraMinutes.Five to 2, ExtraMinutes.Ten to 3, ExtraMinutes.Fifteen to 5).forEach { (length, quota) ->
            var block = PracticeBlock.extra(900, length)
            repeat(quota) {
                assertTrue(block.meaningRoom(100))
                block = block.introduced(true, false)
            }
            assertFalse(block.meaningRoom(0))
            repeat(quota) {
                assertTrue(block.genderRoom(100))
                block = block.introduced(false, true)
            }
            assertFalse(block.genderRoom(0))
            val data = JSONObject()
            block.write(data, "2026-11-15")
            assertEquals(block, PracticeBlock.read(data, "2026-11-15", 950))
            assertTrue(PracticeBlock.extra(block.end, length).meaningRoom(100))
        }
        assertTrue(PracticeBlock.DAILY.meaningRoom(4))
        assertFalse(PracticeBlock.DAILY.meaningRoom(5))
        assertTrue(PracticeBlock.DAILY.genderRoom(9))
        assertFalse(PracticeBlock.DAILY.genderRoom(10))
    }

    @Test fun `old and malformed usage fails closed without losing valid duration`() {
        listOf(null, -1, 3, 0.5, "0", JSONObject.NULL).forEach { invalid ->
            val data = JSONObject()
            PracticeBlock.extra(900, ExtraMinutes.Five).write(data, "2026-11-15")
            val saved = data.getJSONObject("extraBlock")
            saved.remove("meaningsUsed"); saved.remove("gendersUsed")
            if (invalid != null) saved.put("meaningsUsed", invalid).put("gendersUsed", invalid)
            repeat(2) {
                val block = PracticeBlock.read(data, "2026-11-15", 950)
                assertEquals(1200, block.end)
                assertFalse(block.meaningRoom(0))
                assertFalse(block.genderRoom(0))
            }
        }
    }

    @Test fun `one corrupt counter closes both allowances`() {
        val data = JSONObject()
        PracticeBlock.extra(900, ExtraMinutes.Ten).write(data, "2026-11-15")
        data.getJSONObject("extraBlock").remove("meaningsUsed")
        val restored = PracticeBlock.read(data, "2026-11-15", 900)
        assertFalse(restored.meaningRoom(0))
        assertFalse(restored.genderRoom(0))
    }

    @Test fun `unused allowance expires with a new grant and repeated answers spend nothing`() {
        val partial = PracticeBlock.extra(900, ExtraMinutes.Five).introduced(true, true)
        assertEquals(partial, partial.introduced(false, false))
        assertTrue(partial.meaningRoom(99))
        val fresh = PracticeBlock.extra(partial.end, ExtraMinutes.Five).introduced(true, true).introduced(true, true)
        assertFalse(fresh.meaningRoom(0))
        assertFalse(fresh.genderRoom(0))
    }

}
