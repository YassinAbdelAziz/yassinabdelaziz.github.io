package com.yassinabdelaziz.ystream.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.yassinabdelaziz.ystream.data.model.ContinueEntry
import com.yassinabdelaziz.ystream.data.model.MediaListItem
import com.yassinabdelaziz.ystream.ui.theme.AccentRed
import com.yassinabdelaziz.ystream.ui.theme.RatingGold
import com.yassinabdelaziz.ystream.ui.theme.SurfaceDark
import com.yassinabdelaziz.ystream.ui.theme.SurfaceVariantDark
import com.yassinabdelaziz.ystream.ui.theme.TextSecondary

private val Placeholder = ColorPainter(Color(0xFF1E1E1E))

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
        modifier = modifier.padding(horizontal = 16.dp, vertical = 8.dp)
    )
}

@Composable
fun RatingBadge(score: Double?, modifier: Modifier = Modifier) {
    val rating = score ?: return
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .background(Color(0xCC000000))
            .padding(horizontal = 6.dp, vertical = 3.dp)
    ) {
        Icon(
            imageVector = Icons.Filled.Star,
            contentDescription = null,
            tint = RatingGold,
            modifier = Modifier.size(12.dp)
        )
        Spacer(Modifier.width(3.dp))
        Text(
            text = String.format("%.1f", rating),
            color = Color.White,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
fun MediaCard(
    item: MediaListItem,
    onClick: (MediaListItem) -> Unit,
    modifier: Modifier = Modifier,
    width: Dp = 128.dp
) {
    Column(modifier = modifier.width(width).clickable { onClick(item) }) {
        Box {
            AsyncImage(
                model = item.posterUrl(),
                contentDescription = item.title,
                placeholder = Placeholder,
                error = Placeholder,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(2f / 3f)
                    .clip(RoundedCornerShape(10.dp))
                    .background(SurfaceDark)
            )
            item.voteAverage?.let { RatingBadge(it, Modifier.align(Alignment.TopStart).padding(6.dp)) }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            text = item.title,
            color = MaterialTheme.colorScheme.onBackground,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        item.year?.let {
            Text(
                text = it,
                color = TextSecondary,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
fun MediaRow(
    title: String,
    items: List<MediaListItem>,
    modifier: Modifier = Modifier,
    onClick: (MediaListItem) -> Unit
) {
    Column(modifier) {
        SectionTitle(title)
        LazyRow(
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(items, key = { "${it.type.tmdb}:${it.id}" }) { item ->
                MediaCard(item, onClick)
            }
        }
    }
}

@Composable
fun PosterGrid(
    items: List<MediaListItem>,
    modifier: Modifier = Modifier,
    columns: Int = 3,
    onClick: (MediaListItem) -> Unit
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(columns),
        modifier = modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        items(items, key = { "${it.type.tmdb}:${it.id}" }) { item ->
            MediaCard(item, onClick, width = Dp.Unspecified)
        }
    }
}

@Composable
fun ContinueCard(
    entry: ContinueEntry,
    modifier: Modifier = Modifier,
    onClick: (ContinueEntry) -> Unit
) {
    Column(modifier = modifier.width(260.dp).clickable { onClick(entry) }) {
        Box {
            AsyncImage(
                model = entry.backdropPath?.let { "https://image.tmdb.org/t/p/w500$it" },
                contentDescription = entry.title,
                placeholder = Placeholder,
                error = Placeholder,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(140.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(SurfaceDark)
            )
            Box(
                Modifier
                    .align(Alignment.Center)
                    .size(48.dp)
                    .clip(RoundedCornerShape(50))
                    .background(Color(0x99000000))
            )
        }
        val progress = if (entry.durationMs > 0) entry.positionMs.toFloat() / entry.durationMs.toFloat() else 0f
        Box(
            Modifier
                .fillMaxWidth()
                .height(3.dp)
                .padding(top = 8.dp)
                .background(SurfaceVariantDark)
        ) {
            Box(
                Modifier
                    .fillMaxWidth(progress.coerceIn(0f, 1f))
                    .height(3.dp)
                    .background(AccentRed)
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(
            text = entry.title,
            color = MaterialTheme.colorScheme.onBackground,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        val sub = buildString {
            if (entry.season != null && entry.episode != null) append("S${entry.season} E${entry.episode} · ")
            append(formatPosition(entry.positionMs))
        }
        Text(
            text = sub,
            color = TextSecondary,
            style = MaterialTheme.typography.bodySmall
        )
    }
}

private fun formatPosition(ms: Long): String {
    val totalSec = ms / 1000
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

@Composable
fun LoadingState(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = AccentRed)
    }
}

@Composable
fun ErrorState(
    message: String,
    onRetry: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Filled.Warning,
            contentDescription = null,
            tint = TextSecondary,
            modifier = Modifier.size(40.dp)
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = message,
            color = TextSecondary,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center
        )
        if (onRetry != null) {
            Spacer(Modifier.height(16.dp))
            androidx.compose.material3.Button(onClick = onRetry) {
                Text("Retry")
            }
        }
    }
}

@Composable
fun EmptyState(message: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(
            text = message,
            color = TextSecondary,
            style = MaterialTheme.typography.bodyMedium
        )
    }
}

@Composable
fun PosterSkeleton(modifier: Modifier = Modifier) {
    Box(
        modifier
            .aspectRatio(2f / 3f)
            .clip(RoundedCornerShape(10.dp))
            .background(SurfaceVariantDark)
    )
}
