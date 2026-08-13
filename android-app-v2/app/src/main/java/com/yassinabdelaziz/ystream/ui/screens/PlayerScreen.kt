package com.yassinabdelaziz.ystream.ui.screens

import android.annotation.SuppressLint
import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.yassinabdelaziz.ystream.BuildConfig
import com.yassinabdelaziz.ystream.adblock.AdBlocker
import com.yassinabdelaziz.ystream.ui.theme.AccentRed
import com.yassinabdelaziz.ystream.ui.viewmodel.PlayerViewModel
import com.yassinabdelaziz.ystream.web.PlayerShell

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PlayerScreen(
    vm: PlayerViewModel,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val view = LocalView.current
    val embedUrl by vm.embedUrl.collectAsState()
    val bridge by vm.bridge.collectAsState()

    val activity = context as? Activity
    val webViewRef = remember { mutableStateOf<WebView?>(null) }
    val webView = webViewRef.value
    var showSpinner by remember { mutableStateOf(true) }
    var loadedUrl by remember { mutableStateOf<String?>(null) }
    var playbackStarted by remember { mutableStateOf(false) }
    val mainHandler = remember { Handler(Looper.getMainLooper()) }

    // Immersive fullscreen: hide system bars while watching, restore on exit.
    DisposableEffect(Unit) {
        val controller = WindowCompat.getInsetsController(
            (view.context as Activity).window, view
        )
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
        onDispose {
            controller.show(WindowInsetsCompat.Type.systemBars())
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    // Automatically rotate to landscape fullscreen once playback actually starts.
    LaunchedEffect(playbackStarted) {
        if (playbackStarted) {
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
    }

    BackHandler(onBack = onBack)

    LaunchedEffect(bridge, webView) {
        bridge?.let {
            webView?.addJavascriptInterface(it, "AndroidBridge")
            it.onPlaybackStarted = {
                mainHandler.post { playbackStarted = true }
            }
        }
    }

    LaunchedEffect(embedUrl, webView) {
        val url = embedUrl ?: return@LaunchedEffect
        if (url == loadedUrl) return@LaunchedEffect
        loadedUrl = url
        showSpinner = true
        val shell = PlayerShell.html(url)
        webView?.loadDataWithBaseURL(
            BuildConfig.SITE_URL, shell, "text/html", "utf-8", null
        )
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.databaseEnabled = true
                    settings.mediaPlaybackRequiresUserGesture = false
                    settings.setSupportMultipleWindows(false)
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.cacheMode = WebSettings.LOAD_DEFAULT
                    settings.userAgentString =
                        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
                                "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"

                    webChromeClient = object : WebChromeClient() {
                        override fun onCreateWindow(
                            view: WebView, isDialog: Boolean, isUserGesture: Boolean,
                            resultMsg: android.os.Message
                        ): Boolean = false

                        // Videasy's own fullscreen button arrives here. We can't remove
                        // the control from inside the iframe, so treat it as PiP: hand the
                        // whole activity over to picture-in-picture and playback continues
                        // in the PiP window. The user returns to the player (and from there
                        // to the content page) when PiP is closed.
                        override fun onShowCustomView(
                            view: View?,
                            customViewCallback: WebChromeClient.CustomViewCallback
                        ) {
                            val act = activity
                            if (act != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                customViewCallback.onCustomViewHidden()
                                act.enterPictureInPictureMode(PictureInPictureParams.Builder().build())
                            } else {
                                customViewCallback.onCustomViewHidden()
                            }
                        }
                    }

                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView, request: WebResourceRequest
                        ): Boolean = handleUrl(request.url)

                        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                            handleUrl(Uri.parse(url))

                        override fun shouldInterceptRequest(
                            view: WebView, request: WebResourceRequest
                        ): WebResourceResponse? = AdBlocker.maybeBlock(request.url.toString())

                        override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? =
                            AdBlocker.maybeBlock(url)

                        override fun onPageStarted(
                            view: WebView, url: String, favicon: Bitmap?
                        ) {
                            if (url.startsWith("http")) showSpinner = true
                        }

                        override fun onPageFinished(view: WebView, url: String) {
                            showSpinner = false
                            AdBlocker.onPageReady(view, url)
                        }
                    }

                    webViewRef.value = this
                }
            },
            onRelease = { it.destroy() }
        )

        if (showSpinner) {
            CircularProgressIndicator(
                color = AccentRed,
                modifier = Modifier.align(Alignment.Center).size(44.dp)
            )
        }

        IconButton(
            onClick = onBack,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(top = 16.dp, start = 8.dp)
                .clip(RoundedCornerShape(50))
                .background(Color(0x66000000))
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Exit player",
                tint = Color.White
            )
        }
    }
}

private fun handleUrl(uri: Uri): Boolean {
    val scheme = uri.scheme
    if (scheme == "http" || scheme == "https") return false
    return true
}
