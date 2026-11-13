package com.randspy.langocard

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import com.google.ai.edge.litertlm.SamplerConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.net.URI
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Gemma 4 E2B running on this phone through LiteRT-LM. The model (2.6 GB) is downloaded
 * once, only when the learner asks, from a pinned Hugging Face revision and checked
 * against its SHA-256. After that it works offline, and nothing the learner types leaves
 * the device. The only place in the app that knows about LiteRT-LM or the model file.
 *
 * One per process, so a download keeps going while the learner uses other pages.
 */
class OnDeviceModel private constructor(context: Context) {
    sealed interface Availability {
        /** This phone has too little memory to run the model. */
        data object Unavailable : Availability
        /** The model can be downloaded; [problem] explains why the last attempt failed. */
        data class Downloadable(val problem: String? = null) : Availability
        data class Downloading(val progress: Float) : Availability
        data object Available : Availability
    }

    private val app = context.applicationContext
    private val file = ModelFile(java.io.File(app.filesDir, "models"), FILE, SIZE, SHA256)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _availability = MutableStateFlow(
        when {
            !enoughMemory() -> Availability.Unavailable
            file.ready -> Availability.Available
            else -> Availability.Downloadable()
        }
    )
    val availability: StateFlow<Availability> = _availability.asStateFlow()

    /** Starts the download unless it is already running or done. Survives leaving the page. */
    fun download() {
        if (_availability.value !is Availability.Downloadable) return
        _availability.value = Availability.Downloading(0f)
        scope.launch {
            _availability.value = try {
                // Keep 200 MB free for the rest of the phone. Plain free space is enough: the model is stored once, not cached.
                @SuppressLint("UsableSpace")
                val free = app.filesDir.usableSpace
                if (free < file.remaining + 200L * 1024 * 1024) {
                    throw IOException("Not enough free storage: the model needs %.1f GB".format(file.remaining / 1e9))
                }
                file.download(::open) { _availability.value = Availability.Downloading(it) }
                Availability.Available
            } catch (e: Exception) {
                Availability.Downloadable(e.message ?: "Download failed")
            }
        }
    }

    // LiteRT-LM wants one thread to own the engine; the mutex keeps a draft and a release from overlapping.
    private val engineThread = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val engineLock = Mutex()
    private var engine: Engine? = null

    /** The model's reply to [prompt]. Loads the model on first use (a few seconds). */
    suspend fun generate(prompt: String): String = engineLock.withLock {
        withContext(engineThread) {
            val conversation = loaded().createConversation(ConversationConfig(
                // Low temperature keeps replies close to the requested JSON shape; a fresh seed lets a retry or Regenerate differ.
                samplerConfig = SamplerConfig(topK = 40, topP = 0.95, temperature = 0.2, seed = kotlin.random.Random.nextInt()),
            ))
            try { reply(conversation, prompt) } finally { conversation.close() }
        }
    }

    /** Frees the loaded model's memory (about 2–3 GB); it loads again on the next [generate]. */
    fun release() {
        scope.launch { engineLock.withLock { withContext(engineThread) { engine?.close(); engine = null } } }
    }

    /** Deletes the downloaded model to free its storage. It can be downloaded again. */
    fun remove() {
        if (_availability.value != Availability.Available) return
        scope.launch {
            engineLock.withLock { withContext(engineThread) { engine?.close(); engine = null } }
            file.delete()
            _availability.value = Availability.Downloadable()
        }
    }

    private fun loaded(): Engine {
        engine?.let { return it }
        check(file.ready) { "Download the on-device AI model first" }
        fun start(backend: Backend) = Engine(EngineConfig(modelPath = file.path, backend = backend, maxNumTokens = 2048, cacheDir = app.cacheDir.path))
            .also { it.initialize() }
        // The GPU is much faster; phones without OpenCL fall back to the CPU.
        val started = try { start(Backend.GPU()) } catch (_: Exception) { start(Backend.CPU()) }
        return started.also { engine = it }
    }

    /** Streams one reply. Cancelling stops the model and waits for it, so the conversation is never closed mid-reply. */
    private suspend fun reply(conversation: Conversation, prompt: String): String {
        val finished = CompletableDeferred<Unit>()
        try {
            return suspendCancellableCoroutine { continuation ->
                val text = StringBuilder()
                conversation.sendMessageAsync(prompt, object : MessageCallback {
                    override fun onMessage(message: Message) { text.append(message.toString()) }
                    override fun onDone() { finished.complete(Unit); continuation.resume(text.toString()) }
                    override fun onError(throwable: Throwable) {
                        finished.complete(Unit)
                        if (continuation.isActive) continuation.resumeWithException(throwable)
                    }
                })
                continuation.invokeOnCancellation { conversation.cancelProcess() }
            }
        } catch (e: CancellationException) {
            withContext(NonCancellable) { withTimeoutOrNull(5_000) { finished.await() } }
            throw e
        }
    }

    private fun open(offset: Long): ModelFile.Transfer {
        val connection = URI(URL).toURL().openConnection() as HttpsURLConnection
        // Hugging Face redirects to its CDN (HTTPS to HTTPS); the SHA-256 check makes the source irrelevant to integrity.
        connection.instanceFollowRedirects = true
        connection.connectTimeout = 15_000; connection.readTimeout = 30_000
        if (offset > 0) connection.setRequestProperty("Range", "bytes=$offset-")
        return when (val code = connection.responseCode) {
            200 -> ModelFile.Transfer(connection.inputStream, resumed = false)
            206 -> ModelFile.Transfer(connection.inputStream, resumed = true)
            else -> { connection.disconnect(); throw IOException("Model download returned HTTP $code") }
        }
    }

    private fun enoughMemory(): Boolean {
        val info = ActivityManager.MemoryInfo()
        app.getSystemService(ActivityManager::class.java).getMemoryInfo(info)
        return info.totalMem >= MIN_MEMORY
    }

    companion object {
        private const val FILE = "gemma-4-E2B-it.litertlm"
        private const val REVISION = "2d74ac41a33d7da82f39f7d5720a04c68514a103"
        private const val URL = "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/$REVISION/$FILE"
        private const val SIZE = 2_588_147_712L
        private const val SHA256 = "181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c"
        /** Phones sold with 6 GB report a little less. */
        private const val MIN_MEMORY = 5_500_000_000L

        // Holds only the application context, which lives as long as the process.
        @SuppressLint("StaticFieldLeak")
        @Volatile private var instance: OnDeviceModel? = null
        fun get(context: Context): OnDeviceModel =
            instance ?: synchronized(this) { instance ?: OnDeviceModel(context).also { instance = it } }
    }
}
