package com.yassinabdelaziz.ystream.web

import android.webkit.JavascriptInterface
import com.yassinabdelaziz.ystream.data.YStreamRepository
import com.yassinabdelaziz.ystream.data.model.ContinueEntry
import com.yassinabdelaziz.ystream.data.model.MediaListItem
import com.yassinabdelaziz.ystream.data.model.MediaType
import org.json.JSONObject
import kotlin.math.floor

/**
 * Receives PLAYER_EVENT postMessages forwarded by [PlayerShell] from the embed
 * providers and mirrors the website's continue-watching logic: progress is saved
 * when the player pauses/seeks/ends or on periodic time updates, and an entry
 * only appears in "Continue Watching" after a few minutes of playback.
 */
class PlayerJsBridge(
    private val repository: YStreamRepository,
    private val item: MediaListItem,
    private val requestedSeason: Int?,
    private val requestedEpisode: Int?
) {

    private val allowedOrigins = setOf(
        "https://www.vidking.net",
        "https://player.videasy.net",
        "https://player.videasy.to"
    )

    @JavascriptInterface
    fun onPlayerEvent(origin: String, raw: String) {
        if (origin !in allowedOrigins) return
        try {
            val root = JSONObject(raw)
            if (root.optString("type") != "PLAYER_EVENT") return
            val data = root.optJSONObject("data") ?: return

            val event = data.optString("event")
            val qualifies = event == "pause" || event == "ended" || event == "seeked" ||
                    (event == "timeupdate" && floor(data.optDouble("currentTime", 0.0)) % 10 == 0.0)
            if (!qualifies) return

            val currentSec = data.optDouble("currentTime", 0.0).coerceIn(0.0, 864000.0)
            if (currentSec <= 0) return

            val isTv = item.type == MediaType.TV
            val season = if (isTv) data.optInt("season", requestedSeason ?: 1) else null
            val episode = if (isTv) data.optInt("episode", requestedEpisode ?: 1) else null

            val entry = ContinueEntry(
                id = item.id,
                type = item.type,
                title = item.title,
                posterPath = item.posterPath,
                backdropPath = item.backdropPath,
                season = season,
                episode = episode,
                positionMs = (currentSec * 1000).toLong(),
                durationMs = (data.optDouble("duration", 0.0) * 1000).toLong(),
                updatedAt = System.currentTimeMillis()
            )
            repository.addContinue(entry)
        } catch (_: Exception) {
            // A malformed frame must never break the player.
        }
    }
}
