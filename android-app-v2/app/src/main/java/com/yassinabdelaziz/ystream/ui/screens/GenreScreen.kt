package com.yassinabdelaziz.ystream.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.ui.components.ErrorState
import com.yassinabdelaziz.ystream.ui.components.LoadingState
import com.yassinabdelaziz.ystream.ui.components.MediaCard
import com.yassinabdelaziz.ystream.ui.theme.AccentRed
import com.yassinabdelaziz.ystream.ui.theme.TextSecondary
import com.yassinabdelaziz.ystream.ui.viewmodel.GenreViewModel

@Composable
fun GenreScreen(
    vm: GenreViewModel,
    type: MediaType,
    genreName: String,
    onOpenDetail: (MediaType, Long) -> Unit,
    onBack: () -> Unit
) {
    val ui by vm.ui.collectAsState()

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 4.dp)
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
            Text(
                text = genreName,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
        ) {
            SortChip("Popular", ui.sort == "popularity.desc") { vm.load("popularity.desc") }
            SortChip("Top Rated", ui.sort == "vote_average.desc") { vm.load("vote_average.desc") }
            SortChip(
                if (type == MediaType.TV) "Newest" else "Newest",
                ui.sort == (if (type == MediaType.TV) "first_air_date.desc" else "release_date.desc")
            ) { vm.load(if (type == MediaType.TV) "first_air_date.desc" else "release_date.desc") }
        }

        when {
            ui.loading -> LoadingState()
            ui.error != null -> ErrorState(ui.error!!, onRetry = { vm.load(ui.sort) })
            else -> LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                items(ui.items, key = { "${it.type.tmdb}:${it.id}" }) { item ->
                    MediaCard(item, onClick = { onOpenDetail(item.type, item.id) }, width = Dp.Unspecified)
                }
                if (!ui.end || ui.items.isNotEmpty()) {
                    item(key = "footer") {
                        Box(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
                            when {
                                ui.loadingMore -> CircularProgressIndicator(
                                    modifier = Modifier.size(28.dp).align(Alignment.Center),
                                    color = AccentRed,
                                    strokeWidth = 3.dp
                                )
                                ui.end -> Text(
                                    text = "You've seen it all",
                                    color = TextSecondary,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.align(Alignment.Center)
                                )
                                else -> Unit
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SortChip(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = AccentRed,
            selectedLabelColor = androidx.compose.ui.graphics.Color.White
        )
    )
}
