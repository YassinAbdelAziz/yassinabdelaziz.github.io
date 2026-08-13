package com.yassinabdelaziz.ystream.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.yassinabdelaziz.ystream.data.YStreamRepository
import com.yassinabdelaziz.ystream.data.model.MediaListItem
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.ui.theme.AccentRed
import com.yassinabdelaziz.ystream.ui.theme.SurfaceVariantDark
import com.yassinabdelaziz.ystream.ui.viewmodel.HomeViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val ROTATE_MS = 6500L

/**
 * The homepage featured carousel, mirroring the website: cinematic full-bleed
 * backdrop slides, slow background zoom, auto-rotation every 6.5s (paused while
 * the user is dragging), tappable dots, swipe support and Watch Now / Watchlist
 * actions alongside the slide's content info.
 */
@Composable
fun HeroCarousel(
    slides: List<HomeViewModel.CarouselSlide>,
    extras: Map<String, YStreamRepository.SlideExtra>,
    onPlay: (MediaListItem) -> Unit,
    onOpenDetail: (MediaType, Long) -> Unit,
    onSlideVisible: (MediaListItem, MediaType) -> Unit,
    isInWatchlist: (MediaListItem) -> Boolean,
    onToggleWatchlist: (MediaListItem) -> Unit
) {
    if (slides.isEmpty()) return

    val pagerState = rememberPagerState(
        initialPage = 0,
        pageCount = { slides.size }
    )

    // Auto-rotation, paused while the user interacts with the carousel.
    LaunchedEffect(pagerState, pagerState.isScrollInProgress) {
        while (true) {
            delay(ROTATE_MS)
            if (pagerState.isScrollInProgress) continue
            val next = (pagerState.currentPage + 1) % slides.size
            pagerState.animateScrollToPage(next)
        }
    }

    // Lazily fill in the active slide's runtime/seasons/genres.
    LaunchedEffect(pagerState.currentPage, slides) {
        val slide = slides.getOrNull(pagerState.currentPage) ?: return@LaunchedEffect
        onSlideVisible(slide.item, slide.type)
    }

    Box {
        HorizontalPager(
            state = pagerState,
            modifier = Modifier
                .fillMaxWidth()
                .height(500.dp)
        ) { page ->
            val slide = slides[page]
            HeroSlide(
                slide = slide,
                extra = extras["${slide.type.tmdb}:${slide.item.id}"],
                onPlay = { onPlay(slide.item) },
                onOpenDetail = { onOpenDetail(slide.type, slide.item.id) },
                inWatchlist = isInWatchlist(slide.item),
                onToggleWatchlist = { onToggleWatchlist(slide.item) }
            )
        }

        val scope = rememberCoroutineScope()
        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            repeat(slides.size) { index ->
                val active = pagerState.currentPage == index
                Box(
                    modifier = Modifier
                        .size(if (active) 22.dp else 7.dp, 7.dp)
                        .clip(RoundedCornerShape(50))
                        .background(if (active) AccentRed else Color(0x66FFFFFF))
                        .clickable { scope.launch { pagerState.scrollToPage(index) } }
                )
            }
        }
    }
}

@Composable
private fun HeroSlide(
    slide: HomeViewModel.CarouselSlide,
    extra: YStreamRepository.SlideExtra?,
    onPlay: () -> Unit,
    onOpenDetail: () -> Unit,
    inWatchlist: Boolean,
    onToggleWatchlist: () -> Unit
) {
    val item = slide.item
    val slowZoom = rememberInfiniteTransition(label = "heroZoom")
    val zoom by slowZoom.animateFloat(
        initialValue = 1.04f,
        targetValue = 1.12f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 20000),
            repeatMode = RepeatMode.Restart
        ),
        label = "heroZoomValue"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .clickable(onClick = onOpenDetail)
    ) {
        AsyncImage(
            model = item.backdropUrl("w1280") ?: item.posterUrl("w780"),
            contentDescription = item.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    scaleX = zoom
                    scaleY = zoom
                }
        )
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            Color(0x66000000),
                            Color.Transparent,
                            Color(0x99000000),
                            Color(0xF20F0F0F)
                        )
                    )
                )
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 18.dp)
        ) {
            Text(
                text = if (slide.type == MediaType.MOVIE) "MOVIE" else "TV SHOW",
                color = AccentRed,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = item.title,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            val meta = buildList {
                item.year?.let { add(it) }
                item.voteAverage?.let { add("★ ${String.format("%.1f", it)}") }
                if (slide.type == MediaType.MOVIE) {
                    (extra?.runtime ?: slide.runtime)?.takeIf { it > 0 }?.let { add("$it min") }
                } else {
                    (extra?.seasons ?: slide.seasons)?.takeIf { it > 0 }?.let { add("$it Season${if (it > 1) "s" else ""}") }
                }
            }
            if (meta.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    meta.forEachIndexed { index, part ->
                        if (index > 0) Text("•", color = Color(0xAAFFFFFF), style = MaterialTheme.typography.bodyMedium)
                        Text(part, color = Color(0xE6FFFFFF), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            val genres = extra?.genres ?: slide.genres
            if (genres.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    genres.take(3).forEach { genre ->
                        Text(
                            text = genre,
                            color = Color.White,
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(SurfaceVariantDark.copy(alpha = 0.9f))
                                .padding(horizontal = 6.dp, vertical = 3.dp)
                        )
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(
                text = item.overview.orEmpty(),
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xE6FFFFFF),
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = onPlay,
                    colors = ButtonDefaults.buttonColors(containerColor = AccentRed)
                ) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text("Watch Now")
                }
                OutlinedButton(
                    onClick = onToggleWatchlist,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)
                ) {
                    Icon(
                        imageVector = if (inWatchlist) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                        contentDescription = null,
                        tint = if (inWatchlist) AccentRed else Color.White,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(if (inWatchlist) "In Watchlist" else "Add to Watchlist")
                }
            }
        }
    }
}
