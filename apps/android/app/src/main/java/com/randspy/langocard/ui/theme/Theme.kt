package com.randspy.langocard.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Navy = Color(0xFF44536A)
private val DarkNavy = Color(0xFF2D3443)
private val BrightBlue = Color(0xFFADB7E6)
private val BrightBlueLight = Color(0xFFDADFF3)
private val SoftOrange = Color(0xFFF17463)
private val OffWhite = Color(0xFFFCFCFC)
private val OffWhiteLight = Color(0xFFEEEEEE)
private val SoftBlack = Color(0xFF1E1E1E)
private val Danger = Color(0xFFF02821)
private val Gray50 = Color(0xFFF4F5F6)
private val Gray100 = Color(0xFFE6E8EA)
private val Gray200 = Color(0xFFD1D5D8)
private val Gray300 = Color(0xFFBDC1C6)
private val Gray500 = Color(0xFF8B9095)
private val Gray600 = Color(0xFF6D7277)
private val Gray700 = Color(0xFF51565B)
private val Gray800 = Color(0xFF373B40)

private val LightColors = lightColorScheme(
    primary = Navy, onPrimary = OffWhite,
    primaryContainer = BrightBlueLight, onPrimaryContainer = DarkNavy,
    secondary = BrightBlue, onSecondary = SoftBlack,
    secondaryContainer = BrightBlueLight, onSecondaryContainer = DarkNavy,
    tertiary = SoftOrange, onTertiary = OffWhite,
    background = OffWhite, onBackground = SoftBlack,
    surface = OffWhite, onSurface = SoftBlack,
    surfaceVariant = Gray100, onSurfaceVariant = Gray800,
    surfaceContainerLowest = Color.White, surfaceContainerLow = Gray50, surfaceContainer = Gray100,
    surfaceContainerHigh = Gray100, surfaceContainerHighest = Gray200,
    outline = Gray500, outlineVariant = Gray100,
    error = Danger, onError = Color.White,
    errorContainer = Color(0xFFFFDAD6), onErrorContainer = Color(0xFF8C1D18),
)
private val DarkColors = darkColorScheme(
    primary = BrightBlue, onPrimary = SoftBlack,
    primaryContainer = Navy, onPrimaryContainer = OffWhiteLight,
    secondary = Navy, onSecondary = OffWhiteLight,
    secondaryContainer = Navy, onSecondaryContainer = OffWhiteLight,
    tertiary = SoftOrange, onTertiary = OffWhiteLight,
    background = SoftBlack, onBackground = OffWhiteLight,
    surface = SoftBlack, onSurface = OffWhiteLight,
    surfaceVariant = DarkNavy, onSurfaceVariant = Gray300,
    surfaceContainerLowest = SoftBlack, surfaceContainerLow = Color(0xFF222427), surfaceContainer = Color(0xFF262930),
    surfaceContainerHigh = Color(0xFF292E3A), surfaceContainerHighest = DarkNavy,
    outline = Gray600, outlineVariant = Gray700,
    error = Danger, onError = Color.White,
    errorContainer = Color(0xFF8C1D18), onErrorContainer = Color(0xFFFFDAD6),
)

@Composable
fun LangocardTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors, content = content)
}
