package com.yassinabdelaziz.ystream.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.ui.components.ErrorState
import com.yassinabdelaziz.ystream.ui.components.LoadingState
import com.yassinabdelaziz.ystream.ui.components.MediaCard
import com.yassinabdelaziz.ystream.ui.theme.AccentRed
import com.yassinabdelaziz.ystream.ui.theme.TextSecondary
import com.yassinabdelaziz.ystream.ui.viewmodel.BrowseViewModel

@Composable
fun BrowseScreen(
    vm: BrowseViewModel,
    onOpenDetail: (MediaType, Long) -> Unit
) {
    val ui by vm.ui.collectAsState()

    when {
        ui.loading -> LoadingState()
        ui.error != null -> ErrorState(ui.error!!, onRetry = { vm.load() })
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
                        else -> Button(
                            onClick = vm::loadMore,
                            modifier = Modifier.align(Alignment.Center)
                        ) {
                            Text("Load more")
                        }
                    }
                }
            }
        }
    }
}
