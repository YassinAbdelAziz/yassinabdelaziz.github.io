/**
 * screenify-embed — full reverse proxy for third-party video embeds.
 *
 * Why this exists and how it works:
 * - Embed hosts (vidking.net, player.videasy.net) detect the iframe `sandbox`
 *   attribute and refuse to play, so we do NOT use a sandbox.
 * - Simply proxying the embed HTML and rewriting its asset URLs to point at the
 *   original host broke playback: the page is a React SPA that loads its app JS
 *   via ES modules, and ES modules loaded cross-origin require CORS, which the
 *   host does not grant -> black screen.
 * - So this worker is a FULL reverse proxy: it serves the embed page from our own
 *   origin, leaves relative URLs pointing at OUR origin, and forwards every
 *   subresource / API request (same-origin from the browser's perspective) to the
 *   upstream host server-side, spoofing Origin/Referer so the host's API accepts it.
 * - It also injects a script that kills every popup / pop-under / target=_blank.
 *
 * URL rewriting strategy — the <base> tag only fixes *relative* URLs; absolute-
 * path URLs (e.g. href="/assets/x.js") resolve against the origin and bypass the
 * host prefix, causing 403s.  We fix them in three layers:
 *  1. HTML source: rewrite href="/..." and src="/..." (and poster) to
 *     href="/<host>/..." before serving, so proxyByBase routes them correctly.
 *  2. CSS source: rewrite url(/...) inside proxied stylesheets the same way.
 *  3. JS runtime: inject a tiny script that overrides fetch()/XHR() so absolute-
 *     path URLs built at runtime (e.g. fetch('/api/x')) also get the host prefix.
 *
 * Routes:
 *   /embed?url=<urlencoded embed URL>   -> fetch + inject + serve the page
 *   /<host>/<rest>                       -> proxy <rest> to https://<host>/<rest>
 *   (anything else returns 403 — only known hosts are proxied)
 *
 * Deploy: ES-module Cloudflare Worker, route /embed + a catch-all. EMBED_PROXY in
 * index.html must point at <worker>/embed.
 */

const ALLOWED_HOSTS = new Set(['www.vidking.net', 'player.videasy.net']);
const TIMEOUT_MS = 20000;
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Injected at the top of every proxied page, before any site script runs.
const BLOCKER_SCRIPT = `<script>
(function () {
  function noop() {}
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
    if (url.pathname === '/embed') return handleEmbed(request, url);
    return proxyByBase(request, url);
  },
};
async function handleEmbed(request, url) {
  const raw = url.searchParams.get('url') || '';
  let target;
  try { target = new URL(raw); } catch { return text('Bad url', 400); }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return text('Forbidden host', 403);
  }

  let upstream;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      upstream = await fetch(target.toString(), {
        redirect: 'follow',
        headers: {
          'User-Agent': DEFAULT_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return text('Upstream fetch failed: ' + (err && err.message), 502);
  }

  const ctype = upstream.headers.get('content-type') || '';
  if (!upstream.ok || !ctype.includes('text/html')) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: stripForEmbed(upstream.headers),
    });
  }

  let html = await upstream.text();
  // Inject a <base> so every relative URL (assets + runtime API calls) resolves to
  // this worker's <host>/ path (no cookie needed — cookies are blocked in cross-site
  // iframes by SameSite / third-party-cookie blocking).
  html = injectHead(html, url.origin, target.hostname);

  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Frame-Options': 'ALLOWALL',
  };
  return new Response(html, { status: 200, headers });
}
// Route a request whose URL carries the upstream host as its first path segment
// (thanks to the injected <base>): /<host>/<rest> -> https://<host>/<rest>.
function proxyByBase(request, url) {
  const segs = url.pathname.split('/');
  const host = segs[1];
  if (!host || !ALLOWED_HOSTS.has(host)) return text('Forbidden', 403);
  const rest = '/' + segs.slice(2).join('/');
  return proxyFetch(request, host, 'https://' + host + rest + url.search);
}

// Forward a same-origin subresource / API request to the upstream host.
async function proxyFetch(request, host, upstreamUrl) {

  const hdrs = new Headers();
  const skip = new Set([
    'host','cookie','origin','referer','content-length','content-type',
    'connection','keep-alive','transfer-encoding','upgrade','accept-encoding',
    'sec-fetch-site','sec-fetch-mode','sec-fetch-dest','sec-fetch-user','te',
  ]);
  for (const [k, v] of request.headers) {
    if (!skip.has(k.toLowerCase())) hdrs.set(k, v);
  }
  // Impersonate the native player page so the host's API accepts the request.
  hdrs.set('Origin', 'https://' + host);
  hdrs.set('Referer', `https://${host}/`);
  hdrs.set('User-Agent', request.headers.get('User-Agent') || DEFAULT_UA);

  const init = { method: request.method, headers: hdrs, redirect: 'follow' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;

  let upstream;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      upstream = await fetch(upstreamUrl, init);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return text('Proxy error: ' + (err && err.message), 502);
  }

  const out = new Headers();
  const drop = new Set(['content-encoding','content-length','transfer-encoding','connection','keep-alive']);
  for (const [k, v] of upstream.headers) {
    if (!drop.has(k.toLowerCase())) out.set(k, v);
  }
  out.set('Cache-Control', 'no-store');

  // Rewrite absolute-path url() references in CSS so they route through
  // proxyByBase instead of 403'ing (the <base> tag only fixes relative URLs).
  const ctype = upstream.headers.get('content-type') || '';
  if (ctype.includes('text/css')) {
    const css = await upstream.text();
    const rewritten = css.replace(/url\(\s*(["']?)\/(?!\/)/g, 'url($1/' + host + '/');
    out.set('Content-Type', 'text/css; charset=utf-8');
    return new Response(rewritten, { status: upstream.status, headers: out });
  }

  return new Response(upstream.body, { status: upstream.status, headers: out });
}

function text(body, status) {
  return new Response(String(body), { status, headers: { 'Content-Type': 'text/plain' } });
}

function stripForEmbed(headers) {
  const out = new Headers();
  const drop = new Set(['content-security-policy','content-security-policy-report-only','x-content-security-policy','x-webkit-csp']);
  for (const [k, v] of headers) {
    if (!drop.has(k.toLowerCase())) out.set(k, v);
  }
  out.set('Cache-Control', 'no-store');
  out.set('X-Content-Type-Options', 'nosniff');
  out.set('Referrer-Policy', 'no-referrer');
  return out;
}

// Rewrite absolute-path URLs (/foo) in HTML to host-prefixed paths (/<host>/foo).
// The injected <base> tag only affects *relative* URLs; absolute-path URLs
// (starting with /) resolve against the origin only, bypassing the host prefix
// in proxyByBase, so they would 403.  This rewrite fixes href/src/poster
// attributes and url() calls in inline CSS.
function rewriteAbsolutePaths(html, host) {
  const prefix = '/' + host;
  return html
    .replace(/(href|src|poster)\s*=\s*(["'])\/(?!\/)/g, '$1=$2' + prefix + '/')
    .replace(/url\(\s*(["']?)\/(?!\/)/g, 'url($1' + prefix + '/');
}

// Build a runtime URL-patching script that redirects absolute-path URLs built
// in JavaScript (e.g. fetch('/api/x')) through this worker's proxy path.
// The <base> tag and HTML/CSS rewriting only fix pre-rendered URLs.
function buildUrlFixer(host) {
  return `<script>\n(function () {\n  var pf = '/${host}/';\n  function fix(u) {\n    return (typeof u === 'string' && u.charAt(0) === '/' && u.charAt(1) !== '/' && u !== '/') ? pf + u : u;\n  }\n  if (window.fetch) { var f = window.fetch; window.fetch = function (u, o) { return f.call(this, fix(u), o); }; }\n  if (window.XMLHttpRequest) { var X = window.XMLHttpRequest.prototype; var op = X.open; X.open = function (m, u) { var a = [m, fix(u)]; if (arguments[2] !== undefined) a.push(arguments[2]); if (arguments[3] !== undefined) a.push(arguments[3]); return op.apply(this, a); }; }\n})();\n</script>`;
}

function injectHead(html, selfOrigin, host) {
  // Rewrite absolute-path URLs in the HTML/CSS source so they route through
  // proxyByBase instead of 403'ing (the <base> tag only fixes relative URLs).
  html = rewriteAbsolutePaths(html, host);

  const base = `<base href="${selfOrigin}/${host}/">`;
  const idx = html.toLowerCase().search(/<head[^>]*>/);
  if (idx !== -1) {
    const after = html.indexOf('>', idx) + 1;
    return html.slice(0, after) + base + BLOCKER_SCRIPT + buildUrlFixer(host) + html.slice(after);
  }
  return base + BLOCKER_SCRIPT + buildUrlFixer(host) + html;
}
