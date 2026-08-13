package com.yassinabdelaziz.ystream

import android.app.Application
import com.yassinabdelaziz.ystream.adblock.AdBlocker
import com.yassinabdelaziz.ystream.data.LocalStore
import com.yassinabdelaziz.ystream.data.TmdbApi
import com.yassinabdelaziz.ystream.data.YStreamRepository
import com.yassinabdelaziz.ystream.update.AppUpdater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class YStreamApp : Application() {

    val repository: YStreamRepository by lazy {
        YStreamRepository(TmdbApi.create(), LocalStore(this))
    }

    val updater: AppUpdater by lazy {
        AppUpdater(this, LocalStore(this))
    }

    override fun onCreate() {
        super.onCreate()
        Thread { AdBlocker.ensureLoaded(this) }.start()

        // Look for a newer APK release on startup, then re-check periodically so
        // new releases are detected while the app keeps running.
        CoroutineScope(Dispatchers.Main + SupervisorJob()).launch {
            delay(4000)
            updater.check()
            while (true) {
                delay(UPDATE_CHECK_INTERVAL_MS)
                updater.check()
            }
        }
    }

    private companion object {
        const val UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L
    }
}
