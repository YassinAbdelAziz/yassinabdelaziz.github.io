/**
 * embed-proxy.js — Cloudflare Worker "embed proxy"
 *
 * Why: third-party video-embed hosts (vidking.net, player.videasy.net) detect the
 * iframe `sandbox` attribute and refuse to play. This worker proxies the embed
 * through our own origin with NO sandbox (so embeds behave / don't detect sandbox)
 * while injecting a script that makes every popup / pop-under / target=_blank dead.
 *
 * Flow:
 *   1) index.html points its <iframe> at: /embed?url=<urlencoded original embed>
 *   2) This worker fetches that page server-side.
 *   3) Rewrites relative asset URLs -> absolute, strips any incoming CSP (so our
 *      injected script can run), and injects a popup-blocker <script> on top.
 *   4) Serves the modified HTML to the (now sandbox-free) iframe.
 *
 * Deploy: ES-module Cloudflare Worker, route /embed. Point EMBED_PROXY in
 * index.html at it. Set EMBED_PROXY='' to fall back to a direct, sandbox-free
 * (still popup-prone) embed.
 *
 * IMPORTANT DEPLOYMENT WARNING:
 * This file ONLY implements the /embed route. Do NOT wholesale-replace your
 * existing worker with this file if that worker also proxies TMDB (screenify-worker
 * serves /api/tmdb). Instead either:
 *   (a) add this /embed handler into your existing worker source, OR
 *   (b) deploy this as a SEPARATE worker and update EMBED_PROXY in index.html to
 *       that worker's /embed URL (e.g. https://your-new-worker.workers.dev/embed).
 *
 * Notes:
 * - Only the top-level HTML is proxied. Video <video src> / absolute URLs stream
 *   straight from the CDN, so normal playback + Range requests are unaffected.
 * - If an embed resolves its stream via a same-origin XHR on the player host, the
 *   proxy makes that XHR cross-origin and it could fail. Most of these players
 *   resolve the source server-side (hence autoPlay/nextEpisode/episodeSelector),
 *   so this is usually not an issue.
 */

const ALLOWED_HOSTS = new Set(['www.vidking.net', 'player.videasy.net']);
const TIMEOUT_MS = 20000;
// Injected at the top of every proxied page, before any site script runs.
const BLOCKER_SCRIPT = `<script>
(function () {
  function noop() {}
  // Fake, already-closed window returned by window.open so nothing new opens.
  function blankWindow() {
    return { closed: true, close: noop, focus: noop, blur: noop, stop: noop,
             postMessage: noop, document: null, location: { href: 'about:blank' } };
  }
  try {
    Object.defineProperty(window, 'open', {
      value: function () { return blankWindow(); },
      writable: false, configurable: false
    });
  } catch (e) {
    try { window.open = function () { return blankWindow(); }; } catch (_) {}
  }
  try { window.showModalDialog = function () { return null; }; } catch (e) {}
  // Kill <a target="_blank"> / <area target="_blank"> "new tab" popups.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest
      ? e.target.closest('a[target="_blank"], area[target="_blank"]') : null;
    if (a) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
  }, true);
})();
</script>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/embed') {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }

    const raw = url.searchParams.get('url') || '';
    let target;
    try { target = new URL(raw); } catch {
      return new Response('Bad url', { status: 400, headers: { 'Content-Type': 'text/plain' } });
    }

    // Open-proxy protection: https only + exact host allowlist.
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
      return new Response('Forbidden host', { status: 403, headers: { 'Content-Type': 'text/plain' } });
    }

    const upstream = await fetch(target.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': request.headers.get('User-Agent') ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': request.headers.get('Accept-Language') || 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const ctype = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !ctype.includes('text/html')) {
      // Upstream error or non-HTML — pass it through untouched.
      return new Response(upstream.body, {
        status: upstream.status,
        headers: stripForEmbed(upstream.headers),
      });
    }

    let html = await upstream.text();
    html = rewriteRelativeUrls(html, target.toString());
    html = injectBlocker(html);

    const headers = new Headers({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Frame-Options': 'ALLOWALL',
    });
    return new Response(html, { status: 200, headers });
  },
};
// Copy upstream headers but drop anything that would block our injected script or
// that leaks cross-origin intent back to the embed.
function stripForEmbed(headers) {
  const out = new Headers();
  const drop = new Set([
    'content-security-policy', 'content-security-policy-report-only',
    'x-content-security-policy', 'x-webkit-csp',
  ]);
  for (const [k, v] of headers) {
    if (!drop.has(k.toLowerCase())) out.set(k, v);
  }
  out.set('Cache-Control', 'no-store');
  out.set('X-Content-Type-Options', 'nosniff');
  out.set('Referrer-Policy', 'no-referrer');
  return out;
}

// Put our script before any real content so it runs first.
function injectBlocker(html) {
  const tags = ['<head', '<body'];
  for (const tag of tags) {
    const idx = html.toLowerCase().indexOf(tag);
    if (idx !== -1) {
      const after = html.indexOf('>', idx) + 1;
      return html.slice(0, after) + BLOCKER_SCRIPT + html.slice(after);
    }
  }
  return BLOCKER_SCRIPT + html;
}

// Rewrite relative resource URLs (src/href/srcset/poster + CSS url()) to absolute
// against the original embed page, so assets keep loading even though we serve the
// HTML from a different origin. Absolute/canonical URLs are left alone.
const ABSOLUTE_RE = /^\s*(?:https?:)?\/\//i;
const SKIP_RE = /^\s*(?:data:|javascript:|blob:|about:|mailto:|tel:|#)/i;

function rewriteRelativeUrls(html, base) {
  const fix = (v) => {
    const t = (v || '').trim();
    if (!t || ABSOLUTE_RE.test(t) || SKIP_RE.test(t)) return v;
    try { return new URL(t, base).href; } catch { return v; }
  };

  let out = html;
  const attrRe = /\s(?:src|href|poster|data-src|data-href)="([^"]*)"/gi;
  out = out.replace(attrRe, (m, val) => m.replace(val, fix(val)));
  const attrSqRe = /\s(?:src|href|poster|data-src|data-href)='([^']*)'/gi;
  out = out.replace(attrSqRe, (m, val) => m.replace(val, fix(val)));

  out = out.replace(/srcset="([^"]*)"/gi, (m, list) =>
    'srcset="' + list.split(',').map((p) => {
      const parts = p.trim().split(/\s+/);
      try { parts[0] = new URL(parts[0], base).href; } catch {}
      return parts.join(' ');
    }).join(',') + '"');

  out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
    const t = u.trim();
    if (ABSOLUTE_RE.test(t) || SKIP_RE.test(t)) return m;
    try { return 'url(' + q + new URL(t, base).href + q + ')'; } catch { return m; }
  });

  return out;
}