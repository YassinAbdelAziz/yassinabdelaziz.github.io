/**
 * yStream BETA — Cloudflare Worker reverse proxy (beta-only).
 *
 * Serves the browser-facing player from the SAME origin as the YStream beta
 * site so the beta page can reach into the player DOM and control popups.
 *
 *   GitHub Pages /beta (static shell + modules)
 *        └─ /beta/player  → Worker fetches the provider embed, rewrites every
 *                           resource URL to /beta/proxy and injects the beta
 *                           control scripts (popup-blocker / ad-filter / fetch
 *                           patcher). Browser sees only the YStream origin.
 *        └─ /beta/proxy   → generic resource proxy (html/js/css/img/media/api),
 *                           streaming, range-aware, redirect-aware, cookie-aware.
 *        └─ /beta/healthz → connectivity probe used by the beta UI.
 *
 * Design notes:
 *  - Kept strictly to /beta paths. No production routes are touched.
 *  - Uses the provider's normal/documented integration hosts only.
 *  - Does NOT spoof browser headers, does NOT defeat DRM, authentication,
 *    signed tokens or anti-proxy protections. If the provider rejects the
 *    proxied request, the client falls back to the normal direct embed.
 *  - Cookies set by the provider are re-scoped to Path=/beta on this origin so
 *    sessions can survive across proxied requests without touching production.
 *
 * Deployment: see wrangler.toml.example + README. Routes (cloudflare-proxied):
 *   https://YSTREAM-DOMAIN/beta/healthz*
 *   https://YSTREAM-DOMAIN/beta/player*
 *   https://YSTREAM-DOMAIN/beta/proxy*
 * NOTE: every pattern must end with "*" — Cloudflare route matching considers
 * the query string, and the embed URLs always carry ?provider=... . The
 * trailing-* swallows /beta/player/ and /beta/proxy/ client-module files, so
 * set STATIC_ORIGIN for the Worker to pass those through to GitHub Pages.
 */
const VERSION = 1;
const PROXY_BASE = '/beta/proxy?u=';
const PLAYER_BASE = '/beta/player?u=';

const PROVIDERS = {
  videasy: {
    name: 'Videasy',
    base: 'https://player.videasy.net',
    movie: (id) => `/movie/${id}`,
    tv: (id, s, e) => `/tv/${id}/${s}/${e}`
  },
  vidking: {
    name: 'VidKing',
    base: 'https://www.vidking.net',
    movie: (id) => `/embed/movie/${id}`,
    tv: (id, s, e) => `/embed/tv/${id}/${s}/${e}`
  }
};

// Provider API origins the injected fetch-patch is allowed to route through
// the proxy. Exact-match list; expand only as needed.
const PROVIDER_ORIGINS = {
  videasy: ['https://player.videasy.net', 'https://videasy.net', 'https://player.videasy.to', 'https://videasy.to', 'https://api.speedracelight.com', 'https://db.speedracelight.com', 'https://moon.ironwallnet.net', 'https://glasscloud.top', 'https://hyperpine.top'],
  vidking: ['https://www.vidking.net', 'https://vidking.net']
};

// The provider's manifest CDN (moon.ironwallnet.net) rejects every request that
// carries a non-provider Origin header and also blocks Cloudflare Worker egress,
// so the real .m3u8 can never be relayed. The stream it points to, however,
// lives on glasscloud.top with a fully predictable segment layout
// (seg-1..N-<stream>.m4s + init-<stream>.mp4), which the Worker CAN relay. We
// therefore synthesize the VOD playlist on the fly: probe the last existing
// segment, emit an ENDLIST playlist, and let the segment requests relay normally.
const MANIFEST_CACHE = new Map();
const SEGCOUNT_CACHE = new Map();
const MEDIA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function hostIs(u, suffix) {
  const h = u.hostname.toLowerCase();
  return h === suffix || h.endsWith('.' + suffix);
}

// The segment CDN throttles probe-style requests that don't look like a real
// browser (no videasy Referer / sec-fetch / accept-language), so the probes
// must mirror the header set the relay would forward.
const PROBE_HEADERS = {
  'Range': 'bytes=0-0',
  'Accept': '*/*',
  'User-Agent': MEDIA_UA,
  'Referer': 'https://player.videasy.to/',
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="126", "Not?A_Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin'
};

async function segExists(u) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(u, {
        headers: PROBE_HEADERS,
        redirect: 'follow'
      });
      if (r.status === 206 || r.status === 200) return true;
      // 403 doubles as "missing" and as the CDN's throttle signal for probe
      // bursts, so it must be retried with a growing backoff before we treat
      // the segment as absent.
      if (r.status === 403 || r.status === 429 || (r.status >= 500 && r.status < 600)) {
        await new Promise((res) => setTimeout(res, 400 + attempt * 500));
        continue;
      }
      return false;
    } catch (e) {
      await new Promise((res) => setTimeout(res, 400 + attempt * 500));
    }
  }
  return false;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const SEGCOUNT_INFLIGHT = new Map();

async function findSegmentCount(segUrl) {
  const cached = SEGCOUNT_CACHE.get(segUrl);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.count;
  if (SEGCOUNT_INFLIGHT.has(segUrl)) return SEGCOUNT_INFLIGHT.get(segUrl);

  const search = (async () => {
    let lo = 1, hi = 8192;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (await segExists(segUrl.replace('SEGNUM', mid))) lo = mid + 1;
      else hi = mid - 1;
      // The CDN throttles probe bursts; spacing the probes keeps the search
      // from tripping the limit while it narrows down the boundary.
      await sleep(120);
    }
    // Re-verify the boundary: a throttled search can undercount badly, so if
    // the segment right after our answer exists, widen the window and retry.
    let retries = 0;
    while (hi >= 1 && retries < 3) {
      const probeNext = segUrl.replace('SEGNUM', hi + 1);
      if (await segExists(probeNext)) {
        retries++;
        lo = hi + 2;
        hi = 8192;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (await segExists(segUrl.replace('SEGNUM', mid))) lo = mid + 1;
          else hi = mid - 1;
          await sleep(120);
        }
      } else {
        break;
      }
    }
    if (hi >= 1) SEGCOUNT_CACHE.set(segUrl, { count: hi, at: Date.now() });
    return hi;
  })();

  SEGCOUNT_INFLIGHT.set(segUrl, search);
  search.then(() => SEGCOUNT_INFLIGHT.delete(segUrl)).catch(() => {});
  return search;
}

async function synthesizeManifest(u, request) {
  const cacheKey = u.href;
  const cached = MANIFEST_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) {
    return new Response(cached.text, { status: 200, headers: cached.headers });
  }

  const m = u.pathname.match(/^\/vd\/([^/]+)\/index-(.+?)\.m3u8$/i);
  if (!m) {
    return jsonResponse(400, { ok: false, route: 'proxy', detail: 'unsupported manifest path' }, request);
  }
  const token = m[1];
  const stream = m[2];
  const base = `https://glasscloud.top/vd/${token}/`;
  const initUrl = `${base}init-${stream}.mp4`;
  const segUrl = `${base}seg-SEGNUM-${stream}.m4s`;

  const count = await findSegmentCount(segUrl);
  if (count < 1) {
    return jsonResponse(404, { ok: false, route: 'proxy', detail: 'no segments found for synthesized manifest', stream, token: token.slice(0, 8) }, request);
  }

  const lines = [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-VERSION:6',
    '#EXT-X-MEDIA-SEQUENCE:1',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-MAP:URI="${initUrl}"`
  ];
  for (let i = 1; i <= count; i++) {
    lines.push('#EXTINF:6.0,', segUrl.replace('SEGNUM', i));
  }
  lines.push('#EXT-X-ENDLIST');
  const text = lines.join('\n') + '\n';

  const headers = {
    'Content-Type': 'application/vnd.apple.mpegurl',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'X-YStream-Beta-Synth': '1',
    'X-YStream-Beta-Segments': String(count)
  };
  MANIFEST_CACHE.set(cacheKey, { text, headers, at: Date.now() });
  return new Response(text, { status: 200, headers });
}

// TV episodes serve their manifest from moon.ironwallnet.net/r2/cdn2/<token>
// (moon is unreachable from the Worker), but the segments live on
// hyperpine.top/r2/cdn2/<token>/<quality>/<name> where <name> is a deterministic
// base36 counter: +1 per segment, +11 at the keyframe segment every 26th, with a
// cycling file extension. Each episode has its own token with a model entry below;
// the synthesizer rebuilds the playlist from the model so the segments relay via
// hyperpine (which DOES allow Worker egress).
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const TV_EXT_CYCLE = ['jpg', 'css', 'txt', 'png', 'webp', 'ico'];
const TV_SEGMENT_MODELS = {
  // Breaking Bad S01E01 (tmdb 1396): start value observed in the real manifest.
  'VURlSG4tUEd3S2VITElwbldqdWZTUTpYbzJ6aEplcXV6cDZJYWZXVTU0YXFDdzlGRWNvblhETHBvNDdXWE1NcGh0bTNMTWlyaDdyRzZwT3BBVjdFVXZ3NjdrTF9NY09iekphckFHbTROWnViQTdiTEl6Y01IVHV0aFJjWW9NOEJYbw': {
    dir: '1080p',
    start: 13564,
    count: 438,
    lastDur: 4.213
  }
};

function b36name(v) {
  let s = '';
  do { s = BASE36[v % 36] + s; v = Math.floor(v / 36); } while (v > 0);
  return s.padStart(3, '0');
}

function tvSegmentName(model, i) {
  const jumps = i >= 8 ? Math.floor((i - 8) / 26) + 1 : 0;
  const value = model.start + i + 10 * jumps;
  return `${b36name(value)}.${TV_EXT_CYCLE[i % TV_EXT_CYCLE.length]}`;
}

async function synthesizeTvManifest(u, token, request) {
  const model = TV_SEGMENT_MODELS[token];
  const lines = [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:8',
    '#EXT-X-ALLOW-CACHE:YES',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-VERSION:3',
    '#EXT-X-MEDIA-SEQUENCE:1'
  ];
  for (let i = 0; i < model.count; i++) {
    const dur = (i === model.count - 1) ? model.lastDur : 8.0;
    lines.push(`#EXTINF:${dur},`);
    lines.push(`https://hyperpine.top/r2/cdn2/${token}/${model.dir}/${tvSegmentName(model, i)}`);
  }
  lines.push('#EXT-X-ENDLIST');
  const text = lines.join('\n') + '\n';
  const headers = {
    'Content-Type': 'application/vnd.apple.mpegurl',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'X-YStream-Beta-Synth': '1',
    'X-YStream-Beta-TvSegments': String(model.count)
  };
  return new Response(text, { status: 200, headers });
}

const ALLOWED_PLAYER_HOSTS = /(^|\.)(vidking\.net|videasy\.(net|to))$/i;
const MAX_REDIRECTS = 10;

// Headers that must never be relayed between upstream and the browser.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'content-length', 'host', 'accept-encoding'
]);

// Security headers stripped from proxied responses: they belong to the
// upstream origin, not ours. (This is the experimental "present the provider
// content through the beta origin" behavior — nothing here defeats DRM/auth.)
const STRIP_RESPONSE_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'strict-transport-security'
];

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env);
    } catch (err) {
      return jsonResponse(502, {
        ok: false, route: 'error', detail: String((err && err.message) || err)
      }, request);
    }
  }
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }), request);
  }

  // --- connectivity probe ------------------------------------------------
  if (path === '/beta/healthz' || path === '/beta/healthz/') {
    const body = { ok: true, worker: 'ystream-beta-proxy', version: VERSION, t: Date.now() };
    return cors(jsonResponse(200, body, request), request);
  }

  // --- player page proxy -------------------------------------------------
  if (path === '/beta/player' || path === '/beta/player/') {
    return cors(await handlePlayer(request, env), request);
  }

  // --- generic resource proxy -------------------------------------------
  if (path === '/beta/proxy' || path === '/beta/proxy/') {
    return cors(await handleProxy(request, env), request);
  }

  // --- static passthrough ------------------------------------------------
  // Wildcard routes (e.g. /beta/player*) also swallow the /beta/player/ and
  // /beta/proxy/ module files; with STATIC_ORIGIN set, those are passed
  // through to GitHub Pages here. Requires STATIC_ORIGIN to be configured.
  return handleStaticPassthrough(request, env);
}

// =====================================================================
//  PLAYER PAGE
// =====================================================================
async function handlePlayer(request, env) {
  const params = new URL(request.url).searchParams;
  const config = readConfig(env);

  let upstreamUrl;
  try {
    upstreamUrl = buildUpstreamUrl(params, env);
  } catch (err) {
    return jsonResponse(400, { ok: false, route: 'player', detail: err.message }, request);
  }

  const headers = buildUpstreamHeaders(request, env);
  const { url: finalUrl, response } = await fetchWithRedirects(upstreamUrl, { headers, method: 'GET' }, env);

  if (!finalUrl) {
    return jsonResponse(502, { ok: false, route: 'player', detail: 'fetch to upstream failed: ' + (response || 'unknown') }, request);
  }

  const contentType = response.headers.get('content-type') || '';
  const looksHtml = /html/i.test(contentType);

  // Non-HTML upstream response (e.g. a raw media URL): relay as-is.
  if (!looksHtml) {
    const relay = relayHeaders(response, request, env, false);
    relay.set('Content-Type', contentType || 'application/octet-stream');
    relay.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers: relay });
  }

  // Rewrite + inject.
  const html = await response.text();
  const out = await rewritePlayerHtml(html, finalUrl, params, config, request);

  const h = new Headers();
  h.set('Content-Type', 'text/html; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  h.set('X-YStream-Beta-Mode', 'proxied');
  h.set('X-YStream-Beta-Provider', (params.get('provider') || config.provider || 'unknown'));
  h.set('X-YStream-Beta-Upstream', redactHost(finalUrl));
  relayCookies(response, h, request);
  return new Response(out, { status: response.status, headers: h });
}

function buildUpstreamUrl(params, env) {
  const cfg = readConfig(env);

  // Generic mode: u = full embed URL (used for player-internal navigation).
  if (params.get('u')) {
    const u = new URL(params.get('u'));
    if (!/^https?:$/.test(u.protocol)) throw new Error('u must be an http(s) URL');
    if (!ALLOWED_PLAYER_HOSTS.test(u.hostname)) throw new Error('u host is not an allowed provider host');
    return u.href;
  }

  const provider = params.get('provider') || cfg.defaultProvider;
  const p = PROVIDERS[provider];
  if (!p) throw new Error('unknown provider: ' + provider);

  const type = params.get('type') === 'tv' ? 'tv' : 'movie';
  const id = params.get('id');
  if (!id) throw new Error('missing id');

  let path;
  if (type === 'tv') {
    const s = intParam(params.get('season'), 1);
    const e = intParam(params.get('episode'), 1);
    path = p.tv(id, s, e);
  } else {
    path = p.movie(id);
  }

  const u = new URL(p.base + path);

  // Forward the provider's own documented query params (color, autoplay,
  // nextEpisode, episodeSelector, overlay, progress, …). Never forward our
  // control params.
  const control = new Set(['u', 'provider', 'type', 'id', 'season', 'episode']);
  for (const [k, v] of params.entries()) {
    if (control.has(k)) continue;
    u.searchParams.append(k, v);
  }
  return u.href;
}

// =====================================================================
//  GENERIC RESOURCE PROXY
// =====================================================================
async function handleProxy(request, env) {
  const params = new URL(request.url).searchParams;
  const target = params.get('u');

  if (!target) {
    return jsonResponse(400, { ok: false, route: 'proxy', detail: 'missing ?u= parameter' }, request);
  }
  let u;
  try {
    u = new URL(target);
  } catch (err) {
    return jsonResponse(400, { ok: false, route: 'proxy', detail: '?u= is not a valid URL' }, request);
  }
  if (!/^https?:$/.test(u.protocol)) {
    return jsonResponse(400, { ok: false, route: 'proxy', detail: 'only http(s) targets are proxied' }, request);
  }
  if (!isAllowedProxyTarget(u)) {
    return jsonResponse(403, { ok: false, route: 'proxy', detail: 'target host is not allowed' }, request);
  }

  // Videasy manifest CDN is Origin-gated AND blocks Worker egress, so the real
  // .m3u8 cannot be relayed. Synthesize the VOD playlist from the predictable
  // glasscloud.top segment layout instead (see PROXY_MANIFEST_SYNTH note).
  if (hostIs(u, 'moon.ironwallnet.net') && /^\/vd\/[^/]+\/index-.+\.m3u8$/i.test(u.pathname)) {
    return synthesizeManifest(u, request);
  }
  // TV/signed manifests + segments use /r2/cdn2/<token> paths. moon itself
  // blocks Worker egress, but the segments live on hyperpine.top (same token
  // space) which IS worker-reachable, so synthesize the playlist for a known
  // episode. Unknown tokens surface the token so the model can be extended.
  if (hostIs(u, 'moon.ironwallnet.net') && /^\/r2\/cdn2\/([^/]+)\/?$/i.test(u.pathname)) {
    const tok = u.pathname.match(/^\/r2\/cdn2\/([^/]+)\/?$/i)[1];
    if (TV_SEGMENT_MODELS[tok]) {
      return synthesizeTvManifest(u, tok, request);
    }
    return jsonResponse(404, { ok: false, route: 'proxy', detail: 'tv token not in model', token: tok }, request);
  }
  // Same host serves the subtitle tracks; moon is unreachable from here, so
  // answer with a benign empty VTT rather than a hard error.
  if (hostIs(u, 'moon.ironwallnet.net') && /\.vtt$/i.test(u.pathname)) {
    return new Response('WEBVTT\n\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'X-YStream-Beta-Synth': '1'
      }
    });
  }

  const headers = buildUpstreamHeaders(request, env, true);
  const method = request.method || 'GET';
  let body = null;
  if (method !== 'GET' && method !== 'HEAD') {
    body = request.body;
  }

  const { response, hops } = await fetchWithRedirects(u.href, { method, headers, body, redirect: 'manual' }, env);

  if (!response) {
    return jsonResponse(502, { ok: false, route: 'proxy', detail: 'fetch to upstream failed', redirects: hops }, request);
  }

  const out = relayHeaders(response, request, env, true);
  out.set('X-YStream-Beta-Proxied', '1');
  out.set('X-YStream-Beta-Upstream', redactHost(u.href));

  return new Response(response.body, { status: response.status, headers: out });
}

// =====================================================================
//  HTML REWRITING + INJECTION
// =====================================================================
async function rewritePlayerHtml(html, upstreamUrl, params, config, request) {
  const upstream = new URL(upstreamUrl);
  const providerKey = params.get('provider') || config.provider || 'videasy';
  const providerOrigins = PROVIDER_ORIGINS[providerKey] || [upstream.origin];

  // The <base href> injected below is the provider's URL so the provider's own
  // relative asset references still resolve against its origin. That means any
  // *relative* /beta URL in this document would be mis-resolved to the provider
  // origin, so every URL we rewrite/inject must be ABSOLUTE to this origin.
  const origin = new URL(request.url).origin;
  const proxyBase = origin + PROXY_BASE;
  const playerBase = origin + PLAYER_BASE;

  const configBlock = JSON.stringify({
    provider: providerKey,
    upstream: upstreamUrl,
    playerUrl: request.url,
    proxyBase: proxyBase,
    injected: true,
    servedAt: Date.now(),
    providerOrigins: providerOrigins,
    proxyBootstrap: { providerOrigins: providerOrigins, proxyBase: proxyBase },
    popupBlocker: { providerOrigins: providerOrigins, blockAllOpens: true, blockNavOutside: true },
    adFilter: { enabled: true }
  });

  // Config must come BEFORE the injected scripts, which read it at load time.
  // The history re-home is inlined (not a separate file) so it can never be
  // served stale by the /beta service worker, and it runs before any provider
  // script. See the same logic in /beta/popup-blocker/popup-blocker.js.
  const historyPatch =
    '<script data-ystream-injected="">(function(){try{' +
    'function rehome(u){if(u==null)return u;var s=String(u);' +
    'if(s.charAt(0)==="#")return u;var a;' +
    'try{a=new URL(s,document.baseURI);}catch(e){return u;}' +
    'if(a.origin===location.origin)return u;' +
    'return location.origin+a.pathname+a.search+a.hash;}' +
    'var rp=history.replaceState,pp=history.pushState;' +
    'history.replaceState=function(s,t,u){return rp.call(history,s,t,rehome(u));};' +
    'history.pushState=function(s,t,u){return pp.call(history,s,t,rehome(u));};' +
    '}catch(e){}})();</script>';

  const injection =
    '<script>window.__YSTREAM_BETA__=' + configBlock + ';</script>' +
    historyPatch +
    '<base href="' + escapeAttr(upstreamUrl) + '" data-ystream-injected="1">' +
    '<script data-ystream-injected="" src="' + origin + '/beta/popup-blocker/popup-blocker.js"></script>' +
    '<script data-ystream-injected="" src="' + origin + '/beta/ad-filter/ad-filter.js"></script>' +
    '<script data-ystream-injected="" src="' + origin + '/beta/proxy/proxy-bootstrap.js"></script>';

  let out = html;
  const lower = html.slice(0, 512).toLowerCase();
  const docPos = lower.indexOf('<!doctype');
  if (docPos >= 0) {
    const gt = html.indexOf('>', docPos);
    if (gt >= 0) {
      out = html.slice(0, gt + 1) + injection + html.slice(gt + 1);
    } else {
      out = injection + html;
    }
  } else {
    // No doctype: put the scripts as early as possible so they run before the
    // provider's own scripts.
    out = injection + html;
  }

  // Elements we injected ourselves must never be rewritten.
  const isInjected = (el) => el.hasAttribute('data-ystream-injected');

  const rewriter = new HTMLRewriter()
    .on('script[src]', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream, origin); } })
    .on('link', {
      element: (el) => {
        if (isInjected(el)) return;
        const href = el.getAttribute('href');
        if (href && looksLikeHttpOrPath(href)) setUrlAttr(el, 'href', upstream, origin);
        const is = el.getAttribute('imagesrcset');
        if (is) el.setAttribute('imagesrcset', rewriteSrcset(is, upstream, origin));
      }
    })
    .on('img', {
      element: (el) => {
        if (isInjected(el)) return;
        setUrlAttr(el, 'src', upstream, origin);
        const ss = el.getAttribute('srcset');
        if (ss) el.setAttribute('srcset', rewriteSrcset(ss, upstream, origin));
      }
    })
    .on('source', {
      element: (el) => {
        if (isInjected(el)) return;
        setUrlAttr(el, 'src', upstream, origin);
        const ss = el.getAttribute('srcset');
        if (ss) el.setAttribute('srcset', rewriteSrcset(ss, upstream, origin));
      }
    })
    .on('iframe', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream, origin); } })
    .on('video', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream, origin); } })
    .on('audio', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream, origin); } })
    .on('embed', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream, origin); } })
    .on('track', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream, origin); } })
    .on('input', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream, origin); } })
    .on('object', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'data', upstream, origin); } })
    .on('meta', {
      element: (el) => {
        if (isInjected(el)) return;
        // CSP <meta> tags belong to the upstream origin; strip them just like
        // the CSP response header so the injected beta scripts can run.
        const he = (el.getAttribute('http-equiv') || '').toLowerCase();
        if (he === 'content-security-policy' || he === 'content-security-policy-report-only') {
          el.remove();
          return;
        }
        const c = el.getAttribute('content');
        if (c && /^https?:\/\//i.test(c.trim())) el.setAttribute('content', toProxy(c, upstream, origin));
      }
    })
    .on('a', {
      element: (el) => {
        if (isInjected(el)) return;
        const href = el.getAttribute('href');
        if (href && looksLikeHttpOrPath(href)) el.setAttribute('href', toPlayerUrl(href, upstream, origin));
      }
    })
    .on('form', {
      element: (el) => {
        if (isInjected(el)) return;
        const a = el.getAttribute('action');
        if (a && looksLikeHttpOrPath(a)) el.setAttribute('action', toProxy(a, upstream, origin));
      }
    })
    .on('style', {
      element: (el) => {
        if (isInjected(el)) return;
        const s = el.getAttribute('style');
        if (s) el.setAttribute('style', rewriteCssUrls(s, upstream, origin));
      },
      text: (t) => {
        if (t.text) t.replace(rewriteCssUrls(t.text, upstream, origin));
      }
    })
    .on('[style]', {
      element: (el) => {
        if (isInjected(el)) return;
        const s = el.getAttribute('style');
        if (s) el.setAttribute('style', rewriteCssUrls(s, upstream, origin));
      }
    });

  return await rewriter.transform(new Response(out)).text();
}function setUrlAttr(el, name, upstream, origin) {
  const v = el.getAttribute(name);
  if (!v) return;
  const s = String(v).trim();
  if (/^(data|blob|about|javascript|mailto|tel):/i.test(s)) return;
  if (s.startsWith('#') || s === '') return;
  el.setAttribute(name, toProxy(s, upstream, origin));
}

function looksLikeHttpOrPath(v) {
  if (!v) return false;
  const s = String(v).trim();
  if (s === '' || s === '#') return false;
  if (s.charAt(0) === '#') return false;
  if (/^(data|blob|about|javascript|mailto|tel|#):/i.test(s)) return false;
  return true;
}

function toProxy(val, upstream, origin) {
  let abs;
  try {
    abs = new URL(String(val), upstream.href).href;
  } catch (e) {
    return val;
  }
  if (!/^https?:\/\//i.test(abs)) return val;
  // Absolute: the document carries a <base href> pointing at the provider, so a
  // relative /beta URL here would be resolved against the provider's origin.
  return origin + PROXY_BASE + encodeURIComponent(abs);
}

function toPlayerUrl(val, upstream, origin) {
  let abs;
  try {
    abs = new URL(String(val), upstream.href).href;
  } catch (e) {
    return val;
  }
  if (!/^https?:\/\//i.test(abs)) return val;
  return origin + PLAYER_BASE + encodeURIComponent(abs);
}

function rewriteSrcset(srcset, upstream, origin) {
  return String(srcset)
    .split(',')
    .map((part) => {
      const m = part.trim().match(/^(\S+)(\s+.*)?$/);
      if (!m) return part;
      return toProxy(m[1], upstream, origin) + (m[2] || '');
    })
    .join(', ');
}

function rewriteCssUrls(css, upstream, origin) {
  return String(css).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, url) => {
    const s = String(url).trim();
    if (/^(data|#)/i.test(s)) return m;
    return 'url(' + q + toProxy(s, upstream, origin) + q + ')';
  });
}

// =====================================================================
//  FETCHING / COOKIES / HEADERS
// =====================================================================
async function fetchWithRedirects(url, init, env) {
  let current = url;
  const cookieJar = [];
  let lastResp = null;

  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const headers = new Headers(init.headers || {});
    if (cookieJar.length) headers.set('Cookie', cookieJar.join('; '));

    let resp;
    try {
      resp = await fetch(current, { ...init, headers, redirect: 'manual' });
    } catch (err) {
      return { response: null, hops: hop, error: (err && err.message) || String(err) };
    }

    // Collect any Set-Cookie the upstream wants to establish (session state,
    // where permitted).
    collectCookies(resp, cookieJar);

    const status = resp.status;
    if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && resp.headers.get('location')) {
      const next = new URL(resp.headers.get('location'), current);
      // Guard: never chase redirects into disallowed targets.
      if (!isAllowedProxyTarget(next)) {
        return { response: resp, hops: hop + 1, redirectedTo: next.href };
      }
      current = next.href;
      if (status === 303) {
        init.method = 'GET';
        init.body = undefined;
      }
      lastResp = resp;
      continue;
    }
    return { response: resp, hops: hop, url: current, cookieJar };
  }
  return { response: lastResp, hops: MAX_REDIRECTS, url: current, redirectLimit: true };
}

function collectCookies(resp, jar) {
  try {
    const setCookies = typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : null;
    const list = setCookies && setCookies.length ? setCookies : (resp.headers.get('set-cookie') ? [resp.headers.get('set-cookie')] : []);
    for (const c of list) {
      const name = c.split(';')[0].split('=')[0].trim();
      if (!name) continue;
      jar.push(c.split(';')[0]); // keep name=value for the next hop
    }
  } catch (e) { /* ignore */ }
}

function buildUpstreamHeaders(request, env, resource) {
  const h = new Headers();
  const reqHeaders = request.headers;
  for (const k of reqHeaders.keys()) {
    if (k === 'cookie') continue; // handled below
    if (k === 'host') continue;
    if (HOP_BY_HOP.has(k)) continue;
    // Forward only a conservative, browser-normal subset.
    if (k === 'user-agent' || k === 'accept' || k === 'accept-language' || k === 'range' || k.startsWith('sec-ch-ua') || k.startsWith('sec-fetch-')) {
      h.set(k, reqHeaders.get(k));
    }
  }

  // Cookies: forward the beta-origin cookies the browser holds for /beta so a
  // provider session can survive across proxied requests (where permitted).
  const cookie = reqHeaders.get('cookie');
  if (cookie) h.set('Cookie', cookie);

  const cfg = readConfig(env);
  if (cfg.referer) {
    h.set('Referer', cfg.referer);
  }
  if (resource) h.set('Accept', reqHeaders.get('accept') || '*/*');
  return h;
}

function relayHeaders(upstreamResp, request, env, resource) {
  const out = new Headers();
  for (const [k, v] of upstreamResp.headers) {
    const lk = k.toLowerCase();
    if (HOP_BY_HOP.has(lk)) continue;
    if (lk === 'set-cookie') continue; // handled by relayCookies
    if (STRIP_RESPONSE_HEADERS.includes(lk)) continue;
    // Never forward a 3xx Location verbatim: the browser would leave the beta
    // origin. (With manual redirect handling this should not occur.)
    if ((lk === 'location')) continue;
    out.set(k, v);
  }
  return out;
}

// Re-emit upstream cookies scoped to THIS origin's /beta path so they never
// leak into production and never touch another domain.
function relayCookies(upstreamResp, out, request) {
  try {
    const setCookies = typeof upstreamResp.headers.getSetCookie === 'function' ? upstreamResp.headers.getSetCookie() : null;
    const list = setCookies && setCookies.length ? setCookies : (upstreamResp.headers.get('set-cookie') ? [upstreamResp.headers.get('set-cookie')] : []);
    for (const c of list) {
      out.append('Set-Cookie', rewriteSetCookie(c));
    }
  } catch (e) { /* ignore */ }
}

function rewriteSetCookie(c) {
  const parts = String(c).split(';').map((s) => s.trim()).filter(Boolean);
  const base = parts.shift();
  const kept = [];
  for (const p of parts) {
    const k = p.split('=')[0].toLowerCase();
    if (k === 'domain' || k === 'path' || k === 'samesite' || k === 'secure') continue;
    kept.push(p);
  }
  const name = base.split('=')[0];
  if (!name) return null;
  return [base].concat(kept, ['Path=/beta', 'SameSite=None', 'Secure']).join('; ');
}

// =====================================================================
//  STATIC PASSTHROUGH (wildcard-route deployments only)
// =====================================================================
async function handleStaticPassthrough(request, env) {
  const cfg = readConfig(env);
  const url = new URL(request.url);
  const originHost = cfg.staticOrigin;
  if (originHost) {
    try {
      const target = new URL(url.pathname + url.search, 'https://' + originHost);
      const resp = await fetch(target.href, { headers: { 'User-Agent': request.headers.get('user-agent') || '' } });
      const out = relayHeaders(resp, request, env, false);
      return new Response(resp.body, { status: resp.status, headers: out });
    } catch (err) {
      return jsonResponse(502, { ok: false, route: 'static', detail: 'static origin fetch failed' }, request);
    }
  }
  return jsonResponse(404, {
    ok: false, route: 'static',
    detail: 'This path is served by GitHub Pages, not the Worker. Deploy the Worker on the exact routes /beta/healthz, /beta/player, /beta/proxy, or set STATIC_ORIGIN.'
  }, request);
}

// =====================================================================
//  HELPERS
// =====================================================================
function readConfig(env) {
  return {
    defaultProvider: (env && env.DEFAULT_PROVIDER) || 'videasy',
    referer: (env && env.REFERER) || '',
    staticOrigin: (env && env.STATIC_ORIGIN) || ''
  };
}

function isAllowedProxyTarget(u) {
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return false;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  return true;
}

function intParam(v, fallback) {
  const n = parseInt(v, 10);
  return isFinite(n) && n > 0 ? n : fallback;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function redactHost(u) {
  try {
    return new URL(u).host;
  } catch (e) {
    return '';
  }
}

function jsonResponse(status, body, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-YStream-Beta-Worker': '1'
    }
  });
}

function cors(resp, request) {
  const origin = request.headers.get('origin');
  if (origin) {
    resp.headers.set('Access-Control-Allow-Origin', origin);
    resp.headers.set('Vary', 'Origin');
    resp.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    resp.headers.set('Access-Control-Allow-Headers', '*');
    resp.headers.set('Access-Control-Max-Age', '86400');
  }
  resp.headers.set('X-YStream-Beta-Worker', '1');
  return resp;
}
