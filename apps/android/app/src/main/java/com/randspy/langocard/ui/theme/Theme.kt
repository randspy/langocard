package com.randspy.langocard.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFF285B4B), onPrimary = Color.White,
    primaryContainer = Color(0xFFD9EBDD), onPrimaryContainer = Color(0xFF12382D),
    secondary = Color(0xFF806044), background = Color(0xFFF8F7F2),
    surface = Color(0xFFF8F7F2), surfaceContainerLow = Color(0xFFF0EFE7),
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFFA3D2B5), onPrimary = Color(0xFF11382A),
    primaryContainer = Color(0xFF294E3F), onPrimaryContainer = Color(0xFFD9EBDD),
    secondary = Color(0xFFE2BD98), background = Color(0xFF151C18), surface = Color(0xFF151C18),
)

@Composable
fun LangocardTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors, content = content)
}
