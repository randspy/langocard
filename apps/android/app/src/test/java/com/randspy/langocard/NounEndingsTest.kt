package com.randspy.langocard

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class NounEndingsTest {
    @Test fun `shared cases teach matches and exceptions without guessing elided gender`() {
        val cases = fixtures().getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val gender = Gender.entries.firstOrNull { it.json == c.optString("gender") }
            val match = NounEndings.match(c.getString("word"), gender)
            if (c.isNull("ending")) assertNull(c.toString(), match)
            else {
                assertEquals(c.toString(), c.getString("ending"), match?.rule?.ending)
                assertEquals(c.toString(), c.getBoolean("follows"), match?.follows)
                assertTrue(match!!.feedback.contains(if (match.follows) "follows the rule" else "an exception"))
            }
        }
    }

    @Test fun `every shipped noun is audited against the advertised tendencies`() {
        val assets = File("src/main/assets")
        val nouns = assets.resolve("pilot.tsv").readLines().filter { it.isNotBlank() }.map { line ->
            val word = line.split('|')[1]
            word to Gender.ofArticle(word)
        }.toMutableList()
        (listOf(assets.resolve("frequent-pack.json")) + File("../../../content").listFiles()!!.filter {
            it.name.startsWith("fr-source-") && it.extension == "json"
        }).forEach { file ->
            val entries = JSONObject(file.readText()).getJSONArray("entries")
            for (i in 0 until entries.length()) {
                val e = entries.getJSONObject(i)
                nouns.add(e.getString("word") to Gender.read(e, e.getString("word")))
            }
        }
        val unique = nouns.filter { it.second != null }.distinctBy { Gender.noun(it.first) to it.second }
        val exceptions = unique.filter { (word, gender) -> NounEndings.match(word, gender)?.follows == false }
        assertEquals(listOf("image"), exceptions.map { Gender.noun(it.first) }.sorted())
        val audited = fixtures().getJSONArray("rules")
        assertEquals(NounEndings.rules.size, audited.length())
        for (i in 0 until audited.length()) {
            val expected = audited.getJSONObject(i)
            val rule = NounEndings.rules.single { it.ending == expected.getString("ending") }
            assertEquals(expected.getString("gender"), rule.gender.json)
            val matched = unique.mapNotNull { (word, gender) -> NounEndings.match(word, gender) }.filter { it.rule == rule }
            assertEquals(rule.ending, expected.getInt("total"), matched.size)
            assertEquals(rule.ending, expected.getInt("follows"), matched.count { it.follows })
            assertTrue(rule.ending, matched.count { it.follows }.toDouble() / matched.size >= 0.9)
        }
    }

    private fun fixtures() = JSONObject(File("../../../content/noun-ending-fixtures.json").readText())
}
