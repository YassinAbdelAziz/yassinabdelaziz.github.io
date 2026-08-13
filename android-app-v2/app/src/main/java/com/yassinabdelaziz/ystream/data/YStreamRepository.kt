package com.yassinabdelaziz.ystream.data

import com.yassinabdelaziz.ystream.data.model.CastDto
import com.yassinabdelaziz.ystream.data.model.ContinueEntry
import com.yassinabdelaziz.ystream.data.model.DetailsDto
import com.yassinabdelaziz.ystream.data.model.MediaListItem
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.data.model.toListItem
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Single source of app data. Combines the remote TMDB API (via the site's worker
 * proxy) with the on-device store, and exposes reactive state for the UI.
 */
class YStreamRepository(private val api: TmdbApi, private val store: LocalStore) {

    private val _watchlist = MutableStateFlow(store.getWatchlist())
    val watchlist: StateFlow<List<MediaListItem>> = _watchlist.asStateFlow()

    private val _continueWatching = MutableStateFlow(
        store.getContinue().sortedByDescending { it.updatedAt }
    )
    val continueWatching: StateFlow<List<ContinueEntry>> = _continueWatching.asStateFlow()

    private val _history = MutableStateFlow(store.getHistory())
    val history: StateFlow<List<String>> = _history.asStateFlow()

    private val _activeServer = MutableStateFlow(store.getActiveServer())
    val activeServer: StateFlow<String> = _activeServer.asStateFlow()

    // ---- Remote data -----------------------------------------------------

    suspend fun trending(type: MediaType, page: Int = 1): List<MediaListItem> =
        api.trending(type.tmdb, page).results.map { it.toListItem(type) }

    suspend fun search(type: MediaType, query: String, page: Int = 1): List<MediaListItem> =
        api.search(type.tmdb, query, page).results.map { it.toListItem(type) }

    data class DetailsBundle(
        val media: MediaListItem,
        val details: DetailsDto,
        val cast: List<CastDto>,
        val moreLikeThis: List<MediaListItem>
    )

    suspend fun details(type: MediaType, id: Long): DetailsBundle = coroutineScope {
        val dtoDeferred = async { api.details(type.tmdb, id) }
        val similarDeferred = async { api.similar(type.tmdb, id) }
        val recDeferred = async { api.recommendations(type.tmdb, id) }
        val creditsDeferred = async { api.credits(type.tmdb, id) }

        val dto = dtoDeferred.await()
        val similar = runCatching { similarDeferred.await() }.getOrNull()
        val recommendations = runCatching { recDeferred.await() }.getOrNull()
        val cast = runCatching { creditsDeferred.await() }.getOrNull()

        DetailsBundle(
            media = dto.toListItem(type),
            details = dto,
            cast = cast?.cast?.sortedBy { it.order }?.take(10) ?: emptyList(),
            moreLikeThis = ((similar?.results ?: emptyList()) + (recommendations?.results ?: emptyList()))
                .map { it.toListItem(type) }
                .distinctBy { it.id }
                .take(12)
        )
    }

    suspend fun moreLikeThis(type: MediaType, id: Long): List<MediaListItem> {
        val similar = api.similar(type.tmdb, id).results.take(10).map { it.toListItem(type) }
        val rec = api.recommendations(type.tmdb, id).results.take(10).map { it.toListItem(type) }
        return (similar + rec).distinctBy { it.id }.take(12)
    }

    // ---- Watchlist -------------------------------------------------------

    fun isInWatchlist(item: MediaListItem): Boolean =
        _watchlist.value.any { it.type == item.type && it.id == item.id }

    fun toggleWatchlist(item: MediaListItem) {
        val current = _watchlist.value
        val exists = current.any { it.type == item.type && it.id == item.id }
        val next = if (exists) current.filterNot { it.type == item.type && it.id == item.id }
        else listOf(item) + current
        _watchlist.value = next
        store.setWatchlist(next)
    }

    // ---- Continue watching ----------------------------------------------

    fun addContinue(entry: ContinueEntry) {
        val current = _continueWatching.value.filterNot { it.key() == entry.key() }
        val next = (listOf(entry) + current).take(50)
        _continueWatching.value = next.sortedByDescending { it.updatedAt }
        store.setContinue(_continueWatching.value)
    }

    fun updateContinueProgress(entry: ContinueEntry) {
        val current = _continueWatching.value
        val existing = current.find { it.key() == entry.key() }
        if (existing == null) {
            addContinue(entry)
            return
        }
        val updated = existing.copy(positionMs = entry.positionMs, durationMs = entry.durationMs, updatedAt = entry.updatedAt)
        val next = current.map { if (it.key() == entry.key()) updated else it }
            .sortedByDescending { it.updatedAt }
        _continueWatching.value = next
        store.setContinue(next)
    }

    fun removeContinue(entry: ContinueEntry) {
        val next = _continueWatching.value.filterNot { it.key() == entry.key() }
        _continueWatching.value = next
        store.setContinue(next)
    }

    // ---- Search history ---------------------------------------------------

    fun addSearchQuery(query: String) {
        val q = query.trim()
        if (q.isEmpty()) return
        val current = _history.value.filterNot { it.equals(q, ignoreCase = true) }
        val next = (listOf(q) + current).take(8)
        _history.value = next
        store.setHistory(next)
    }

    fun removeHistoryQuery(query: String) {
        val next = _history.value.filterNot { it == query }
        _history.value = next
        store.setHistory(next)
    }

    fun clearHistory() {
        _history.value = emptyList()
        store.setHistory(emptyList())
    }

    // ---- Player server ----------------------------------------------------

    fun setActiveServer(server: String) {
        _activeServer.value = server
        store.setActiveServer(server)
    }

    /** Same embed URLs the website loads (direct from the provider hosts). */
    fun embedUrl(
        type: MediaType,
        id: Long,
        server: String,
        season: Int? = null,
        episode: Int? = null,
        resume: ContinueEntry? = null
    ): String {
        val ts = resume?.positionMs?.div(1000)?.toInt()?.takeIf { it > 10 } ?: 0
        val s = season ?: resume?.season ?: 1
        val e = episode ?: resume?.episode ?: 1
        val color = "ff2e2e"
        return when (server) {
            "vidking" -> {
                val base = if (type == MediaType.TV)
                    "https://www.vidking.net/embed/tv/$id/$s/$e"
                else
                    "https://www.vidking.net/embed/movie/$id"
                val params = mutableListOf("color=$color", "autoPlay=true")
                if (type == MediaType.MOVIE && ts > 0) params += "progress=$ts"
                if (type == MediaType.TV) {
                    params += "nextEpisode=true"
                    params += "episodeSelector=true"
                }
                "$base?${params.joinToString("&")}"
            }

            else -> {
                val base = if (type == MediaType.TV)
                    "https://player.videasy.net/tv/$id/$s/$e"
                else
                    "https://player.videasy.net/movie/$id"
                val params = mutableListOf("color=$color", "autoplayNextEpisode=true", "overlay=true")
                if (ts > 0) params += "progress=$ts"
                if (type == MediaType.TV) {
                    params += "nextEpisode=true"
                    params += "episodeSelector=true"
                }
                "$base?${params.joinToString("&")}"
            }
        }
    }
}
