package com.yassinabdelaziz.ystream.adblock;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * Applies the uBlock Origin filter lists (compiled into assets/ublock/rules.json)
 * inside the app's embed player WebView. Blocks ad/tracker requests by host and URL
 * pattern, never opens pop-up windows, and hides ad elements with cosmetic filtering.
 */
public final class AdBlocker {

    private static final class UrlRule {
        final String lit;   // cheapest literal gate; null = always run regex
        final Pattern pattern;

        UrlRule(String lit, String re) {
            this.lit = lit;
            this.pattern = re == null ? null : Pattern.compile(re);
        }

        boolean matches(String url) {
            if (pattern == null) return false;
            if (lit != null && !url.contains(lit)) return false;
            return pattern.matcher(url).find();
        }
    }

    // Origins yStream itself relies on (site, API, provider embeds + their media
    // CDNs): never blocked so playback can never be broken by a filter hit.
    private static final Set<String> ALLOW = new HashSet<>(Arrays.asList(
            "yassinabdelaziz.github.io",
            "ystream.dpdns.org",
            "screenify-worker.yassinmovies.workers.dev",
            "api.themoviedb.org",
            "image.tmdb.org",
            "video.tmdb.org",
            "fonts.googleapis.com",
            "fonts.gstatic.com",
            "cdnjs.cloudflare.com",
            "www.vidking.net",
            "vidking.net",
            "player.videasy.net",
            "player.videasy.to",
            "videasy.net",
            "videasy.to",
            "api.speedracelight.com",
            "db.speedracelight.com",
            "moon.ironwallnet.net",
            "glasscloud.top",
            "hyperpine.top"
    ));

    private static final AtomicBoolean loaded = new AtomicBoolean(false);

    private static Set<String> blockHosts = new HashSet<>();
    private static Set<String> exceptions = new HashSet<>();
    private static List<UrlRule> urlPatterns = new ArrayList<>();
    private static List<UrlRule> exceptionUrls = new ArrayList<>();
    private static List<String> cosmeticGeneric = new ArrayList<>();
    private static Map<String, List<String>> cosmeticDomains = new HashMap<>();

    private AdBlocker() {
    }

    /** Loads the compiled filter rules once. Call from a background thread. */
    public static void ensureLoaded(Context context) {
        if (loaded.get()) return;
        synchronized (AdBlocker.class) {
            if (loaded.get()) return;
            try {
                InputStream in = context.getAssets().open("ublock/rules.json");
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                in.close();
                JSONObject root = new JSONObject(out.toString("UTF-8"));

                Set<String> bh = new HashSet<>();
                JSONArray arr = root.optJSONArray("blockHosts");
                if (arr != null) for (int i = 0; i < arr.length(); i++) bh.add(arr.getString(i));
                Set<String> ex = new HashSet<>();
                arr = root.optJSONArray("exceptions");
                if (arr != null) for (int i = 0; i < arr.length(); i++) ex.add(arr.getString(i));
                List<UrlRule> up = parseRules(root.optJSONArray("urlPatterns"));
                List<UrlRule> exu = parseRules(root.optJSONArray("exceptionUrls"));
                List<String> cg = new ArrayList<>();
                arr = root.optJSONArray("cosmeticGeneric");
                if (arr != null) for (int i = 0; i < arr.length(); i++) cg.add(arr.getString(i));
                Map<String, List<String>> cd = new HashMap<>();
                JSONObject dom = root.optJSONObject("cosmeticDomains");
                if (dom != null) {
                    java.util.Iterator<String> keys = dom.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        JSONArray v = dom.optJSONArray(k);
                        List<String> list = new ArrayList<>();
                        if (v != null) for (int i = 0; i < v.length(); i++) list.add(v.getString(i));
                        cd.put(k, list);
                    }
                }

                blockHosts = bh;
                exceptions = ex;
                urlPatterns = up;
                exceptionUrls = exu;
                cosmeticGeneric = cg;
                cosmeticDomains = cd;
                loaded.set(true);
            } catch (Exception e) {
                // No rules loaded -> nothing is blocked. Playback stays safe.
                loaded.set(false);
            }
        }
    }

    private static List<UrlRule> parseRules(JSONArray arr) {
        List<UrlRule> list = new ArrayList<>();
        if (arr == null) return list;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            String lit = o.optString("lit", null);
            String re = o.optString("re", null);
            if (re == null) continue;
            try {
                list.add(new UrlRule(lit, re));
            } catch (Exception e) {
                // Skip one malformed pattern; never disable the whole blocker.
            }
        }
        return list;
    }

    /** Returns a blocked (empty) response, or null to let the request load. */
    public static WebResourceResponse maybeBlock(String url) {
        if (!loaded.get() || url == null) return null;
        if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
        if (shouldBlock(url)) {
            return new WebResourceResponse(
                    "text/plain", "utf-8", 200, "Blocked",
                    java.util.Collections.emptyMap(),
                    new ByteArrayInputStream(new byte[0]));
        }
        return null;
    }

    private static boolean shouldBlock(String url) {
        // Allow-list for origins yStream depends on.
        Uri uri = Uri.parse(url);
        String host = uri.getHost();
        if (host == null) return false;
        String low = host.toLowerCase();
        if (ALLOW.contains(low)) return false;

        // Host-suffix match against root-domain block/exception sets.
        boolean hostBlocked = false;
        List<String> suffixes = hostSuffixes(low);
        for (String s : suffixes) {
            if (exceptions.contains(s)) return false; // @@||domain^ overrides
        }
        for (String s : suffixes) {
            if (blockHosts.contains(s)) {
                hostBlocked = true;
                break;
            }
        }

        // Allow-list URL regexes first (they whitelist exact paths/patterns).
        for (UrlRule r : exceptionUrls) {
            if (r.matches(url)) return false;
        }
        if (hostBlocked) return true;

        // Remaining URL patterns (host+path, substring, anchored).
        for (UrlRule r : urlPatterns) {
            if (r.matches(url)) return true;
        }
        return false;
    }

    private static List<String> hostSuffixes(String host) {
        List<String> out = new ArrayList<>();
        String[] parts = host.split("\\.");
        for (int i = 0; i < parts.length - 1; i++) {
            StringBuilder sb = new StringBuilder();
            for (int j = i; j < parts.length; j++) {
                if (j > i) sb.append('.');
                sb.append(parts[j]);
            }
            out.add(sb.toString());
        }
        out.add(host);
        return out;
    }

    /**
     * Injected after each page load: removes any leftover Shortcuts sidebar entry
     * (from a stale service-worker cache) and applies cosmetic ad hiding.
     */
    public static void onPageReady(WebView webView, String url) {
        ensureLoaded(webView.getContext());
        String host = Uri.parse(url).getHost();
        String css = cosmeticCss(host);
        StringBuilder js = new StringBuilder();
        js.append("(function(){try{");
        js.append("var s=document.getElementById('nav-shortcuts');if(s&&s.parentNode)s.parentNode.removeChild(s);");
        js.append("document.querySelectorAll('.nav-section-label').forEach(function(l){if(l.textContent.replace(/\\s+/g,'')==='More'){var n=l.nextElementSibling;if(!n||!n.className||n.className.indexOf('nav-item')===-1)l.parentNode.removeChild(l);}});");
        js.append("var st=document.getElementById('ystream-ubo');if(st)st.parentNode&&st.parentNode.removeChild(st);");
        if (css != null && css.length() > 0) {
            String esc = css.replace("\\", "\\\\")
                    .replace("\n", "\\n")
                    .replace("\r", "\\r")
                    .replace("'", "\\'");
            js.append("var el=document.createElement('style');el.id='ystream-ubo';");
            js.append("el.textContent='").append(esc).append("';");
            js.append("document.head.appendChild(el);");
        }
        js.append("}catch(e){}})();");
        webView.evaluateJavascript(js.toString(), null);
    }

    private static final int COSMETIC_INJECT_LIMIT = 5000;

    private static String cosmeticCss(String host) {
        StringBuilder sb = new StringBuilder();
        if (cosmeticGeneric != null) {
            int n = Math.min(cosmeticGeneric.size(), COSMETIC_INJECT_LIMIT);
            for (int i = 0; i < n; i++) {
                sb.append(cosmeticGeneric.get(i)).append("{display:none!important;}\n");
            }
        }
        if (host != null && cosmeticDomains != null) {
            String low = host.toLowerCase();
            for (String s : hostSuffixes(low)) {
                List<String> sels = cosmeticDomains.get(s);
                if (sels != null) {
                    for (String sel : sels) {
                        sb.append(sel).append("{display:none!important;}\n");
                    }
                }
            }
        }
        return sb.length() == 0 ? null : sb.toString();
    }
}
