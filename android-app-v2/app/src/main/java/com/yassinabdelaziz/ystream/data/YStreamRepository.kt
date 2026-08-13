package com.yassinabdelaziz.ystream.data

import com.yassinabdelaziz.ystream.data.model.AgeRating
import com.yassinabdelaziz.ystream.data.model.CastDto
import com.yassinabdelaziz.ystream.data.model.ContinueEntry
import com.yassinabdelaziz.ystream.data.model.DetailsDto
import com.yassinabdelaziz.ystream.data.model.GenreDto
import com.yassinabdelaziz.ystream.data.model.MediaItemDto
import com.yassinabdelaziz.ystream.data.model.MediaListItem
import com.yassinabdelaziz.ystream.data.model.MediaType
import com.yassinabdelaziz.ystream.data.model.resolveMovieCert
import com.yassinabdelaziz.ystream.data.model.resolveTvCert
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

    // ---- Remote data -----------------------------------------------------

    suspend fun trending(type: MediaType, page: Int = 1): List<MediaListItem> =
        api.trending(type.tmdb, page).results
            .filterNot { it.adult }
            .map { it.toListItem(type) }

    suspend fun search(type: MediaType, query: String, page: Int = 1): List<MediaListItem> =
        api.search(type.tmdb, query, page).results
            .filterNot { it.adult }
            .map { it.toListItem(type) }

    suspend fun genres(type: MediaType): List<GenreDto> =
        api.genres(type.tmdb).genres

    suspend fun discover(
        type: MediaType,
        genreId: Int,
        page: Int = 1,
        sortBy: String = "popularity.desc"
    ): List<MediaListItem> =
        api.discover(type.tmdb, genreId, sortBy, page).results
            .filterNot { it.adult }
            .map { it.toListItem(type) }

    data class DetailsBundle(
        val media: MediaListItem,
        val details: DetailsDto,
        val cast: List<CastDto>,
        val moreLikeThis: List<MediaListItem>,
        val ageRating: AgeRating? = null
    )

    suspend fun details(type: MediaType, id: Long): DetailsBundle = coroutineScope {
        val dtoDeferred = async { api.details(type.tmdb, id) }
        val similarDeferred = async { api.similar(type.tmdb, id) }
        val recDeferred = async { api.recommendations(type.tmdb, id) }
        val creditsDeferred = async { api.credits(type.tmdb, id) }
        val certDeferred = async {
            if (type == MediaType.MOVIE) api.movieReleaseDates(id).resolveMovieCert()
            else api.tvContentRatings(id).resolveTvCert()
        }

        val dto = dtoDeferred.await()
        val similar = runCatching { similarDeferred.await() }.getOrNull()
        val recommendations = runCatching { recDeferred.await() }.getOrNull()
        val cast = runCatching { creditsDeferred.await() }.getOrNull()
        val ageRating = runCatching { certDeferred.await() }.getOrNull()

        DetailsBundle(
            media = dto.toListItem(type),
            details = dto,
            cast = cast?.cast?.sortedBy { it.order }?.take(10) ?: emptyList(),
            moreLikeThis = mergeMoreLikeThis(similar?.results, recommendations?.results, type),
            ageRating = ageRating
        )
    }

    suspend fun moreLikeThis(type: MediaType, id: Long): List<MediaListItem> {
        val similar = runCatching { api.similar(type.tmdb, id).results }.getOrNull()
        val rec = runCatching { api.recommendations(type.tmdb, id).results }.getOrNull()
        return mergeMoreLikeThis(similar, rec, type)
    }

    /**
     * Mirrors the website's More Like This scoring: recommendations are worth 2
     * points, similar titles 1, plus 1 extra when a title shows up in both; sorted
     * by score then rating and capped at 14, keeping only titles with posters.
     */
    private fun mergeMoreLikeThis(
        similar: List<MediaItemDto>?,
        recommendations: List<MediaItemDto>?,
        type: MediaType
    ): List<MediaListItem> {
        val scores = mutableMapOf<Long, Pair<MediaItemDto, Int>>()
        recommendations.orEmpty()
            .filterNot { it.adult }
            .filter { it.posterPath != null }
            .forEach { r -> scores[r.id] = r to ((scores[r.id]?.second ?: 0) + 2) }
        similar.orEmpty()
            .filterNot { it.adult }
            .filter { it.posterPath != null }
            .forEach { r -> scores[r.id] = r to ((scores[r.id]?.second ?: 0) + 1) }
        return scores.values
            .sortedWith(compareByDescending<Pair<MediaItemDto, Int>> { it.second }
                .thenByDescending { it.first.voteAverage ?: 0.0 })
            .take(14)
            .map { it.first.toListItem(type) }
    }

    /** Lightweight detail fetch for the homepage carousel's active slide. */
    data class SlideExtra(
        val genres: List<String> = emptyList(),
        val runtime: Int? = null,
        val seasons: Int? = null
    )

    suspend fun slideExtras(type: MediaType, id: Long): SlideExtra = runCatching {
        val dto = api.details(type.tmdb, id)
        SlideExtra(
            genres = dto.genres.orEmpty().mapNotNull { it.name },
            runtime = if (type == MediaType.MOVIE) dto.runtime else null,
            seasons = if (type == MediaType.TV) dto.numberOfSeasons else null
        )
    }.getOrDefault(SlideExtra())

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

    // ---- Playback --------------------------------------------------------

    /**
     * Videasy embed URL - the app's only playback option, mirroring the website's
     * direct-embed model for the default server.
     */
    fun embedUrl(
        type: MediaType,
        id: Long,
        season: Int? = null,
        episode: Int? = null,
        resume: ContinueEntry? = null
    ): String {
        val ts = resume?.positionMs?.div(1000)?.toInt()?.takeIf { it > 10 } ?: 0
        val s = season ?: resume?.season ?: 1
        val e = episode ?: resume?.episode ?: 1
        val color = "ff2e2e"
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
        return "$base?${params.joinToString("&")}"
    }
}
