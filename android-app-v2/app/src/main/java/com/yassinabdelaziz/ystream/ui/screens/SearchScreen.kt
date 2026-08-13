package com.yassinabdelaziz.ystream.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yassinabdelaziz.ystream.data.model.GenreDto
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.ui.components.EmptyState
import com.yassinabdelaziz.ystream.ui.components.ErrorState
import com.yassinabdelaziz.ystream.ui.components.GenreTile
import com.yassinabdelaziz.ystream.ui.components.LoadingState
import com.yassinabdelaziz.ystream.ui.components.PosterGrid
import com.yassinabdelaziz.ystream.ui.components.SectionTitle
import com.yassinabdelaziz.ystream.ui.theme.TextSecondary
import com.yassinabdelaziz.ystream.ui.viewmodel.SearchViewModel

@Composable
fun SearchScreen(
    vm: SearchViewModel,
    onOpenDetail: (MediaType, Long) -> Unit,
    onOpenCategory: (MediaType) -> Unit,
    onOpenGenre: (MediaType, Int, String) -> Unit
) {
    val ui by vm.ui.collectAsState()
    val history by vm.history.collectAsState()
    val screenWidthDp = LocalConfiguration.current.screenWidthDp.dp
    val tileWidth = (screenWidthDp - 56.dp) / 3

    Column(modifier = Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = ui.query,
            onValueChange = vm::onQueryChange,
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            placeholder = { Text("Search movies & TV shows") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                if (ui.query.isNotEmpty()) {
                    IconButton(onClick = { vm.onQueryChange("") }) {
                        Icon(Icons.Filled.Clear, contentDescription = "Clear")
                    }
                }
            },
            singleLine = true,
            shape = MaterialTheme.shapes.large,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { vm.submitQuery() })
        )

        when {
            ui.query.isBlank() -> BrowseTiles(
                movieGenres = ui.movieGenres,
                tvGenres = ui.tvGenres,
                history = history,
                tileWidth = tileWidth,
                onOpenCategory = onOpenCategory,
                onOpenGenre = onOpenGenre,
                onSelectHistory = vm::searchFromHistory,
                onRemoveHistory = vm::removeHistoryQuery,
                onClearHistory = vm::clearHistory
            )

            ui.loading -> LoadingState()
            ui.error != null -> ErrorState(ui.error!!, onRetry = { vm.submitQuery() })
            ui.searched && ui.results.isEmpty() ->
                EmptyState("No results for \"${ui.query.trim()}\"")

            else -> PosterGrid(ui.results) { onOpenDetail(it.type, it.id) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BrowseTiles(
    movieGenres: List<GenreDto>,
    tvGenres: List<GenreDto>,
    history: List<String>,
    tileWidth: androidx.compose.ui.unit.Dp,
    onOpenCategory: (MediaType) -> Unit,
    onOpenGenre: (MediaType, Int, String) -> Unit,
    onSelectHistory: (String) -> Unit,
    onRemoveHistory: (String) -> Unit,
    onClearHistory: () -> Unit
) {
    val genreTiles = (movieGenres + tvGenres)
        .distinctBy { it.id }
        .sortedBy { it.name.orEmpty() }

    LazyColumn(contentPadding = PaddingValues(bottom = 16.dp)) {
        item(key = "cats-title") { SectionTitle("Categories") }
        item(key = "cats") {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
            ) {
                GenreTile("Movies", onClick = { onOpenCategory(MediaType.MOVIE) }, modifier = Modifier.weight(1f))
                GenreTile("TV Shows", onClick = { onOpenCategory(MediaType.TV) }, modifier = Modifier.weight(1f))
            }
        }

        if (genreTiles.isNotEmpty()) {
            item(key = "genres-title") { SectionTitle("Genres") }
            item(key = "genres") {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                ) {
                    genreTiles.forEach { genre ->
                        GenreTile(
                            label = genre.name.orEmpty(),
                            onClick = {
                                val type = if (movieGenres.any { it.id == genre.id }) MediaType.MOVIE else MediaType.TV
                                onOpenGenre(type, genre.id, genre.name.orEmpty())
                            },
                            modifier = Modifier.width(tileWidth)
                        )
                    }
                }
            }
        }

        if (history.isNotEmpty()) {
            item(key = "history-title") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 16.dp, end = 8.dp, top = 20.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    SectionTitle("Recent Searches", Modifier.weight(1f))
                    TextButton(onClick = onClearHistory) {
                        Text("Clear all", color = TextSecondary)
                    }
                }
            }
            items(history.size, key = { "h-$it" }) { index ->
                val query = history[index]
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelectHistory(query) }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Filled.History,
                        contentDescription = null,
                        tint = TextSecondary,
                        modifier = Modifier.width(20.dp)
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = query,
                        color = MaterialTheme.colorScheme.onBackground,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.weight(1f)
                    )
                    IconButton(onClick = { onRemoveHistory(query) }) {
                        Icon(
                            imageVector = Icons.Filled.Clear,
                            contentDescription = "Remove",
                            tint = TextSecondary,
                            modifier = Modifier.width(18.dp)
                        )
                    }
                }
                if (index < history.lastIndex) {
                    HorizontalDivider(
                        modifier = Modifier.padding(horizontal = 16.dp),
                        color = TextSecondary.copy(alpha = 0.15f)
                    )
                }
            }
        }
    }
}
