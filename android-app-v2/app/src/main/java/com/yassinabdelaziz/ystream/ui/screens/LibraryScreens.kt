package com.yassinabdelaziz.ystream.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.yassinabdelaziz.ystream.data.model.ContinueEntry
import com.yassinabdelaziz.ystream.data.model.MediaListItem
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.ui.components.EmptyState
import com.yassinabdelaziz.ystream.ui.theme.AccentRed
import com.yassinabdelaziz.ystream.ui.theme.RatingGold
import com.yassinabdelaziz.ystream.ui.theme.SurfaceDark
import com.yassinabdelaziz.ystream.ui.theme.SurfaceVariantDark
import com.yassinabdelaziz.ystream.ui.theme.TextSecondary
import com.yassinabdelaziz.ystream.ui.viewmodel.LibraryViewModel

private val Placeholder = ColorPainter(Color(0xFF1E1E1E))

@Composable
fun WatchlistScreen(
    vm: LibraryViewModel,
    onOpenDetail: (MediaType, Long) -> Unit
) {
    val watchlist by vm.watchlist.collectAsState()

    if (watchlist.isEmpty()) {
        EmptyState("Your watchlist is empty.\nOpen a title and tap the heart to save it.")
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        items(watchlist, key = { "${it.type.tmdb}:${it.id}" }) { item ->
            WatchlistFeaturedCard(
                item = item,
                onOpen = { onOpenDetail(item.type, item.id) },
                onToggle = { vm.toggleWatchlist(item) }
            )
        }
    }
}

@Composable
fun ContinueScreen(
    vm: LibraryViewModel,
    onOpenPlayer: (MediaListItem, Int?, Int?) -> Unit
) {
    val continueList by vm.continueWatching.collectAsState()
    val visible = continueList
        .filter { it.positionMs > 0 && it.positionMs >= continueThreshold(it.type) }

    if (visible.isEmpty()) {
        EmptyState("Nothing in Continue Watching.\nPlay something and it will show up here.")
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        items(visible, key = { it.key() }) { entry ->
            ContinueFeaturedCard(
                entry = entry,
                onResume = {
                    onOpenPlayer(
                        MediaListItem(
                            id = entry.id,
                            type = entry.type,
                            title = entry.title,
                            overview = null,
                            posterPath = entry.posterPath,
                            backdropPath = entry.backdropPath,
                            voteAverage = null,
                            year = null
                        ),
                        entry.season,
                        entry.episode
                    )
                },
                onRemove = { vm.removeContinue(entry) }
            )
        }
    }
}

@Composable
private fun FeaturedCardLayout(
    posterPath: String?,
    typeLabel: String,
    title: String,
    year: String?,
    rating: Double?,
    progress: Float?,
    progressLabel: String?,
    onOpen: () -> Unit,
    actionContent: @Composable () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(SurfaceDark)
            .clickable(onClick = onOpen)
            .padding(12.dp),
        verticalAlignment = Alignment.Top
    ) {
        AsyncImage(
            model = posterPath?.let { "https://image.tmdb.org/t/p/w342$it" },
            contentDescription = title,
            placeholder = Placeholder,
            error = Placeholder,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .width(92.dp)
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(8.dp))
                .background(SurfaceVariantDark)
        )
        Spacer(Modifier.size(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = typeLabel,
                color = AccentRed,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            val meta = buildList {
                year?.let { add(it) }
                rating?.let { add("★ ${String.format("%.1f", it)}") }
            }
            if (meta.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    meta.forEach { part ->
                        Text(
                            text = part,
                            color = TextSecondary,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }
            progress?.let { p ->
                Spacer(Modifier.height(10.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(Color(0x14FFFFFF))
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(p.coerceIn(0f, 1f))
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(AccentRed)
                    )
                }
                progressLabel?.let { label ->
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = label,
                        color = TextSecondary,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            actionContent()
        }
    }
}

@Composable
private fun WatchlistFeaturedCard(
    item: MediaListItem,
    onOpen: () -> Unit,
    onToggle: () -> Unit
) {
    FeaturedCardLayout(
        posterPath = item.posterPath,
        typeLabel = if (item.type == MediaType.TV) "TV Show" else "Movie",
        title = item.title,
        year = item.year,
        rating = item.voteAverage,
        progress = null,
        progressLabel = null,
        onOpen = onOpen
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = onOpen,
                modifier = Modifier.weight(1f).height(40.dp),
                colors = ButtonDefaults.buttonColors(containerColor = AccentRed)
            ) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Watch now")
            }
            OutlinedButton(
                onClick = onToggle,
                modifier = Modifier.height(40.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = AccentRed)
            ) {
                Icon(
                    imageVector = Icons.Filled.Favorite,
                    contentDescription = "Remove from watchlist",
                    tint = AccentRed,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}

@Composable
private fun ContinueFeaturedCard(
    entry: ContinueEntry,
    onResume: () -> Unit,
    onRemove: () -> Unit
) {
    val pct = if (entry.durationMs > 0)
        (entry.positionMs.toFloat() / entry.durationMs.toFloat() * 100).toInt().coerceIn(0, 100)
    else null
    val label = buildString {
        if (entry.season != null && entry.episode != null) append("S${entry.season} E${entry.episode} · ")
        if (pct != null) append("$pct% · ")
        append(formatContinuePosition(entry.positionMs))
    }
    FeaturedCardLayout(
        posterPath = entry.posterPath,
        typeLabel = if (entry.type == MediaType.TV) "TV Show" else "Movie",
        title = entry.title,
        year = null,
        rating = null,
        progress = pct?.div(100f),
        progressLabel = if (pct != null) label else null,
        onOpen = onResume
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = onResume,
                modifier = Modifier.weight(1f).height(40.dp),
                colors = ButtonDefaults.buttonColors(containerColor = AccentRed)
            ) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text(if (pct != null) "Resume" else "Watch now")
            }
            OutlinedButton(
                onClick = onRemove,
                modifier = Modifier.height(40.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary)
            ) {
                Text("Remove", color = TextSecondary)
            }
        }
    }
}

private fun formatContinuePosition(ms: Long): String {
    val totalSec = ms / 1000
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

private fun continueThreshold(type: MediaType): Long =
    if (type == MediaType.TV) 180_000L else 300_000L
