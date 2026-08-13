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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.yassinabdelaziz.ystream.data.model.ContinueEntry
import com.yassinabdelaziz.ystream.data.model.MediaListItem
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.ui.components.EmptyState
import com.yassinabdelaziz.ystream.ui.components.MediaCard
import com.yassinabdelaziz.ystream.ui.theme.AccentRed
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

    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        items(watchlist, key = { "${it.type.tmdb}:${it.id}" }) { item ->
            Box {
                MediaCard(item, onClick = { onOpenDetail(item.type, item.id) }, width = Dp.Unspecified)
                IconButton(
                    onClick = { vm.toggleWatchlist(item) },
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(4.dp)
                        .size(28.dp)
                        .clip(RoundedCornerShape(50))
                        .background(Color(0x99000000))
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = "Remove from watchlist",
                        tint = Color.White,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
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
            ContinueListCard(
                entry = entry,
                onClick = {
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
private fun ContinueListCard(
    entry: ContinueEntry,
    onClick: () -> Unit,
    onRemove: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(SurfaceDark)
            .clickable(onClick = onClick)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AsyncImage(
            model = entry.posterPath?.let { "https://image.tmdb.org/t/p/w342$it" },
            contentDescription = entry.title,
            placeholder = Placeholder,
            error = Placeholder,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .height(92.dp)
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(8.dp))
                .background(SurfaceVariantDark)
        )
        Spacer(Modifier.size(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = entry.title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            val sub = buildString {
                if (entry.season != null && entry.episode != null) append("S${entry.season} · E${entry.episode}   ")
                append(formatPosition(entry.positionMs))
            }
            Text(text = sub, style = MaterialTheme.typography.bodySmall, color = TextSecondary)
            Spacer(Modifier.height(8.dp))
            val progress = if (entry.durationMs > 0) entry.positionMs.toFloat() / entry.durationMs.toFloat() else 0f
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(SurfaceVariantDark)
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(progress.coerceIn(0f, 1f))
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(AccentRed)
                )
            }
        }
        IconButton(onClick = onRemove) {
            Icon(
                imageVector = Icons.Filled.Delete,
                contentDescription = "Remove from Continue Watching",
                tint = TextSecondary
            )
        }
    }
}

private fun formatPosition(ms: Long): String {
    val totalSec = ms / 1000
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

private fun continueThreshold(type: MediaType): Long =
    if (type == MediaType.TV) 180_000L else 300_000L
