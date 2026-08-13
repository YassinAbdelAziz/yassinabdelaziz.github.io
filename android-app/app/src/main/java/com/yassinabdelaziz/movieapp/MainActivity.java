package com.yassinabdelaziz.movieapp;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;

public class MainActivity extends Activity {

    public static final String SITE_URL = "https://ystream.dpdns.org/";
    public static final String SITE_HOST = Uri.parse(SITE_URL).getHost();

    private WebView webView;
    private View loadingView;
    private View errorView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        enableImmersive();

        webView = findViewById(R.id.webview);
        loadingView = findViewById(R.id.loadingOverlay);
        errorView = findViewById(R.id.errorOverlay);
        Button retry = findViewById(R.id.retryBtn);
        retry.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            webView.loadUrl(SITE_URL);
        });

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/126.0.0.0 Mobile Safari/537.36");

        // Never create additional windows: pop-up ads from embeds go nowhere.
        webView.getSettings().setSupportMultipleWindows(false);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture,
                                          android.os.Message resultMsg) {
                return false; // block all new-window popups
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleExternal(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleExternal(Uri.parse(url));
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return AdBlocker.maybeBlock(url);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return AdBlocker.maybeBlock(request.getUrl().toString());
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (!url.startsWith("http")) return;
                errorView.setVisibility(View.GONE);
                loadingView.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                loadingView.setVisibility(View.GONE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                loadingView.setVisibility(View.GONE);
                AdBlocker.onPageReady(view, url);
                android.util.Log.i("yStream", "page=" + url);
                view.evaluateJavascript(
                        "(function(){var n=document.querySelectorAll('.card').length;"
                                + "var l=document.querySelector('.loading')?1:0;"
                                + "var sc=document.getElementById('nav-shortcuts')?1:0;"
                                + "return 'cards='+n+',loading='+l+',shortcuts='+sc;})()",
                        value -> android.util.Log.i("yStream", "content " + value));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) {
                    loadingView.setVisibility(View.GONE);
                    if (webView.getUrl() == null) errorView.setVisibility(View.VISIBLE);
                }
            }
        });

        // Preload the uBlock filter rules on a background thread so the first
        // request is already protected.
        new Thread(() -> AdBlocker.ensureLoaded(getApplicationContext())).start();

        webView.loadUrl(SITE_URL);
    }

    /** Keep http(s) inside the app; hand other schemes to Android. */
    private boolean handleExternal(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (scheme == null) return false;
        if (scheme.equals("http") || scheme.equals("https")) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
        }
        return true;
    }

    private void enableImmersive() {
        try {
            Window w = getWindow();
            w.setStatusBarColor(android.graphics.Color.TRANSPARENT);
            w.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
            if (Build.VERSION.SDK_INT >= 30) {
                WindowInsetsController c = w.getInsetsController();
                if (c != null) {
                    c.setSystemBarsBehavior(
                            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    c.hide(android.view.WindowInsets.Type.systemBars());
                }
            } else {
                View decor = w.getDecorView();
                if (decor != null) {
                    decor.setSystemUiVisibility(
                            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
                }
            }
        } catch (Exception ignored) {
            // Best-effort immersive mode; never crash the app.
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
