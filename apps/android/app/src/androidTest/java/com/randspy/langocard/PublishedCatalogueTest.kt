package com.randspy.langocard

import android.app.Application
import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Opt-in integration check against the actually published HTTPS catalogue. */
class PublishedCatalogueTest {
    private class IsolatedApp(context: Context, private val folder: File) : Application() {
        init { attachBaseContext(context) }
        override fun getFilesDir() = folder
    }
    @Test fun publishedPacksInstallAndRestoreWithSourceMetadata() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("liveCatalogue") == "true")
        val instrument = InstrumentationRegistry.getInstrumentation()
        val packs = PackManifest.parse(PackDownloads.fetch(PackDownloads.CATALOGUE_URL))
        assertEquals(3, packs.size)
        val downloaded = packs.map { pack ->
            PackDownloads.fetch(pack.url, pack.sha256).also { PackManifest.verifyPayload(it, pack) }
        }
        // A wrong digest must fail before a pack reaches the importer.
        try { PackDownloads.fetch(packs.last().url, "0".repeat(64)); fail("Wrong digest accepted") }
        catch (_: IllegalArgumentException) { }
        val directory = File(instrument.targetContext.cacheDir, "catalogue-test-${System.nanoTime()}").apply { mkdirs() }
        try {
            instrument.runOnMainSync {
                val app = IsolatedApp(instrument.targetContext, directory)
                val model = LearningModel(app)
                assertEquals(701, model.entries.size)
                assertTrue(model.installedPack(packs.first().id))
                packs.forEachIndexed { index, pack ->
                    if (!model.installedPack(pack.id)) assertEquals(pack.meanings, model.importPack(downloaded[index]))
                }
                assertEquals(1316, model.entries.size)
                val backup = model.backup()
                model.restore(backup)
                assertTrue(packs.all { model.installedPack(it.id) })
                assertEquals(1316, LearningModel(app).entries.size)
                val restoredSource = model.entries.first { it.sourceUrl.isNotBlank() }
                assertTrue(restoredSource.rank > 0)
                assertTrue(restoredSource.license.isNotBlank())
                val lines = model.ankiExport().lines().filter { it.isNotBlank() && !it.startsWith('#') }
                assertEquals(2632, lines.size)
                assertEquals(lines.size, lines.map { it.substringBefore('\t') }.distinct().size)
                assertTrue(model.ankiExport().contains("https://fr.wiktionary.org/wiki/"))
            }
        } finally { directory.deleteRecursively() }
    }
}
