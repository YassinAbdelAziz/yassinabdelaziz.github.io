package com.yassinabdelaziz.ystream.ui.screens

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
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
import com.yassinabdelaziz.ystream.ui.theme.TextSecondary
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
    val server by vm.server.collectAsState()

    val webViewRef = remember { mutableStateOf<WebView?>(null) }
    val webView = webViewRef.value
    var showSpinner by remember { mutableStateOf(true) }
    var loadedUrl by remember { mutableStateOf<String?>(null) }

    // Immersive fullscreen: hide system bars while watching, restore on exit.
    DisposableEffect(Unit) {
        val controller = WindowCompat.getInsetsController(
            (view.context as Activity).window, view
        )
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
        onDispose { controller.show(WindowInsetsCompat.Type.systemBars()) }
    }

    BackHandler(onBack = onBack)

    LaunchedEffect(bridge, webView) {
        bridge?.let { webView?.addJavascriptInterface(it, "AndroidBridge") }
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

        Row(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = 20.dp, end = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            ServerPill("Videasy", server == "videasy") { vm.setServer("videasy") }
            ServerPill("Vidking", server == "vidking") { vm.setServer("vidking") }
        }
    }
}

@Composable
private fun ServerPill(
    label: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    androidx.compose.material3.TextButton(
        onClick = onClick,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (selected) AccentRed else Color(0x66000000))
    ) {
        Text(
            text = label,
            color = if (selected) Color.White else TextSecondary,
            style = androidx.compose.material3.MaterialTheme.typography.labelLarge
        )
    }
}

private fun handleUrl(uri: Uri): Boolean {
    val scheme = uri.scheme
    if (scheme == "http" || scheme == "https") return false
    return true
}
