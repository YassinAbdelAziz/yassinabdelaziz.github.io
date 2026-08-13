package com.yassinabdelaziz.ystream.data

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.yassinabdelaziz.ystream.data.model.ContinueEntry
import com.yassinabdelaziz.ystream.data.model.MediaListItem

/**
 * App-local persistence, mirroring what the website keeps in localStorage:
 * watchlist, continue-watching, search history and the active player server.
 * Stored as JSON in SharedPreferences via Gson.
 */
class LocalStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("ystream_store", Context.MODE_PRIVATE)
    private val gson = Gson()

    private fun <T> readJson(key: String, typeToken: TypeToken<T>, default: T): T {
        val raw = prefs.getString(key, null) ?: return default
        return try {
            gson.fromJson(raw, typeToken.type)
        } catch (_: Exception) {
            default
        }
    }

    private fun <T> writeJson(key: String, value: T) {
        prefs.edit().putString(key, gson.toJson(value)).apply()
    }

    fun getWatchlist(): List<MediaListItem> =
        readJson(KEY_WATCHLIST, object : TypeToken<List<MediaListItem>>() {}, emptyList())

    fun setWatchlist(list: List<MediaListItem>) = writeJson(KEY_WATCHLIST, list)

    fun getContinue(): List<ContinueEntry> =
        readJson(KEY_CONTINUE, object : TypeToken<List<ContinueEntry>>() {}, emptyList())

    fun setContinue(list: List<ContinueEntry>) = writeJson(KEY_CONTINUE, list)

    fun getHistory(): List<String> =
        readJson(KEY_HISTORY, object : TypeToken<List<String>>() {}, emptyList())

    fun setHistory(list: List<String>) = writeJson(KEY_HISTORY, list)

    fun getActiveServer(): String = prefs.getString(KEY_SERVER, "videasy") ?: "videasy"

    fun setActiveServer(server: String) {
        prefs.edit().putString(KEY_SERVER, server).apply()
    }

    private companion object {
        const val KEY_WATCHLIST = "watchlist"
        const val KEY_CONTINUE = "continue_watching"
        const val KEY_HISTORY = "search_history"
        const val KEY_SERVER = "active_server"
    }
}
