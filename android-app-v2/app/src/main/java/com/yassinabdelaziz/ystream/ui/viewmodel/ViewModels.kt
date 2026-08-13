package com.yassinabdelaziz.ystream.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.yassinabdelaziz.ystream.YStreamApp
import com.yassinabdelaziz.ystream.data.YStreamRepository
import com.yassinabdelaziz.ystream.data.model.ContinueEntry
import com.yassinabdelaziz.ystream.data.model.GenreDto
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

    /** A single slide of the homepage hero carousel. */
    data class CarouselSlide(
        val item: MediaListItem,
        val type: MediaType,
        val genres: List<String> = emptyList(),
        val runtime: Int? = null,
        val seasons: Int? = null
    )

    data class UiState(
        val movies: List<MediaListItem> = emptyList(),
        val tv: List<MediaListItem> = emptyList(),
        val carousel: List<CarouselSlide> = emptyList(),
        val loading: Boolean = true,
        val error: String? = null
    )

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    val continueWatching: StateFlow<List<ContinueEntry>> = repo.continueWatching

    private val _slideExtras = MutableStateFlow<Map<String, YStreamRepository.SlideExtra>>(emptyMap())
    val slideExtras: StateFlow<Map<String, YStreamRepository.SlideExtra>> = _slideExtras.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _ui.update { it.copy(loading = true, error = null) }
            try {
                val movies = repo.trending(MediaType.MOVIE)
                val tv = repo.trending(MediaType.TV)
                val slides = buildCarousel(movies, tv)
                val slideIds = slides.map { it.item.id }.toSet()
                _ui.update {
                    it.copy(
                        movies = movies.filterNot { x -> x.id in slideIds }.take(14),
                        tv = tv.filterNot { x -> x.id in slideIds }.take(14),
                        carousel = slides,
                        loading = false
                    )
                }
            } catch (e: Exception) {
                _ui.update {
                    it.copy(loading = false, error = "Couldn't load the feed. Check your connection and try again.")
                }
            }
        }
    }

    /**
     * Builds the hero carousel exactly like the website: up to 6 movies and 6 TV
     * shows that have backdrop art and an overview, interleaved, capped at 8 slides.
     */
    private fun buildCarousel(movies: List<MediaListItem>, tv: List<MediaListItem>): List<CarouselSlide> {
        val movieCandidates = movies.filter { it.backdropPath != null && !it.overview.isNullOrBlank() }.take(6)
        val tvCandidates = tv.filter { it.backdropPath != null && !it.overview.isNullOrBlank() }.take(6)
        val inter = mutableListOf<CarouselSlide>()
        val len = maxOf(movieCandidates.size, tvCandidates.size)
        for (i in 0 until len) {
            if (i < movieCandidates.size) inter += CarouselSlide(movieCandidates[i], MediaType.MOVIE)
            if (i < tvCandidates.size) inter += CarouselSlide(tvCandidates[i], MediaType.TV)
        }
        return inter.take(8)
    }

    /** Lazily fills runtime/seasons/genres for the currently visible carousel slide. */
    fun loadSlideExtras(item: MediaListItem, type: MediaType) {
        val key = "${type.tmdb}:${item.id}"
        if (_slideExtras.value.containsKey(key)) return
        viewModelScope.launch {
            val extra = repo.slideExtras(type, item.id)
            _slideExtras.update { it + (key to extra) }
        }
    }

    fun isInWatchlist(item: MediaListItem): Boolean = repo.isInWatchlist(item)

    fun toggleWatchlist(item: MediaListItem) = repo.toggleWatchlist(item)

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

// ---------------------------------------------------------------- Genre

class GenreViewModel(
    private val repo: YStreamRepository,
    private val type: MediaType,
    private val genreId: Int
) : ViewModel() {

    data class UiState(
        val items: List<MediaListItem> = emptyList(),
        val loading: Boolean = true,
        val loadingMore: Boolean = false,
        val end: Boolean = false,
        val error: String? = null,
        val sort: String = "popularity.desc"
    )

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private var page = 0

    init {
        load()
    }

    fun load(sort: String = _ui.value.sort) {
        viewModelScope.launch {
            _ui.update { it.copy(loading = true, error = null, sort = sort) }
            try {
                page = 1
                val items = repo.discover(type, genreId, page, sort)
                _ui.update { it.copy(items = items, loading = false, end = items.isEmpty()) }
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, error = "Couldn't load titles. Try again.") }
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
                val more = repo.discover(type, genreId, page, state.sort)
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
        fun factory(repo: YStreamRepository, type: MediaType, genreId: Int) =
            appRepositoryFactory { GenreViewModel(it, type, genreId) }
    }
}

// ---------------------------------------------------------------- Search

class SearchViewModel(private val repo: YStreamRepository) : ViewModel() {

    data class UiState(
        val query: String = "",
        val results: List<MediaListItem> = emptyList(),
        val loading: Boolean = false,
        val searched: Boolean = false,
        val error: String? = null,
        val movieGenres: List<GenreDto> = emptyList(),
        val tvGenres: List<GenreDto> = emptyList(),
        val genresLoading: Boolean = true
    )

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    val history: StateFlow<List<String>> = repo.history

    private var searchJob: Job? = null

    init {
        loadGenres()
    }

    private fun loadGenres() {
        viewModelScope.launch {
            _ui.update { it.copy(genresLoading = true) }
            try {
                val movieGenres = repo.genres(MediaType.MOVIE)
                val tvGenres = repo.genres(MediaType.TV)
                _ui.update { it.copy(movieGenres = movieGenres, tvGenres = tvGenres, genresLoading = false) }
            } catch (_: Exception) {
                _ui.update { it.copy(genresLoading = false) }
            }
        }
    }

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

    private fun rebuildEmbed() {
        val resume = repo.continueWatching.value.firstOrNull { entry ->
            entry.key() == "${type.tmdb}:$mediaId" &&
                    (type == MediaType.MOVIE || (entry.season == season && entry.episode == episode))
        }
        _embedUrl.value = repo.embedUrl(type, mediaId, season, episode, resume)
    }

    companion object {
        fun factory(repo: YStreamRepository, type: MediaType, id: Long, season: Int?, episode: Int?) =
            appRepositoryFactory { PlayerViewModel(it, type, id, season, episode) }
    }
}
