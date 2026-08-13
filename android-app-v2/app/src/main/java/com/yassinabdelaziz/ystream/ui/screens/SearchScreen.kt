package com.yassinabdelaziz.ystream.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.ui.components.EmptyState
import com.yassinabdelaziz.ystream.ui.components.ErrorState
import com.yassinabdelaziz.ystream.ui.components.LoadingState
import com.yassinabdelaziz.ystream.ui.components.PosterGrid
import com.yassinabdelaziz.ystream.ui.theme.AccentRed
import com.yassinabdelaziz.ystream.ui.theme.SurfaceVariantDark
import com.yassinabdelaziz.ystream.ui.theme.TextSecondary
import com.yassinabdelaziz.ystream.ui.viewmodel.SearchViewModel

@Composable
fun SearchScreen(
    vm: SearchViewModel,
    onOpenDetail: (MediaType, Long) -> Unit
) {
    val ui by vm.ui.collectAsState()
    val history by vm.history.collectAsState()

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
            ui.query.isBlank() && history.isNotEmpty() -> RecentSearches(
                history = history,
                onSelect = vm::searchFromHistory,
                onRemove = vm::removeHistoryQuery,
                onClearAll = vm::clearHistory
            )

            ui.loading -> LoadingState()
            ui.error != null -> ErrorState(ui.error!!, onRetry = { vm.submitQuery() })
            ui.searched && ui.results.isEmpty() ->
                EmptyState("No results for \"${ui.query.trim()}\"")

            else -> PosterGrid(ui.results) { onOpenDetail(it.type, it.id) }
        }
    }
}

@Composable
private fun RecentSearches(
    history: List<String>,
    onSelect: (String) -> Unit,
    onRemove: (String) -> Unit,
    onClearAll: () -> Unit
) {
    LazyColumn {
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 8.dp, top = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Recent searches",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f)
                )
                TextButton(onClick = onClearAll) {
                    Text("Clear", color = TextSecondary)
                }
            }
        }
        items(history.size) { index ->
            val query = history[index]
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onSelect(query) }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Filled.History,
                    contentDescription = null,
                    tint = TextSecondary,
                    modifier = Modifier.width(24.dp)
                )
                Spacer(Modifier.width(12.dp))
                Text(
                    text = query,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = { onRemove(query) }) {
                    Icon(
                        imageVector = Icons.Filled.Clear,
                        contentDescription = "Remove",
                        tint = TextSecondary
                    )
                }
            }
            if (index < history.lastIndex) {
                HorizontalDivider(
                    modifier = Modifier.padding(start = 52.dp),
                    color = SurfaceVariantDark
                )
            }
        }
    }
}
