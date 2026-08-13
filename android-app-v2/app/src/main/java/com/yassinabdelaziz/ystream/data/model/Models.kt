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
    @SerializedName("adult") val adult: Boolean = false,
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

data class GenreListDto(
    @SerializedName("genres") val genres: List<GenreDto> = emptyList()
)

data class ReleaseDatesDto(
    @SerializedName("results") val results: List<ReleaseCountryDto> = emptyList()
)

data class ReleaseCountryDto(
    @SerializedName("iso_3166_1") val country: String? = null,
    @SerializedName("release_dates") val releaseDates: List<ReleaseDateEntryDto> = emptyList()
)

data class ReleaseDateEntryDto(
    @SerializedName("certification") val certification: String? = null,
    @SerializedName("type") val type: Int = 0,
    @SerializedName("descriptors") val descriptors: List<String> = emptyList(),
    @SerializedName("advisory") val advisory: String? = null
)

data class ContentRatingsDto(
    @SerializedName("results") val results: List<ContentRatingDto> = emptyList()
)

data class ContentRatingDto(
    @SerializedName("iso_3166_1") val country: String? = null,
    @SerializedName("rating") val rating: String? = null,
    @SerializedName("descriptors") val descriptors: List<String> = emptyList(),
    @SerializedName("advisory") val advisory: String? = null
)

/**
 * An age rating for a title, mirroring the website's cert resolution. [label]
 * is the raw certification (e.g. "PG-13") and [reason] holds the content
 * descriptors / advisory used for the detail page's info line.
 */
data class AgeRating(
    val label: String?,
    val reason: String?
) {
    /** Numeric display label (e.g. "13+") matching the website's badge. */
    fun numericLabel(): String {
        val raw = label?.trim()?.lowercase()?.replace(Regex("[^a-z0-9+]"), "") ?: return label ?: ""
        return AGE_RATING_MAP[raw] ?: label ?: ""
    }

    private companion object {
        // Mirrors the website's AGE_RATING_MAP exactly.
        val AGE_RATING_MAP = mapOf(
            "g" to "All", "nr" to "All", "tvy" to "All", "tv-g" to "All", "tvy7" to "7+",
            "tvy7fv" to "7+", "7a" to "7+", "7ap" to "7+", "7a7ap" to "7+", "6" to "6+",
            "6+" to "6+", "7" to "7+", "7+" to "7+", "pg" to "7+", "tvpg" to "7+",
            "pg13" to "13+", "tv14" to "13+", "12" to "12+", "12a" to "12+", "12+" to "12+",
            "13" to "13+", "13+" to "13+", "14" to "14+", "14+" to "14+", "vm14" to "14+",
            "dgf" to "14+", "r" to "17+", "tvma" to "17+", "15" to "15+", "15a" to "15+",
            "15+" to "15+", "16" to "16+", "16+" to "16+", "17" to "17+", "17+" to "17+",
            "m" to "15+", "ma15" to "17+", "ma15+" to "17+", "nc17" to "18+", "x" to "18+",
            "ao" to "18+", "18" to "18+", "18+" to "18+", "18a" to "18+", "18r" to "18+",
            "r18" to "18+", "r18+" to "18+"
        )
    }
}

/** Resolves the movie certification the same way the website does. */
fun ReleaseDatesDto.resolveMovieCert(): AgeRating? {
    val results = results
    val preferred = listOf("US", "GB", "CA", "AU", "IE", "NZ", "FR", "DE", "ES", "IT", "NL", "SE", "NO", "DK", "MX", "BR", "IN")
    fun pick(releaseDates: List<ReleaseDateEntryDto>?): ReleaseDateEntryDto? {
        val valid = releaseDates.orEmpty().filter { !it.certification.isNullOrBlank() }
        if (valid.isEmpty()) return null
        val rank = { d: ReleaseDateEntryDto ->
            when (d.type) {
                3 -> 0; 2 -> 1; 4 -> 2; 5 -> 3; else -> 4
            }
        }
        return valid.minByOrNull(rank)
    }
    for (iso in preferred) {
        val country = results.find { it.country == iso } ?: continue
        val entry = pick(country.releaseDates) ?: continue
        val reason = entry.descriptors.filter { it.isNotBlank() }.joinToString(", ")
            .ifBlank { entry.advisory.orEmpty().trim() }
        return AgeRating(entry.certification, reason.ifBlank { null })
    }
    for (country in results) {
        val entry = pick(country.releaseDates) ?: continue
        val reason = entry.descriptors.filter { it.isNotBlank() }.joinToString(", ")
            .ifBlank { entry.advisory.orEmpty().trim() }
        return AgeRating(entry.certification, reason.ifBlank { null })
    }
    return null
}

/** Resolves the TV content rating the same way the website does. */
fun ContentRatingsDto.resolveTvCert(): AgeRating? {
    val preferred = listOf("US", "GB", "CA", "AU", "IE", "NZ", "FR", "DE")
    for (iso in preferred) {
        val r = results.find { it.country == iso } ?: continue
        if (r.rating.isNullOrBlank()) continue
        val reason = r.descriptors.filter { it.isNotBlank() }.joinToString(", ")
            .ifBlank { r.advisory.orEmpty().trim() }
        return AgeRating(r.rating, reason.ifBlank { null })
    }
    for (r in results) {
        if (r.rating.isNullOrBlank()) continue
        val reason = r.descriptors.filter { it.isNotBlank() }.joinToString(", ")
            .ifBlank { r.advisory.orEmpty().trim() }
        return AgeRating(r.rating, reason.ifBlank { null })
    }
    return null
}

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
