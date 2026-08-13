package com.yassinabdelaziz.ystream.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.yassinabdelaziz.ystream.data.model.MediaListItem
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.ui.components.ErrorState
import com.yassinabdelaziz.ystream.ui.components.LoadingState
import com.yassinabdelaziz.ystream.ui.components.MediaCard
import com.yassinabdelaziz.ystream.ui.components.RatingBadge
import com.yassinabdelaziz.ystream.ui.theme.AccentRed
import com.yassinabdelaziz.ystream.ui.theme.Background
import com.yassinabdelaziz.ystream.ui.theme.RatingGold
import com.yassinabdelaziz.ystream.ui.theme.SurfaceDark
import com.yassinabdelaziz.ystream.ui.theme.SurfaceVariantDark
import com.yassinabdelaziz.ystream.ui.theme.TextSecondary
import com.yassinabdelaziz.ystream.ui.viewmodel.DetailViewModel

private val Placeholder = ColorPainter(Color(0xFF1E1E1E))

@Composable
fun DetailScreen(
    vm: DetailViewModel,
    onBack: () -> Unit,
    onOpenPlayer: (MediaListItem, Int?, Int?) -> Unit,
    onOpenDetail: (MediaType, Long) -> Unit
) {
    val ui by vm.ui.collectAsState()
    val server by vm.server.collectAsState()
    val continueList by vm.continueWatching.collectAsState()
    val watchlist by vm.watchlist.collectAsState()

    val bundle = ui.bundle
    when {
        ui.loading -> LoadingState()
        ui.error != null -> ErrorState(ui.error!!, onRetry = { vm.load() })
        bundle == null -> Unit
        else -> {
            val media = bundle.media
            val isTv = media.type == MediaType.TV
            val resume = continueList.firstOrNull { it.key() == "${media.type.tmdb}:${media.id}" }
            var selectedSeason by remember(media.id) {
                mutableStateOf(resume?.season ?: 1)
            }
            var selectedEpisode by remember(media.id) {
                mutableStateOf(resume?.episode ?: 1)
            }

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .background(Background)
            ) {
                BackdropHeader(media, onBack)
                DetailContent(
                    media = media,
                    bundle = bundle,
                    isTv = isTv,
                    server = server,
                    inWatchlist = watchlist.any { it.id == media.id && it.type == media.type },
                    hasResume = resume != null && resume.positionMs > 0,
                    selectedSeason = selectedSeason,
                    selectedEpisode = selectedEpisode,
                    onSeasonChange = { selectedSeason = it; selectedEpisode = 1 },
                    onEpisodeChange = { selectedEpisode = it },
                    onToggleWatchlist = vm::toggleWatchlist,
                    onServerChange = vm::setServer,
                    onPlay = {
                        if (isTv) onOpenPlayer(media, selectedSeason, selectedEpisode)
                        else onOpenPlayer(media, null, null)
                    },
                    onOpenDetail = onOpenDetail
                )
            }
        }
    }
}

@Composable
private fun BackdropHeader(media: MediaListItem, onBack: () -> Unit) {
    Box {
        AsyncImage(
            model = media.backdropUrl("w780"),
            contentDescription = null,
            placeholder = Placeholder,
            error = Placeholder,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxWidth()
                .height(240.dp)
        )
        Box(
            Modifier
                .fillMaxWidth()
                .height(240.dp)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(Color.Transparent, Background.copy(alpha = 0.35f), Background)
                    )
                )
        )
        IconButton(onClick = onBack, modifier = Modifier.padding(top = 8.dp, start = 8.dp)) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = Color.White,
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(50))
                    .background(Color(0x66000000))
                    .padding(6.dp)
            )
        }
    }
}

@Composable
private fun DetailContent(
    media: MediaListItem,
    bundle: YStreamRepositoryDetailsBundle,
    isTv: Boolean,
    server: String,
    inWatchlist: Boolean,
    hasResume: Boolean,
    selectedSeason: Int,
    selectedEpisode: Int,
    onSeasonChange: (Int) -> Unit,
    onEpisodeChange: (Int) -> Unit,
    onToggleWatchlist: () -> Unit,
    onServerChange: (String) -> Unit,
    onPlay: () -> Unit,
    onOpenDetail: (MediaType, Long) -> Unit
) {
    Column(modifier = Modifier.padding(horizontal = 16.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            AsyncImage(
                model = media.posterUrl("w342"),
                contentDescription = media.title,
                placeholder = Placeholder,
                error = Placeholder,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .width(110.dp)
                    .aspectRatio(2f / 3f)
                    .clip(RoundedCornerShape(10.dp))
                    .background(SurfaceDark)
            )
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = media.title,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 6.dp)
                ) {
                    media.year?.let { Text(it, color = TextSecondary, style = MaterialTheme.typography.bodyMedium) }
                    if (bundle.details.status != null) {
                        Text("·", color = TextSecondary)
                        Text(bundle.details.status, color = TextSecondary, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                bundle.details.genres?.take(3)?.let { genres ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.padding(top = 6.dp)
                    ) {
                        genres.forEach { genre ->
                            Text(
                                text = genre.name ?: "",
                                color = Color.White,
                                style = MaterialTheme.typography.labelMedium,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(SurfaceVariantDark)
                                    .padding(horizontal = 6.dp, vertical = 3.dp)
                            )
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                media.voteAverage?.let {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Star, contentDescription = null, tint = RatingGold, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = String.format("%.1f", it),
                            color = RatingGold,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(
                onClick = onPlay,
                modifier = Modifier.weight(1f).height(48.dp)
            ) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text(if (isTv) "Play S$selectedSeason E$selectedEpisode" else if (hasResume) "Resume" else "Play")
            }
            OutlinedButton(
                onClick = onToggleWatchlist,
                modifier = Modifier.height(48.dp)
            ) {
                Icon(
                    imageVector = if (inWatchlist) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                    contentDescription = null,
                    tint = if (inWatchlist) AccentRed else MaterialTheme.colorScheme.onSurface
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        Text("Server", style = MaterialTheme.typography.titleSmall, color = TextSecondary)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ServerChip("videasy", "Videasy", server == "videasy", onServerChange)
            ServerChip("vidking", "Vidking", server == "vidking", onServerChange)
        }

        if (isTv) {
            Spacer(Modifier.height(16.dp))
            Text("Season", style = MaterialTheme.typography.titleSmall, color = TextSecondary)
            Spacer(Modifier.height(8.dp))
            val seasons = bundle.details.seasons?.filter { it.seasonNumber > 0 }
                ?: bundle.details.numberOfSeasons?.let { n -> (1..n).map { com.yassinabdelaziz.ystream.data.model.SeasonDto(it) } }
                ?: listOf(com.yassinabdelaziz.ystream.data.model.SeasonDto(1))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(seasons, key = { it.seasonNumber }) { s ->
                    FilterChip(
                        selected = s.seasonNumber == selectedSeason,
                        onClick = { onSeasonChange(s.seasonNumber) },
                        label = { Text("Season ${s.seasonNumber}") },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = AccentRed,
                            selectedLabelColor = Color.White
                        )
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            Text("Episode", style = MaterialTheme.typography.titleSmall, color = TextSecondary)
            Spacer(Modifier.height(8.dp))
            val episodeCount = bundle.details.seasons
                ?.firstOrNull { it.seasonNumber == selectedSeason }
                ?.episodeCount?.takeIf { it > 0 } ?: 24
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items((1..episodeCount).toList()) { ep ->
                    FilterChip(
                        selected = ep == selectedEpisode,
                        onClick = { onEpisodeChange(ep) },
                        label = { Text("$ep") },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = AccentRed,
                            selectedLabelColor = Color.White
                        )
                    )
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        bundle.details.overview?.let { overview ->
            Text(
                text = overview,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onBackground
            )
        }

        val extraMeta = buildString {
            if (!isTv && bundle.details.runtime != null && bundle.details.runtime > 0) {
                append("${bundle.details.runtime} min")
            }
            if (isTv) {
                bundle.details.numberOfSeasons?.let { append("$it seasons") }
                bundle.details.numberOfEpisodes?.let { append(" · $it episodes") }
            }
        }
        if (extraMeta.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            Text(extraMeta, color = TextSecondary, style = MaterialTheme.typography.bodyMedium)
        }

        if (bundle.cast.isNotEmpty()) {
            Spacer(Modifier.height(20.dp))
            Text("Cast", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(bundle.cast, key = { it.id }) { person ->
                    Column(modifier = Modifier.width(80.dp)) {
                        AsyncImage(
                            model = person.profilePath?.let { "https://image.tmdb.org/t/p/w185$it" },
                            contentDescription = person.name,
                            placeholder = Placeholder,
                            error = Placeholder,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .size(80.dp)
                                .clip(RoundedCornerShape(50))
                                .background(SurfaceVariantDark)
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = person.name ?: "",
                            color = MaterialTheme.colorScheme.onBackground,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis
                        )
                        Text(
                            text = person.character ?: "",
                            color = TextSecondary,
                            style = MaterialTheme.typography.labelSmall,
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }

        if (bundle.moreLikeThis.isNotEmpty()) {
            Spacer(Modifier.height(20.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(bundle.moreLikeThis, key = { "${it.type.tmdb}:${it.id}" }) { item ->
                    MediaCard(item, onClick = { onOpenDetail(item.type, item.id) })
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun ServerChip(
    value: String,
    label: String,
    selected: Boolean,
    onSelect: (String) -> Unit
) {
    FilterChip(
        selected = selected,
        onClick = { onSelect(value) },
        label = { Text(label) },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = AccentRed,
            selectedLabelColor = Color.White
        )
    )
}

// Type alias so DetailContent can reference the bundle without leaking the data package name.
private typealias YStreamRepositoryDetailsBundle = com.yassinabdelaziz.ystream.data.YStreamRepository.DetailsBundle
