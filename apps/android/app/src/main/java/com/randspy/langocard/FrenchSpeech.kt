package com.randspy.langocard

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

class FrenchSpeech(context: Context) {
    var available by mutableStateOf(false); private set
    var message by mutableStateOf("Checking offline French voice…"); private set
    var speaking by mutableStateOf(false); private set
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private var engine: TextToSpeech? = null
    init {
        engine = TextToSpeech(context) { status -> main.post {
            if (status == TextToSpeech.SUCCESS) {
                val voice = engine?.voices?.filter { it.locale.language == "fr" && !it.isNetworkConnectionRequired }
                    ?.sortedByDescending { if (it.locale.country == "FR") 1000 + it.quality else it.quality }?.firstOrNull()
                if (voice != null && engine?.setVoice(voice) == TextToSpeech.SUCCESS) {
                    available = true; message = "Offline synthetic French · ${voice.locale.toLanguageTag()}"
                } else message = "Install an offline French voice in Android speech settings, then reopen Langocard."
                engine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String?) { main.post { speaking = true } }
                    override fun onDone(id: String?) { main.post { speaking = false } }
                    @Deprecated("Android callback")
                    override fun onError(id: String?) { main.post {
                        speaking = false; available = false; message = "French audio failed. Check your installed offline voice."
                    } }
                })
            } else message = "Speech engine unavailable. Reading and speaking practice still work."
        } }
    }
    fun say(text: String): Boolean {
        if (!available) return false
        speaking = true
        val success = engine?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "french") == TextToSpeech.SUCCESS
        if (!success) { speaking = false; available = false; message = "Could not play French audio. Check Android speech settings." }
        return success
    }
    fun stop() { engine?.stop(); speaking = false }
    fun close() { engine?.shutdown() }
}
