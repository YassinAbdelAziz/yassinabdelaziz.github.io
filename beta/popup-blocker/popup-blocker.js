/* yStream BETA — popup-blocker/popup-blocker.js
 * INJECTED by the Cloudflare Worker into every proxied player document,
 * and installed *before* the provider's own scripts so popup attempts are
 * intercepted early.
 *
 * Experiment goal: prevent the advertising tabs/popups emitted by the embed
 * while keeping playback and legit player navigation intact.
 *
 * What it does:
 *  - window.open()        -> returns an experimental, compatible stub. No real
 *                            tab/window is ever created.
 *  - <a target="_blank">  -> intercepted at the DOM level (capture listener +
 *                            MutationObserver for dynamically injected links).
 *  - programmatic clicks  -> a.click() / anchor.click() dispatch real events,
 *                            which the capture listener also catches.
 *  - top-level navigation -> best-effort interception of location writes that
 *                            leave the provider/beta origins.
 *
 * Compatibility: the stub exposes the operations player code commonly probes
 * (closed, close(), focus(), blur(), postMessage(), location, document,
 * setTimeout, addEventListener, ...) so simple player code keeps executing
 * instead of throwing on a null return. It is NOT a real WindowProxy.
 *
 * It does NOT defeat DRM, authentication, signed tokens or any access control.
 */
(function () {
  'use strict';
  try {
    if (window.__YSTREAM_BETA_INSTALLED__) return;

    var cfg = (window.__YSTREAM_BETA__ || {}).popupBlocker || {};
    var providerOrigins = Array.isArray(cfg.providerOrigins) ? cfg.providerOrigins : [];
    // Origins that are allowed to actually open (experiment toggle, default off).
    var allowOpenOrigins = Array.isArray(cfg.allowOpenOrigins) ? cfg.allowOpenOrigins : [];
    var blockAllOpens = cfg.blockAllOpens !== false;
    var blockNavOutside = cfg.blockNavOutside !== false;

    var state = {
      enabled: true,
      blockAllOpens: blockAllOpens,
      stubbedOpens: 0,
      blockedAnchors: 0,
      blockedNavs: 0,
      blocked: [],        // {kind, url, name, t}
      stubReturned: 0,
      lastStub: null
    };

    function log(kind, url, name) {
      if (state.blocked.length >= 150) state.blocked.shift();
      state.blocked.push({ kind: kind, url: String(url || '').slice(0, 500), name: String(name || ''), t: Date.now() });
    }

    function isProviderUrl(u) {
      if (!u) return false;
      var origin;
      try { origin = new URL(u, location.href).origin; } catch (e) { return false; }
      for (var i = 0; i < providerOrigins.length; i++) {
        var base = providerOrigins[i];
        if (origin === base || origin === base.replace(/^https:/, 'http:') || origin === base.replace(/^http:/, 'https:')) return true;
      }
      return origin === location.origin;
    }

    // ---- experimental compatible popup stub ------------------------------
    function makeStub() {
      var stub = null;
      var loc = {
        href: 'about:blank', protocol: 'about:', host: '', hostname: '', port: '',
        pathname: '', search: '', hash: '', origin: 'null',
        assign: function () {}, replace: function () {}, reload: function () {}
      };
      var doc = {
        location: loc, title: '', URL: 'about:blank', referrer: '', cookie: '',
        readyState: 'complete',
        write: function () {}, writeln: function () {}, close: function () {}, open: function () { return null; },
        querySelector: function () { return null; }, querySelectorAll: function () { return []; },
        getElementById: function () { return null; }, getElementsByTagName: function () { return []; },
        getElementsByClassName: function () { return []; },
        createElement: function () { return null; }, createTextNode: function () { return null; },
        addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; },
        body: null, head: null, documentElement: null, forms: [], images: [], links: [], scripts: []
      };
      var history = { length: 0, back: function () {}, forward: function () {}, go: function () {}, pushState: function () {}, replaceState: function () {} };
      stub = {
        closed: false, name: '', length: 0, frames: null, opener: null,
        window: null, self: null, top: null, parent: null,
        location: loc, document: doc, history: history,
        navigator: { userAgent: (navigator && navigator.userAgent) || '' },
        screen: { width: 0, height: 0, availWidth: 0, availHeight: 0, colorDepth: 24, pixelDepth: 24 },
        close: function () {}, focus: function () {}, blur: function () {},
        postMessage: function () {}, stop: function () {}, print: function () {},
        moveTo: function () {}, moveBy: function () {}, resizeTo: function () {}, resizeBy: function () {},
        scrollTo: function () {}, scroll: function () {}, scrollBy: function () {},
        addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; },
        getComputedStyle: function () { return null; },
        alert: function () {}, confirm: function () { return false; }, prompt: function () { return null; },
        setTimeout: function (fn) { return setTimeout(fn, 0); }, clearTimeout: function (id) { clearTimeout(id); },
        setInterval: function (fn, ms) { return setInterval(fn, ms); }, clearInterval: function (id) { clearInterval(id); },
        requestAnimationFrame: function (fn) { return requestAnimationFrame(fn); }, cancelAnimationFrame: function (id) { cancelAnimationFrame(id); },
        fetch: function () { return Promise.reject(new Error('blocked')); },
        open: function () { return null; },
        toString: function () { return '[object Window]'; }
      };
      stub.window = stub; stub.self = stub; stub.top = stub; stub.parent = stub;
      return stub;
    }

    // ---- window.open interception ---------------------------------------
    var realOpen = window.open;
    window.open = function (url, name, features) {
      state.stubbedOpens++;
      log('window.open', url, name);
      if (blockAllOpens) {
        state.stubReturned++;
        var s = makeStub();
        state.lastStub = s;
        return s;
      }
      // allowlist mode (experimental): let a small set of origins through.
      if (url && allowOpenOrigins.length) {
        try {
          var origin = new URL(url, location.href).origin;
          for (var i = 0; i < allowOpenOrigins.length; i++) {
            if (origin === allowOpenOrigins[i]) return realOpen.apply(window, arguments);
          }
        } catch (e) { /* fall through to stub */ }
      }
      state.stubReturned++;
      var s2 = makeStub();
      state.lastStub = s2;
      return s2;
    };
    try { if (window.top && window.top !== window && window.top.open) window.top.open = window.open; } catch (e) { /* same-origin only */ }

    // ---- _blank / _new anchor interception ------------------------------
    function isExternalAnchor(a) {
      if (!a || !a.href) return false;
      if (a.target !== '_blank' && a.target !== '_new') return false;
      return !isProviderUrl(a.href);
    }

    function onAnchorClick(e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      if (!isExternalAnchor(a)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      state.blockedAnchors++;
      log('anchor _blank', a.href, a.target);
    }
    document.addEventListener('click', onAnchorClick, true);

    // Patch anchors created later (player UI, ad scripts).
    try {
      var MO = window.MutationObserver;
      if (MO) {
        var mo = new MO(function (muts) {
          for (var m = 0; m < muts.length; m++) {
            var added = muts[m].addedNodes;
            for (var n = 0; n < added.length; n++) {
              var node = added[n];
              if (node.nodeType !== 1) continue;
              var links = node.querySelectorAll ? node.querySelectorAll('a') : [];
              if (node.tagName === 'A') links = [node].concat(Array.prototype.slice.call(links));
              for (var i = 0; i < links.length; i++) {
                var a = links[i];
                if (a.target === '_blank' || a.target === '_new') {
                  a.setAttribute('data-ystream-blink', '1');
                }
              }
            }
          }
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
      }
    } catch (e) { /* optional */ }

    // Also patch HTMLAnchorElement.click() so programmatic .click() calls
    // on _blank anchors are blocked even before events dispatch.
    try {
      var realAnchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (isExternalAnchor(this)) {
          state.blockedAnchors++;
          log('anchor.click', this.href, this.target);
          return;
        }
        return realAnchorClick.apply(this, arguments);
      };
    } catch (e) { /* optional */ }

    // ---- top-level navigation interception (best effort) ----------------
    function handleLocationWrite(newValue) {
      if (newValue == null) return;
      var url;
      try { url = new URL(String(newValue), location.href).href; } catch (e) { return true; }
      if (blockNavOutside && !isProviderUrl(url) && !/^about:|^blob:|^data:/i.test(url)) {
        state.blockedNavs++;
        log('location write', url, '');
        return false;
      }
      return true;
    }

    // Attempt to intercept direct `location = ...` / `location.href = ...`
    // assignments. In modern browsers the property may be non-configurable, so
    // this is best-effort only; anchor/event/open interception above is the
    // reliable layer.
    try {
      var realLocation = window.location;
      var desc = Object.getOwnPropertyDescriptor(window, 'location');
      if (desc && desc.configurable) {
        Object.defineProperty(window, 'location', {
          configurable: true,
          get: function () { return realLocation; },
          set: function (v) { if (handleLocationWrite(v)) { try { realLocation.href = String(v); } catch (e) { /* ignore */ } } }
        });
      }
    } catch (e) { /* non-configurable: skip */ }

    // Wrap location.assign/replace so programmatic navigation is filtered.
    try {
      var realAssign = window.location.assign.bind(window.location);
      var realReplace = window.location.replace.bind(window.location);
      window.location.assign = function (u) { if (handleLocationWrite(u)) return realAssign(u); };
      window.location.replace = function (u) { if (handleLocationWrite(u)) return realReplace(u); };
    } catch (e) { /* optional */ }

    // ---- expose for diagnostics ----------------------------------------
    window.__YSTREAM_BETA__ = window.__YSTREAM_BETA__ || {};
    window.__YSTREAM_BETA__._injected = window.__YSTREAM_BETA__._injected || {};
    window.__YSTREAM_BETA__._injected.popupBlocker = { ok: true, t: Date.now() };
    window.__YSTREAM_BETA__.popup = state;
    state._fire = function (url, name) {
      // Simulate a popup attempt for testing.
      window.open(url, name, 'noopener');
      return state.stubbedOpens;
    };
    state._stub = makeStub;
  } catch (e) {
    try { window.__YSTREAM_BETA_POPUP_ERROR__ = String(e); } catch (e2) { /* ignore */ }
  }
})();
