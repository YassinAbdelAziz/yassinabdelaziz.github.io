package com.yassinabdelaziz.ystream.ui.navigation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.yassinabdelaziz.ystream.YStreamApp
import com.yassinabdelaziz.ystream.data.model.MediaListItem
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.ui.screens.BrowseScreen
import com.yassinabdelaziz.ystream.ui.screens.ContinueScreen
import com.yassinabdelaziz.ystream.ui.screens.DetailScreen
import com.yassinabdelaziz.ystream.ui.screens.HomeScreen
import com.yassinabdelaziz.ystream.ui.screens.PlayerScreen
import com.yassinabdelaziz.ystream.ui.screens.SearchScreen
import com.yassinabdelaziz.ystream.ui.screens.WatchlistScreen
import com.yassinabdelaziz.ystream.ui.theme.Background
import com.yassinabdelaziz.ystream.ui.theme.AccentRed
import com.yassinabdelaziz.ystream.ui.theme.TextSecondary
import com.yassinabdelaziz.ystream.ui.viewmodel.BrowseViewModel
import com.yassinabdelaziz.ystream.ui.viewmodel.DetailViewModel
import com.yassinabdelaziz.ystream.ui.viewmodel.HomeViewModel
import com.yassinabdelaziz.ystream.ui.viewmodel.LibraryViewModel
import com.yassinabdelaziz.ystream.ui.viewmodel.PlayerViewModel
import com.yassinabdelaziz.ystream.ui.viewmodel.SearchViewModel

private data class Tab(
    val route: String,
    val label: String,
    val icon: ImageVector
)

private val tabs = listOf(
    Tab("home", "Home", Icons.Filled.Home),
    Tab("movies", "Movies", Icons.Filled.Movie),
    Tab("tv", "TV", Icons.Filled.Tv),
    Tab("search", "Search", Icons.Filled.Search),
    Tab("watchlist", "Watchlist", Icons.Filled.Favorite)
)

@Composable
fun YStreamNav() {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    Scaffold(
        containerColor = Background,
        bottomBar = {
            if (currentRoute in tabs.map { it.route }) {
                NavigationBar(containerColor = Background) {
                    tabs.forEach { tab ->
                        NavigationBarItem(
                            selected = currentRoute == tab.route,
                            onClick = {
                                navController.navigate(tab.route) {
                                    popUpTo(navController.graph.findStartDestination().id) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label) },
                            colors = androidx.compose.material3.NavigationBarItemDefaults.colors(
                                selectedIconColor = AccentRed,
                                indicatorColor = AccentRed.copy(alpha = 0.15f),
                                selectedTextColor = AccentRed
                            )
                        )
                    }
                }
            }
        }
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = "home",
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            composable("home") {
                val vm: HomeViewModel = viewModel(factory = HomeViewModel.factory(appRepo()))
                HomeScreen(
                    vm = vm,
                    onOpenDetail = { type, id -> navController.navigate(detailRoute(type, id)) },
                    onOpenContinue = { navController.navigate("continue") },
                    onOpenPlayer = { item, s, e -> navController.navigate(playerRoute(item, s, e)) }
                )
            }
            composable("movies") {
                val vm: BrowseViewModel = viewModel(factory = BrowseViewModel.factory(appRepo(), MediaType.MOVIE))
                BrowseScreen(vm) { type, id -> navController.navigate(detailRoute(type, id)) }
            }
            composable("tv") {
                val vm: BrowseViewModel = viewModel(factory = BrowseViewModel.factory(appRepo(), MediaType.TV))
                BrowseScreen(vm) { type, id -> navController.navigate(detailRoute(type, id)) }
            }
            composable("search") {
                val vm: SearchViewModel = viewModel(factory = SearchViewModel.factory(appRepo()))
                SearchScreen(vm) { type, id -> navController.navigate(detailRoute(type, id)) }
            }
            composable("watchlist") {
                val vm: LibraryViewModel = viewModel(factory = LibraryViewModel.factory(appRepo()))
                WatchlistScreen(vm) { type, id -> navController.navigate(detailRoute(type, id)) }
            }
            composable("continue") {
                val vm: LibraryViewModel = viewModel(factory = LibraryViewModel.factory(appRepo()))
                Column(Modifier.fillMaxSize()) {
                    ScreenHeader(title = "Continue Watching", onBack = { navController.popBackStack() })
                    ContinueScreen(vm) { item, s, e -> navController.navigate(playerRoute(item, s, e)) }
                }
            }
            composable(
                route = "detail/{type}/{id}",
                arguments = listOf(
                    navArgument("type") { type = NavType.StringType },
                    navArgument("id") { type = NavType.LongType }
                )
            ) { entry ->
                val type = MediaType.valueOf(entry.arguments!!.getString("type")!!.uppercase())
                val id = entry.arguments!!.getLong("id")
                val vm: DetailViewModel = viewModel(factory = DetailViewModel.factory(appRepo(), type, id))
                DetailScreen(
                    vm = vm,
                    onBack = { navController.popBackStack() },
                    onOpenPlayer = { item, s, e -> navController.navigate(playerRoute(item, s, e)) },
                    onOpenDetail = { t, i -> navController.navigate(detailRoute(t, i)) }
                )
            }
            composable(
                route = "player/{type}/{id}?season={season}&episode={episode}",
                arguments = listOf(
                    navArgument("type") { type = NavType.StringType },
                    navArgument("id") { type = NavType.LongType },
                    navArgument("season") { type = NavType.IntType; defaultValue = -1 },
                    navArgument("episode") { type = NavType.IntType; defaultValue = -1 }
                )
            ) { entry ->
                val type = MediaType.valueOf(entry.arguments!!.getString("type")!!.uppercase())
                val id = entry.arguments!!.getLong("id")
                val season = entry.arguments!!.getInt("season").takeIf { it > 0 }
                val episode = entry.arguments!!.getInt("episode").takeIf { it > 0 }
                val vm: PlayerViewModel = viewModel(
                    factory = PlayerViewModel.factory(appRepo(), type, id, season, episode)
                )
                PlayerScreen(vm = vm, onBack = { navController.popBackStack() })
            }
        }
    }
}

@Composable
private fun ScreenHeader(title: String, onBack: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(onClick = onBack) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = MaterialTheme.colorScheme.onBackground
            )
        }
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground
        )
    }
}

@Composable
private fun appRepo() = (androidx.compose.ui.platform.LocalContext.current
    .applicationContext as YStreamApp).repository

private fun detailRoute(type: MediaType, id: Long) = "detail/${type.tmdb}/$id"

private fun playerRoute(item: MediaListItem, season: Int?, episode: Int?): String {
    val base = "player/${item.type.tmdb}/${item.id}"
    return if (item.type == MediaType.TV && season != null && episode != null) {
        "$base?season=$season&episode=$episode"
    } else {
        base
    }
}
