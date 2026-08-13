package com.yassinabdelaziz.ystream

import android.app.Application
import com.yassinabdelaziz.ystream.adblock.AdBlocker
import com.yassinabdelaziz.ystream.data.LocalStore
import com.yassinabdelaziz.ystream.data.TmdbApi
import com.yassinabdelaziz.ystream.data.YStreamRepository

class YStreamApp : Application() {

    val repository: YStreamRepository by lazy {
        YStreamRepository(TmdbApi.create(), LocalStore(this))
    }

    override fun onCreate() {
        super.onCreate()
        Thread { AdBlocker.ensureLoaded(this) }.start()
    }
}
