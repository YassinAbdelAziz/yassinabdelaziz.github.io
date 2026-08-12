/* yStream BETA — proxy/proxy-bootstrap.js
 * INJECTED by the Cloudflare Worker into every proxied player document.
 *
 * This script is the same-origin "glue" for the provider player: it patches
 * window.fetch / XMLHttpRequest so that provider API + media requests made by
 * player JS are routed through the YStream-origin proxy (/beta/proxy) instead of
 * leaving the origin. Static resources (scripts, css, images, html attributes)
 * are rewritten to /beta/proxy by the worker directly.
 *
 * Deliberately conservative:
 *  - only rewrites requests whose origin is one of the provider origins
 *    (the normal/documented integration hosts),
 *  - never touches DRM / license / auth endpoints,
 *  - never spoofs headers or defeats access controls,
 *  - never throws (all wrapped so a failure cannot kill the player).
 *
 * Runs inside the player document; must be fully self-contained.
 */
(function () {
  'use strict';
  try {
    if (!window || typeof window.fetch !== 'function') return;
    if (window.__YSTREAM_BETA_INSTALLED__) return;

    var cfg = (window.__YSTREAM_BETA__ || {}).proxyBootstrap || {};
    var providerOrigins = Array.isArray(cfg.providerOrigins) ? cfg.providerOrigins : [];
    var proxyBase = cfg.proxyBase || '/beta/proxy?u=';

    var REQ_LOG_CAP = 120;

    // Endpoints that must NEVER be routed through the proxy: DRM / licensing /
    // authentication systems. They stay direct so we do not interfere with
    // access controls the provider enforces.
    var BLOCKED_TOKENS = [
      'license', 'widevine', 'playready', 'fairplay', 'clearkey',
      'drm', 'emeprotection', 'eme/',
      '/auth', '/token', '/login', '/signin', 'jwttoken', 'gettoken'
    ];

    var DRM_RE = new RegExp(BLOCKED_TOKENS.join('|'), 'i');

    function logReq(kind, original, rewritten, ok) {
      var cfg2 = window.__YSTREAM_BETA__;
      if (!cfg2) return;
      cfg2._reqLog = cfg2._reqLog || [];
      if (cfg2._reqLog.length >= REQ_LOG_CAP) cfg2._reqLog.shift();
      cfg2._reqLog.push({ kind: kind, u: String(original || '').slice(0, 400), p: String(rewritten || '').slice(0, 400), ok: !!ok, t: Date.now() });
    }

    function isProviderOrigin(u) {
      if (!u || typeof u !== 'string') return false;
      var origin;
      // Resolve against document.baseURI (the injected <base href> = provider)
      // so the provider's own relative URLs are recognised, not our origin.
      try { origin = new URL(u, document.baseURI).origin; } catch (e) { return false; }
      if (!origin || origin === location.origin) return false;
      for (var i = 0; i < providerOrigins.length; i++) {
        var base = providerOrigins[i];
        if (origin === base || origin === base.replace(/^https:/, 'http:') || origin === base.replace(/^http:/, 'https:')) return true;
      }
      return false;
    }

    function shouldProxy(url) {
      if (!url) return false;
      var s = String(url);
      if (/^(data|blob|about|javascript|mailto|tel):/i.test(s)) return false;
      if (s.indexOf(proxyBase) === 0 || s.indexOf('/beta/proxy') === 0 || s.indexOf('/beta/player') === 0) return false;
      if (DRM_RE.test(s)) return false;
      return isProviderOrigin(s);
    }

    function toProxyUrl(url) {
      try {
        var abs = new URL(url, document.baseURI).href;
        return proxyBase + encodeURIComponent(abs);
      } catch (e) {
        return url;
      }
    }

    // ---------- fetch() patch ----------
    var realFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = null;
      var req = null;
      try {
        if (input && typeof input === 'object' && input.url) { req = input; url = req.url; }
        else { url = input; }
      } catch (e) { return realFetch.apply(this, arguments); }

      if (shouldProxy(url)) {
        var rewritten = toProxyUrl(url);
        try {
          var newReq;
          if (req) {
            newReq = new Request(rewritten, req);
          } else {
            newReq = rewritten;
          }
          var p = realFetch(newReq, init || {});
          p.then(function (r) { logReq('fetch', url, rewritten, r && r.ok); }, function () { logReq('fetch', url, rewritten, false); });
          return p;
        } catch (e) {
          logReq('fetch', url, rewritten, false);
        }
      }
      return realFetch.apply(this, arguments);
    };

    // ---------- XMLHttpRequest patch ----------
    var realOpen = XMLHttpRequest.prototype.open;
    var realSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, async, user, pass) {
      var args = Array.prototype.slice.call(arguments);
      if (shouldProxy(url)) {
        var rewritten = toProxyUrl(url);
        try {
          logReq('xhr', url, rewritten, true);
          args[1] = rewritten;
        } catch (e) { /* keep original */ }
      }
      return realOpen.apply(this, args);
    };
    XMLHttpRequest.prototype.send = function (body) {
      return realSend.apply(this, arguments);
    };

    // ---------- Image / video generated URLs ----------
    // Elements created by player JS (new Image(), new Audio(), <video>.src)
    // bypass fetch/XHR. Patch Image.prototype.src and Audio.prototype.src so
    // generated media is also proxied where it targets provider origins.
    function patchMediaSrc(proto, name) {
      try {
        var real = Object.getOwnPropertyDescriptor(proto, name) || { configurable: true };
        var cache = real.get;
        var setter = function (v) {
          if (shouldProxy(v)) {
            var rw = toProxyUrl(v);
            logReq(name + '-src', v, rw, true);
            return setter.call(this, rw);
          }
          return setter.call(this, v);
        };
        Object.defineProperty(proto, name, {
          configurable: true,
          enumerable: true,
          get: cache,
          set: setter
        });
      } catch (e) { /* unsupported */ }
    }
    patchMediaSrc(HTMLImageElement.prototype, 'src');
    patchMediaSrc(HTMLAudioElement.prototype, 'src');
    patchMediaSrc(HTMLVideoElement.prototype, 'src');

    // ---------- report readiness ----------
    window.__YSTREAM_BETA__._injected = window.__YSTREAM_BETA__._injected || {};
    window.__YSTREAM_BETA__._injected.proxyBootstrap = { ok: true, t: Date.now(), patched: { fetch: true, xhr: true } };
    window.__YSTREAM_BETA__.proxy = {
      shouldProxy: shouldProxy,
      toProxyUrl: toProxyUrl,
      blockedTokens: BLOCKED_TOKENS,
      _test: function (u) { return shouldProxy(u) ? toProxyUrl(u) : null; }
    };
  } catch (e) {
    try { window.__YSTREAM_BETA_BOOTSTRAP_ERROR__ = String(e); } catch (e2) { /* ignore */ }
  }
})();
