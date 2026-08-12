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
  videasy: ['https://player.videasy.net', 'https://videasy.net', 'https://player.videasy.to', 'https://videasy.to'],
  vidking: ['https://www.vidking.net', 'https://vidking.net']
};

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

  const configBlock = JSON.stringify({
    provider: providerKey,
    upstream: upstreamUrl,
    playerUrl: request.url,
    proxyBase: PROXY_BASE,
    injected: true,
    servedAt: Date.now(),
    providerOrigins: providerOrigins,
    proxyBootstrap: { providerOrigins: providerOrigins, proxyBase: PROXY_BASE },
    popupBlocker: { providerOrigins: providerOrigins, blockAllOpens: true, blockNavOutside: true },
    adFilter: { enabled: true }
  });

  // Config must come BEFORE the injected scripts, which read it at load time.
  const injection =
    '<script>window.__YSTREAM_BETA__=' + configBlock + ';</script>' +
    '<base href="' + escapeAttr(upstreamUrl) + '" data-ystream-injected="1">' +
    '<script data-ystream-injected="" src="/beta/popup-blocker/popup-blocker.js"></script>' +
    '<script data-ystream-injected="" src="/beta/ad-filter/ad-filter.js"></script>' +
    '<script data-ystream-injected="" src="/beta/proxy/proxy-bootstrap.js"></script>';

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
    .on('script[src]', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream); } })
    .on('link', {
      element: (el) => {
        if (isInjected(el)) return;
        const href = el.getAttribute('href');
        if (href && looksLikeHttpOrPath(href)) setUrlAttr(el, 'href', upstream);
        const is = el.getAttribute('imagesrcset');
        if (is) el.setAttribute('imagesrcset', rewriteSrcset(is, upstream));
      }
    })
    .on('img', {
      element: (el) => {
        if (isInjected(el)) return;
        setUrlAttr(el, 'src', upstream);
        const ss = el.getAttribute('srcset');
        if (ss) el.setAttribute('srcset', rewriteSrcset(ss, upstream));
      }
    })
    .on('source', {
      element: (el) => {
        if (isInjected(el)) return;
        setUrlAttr(el, 'src', upstream);
        const ss = el.getAttribute('srcset');
        if (ss) el.setAttribute('srcset', rewriteSrcset(ss, upstream));
      }
    })
    .on('iframe', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream); } })
    .on('video', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream); } })
    .on('audio', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream); } })
    .on('embed', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream); } })
    .on('track', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream); } })
    .on('input', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'src', upstream); } })
    .on('object', { element: (el) => { if (!isInjected(el)) setUrlAttr(el, 'data', upstream); } })
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
        if (c && /^https?:\/\//i.test(c.trim())) el.setAttribute('content', toProxy(c, upstream));
      }
    })
    .on('a', {
      element: (el) => {
        if (isInjected(el)) return;
        const href = el.getAttribute('href');
        if (href && looksLikeHttpOrPath(href)) el.setAttribute('href', toPlayerUrl(href, upstream));
      }
    })
    .on('form', {
      element: (el) => {
        if (isInjected(el)) return;
        const a = el.getAttribute('action');
        if (a && looksLikeHttpOrPath(a)) el.setAttribute('action', toProxy(a, upstream));
      }
    })
    .on('style', {
      element: (el) => {
        if (isInjected(el)) return;
        const s = el.getAttribute('style');
        if (s) el.setAttribute('style', rewriteCssUrls(s, upstream));
      },
      text: (t) => {
        if (t.text) t.replace(rewriteCssUrls(t.text, upstream));
      }
    })
    .on('[style]', {
      element: (el) => {
        if (isInjected(el)) return;
        const s = el.getAttribute('style');
        if (s) el.setAttribute('style', rewriteCssUrls(s, upstream));
      }
    });

  return await rewriter.transform(new Response(out)).text();
}function setUrlAttr(el, name, upstream) {
  const v = el.getAttribute(name);
  if (!v) return;
  const s = String(v).trim();
  if (/^(data|blob|about|javascript|mailto|tel):/i.test(s)) return;
  if (s.startsWith('#') || s === '') return;
  el.setAttribute(name, toProxy(s, upstream));
}

function looksLikeHttpOrPath(v) {
  if (!v) return false;
  const s = String(v).trim();
  if (s === '' || s === '#') return false;
  if (s.charAt(0) === '#') return false;
  if (/^(data|blob|about|javascript|mailto|tel|#):/i.test(s)) return false;
  return true;
}

function toProxy(val, upstream) {
  let abs;
  try {
    abs = new URL(String(val), upstream.href).href;
  } catch (e) {
    return val;
  }
  if (!/^https?:\/\//i.test(abs)) return val;
  return PROXY_BASE + encodeURIComponent(abs);
}

function toPlayerUrl(val, upstream) {
  let abs;
  try {
    abs = new URL(String(val), upstream.href).href;
  } catch (e) {
    return val;
  }
  if (!/^https?:\/\//i.test(abs)) return val;
  return PLAYER_BASE + encodeURIComponent(abs);
}

function rewriteSrcset(srcset, upstream) {
  return String(srcset)
    .split(',')
    .map((part) => {
      const m = part.trim().match(/^(\S+)(\s+.*)?$/);
      if (!m) return part;
      return toProxy(m[1], upstream) + (m[2] || '');
    })
    .join(', ');
}

function rewriteCssUrls(css, upstream) {
  return String(css).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, url) => {
    const s = String(url).trim();
    if (/^(data|#)/i.test(s)) return m;
    return 'url(' + q + toProxy(s, upstream) + q + ')';
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
