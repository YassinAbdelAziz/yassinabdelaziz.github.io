/* yStream BETA — ad-filter/ad-filter.js
 * INJECTED by the Cloudflare Worker into proxied player documents.
 *
 * Modular, conservative, DOM-level advertisement filtering experiment.
 * Start conservative: only obvious advertising overlays/iframes are removed,
 * and the video/player element is always protected. Rules live in the RULES
 * array and can be expanded or disabled without touching anything else.
 *
 * Filtering here never touches DRM / authentication / license endpoints and
 * never rewrites provider requests; that is the proxy-bootstrap's job.
 */
(function () {
  'use strict';
  try {
    if (window.__YSTREAM_BETA_INSTALLED__) return;

    // ---- RULES (expand / disable here) ---------------------------------
    // "aggressive" rules default to off so the player is never destroyed by
    // an over-eager filter during this experiment.
    var RULES = [
      {
        name: 'obvious-ad-overlays',
        enabled: true,
        selectors: [
          '[class*="advert"]', '[class*="ad-container"]', '[class*="ad-slot"]', '[class*="adslot"]',
          '[class*="ad-overlay"]', '[class*="overlay-ad"]', '[class*="ads"]', '[class*="ad_"]',
          '[id*="advert"]', '[id*="ad-container"]', '[id*="ad-slot"]', '[id*="adslot"]'
        ]
      },
      {
        name: 'ad-iframe-src',
        enabled: true,
        selectors: [
          'iframe[src*="ads"]', 'iframe[src*="adservice"]', 'iframe[src*="doubleclick"]',
          'iframe[src*="adnxs"]', 'iframe[src*="advertising"]', 'iframe[src*="popads"]',
          'iframe[src*="propellerads"]', 'iframe[src*="coinzillatag"]'
        ]
      },
      {
        name: 'fixed-popup-layers',
        enabled: false,
        selectors: [
          'div[style*="z-index: 9999"]', 'div[style*="z-index: 99999"]',
          'div[style*="position: fixed"][style*="z-index: 100"]'
        ]
      },
      {
        name: 'aggressive-script-block',
        enabled: false,
        selectors: [
          'script[src*="doubleclick"]', 'script[src*="adservice"]', 'script[src*="adsbygoogle"]',
          'script[src*="propellerads"]', 'script[src*="popads"]'
        ]
      }
    ];

    // Never remove anything inside or containing the actual player.
    var PROTECT_SELECTOR = 'video, audio, .player, [class*="player"], [class*="video"], [class*="embed"], [id*="player"], [id*="video"]';

    var state = {
      enabled: true,
      removed: 0,
      scans: 0,
      activeRules: RULES.filter(function (r) { return r.enabled; }).map(function (r) { return r.name; }),
      lastRemoved: []
    };

    function isProtected(el) {
      if (!el) return false;
      if (el.matches && el.matches('video,audio')) return true;
      if (el.querySelector && el.querySelector('video,audio,canvas')) return true;
      if (el.closest && el.closest(PROTECT_SELECTOR)) return true;
      return false;
    }

    function matchesAnyRule(el) {
      for (var i = 0; i < RULES.length; i++) {
        var rule = RULES[i];
        if (!rule.enabled || !rule.selectors) continue;
        for (var s = 0; s < rule.selectors.length; s++) {
          try { if (el.matches(rule.selectors[s])) return rule.name; } catch (e) { /* bad selector */ }
        }
      }
      return null;
    }

    function scan(root) {
      if (!state.enabled) return;
      var scope = root || document;
      var els;
      try { els = scope.querySelectorAll ? scope.querySelectorAll('*') : []; } catch (e) { return; }
      var removedThisScan = 0;
      var removedNames = [];
      for (var i = els.length - 1; i >= 0; i--) {
        var el = els[i];
        if (!el || el.tagName === 'HTML' || el.tagName === 'BODY') continue;
        if (isProtected(el)) continue;
        var ruleName = matchesAnyRule(el);
        if (!ruleName) continue;
        try {
          if (el.remove) el.remove();
          removedThisScan++;
          state.removed++;
          if (removedNames.length < 20) removedNames.push((el.tagName || '') + '[' + ruleName + ']');
        } catch (e) { /* keep going */ }
      }
      state.scans++;
      if (removedNames.length) {
        state.lastRemoved = removedNames;
      }
    }

    function boot() {
      // Initial scan once the DOM is ready.
      var start = function () { try { scan(document); } catch (e) { /* ignore */ } };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
      else start();

      // Watch for ads injected later by ad scripts.
      try {
        var MO = window.MutationObserver;
        if (MO) {
          var debounce = null;
          var mo = new MO(function () {
            if (debounce) return;
            debounce = setTimeout(function () { debounce = null; scan(document); }, 350);
          });
          mo.observe(document.documentElement, { childList: true, subtree: true });
        }
      } catch (e) { /* optional */ }
    }

    window.__YSTREAM_BETA__ = window.__YSTREAM_BETA__ || {};
    window.__YSTREAM_BETA__._injected = window.__YSTREAM_BETA__._injected || {};
    window.__YSTREAM_BETA__._injected.adFilter = { ok: true, t: Date.now() };
    window.__YSTREAM_BETA__.adFilter = state;
    state.rules = RULES;
    state.scan = scan;
    state.enable = function (on) { state.enabled = !!on; if (state.enabled) scan(document); };

    boot();
  } catch (e) {
    try { window.__YSTREAM_BETA_ADFILTER_ERROR__ = String(e); } catch (e2) { /* ignore */ }
  }
})();
