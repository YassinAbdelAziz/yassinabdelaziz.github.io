package com.yassinabdelaziz.ystream.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.material3.MaterialTheme

val Background = Color(0xFF0F0F0F)
val SurfaceDark = Color(0xFF1A1A1A)
val SurfaceVariantDark = Color(0xFF242424)
val AccentRed = Color(0xFFFF2E2E)
val TextPrimary = Color(0xFFFFFFFF)
val TextSecondary = Color(0xFF999999)
val RatingGold = Color(0xFFF5C518)

private val YStreamColors = darkColorScheme(
    primary = AccentRed,
    onPrimary = Color.White,
    background = Background,
    onBackground = TextPrimary,
    surface = SurfaceDark,
    onSurface = TextPrimary,
    surfaceVariant = SurfaceVariantDark,
    onSurfaceVariant = TextSecondary,
    secondary = SurfaceVariantDark,
    onSecondary = TextPrimary,
    error = AccentRed,
    onError = Color.White
)

private val YStreamTypography = Typography()

@Composable
fun YStreamTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = YStreamColors,
        typography = YStreamTypography,
        content = content
    )
}
