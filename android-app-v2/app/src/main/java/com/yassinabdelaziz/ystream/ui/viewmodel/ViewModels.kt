package com.yassinabdelaziz.ystream.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.yassinabdelaziz.ystream.YStreamApp
import com.yassinabdelaziz.ystream.data.YStreamRepository
import com.yassinabdelaziz.ystream.data.model.ContinueEntry
import com.yassinabdelaziz.ystream.data.model.MediaListItem
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.web.PlayerJsBridge
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

inline fun <reified VM : ViewModel> appRepositoryFactory(
    crossinline build: (YStreamRepository) -> VM
): ViewModelProvider.Factory = viewModelFactory {
    initializer {
        val app = this[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as YStreamApp
        build(app.repository)
    }
}

// ---------------------------------------------------------------- Home

class HomeViewModel(private val repo: YStreamRepository) : ViewModel() {

    data class UiState(
        val movies: List<MediaListItem> = emptyList(),
        val tv: List<MediaListItem> = emptyList(),
        val loading: Boolean = true,
        val error: String? = null
    )

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    val continueWatching: StateFlow<List<ContinueEntry>> = repo.continueWatching

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _ui.update { it.copy(loading = true, error = null) }
            try {
                val movies = repo.trending(MediaType.MOVIE)
                val tv = repo.trending(MediaType.TV)
                _ui.update { it.copy(movies = movies, tv = tv, loading = false) }
            } catch (e: Exception) {
                _ui.update {
                    it.copy(loading = false, error = "Couldn't load the feed. Check your connection and try again.")
                }
            }
        }
    }

    companion object {
        fun factory(repo: YStreamRepository) = appRepositoryFactory { HomeViewModel(it) }
    }
}

// ---------------------------------------------------------------- Browse

class BrowseViewModel(
    private val repo: YStreamRepository,
    private val type: MediaType
) : ViewModel() {

    data class UiState(
        val items: List<MediaListItem> = emptyList(),
        val loading: Boolean = true,
        val loadingMore: Boolean = false,
        val end: Boolean = false,
        val error: String? = null
    )

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private var page = 0

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _ui.update { it.copy(loading = true, error = null) }
            try {
                page = 1
                val items = repo.trending(type, page)
                _ui.update { it.copy(items = items, loading = false) }
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, error = "Couldn't load ${type.tmdb} titles. Try again.") }
            }
        }
    }

    fun loadMore() {
        val state = _ui.value
        if (state.loadingMore || state.end || state.loading) return
        viewModelScope.launch {
            _ui.update { it.copy(loadingMore = true) }
            try {
                page += 1
                val more = repo.trending(type, page)
                val merged = state.items + more
                _ui.update {
                    it.copy(
                        items = merged,
                        loadingMore = false,
                        end = more.isEmpty() || (state.items.isEmpty() && more.isEmpty())
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(loadingMore = false) }
            }
        }
    }

    companion object {
        fun factory(repo: YStreamRepository, type: MediaType) =
            appRepositoryFactory { BrowseViewModel(it, type) }
    }
}

// ---------------------------------------------------------------- Search

class SearchViewModel(private val repo: YStreamRepository) : ViewModel() {

    data class UiState(
        val query: String = "",
        val results: List<MediaListItem> = emptyList(),
        val loading: Boolean = false,
        val searched: Boolean = false,
        val error: String? = null
    )

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    val history: StateFlow<List<String>> = repo.history

    private var searchJob: Job? = null

    fun onQueryChange(value: String) {
        _ui.update { it.copy(query = value, error = null) }
        searchJob?.cancel()
        val q = value.trim()
        if (q.isEmpty()) {
            _ui.update { it.copy(results = emptyList(), loading = false, searched = false) }
            return
        }
        searchJob = viewModelScope.launch {
            delay(400)
            runSearch(q)
        }
    }

    fun submitQuery() {
        val q = _ui.value.query.trim()
        if (q.isEmpty()) return
        searchJob?.cancel()
        repo.addSearchQuery(q)
        viewModelScope.launch { runSearch(q) }
    }

    fun searchFromHistory(q: String) {
        _ui.update { it.copy(query = q) }
        searchJob?.cancel()
        repo.addSearchQuery(q)
        viewModelScope.launch { runSearch(q) }
    }

    private suspend fun runSearch(q: String) {
        _ui.update { it.copy(loading = true, error = null, searched = true) }
        try {
            val movies = repo.search(MediaType.MOVIE, q)
            val tv = repo.search(MediaType.TV, q)
            val merged = (movies + tv).sortedByDescending { it.voteAverage ?: 0.0 }
            _ui.update { it.copy(results = merged, loading = false) }
        } catch (e: Exception) {
            _ui.update { it.copy(loading = false, error = "Search failed. Try again.") }
        }
    }

    fun removeHistoryQuery(q: String) = repo.removeHistoryQuery(q)

    fun clearHistory() = repo.clearHistory()

    companion object {
        fun factory(repo: YStreamRepository) = appRepositoryFactory { SearchViewModel(it) }
    }
}

// ---------------------------------------------------------------- Library

class LibraryViewModel(private val repo: YStreamRepository) : ViewModel() {

    val watchlist: StateFlow<List<MediaListItem>> = repo.watchlist
    val continueWatching: StateFlow<List<ContinueEntry>> = repo.continueWatching

    fun toggleWatchlist(item: MediaListItem) = repo.toggleWatchlist(item)

    fun removeContinue(entry: ContinueEntry) = repo.removeContinue(entry)

    fun clearContinue() {
        repo.continueWatching.value.forEach { repo.removeContinue(it) }
    }

    companion object {
        fun factory(repo: YStreamRepository) = appRepositoryFactory { LibraryViewModel(it) }
    }
}

// ---------------------------------------------------------------- Detail

class DetailViewModel(
    private val repo: YStreamRepository,
    private val type: MediaType,
    private val mediaId: Long
) : ViewModel() {

    data class UiState(
        val media: MediaListItem? = null,
        val bundle: YStreamRepository.DetailsBundle? = null,
        val loading: Boolean = true,
        val error: String? = null
    )

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    val server: StateFlow<String> = repo.activeServer
    val continueWatching: StateFlow<List<ContinueEntry>> = repo.continueWatching
    val watchlist: StateFlow<List<MediaListItem>> = repo.watchlist

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _ui.update { it.copy(loading = true, error = null) }
            try {
                val bundle = repo.details(type, mediaId)
                _ui.update { it.copy(bundle = bundle, media = bundle.media, loading = false) }
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, error = "Couldn't load details. Try again.") }
            }
        }
    }

    fun setServer(server: String) = repo.setActiveServer(server)

    fun toggleWatchlist() {
        _ui.value.media?.let { repo.toggleWatchlist(it) }
    }

    companion object {
        fun factory(repo: YStreamRepository, type: MediaType, id: Long) =
            appRepositoryFactory { DetailViewModel(it, type, id) }
    }
}

// ---------------------------------------------------------------- Player

class PlayerViewModel(
    private val repo: YStreamRepository,
    private val type: MediaType,
    private val mediaId: Long,
    private val season: Int?,
    private val episode: Int?
) : ViewModel() {

    private val _embedUrl = MutableStateFlow<String?>(null)
    val embedUrl: StateFlow<String?> = _embedUrl.asStateFlow()

    private val _item = MutableStateFlow<MediaListItem?>(null)
    val item: StateFlow<MediaListItem?> = _item.asStateFlow()

    private val _bridge = MutableStateFlow<PlayerJsBridge?>(null)
    val bridge: StateFlow<PlayerJsBridge?> = _bridge.asStateFlow()

    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    val server: StateFlow<String> = repo.activeServer

    init {
        viewModelScope.launch {
            try {
                val item = repo.details(type, mediaId).media
                _item.value = item
                _bridge.value = PlayerJsBridge(repo, item, season, episode)
            } catch (_: Exception) {
                // Fall back to a bare item so the embed can still open.
                _item.value = MediaListItem(mediaId, type, "", null, null, null, null, null)
                _bridge.value = PlayerJsBridge(repo, _item.value!!, season, episode)
            }
            rebuildEmbed()
            _loading.value = false
        }
    }

    fun setServer(server: String) {
        repo.setActiveServer(server)
        rebuildEmbed()
    }

    private fun rebuildEmbed() {
        val resume = repo.continueWatching.value.firstOrNull { entry ->
            entry.key() == "${type.tmdb}:$mediaId" &&
                    (type == MediaType.MOVIE || (entry.season == season && entry.episode == episode))
        }
        _embedUrl.value = repo.embedUrl(type, mediaId, repo.activeServer.value, season, episode, resume)
    }

    companion object {
        fun factory(repo: YStreamRepository, type: MediaType, id: Long, season: Int?, episode: Int?) =
            appRepositoryFactory { PlayerViewModel(it, type, id, season, episode) }
    }
}
