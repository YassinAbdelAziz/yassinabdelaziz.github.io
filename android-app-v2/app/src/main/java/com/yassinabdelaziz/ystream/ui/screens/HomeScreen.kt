package com.yassinabdelaziz.ystream.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yassinabdelaziz.ystream.data.model.ContinueEntry
import com.yassinabdelaziz.ystream.data.model.MediaListItem
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.ui.components.ContinueCard
import com.yassinabdelaziz.ystream.ui.components.EmptyState
import com.yassinabdelaziz.ystream.ui.components.ErrorState
import com.yassinabdelaziz.ystream.ui.components.HeroCarousel
import com.yassinabdelaziz.ystream.ui.components.LoadingState
import com.yassinabdelaziz.ystream.ui.components.MediaRow
import com.yassinabdelaziz.ystream.ui.components.SectionTitle
import com.yassinabdelaziz.ystream.ui.theme.TextSecondary
import com.yassinabdelaziz.ystream.ui.viewmodel.HomeViewModel

@Composable
fun HomeScreen(
    vm: HomeViewModel,
    onOpenDetail: (MediaType, Long) -> Unit,
    onOpenContinue: () -> Unit,
    onOpenPlayer: (MediaListItem, Int?, Int?) -> Unit
) {
    val ui by vm.ui.collectAsState()
    val continueList by vm.continueWatching.collectAsState()
    val slideExtras by vm.slideExtras.collectAsState()

    when {
        ui.loading -> LoadingState()
        ui.error != null -> ErrorState(ui.error!!, onRetry = { vm.load() })
        else -> {
            val visibleContinue = continueList
                .filter { it.positionMs > 0 && it.positionMs >= continueThreshold(it.type) }
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 16.dp)
            ) {
                if (ui.carousel.isNotEmpty()) {
                    item(key = "hero") {
                        HeroCarousel(
                            slides = ui.carousel,
                            extras = slideExtras,
                            onPlay = { item ->
                                val resume = continueList.firstOrNull { it.key() == "${item.type.tmdb}:${item.id}" }
                                onOpenPlayer(item, resume?.season, resume?.episode)
                            },
                            onOpenDetail = { type, id -> onOpenDetail(type, id) },
                            onSlideVisible = { item, type -> vm.loadSlideExtras(item, type) },
                            isInWatchlist = vm::isInWatchlist,
                            onToggleWatchlist = vm::toggleWatchlist
                        )
                    }
                    item(key = "hero-spacer") {
                        Spacer(Modifier.height(20.dp))
                    }
                }

                if (visibleContinue.isNotEmpty()) {
                    item(key = "continue-header") {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            SectionTitle("Continue Watching", Modifier.weight(1f))
                            TextButton(onClick = onOpenContinue) {
                                Text("See all", color = TextSecondary)
                            }
                        }
                    }
                    item(key = "continue-row") {
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(visibleContinue, key = { it.key() }) { entry ->
                                ContinueCard(
                                    entry = entry,
                                    onClick = { e ->
                                        onOpenPlayer(
                                            MediaListItem(
                                                id = e.id,
                                                type = e.type,
                                                title = e.title,
                                                overview = null,
                                                posterPath = e.posterPath,
                                                backdropPath = e.backdropPath,
                                                voteAverage = null,
                                                year = null
                                            ),
                                            e.season,
                                            e.episode
                                        )
                                    }
                                )
                            }
                        }
                    }
                }

                if (ui.movies.isNotEmpty()) {
                    item(key = "movies-row") {
                        MediaRow("Trending Movies", ui.movies) { onOpenDetail(it.type, it.id) }
                    }
                }

                if (ui.tv.isNotEmpty()) {
                    item(key = "tv-spacer") {
                        Spacer(Modifier.height(28.dp))
                    }
                    item(key = "tv-row") {
                        MediaRow("Trending TV Shows", ui.tv) { onOpenDetail(it.type, it.id) }
                    }
                }

                if (ui.movies.isEmpty() && ui.tv.isEmpty() && visibleContinue.isEmpty() && ui.carousel.isEmpty()) {
                    item { EmptyState("Nothing to show yet. Check back soon.") }
                }
            }
        }
    }
}

private fun continueThreshold(type: MediaType): Long =
    if (type == MediaType.TV) 180_000L else 300_000L
