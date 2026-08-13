package com.yassinabdelaziz.ystream.data.model

import com.google.gson.annotations.SerializedName

enum class MediaType(val tmdb: String) {
    MOVIE("movie"),
    TV("tv")
}

data class MediaItemDto(
    @SerializedName("id") val id: Long = 0,
    @SerializedName("title") val title: String? = null,
    @SerializedName("name") val name: String? = null,
    @SerializedName("overview") val overview: String? = null,
    @SerializedName("poster_path") val posterPath: String? = null,
    @SerializedName("backdrop_path") val backdropPath: String? = null,
    @SerializedName("vote_average") val voteAverage: Double? = null,
    @SerializedName("release_date") val releaseDate: String? = null,
    @SerializedName("first_air_date") val firstAirDate: String? = null,
    @SerializedName("media_type") val mediaType: String? = null,
    @SerializedName("popularity") val popularity: Double? = null,
    @SerializedName("genre_ids") val genreIds: List<Int>? = null
) {
    fun displayTitle(): String = title ?: name ?: ""
    fun displayDate(): String = releaseDate ?: firstAirDate ?: ""
}

data class MediaListResponse(
    @SerializedName("page") val page: Int = 1,
    @SerializedName("results") val results: List<MediaItemDto> = emptyList(),
    @SerializedName("total_pages") val totalPages: Int = 1
)

data class GenreDto(
    @SerializedName("id") val id: Int = 0,
    @SerializedName("name") val name: String? = null
)

data class SeasonDto(
    @SerializedName("season_number") val seasonNumber: Int = 0,
    @SerializedName("name") val name: String? = null,
    @SerializedName("air_date") val airDate: String? = null,
    @SerializedName("episode_count") val episodeCount: Int = 0,
    @SerializedName("poster_path") val posterPath: String? = null,
    @SerializedName("overview") val overview: String? = null
)

data class CastDto(
    @SerializedName("id") val id: Long = 0,
    @SerializedName("name") val name: String? = null,
    @SerializedName("character") val character: String? = null,
    @SerializedName("profile_path") val profilePath: String? = null,
    @SerializedName("order") val order: Int = 0
)

data class CreditsDto(
    @SerializedName("cast") val cast: List<CastDto> = emptyList()
)

data class DetailsDto(
    @SerializedName("id") val id: Long = 0,
    @SerializedName("title") val title: String? = null,
    @SerializedName("name") val name: String? = null,
    @SerializedName("overview") val overview: String? = null,
    @SerializedName("poster_path") val posterPath: String? = null,
    @SerializedName("backdrop_path") val backdropPath: String? = null,
    @SerializedName("vote_average") val voteAverage: Double? = null,
    @SerializedName("release_date") val releaseDate: String? = null,
    @SerializedName("first_air_date") val firstAirDate: String? = null,
    @SerializedName("genres") val genres: List<GenreDto>? = null,
    @SerializedName("runtime") val runtime: Int? = null,
    @SerializedName("episode_run_time") val episodeRunTime: List<Int>? = null,
    @SerializedName("number_of_seasons") val numberOfSeasons: Int? = null,
    @SerializedName("number_of_episodes") val numberOfEpisodes: Int? = null,
    @SerializedName("seasons") val seasons: List<SeasonDto>? = null,
    @SerializedName("status") val status: String? = null,
    @SerializedName("tagline") val tagline: String? = null,
    @SerializedName("credits") val credits: CreditsDto? = null,
    @SerializedName("recommendations") val recommendations: MediaListResponse? = null,
    @SerializedName("similar") val similar: MediaListResponse? = null
) {
    fun displayTitle(): String = title ?: name ?: ""
    fun displayDate(): String = releaseDate ?: firstAirDate ?: ""
}

/**
 * App-level media item used across the UI: a TMDB DTO combined with the
 * context-provided media type (trending/search do not always carry media_type).
 */
data class MediaListItem(
    val id: Long,
    val type: MediaType,
    val title: String,
    val overview: String?,
    val posterPath: String?,
    val backdropPath: String?,
    val voteAverage: Double?,
    val year: String?
) {
    fun posterUrl(width: String = "w500"): String? =
        posterPath?.let { "https://image.tmdb.org/t/p/$width$it" }

    fun backdropUrl(width: String = "w780"): String? =
        backdropPath?.let { "https://image.tmdb.org/t/p/$width$it" }
}

/** A saved spot in playback so the user can pick up where they left off. */
data class ContinueEntry(
    val id: Long,
    val type: MediaType,
    val title: String,
    val posterPath: String?,
    val backdropPath: String?,
    val season: Int? = null,
    val episode: Int? = null,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val updatedAt: Long = 0L
) {
    fun key(): String = "${type.tmdb}:$id"
}

fun MediaItemDto.toListItem(type: MediaType): MediaListItem {
    val year = displayDate().take(4).ifEmpty { null }
    return MediaListItem(
        id = id,
        type = type,
        title = displayTitle(),
        overview = overview,
        posterPath = posterPath,
        backdropPath = backdropPath,
        voteAverage = voteAverage,
        year = year
    )
}

fun DetailsDto.toListItem(type: MediaType): MediaListItem {
    val year = displayDate().take(4).ifEmpty { null }
    return MediaListItem(
        id = id,
        type = type,
        title = displayTitle(),
        overview = overview,
        posterPath = posterPath,
        backdropPath = backdropPath,
        voteAverage = voteAverage,
        year = year
    )
}
