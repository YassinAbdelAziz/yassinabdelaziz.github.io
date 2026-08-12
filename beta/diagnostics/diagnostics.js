/* yStream BETA — diagnostics/diagnostics.js
 * Client-side experiment diagnostics: verifies whether the proxy + same-origin
 * architecture actually works and classifies the outcome into one of the five
 * experiment states. Never prints cookies, API keys, signed URLs or sensitive
 * headers.
 */
(function () {
  'use strict';

  // The five experiment states (plus a fallback state).
  var STATES = {
    PROXIED_OK: { code: 1, label: '1 · Proxied successfully', cls: 'ok',
      desc: 'The player is served through the YStream beta origin, the beta page can access its DOM, and media is playing normally.' },
    PROXIED_PARTIAL: { code: 2, label: '2 · Proxied but player partially broken', cls: 'warn',
      desc: 'The proxy works and DOM is same-origin, but part of the player did not initialise (scripts, media or API).' },
    PROXIED_NOT_SAME_ORIGIN: { code: 3, label: '3 · Proxied but NOT same-origin', cls: 'warn',
      desc: 'The proxy responded, but the player iframe is still cross-origin (worker route not on this origin, or the provider redirected away). DOM access is blocked by the browser.' },
    PROXY_REJECTED: { code: 4, label: '4 · Proxy rejected by provider', cls: 'bad',
      desc: 'The upstream provider refused the proxied request (HTTP error / bot detection / auth requirement). Not bypassed — the beta falls back to the normal direct embed.' },
    PROXY_IMPOSSIBLE: { code: 5, label: '5 · Proxy technically impossible for required resources', cls: 'bad',
      desc: 'Same-origin loading worked, but required media/API resources cannot pass through the proxy (e.g. body-size limits, WebSockets, or requests the provider hard-binds to its own origin).' },
    FALLBACK: { code: 0, label: '0 · Fallback — direct embed (no proxy)', cls: 'info',
      desc: 'The proxy experiment is not available here, so the normal direct (cross-origin) embed was loaded. Playback works as on production; DOM control and popup interception are not available.' }
  };

  function probeFrame(frame) {
    var r = { accessible: false, error: null };
    if (!frame) { r.error = 'no iframe'; return r; }
    try {
      var doc = frame.contentDocument;
      if (!doc) { r.error = 'contentDocument is null (cross-origin or not loaded)'; return r; }
      r.accessible = true;
      r.doc = doc;
      r.win = frame.contentWindow;
    } catch (e) {
      r.error = String(e && e.name || e);
    }
    return r;
  }

  function collectChecks(ctx) {
    var checks = [];
    var c = ctx || {};
    var proxy = c.proxyCheck || {};
    var preflight = c.preflight || {};
    var frame = c.frame;
    var p = probeFrame(frame);

    // 1. Proxy reachable
    checks.push({
      id: 'proxy', label: 'Proxy reachable',
      value: proxy.ok ? 'YES' : (proxy.status ? 'HTTP ' + proxy.status : 'NO'),
      status: proxy.ok ? 'yes' : 'no',
      detail: proxy.ok
        ? 'Cloudflare Worker answered from ' + (proxy.sameOrigin ? 'the same origin (' + (c.originLabel || 'this site') + ')' : 'a different origin (worker override)') + '.'
        : (proxy.error || 'No worker route answered the /beta/healthz probe.')
    });

    // 2. Player HTML loaded
    var htmlLoaded = !!p.accessible && !!p.doc && !!p.doc.documentElement;
    checks.push({
      id: 'html', label: 'Player HTML loaded',
      value: htmlLoaded ? 'YES' : 'NO',
      status: htmlLoaded ? 'yes' : 'no',
      detail: htmlLoaded
        ? (p.doc.readyState || '') + ' · ' + (p.doc.title ? p.doc.title.slice(0, 80) : '(no title)')
        : (p.error || 'iframe document not readable yet.')
    });

    // 3. Same-origin DOM access
    checks.push({
      id: 'dom', label: 'Same-origin DOM access',
      value: p.accessible ? 'YES' : 'NO',
      status: p.accessible ? 'yes' : 'no',
      detail: p.accessible
        ? 'Reading player DOM from the beta page succeeds — no SecurityError.'
        : (p.error || 'SecurityError: the player document is cross-origin.')
    });

    // 4. Player scripts loaded (beta injections + provider scripts)
    var marker = p.win && p.win.__YSTREAM_BETA__;
    var injected = marker && marker._injected ? Object.keys(marker._injected) : [];
    var scriptCount = p.accessible ? (p.doc.scripts ? p.doc.scripts.length : 0) : 0;
    var scriptsOk = p.accessible && scriptCount > 0;
    checks.push({
      id: 'scripts', label: 'Player scripts loaded',
      value: scriptsOk ? 'YES (' + scriptCount + ')' : 'NO',
      status: scriptsOk ? 'yes' : 'no',
      detail: scriptsOk
        ? 'Beta injections active: ' + (injected.join(', ') || 'none') + '.'
        : 'The player document has no scripts (blocked by CSP/upstream, or cross-origin).'
    });

    // 5. Player APIs loaded
    var w = p.win;
    var apiHints = [];
    if (w) {
      if (w.MediaSource || w.WebKitMediaSource) apiHints.push('MediaSource');
      if (w.videojs) apiHints.push('video.js');
      if (w.Hls) apiHints.push('hls.js');
      if (w.jwplayer) apiHints.push('jwplayer');
      if (w.player) apiHints.push('player');
      if (w.__video) apiHints.push('__video');
    }
    var apisOk = apiHints.length > 0 || !!mediaEl(p);
    checks.push({
      id: 'apis', label: 'Player APIs loaded',
      value: apisOk ? 'YES' : 'NO',
      status: apisOk ? 'yes' : 'no',
      detail: apisOk ? (apiHints.join(', ') || 'video element found') : 'No known player API detected yet.'
    });

    // 6. Media initialized
    var video = mediaEl(p);
    var mediaOk = !!video;
    var mediaDetail = 'No <video> element in the player document.';
    if (video) {
      mediaDetail = 'readyState=' + (video.readyState != null ? video.readyState : '?') +
        (video.currentSrc ? ' · src=' + redactUrl(String(video.currentSrc)) : ' · (no currentSrc yet)') +
        (video.error ? ' · ERROR ' + (video.error.code || '') : '') +
        ' · paused=' + video.paused;
      mediaOk = video.readyState > 0 || !!video.error;
    }
    checks.push({
      id: 'media', label: 'Media initialized',
      value: mediaOk ? 'YES' : 'NO',
      status: mediaOk ? 'yes' : 'no',
      detail: mediaDetail
    });

    // 7. Fullscreen support
    var fullscreenOk = !!p.doc && (!!p.doc.fullscreenEnabled || !!p.doc.webkitFullscreenEnabled);
    checks.push({
      id: 'fullscreen', label: 'Fullscreen',
      value: fullscreenOk ? 'YES' : (c.fullscreenTried ? 'NO' : 'N/A'),
      status: fullscreenOk ? 'yes' : (c.fullscreenTried ? 'no' : 'info'),
      detail: fullscreenOk
        ? 'Fullscreen API available' + (c.fullscreenTried ? '; last probe ' + (c.fullscreenResult ? 'succeeded' : 'failed') + '.' : '; use the Fullscreen probe button to test.')
        : 'Fullscreen API not available in the player document.'
    });

    // 8. Popup interception
    var popupState = marker && marker.popup;
    var popupOk = !!popupState;
    checks.push({
      id: 'popup', label: 'Popup interception',
      value: popupOk ? 'YES' : 'NO',
      status: popupOk ? 'yes' : 'no',
      detail: popupOk
        ? 'window.open stubbed · ' + (popupState.stubbedOpens || 0) + ' opens returned a stub · ' +
          (popupState.blockedAnchors || 0) + ' _blank anchors blocked · ' +
          (popupState.blockedNavs || 0) + ' location writes blocked.'
        : 'The popup blocker did not install inside the player document.'
    });

    // 9. Ad filter
    var adState = marker && marker.adFilter;
    checks.push({
      id: 'adfilter', label: 'Ad filter',
      value: adState ? 'YES' : 'NO',
      status: adState ? 'yes' : 'no',
      detail: adState
        ? adState.removed + ' elements removed · rules: ' + (adState.activeRules || []).join(', ') || 'none'
        : 'Ad filter not installed.'
    });

    // 10. Playback (sampling currentTime over ~2.2s, run by the player)
    var pb = c.playbackSample || {};
    checks.push({
      id: 'playback', label: 'Playback',
      value: pb.value || '…',
      status: pb.status || 'info',
      detail: pb.detail || (video ? 'Sampling currentTime to detect playback…' : 'No video element to sample.')
    });

    // 11. Proxy request log (how many provider requests were routed same-origin)
    var reqLog = marker && marker._reqLog ? marker._reqLog : [];
    checks.push({
      id: 'reqlog', label: 'Provider requests via proxy', value: String(reqLog.length), status: 'info',
      detail: reqLog.length
        ? 'Last: ' + reqLog[reqLog.length - 1].kind + ' → ' + redactUrl(reqLog[reqLog.length - 1].u)
        : 'No fetch/XHR requests from player JS were routed through /beta/proxy yet.'
    });

    return checks;
  }

  function mediaEl(p) {
    if (!p || !p.accessible || !p.doc) return null;
    var v = p.doc.querySelector && p.doc.querySelector('video');
    return v || null;
  }

  // Redact anything that looks sensitive (signed params, tokens, keys).
  function redactUrl(u) {
    var s = String(u || '');
    s = s.replace(/[?&](?:s|signature|token|auth|key|sig|expires|e)=[^&#]*/gi, '$1=REDACTED');
    if (s.length > 140) s = s.slice(0, 140) + '…';
    return s;
  }

  function classify(checks, ctx) {
    var find = function (id) { return checks.filter(function (c) { return c.id === id; })[0]; };
    if (ctx.mode === 'direct') return STATES.FALLBACK;
    if (!ctx.proxyCheck || !ctx.proxyCheck.ok) return STATES.PROXY_REJECTED;
    if (!ctx.preflight || !ctx.preflight.ok) return STATES.PROXY_REJECTED;
    var dom = find('dom');
    if (!dom || dom.status !== 'yes') return STATES.PROXIED_NOT_SAME_ORIGIN;
    var media = find('media');
    var play = find('playback');
    var scripts = find('scripts');
    var playerBroken = (media && media.status !== 'yes') || (scripts && scripts.status !== 'yes');
    if (!playerBroken && play && play.status === 'yes') return STATES.PROXIED_OK;
    if (!playerBroken) return STATES.PROXIED_OK;
    // Media element exists but errored/won't start → likely proxy limits (state 5).
    var video = mediaEl(ctx.frame && probeFrame(ctx.frame));
    if (video && video.error) return STATES.PROXY_IMPOSSIBLE;
    return STATES.PROXIED_PARTIAL;
  }

  function render(panel, ctx, checks, state) {
    if (!panel) return;
    panel.innerHTML = '';
    var banner = document.createElement('div');
    banner.className = 'beta-state-banner ' + state.cls;
    banner.innerHTML = '<b>' + state.label + '</b> — ' + state.desc;
    panel.appendChild(banner);

    checks.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'beta-diag-row';
      var name = document.createElement('span');
      name.className = 'beta-diag-name';
      name.textContent = c.label;
      var val = document.createElement('span');
      val.className = 'beta-diag-val ' + c.status;
      val.textContent = c.value;
      row.appendChild(name);
      row.appendChild(val);
      panel.appendChild(row);
      if (c.detail) {
        var det = document.createElement('div');
        det.className = 'beta-diag-detail';
        det.textContent = c.detail;
        panel.appendChild(det);
      }
    });

    var note = document.createElement('div');
    note.className = 'beta-diag-note';
    note.innerHTML = 'No cookies, API keys, signed URLs or sensitive headers are shown. ' +
      'The beta never defeats DRM, authentication or provider access controls.';
    panel.appendChild(note);
  }

  window.YStreamBeta = window.YStreamBeta || {};
  window.YStreamBeta.diagnostics = {
    STATES: STATES,
    probeFrame: probeFrame,
    collectChecks: collectChecks,
    classify: classify,
    render: render,
    redactUrl: redactUrl
  };
})();
