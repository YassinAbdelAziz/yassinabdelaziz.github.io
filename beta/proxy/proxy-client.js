/* yStream BETA — proxy/proxy-client.js
 * Client-side helpers for the Cloudflare Worker beta proxy.
 * Builds /beta/player and /beta/proxy URLs, runs connectivity checks and
 * preflights a player request before it is put into the iframe.
 *
 * Everything here is isolated to /beta. The production player is untouched.
 */
(function () {
  'use strict';

  const PROXY_PATHS = {
    player: '/beta/player',
    proxy: '/beta/proxy',
    health: '/beta/healthz'
  };

  // Optional absolute worker base (e.g. "https://screenify-beta-proxy.<acct>.workers.dev")
  // used only as a *second* candidate when the same-origin worker route is missing.
  // Keep empty to stay strictly same-origin.
  const WORKER_BASE_OVERRIDE = '';

  function originBase() {
    return new URL(location.href).origin;
  }

  // Returns a URL object for a proxy path, preferring the same origin so the
  // browser-facing player stays same-origin with /beta.
  function baseUrlFor(pathKey) {
    const p = PROXY_PATHS[pathKey];
    if (WORKER_BASE_OVERRIDE) {
      return new URL(WORKER_BASE_OVERRIDE.replace(/\/+$/, '') + p);
    }
    return new URL(p, location.href);
  }

  function buildPlayerUrl(params) {
    const u = baseUrlFor('player');
    Object.keys(params).forEach((k) => {
      const v = params[k];
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    });
    return u.href;
  }

  function buildProxyUrl(absoluteUrl) {
    const u = baseUrlFor('proxy');
    u.searchParams.set('u', absoluteUrl);
    return u.href;
  }

  function isSameOriginUrl(url) {
    try {
      return new URL(url, location.href).origin === originBase();
    } catch (e) {
      return false;
    }
  }

  // Health check against the worker. Returns a status object, never throws.
  async function checkProxy(opts) {
    const o = opts || {};
    const timeout = o.timeout || 6000;
    const result = { ok: false, sameOrigin: isSameOriginUrl(baseUrlFor('health').href), error: null, status: 0, worker: false };

    if (o.url) {
      // Direct probe of an explicit health URL (used for the cross-origin candidate).
      try {
        const r = await fetchWithTimeout(o.url, { cache: 'no-store' }, timeout);
        result.status = r.status;
        if (r.ok) {
          const data = await r.json().catch(() => ({}));
          result.ok = !!data.ok;
          result.worker = !!data.worker;
        }
      } catch (e) {
        result.error = String(e && e.message || e);
      }
      return result;
    }

    // Prefer the same-origin health endpoint.
    try {
      const r = await fetchWithTimeout(baseUrlFor('health').href, { cache: 'no-store' }, timeout);
      result.status = r.status;
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        result.ok = !!data.ok;
        result.worker = !!data.worker;
      } else if (r.status === 404) {
        result.error = 'No worker route on this origin (404 from origin). The Cloudflare Worker /beta routes are not deployed here.';
      }
    } catch (e) {
      result.error = String(e && e.message || e);
    }

    if (!result.ok && WORKER_BASE_OVERRIDE && !o.sameOriginOnly) {
      const alt = await checkProxy({ url: WORKER_BASE_OVERRIDE.replace(/\/+$/, '') + PROXY_PATHS.health, sameOriginOnly: true });
      if (alt.ok) {
        alt.sameOrigin = false;
        alt.usedOverride = true;
        return alt;
      }
      result.overrideTried = true;
    }
    return result;
  }

  // Preflight a /beta/player request before loading it into the iframe.
  // Returns { ok, status, contentType, sameOrigin, error, bodyHint }.
  async function preflightPlayer(url, opts) {
    const o = opts || {};
    const timeout = o.timeout || 15000;
    const result = { ok: false, status: 0, contentType: null, sameOrigin: isSameOriginUrl(url), error: null };
    try {
      const r = await fetchWithTimeout(url, { method: 'GET', cache: 'no-store' }, timeout);
      result.status = r.status;
      result.contentType = (r.headers.get('content-type') || '').split(';')[0].trim();
      result.ok = r.ok && /html/.test(result.contentType);
      if (!result.ok) {
        const text = await r.text().catch(() => '');
        result.bodyHint = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 300);
      }
    } catch (e) {
      result.error = String(e && e.message || e);
    }
    return result;
  }

  // The generic resource proxy with pass-through of streaming bodies.
  // Used by the service worker and available for ad-hoc diagnostics.
  async function proxyFetch(absoluteUrl, init) {
    const proxyUrl = buildProxyUrl(absoluteUrl);
    return fetch(proxyUrl, init || {});
  }

  function fetchWithTimeout(url, init, timeout) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    return fetch(url, Object.assign({}, init || {}, { signal: ctrl.signal })).finally(() => clearTimeout(t));
  }

  window.YStreamBeta = window.YStreamBeta || {};
  window.YStreamBeta.proxy = {
    PROXY_PATHS: PROXY_PATHS,
    WORKER_BASE_OVERRIDE: WORKER_BASE_OVERRIDE,
    buildPlayerUrl: buildPlayerUrl,
    buildProxyUrl: buildProxyUrl,
    isSameOriginUrl: isSameOriginUrl,
    checkProxy: checkProxy,
    preflightPlayer: preflightPlayer,
    proxyFetch: proxyFetch,
    originBase: originBase
  };
})();
