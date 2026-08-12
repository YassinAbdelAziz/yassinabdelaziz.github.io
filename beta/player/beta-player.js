/* yStream BETA — player/beta-player.js
 * Beta player controller. Builds the proxied player URL for the active
 * provider (Server 1 = Videasy, Server 2 = VidKing), loads it into the iframe,
 * verifies same-origin DOM access, samples playback, and drives the control
 * probes. Falls back to the normal direct embed when the proxy experiment is
 * unavailable or rejected.
 *
 * Fully isolated to /beta. Never used by the production player.
 */
(function () {
  'use strict';

  var PROXY = null;
  var ACCENT = 'ff2e2e';

  // showToast lives in the app closure; reach it through the exported namespace.
  function toast(msg, type) {
    var app = window.YStreamBeta && window.YStreamBeta.app;
    if (app && typeof app.showToast === 'function') app.showToast(msg, type);
  }

  // Provider embed URL builders (documented integration shape, same as production).
  var EMBED_BUILDERS = {
    videasy: {
      name: 'Videasy',
      movie: function (id) { return 'https://player.videasy.net/movie/' + id; },
      tv: function (id, s, e) { return 'https://player.videasy.net/tv/' + id + '/' + s + '/' + e; }
    },
    vidking: {
      name: 'VidKing',
      movie: function (id) { return 'https://www.vidking.net/embed/movie/' + id; },
      tv: function (id, s, e) { return 'https://www.vidking.net/embed/tv/' + id + '/' + s + '/' + e; }
    }
  };

  // Allowed postMessage origins for the *direct fallback* embed. In proxy mode
  // the events arrive with the beta origin (same-origin), which we accept too.
  var DIRECT_ORIGINS = new Set(['https://www.vidking.net', 'https://player.videasy.net']);

  var elements = {};
  var state = {
    mode: null,            // 'proxy' | 'direct'
    server: 'videasy',     // 'videasy' | 'vidking'
    item: null,            // { id, type, season, episode, title, year, poster, overview }
    loading: false,
    loadedOnce: false,
    diagCtx: null,         // diagnostics context
    playbackSample: null,
    fullscreenTried: false,
    fullscreenResult: null,
    proxyCheck: null,
    preflight: null,
    playerUrl: null
  };

  function init(app) {
    PROXY = window.YStreamBeta.proxy;
    elements = {
      frame: document.getElementById('betaPlayerFrame'),
      wrap: document.getElementById('betaPlayerWrap'),
      loading: document.getElementById('betaLoadingOverlay'),
      loadingText: document.getElementById('betaLoadingText'),
      error: document.getElementById('betaErrorOverlay'),
      errorTitle: document.getElementById('betaErrorTitle'),
      errorMsg: document.getElementById('betaErrorMsg'),
      modeBadge: document.getElementById('betaModeBadge'),
      modeText: document.getElementById('betaModeText'),
      title: document.getElementById('betaPlayerTitle'),
      subtitle: document.getElementById('betaPlayerSubtitle'),
      diagPanel: document.getElementById('betaDiagnosticsPanel'),
      diagEmpty: document.getElementById('betaDiagnosticsEmpty'),
      diagToggle: document.getElementById('betaDiagnosticsToggle')
    };
  }

  function setModeBadge(kind, text) {
    if (!elements.modeBadge || !elements.modeText) return;
    elements.modeBadge.className = 'beta-mode-badge ' + kind;
    elements.modeText.textContent = text;
  }

  function showLoading(text) {
    state.loading = true;
    if (elements.loading) { elements.loading.style.display = 'flex'; }
    if (elements.loadingText) elements.loadingText.textContent = text || 'Contacting proxy…';
    if (elements.error) elements.error.style.display = 'none';
  }

  function hideLoading() {
    state.loading = false;
    if (elements.loading) elements.loading.style.display = 'none';
  }

  function showError(title, msg) {
    hideLoading();
    if (elements.error) {
      elements.error.style.display = 'flex';
      if (elements.errorTitle) elements.errorTitle.textContent = title || 'Player could not load';
      if (elements.errorMsg) elements.errorMsg.textContent = msg || '';
    }
  }

  function hideError() {
    if (elements.error) elements.error.style.display = 'none';
  }

  function buildProxyParams() {
    var item = state.item || {};
    var p = {
      provider: state.server,
      type: item.type,
      id: item.id,
      color: ACCENT
    };
    if (item.type === 'tv') {
      p.season = item.season || 1;
      p.episode = item.episode || 1;
      p.nextEpisode = 'true';
      p.episodeSelector = 'true';
      if (state.server === 'videasy') { p.autoplayNextEpisode = 'true'; p.overlay = 'true'; }
      else { p.autoPlay = 'true'; }
    } else {
      if (state.server === 'videasy') { p.autoplayNextEpisode = 'true'; p.overlay = 'true'; }
      else { p.autoPlay = 'true'; }
    }
    var resume = getResume(item.id, item.type);
    var ts = resume && resume.currentTime > 10 ? Math.floor(resume.currentTime) : 0;
    if (ts > 0) p.progress = String(ts);
    return p;
  }

  function buildDirectUrl() {
    var item = state.item || {};
    var b = EMBED_BUILDERS[state.server] || EMBED_BUILDERS.videasy;
    var url = item.type === 'tv' ? b.tv(item.id, item.season || 1, item.episode || 1) : b.movie(item.id);
    var params = [];
    if (state.server === 'vidking') {
      params.push('color=' + ACCENT, 'autoPlay=true');
      if (item.type === 'tv') { params.push('nextEpisode=true', 'episodeSelector=true'); }
    } else {
      params.push('color=' + ACCENT, 'autoplayNextEpisode=true', 'overlay=true');
      if (item.type === 'tv') { params.push('nextEpisode=true', 'episodeSelector=true'); }
    }
    var resume = getResume(item.id, item.type);
    var ts = resume && resume.currentTime > 10 ? Math.floor(resume.currentTime) : 0;
    if (ts > 0) params.push('progress=' + ts);
    url += '?' + params.join('&');
    return url;
  }

  function loadIntoFrame(url) {
    state.playerUrl = url;
    showLoading('Loading player…');
    hideError();
    var frame = elements.frame;
    frame.style.opacity = '0.6';
    frame.onload = function () {
      frame.style.opacity = '1';
      handleFrameLoaded();
    };
    frame.onerror = function () {
      showError('Proxy error', 'The player frame failed to load its document.');
    };
    frame.src = url;
  }

  async function load(opts) {
    var app = opts && opts.app || window.YStreamBeta.app;
    if (opts && opts.server) state.server = opts.server;
    if (opts && opts.item) state.item = opts.item;
    if (!state.item || state.item.id == null) return;

    if (elements.title) {
      elements.title.textContent = '\u25B6 ' + (state.item.title || ('#' + state.item.id)) +
        (state.item.type === 'tv' ? ' · S' + (state.item.season || 1) + 'E' + (state.item.episode || 1) : '');
    }
    if (elements.subtitle) {
      var srvName = (EMBED_BUILDERS[state.server] || {}).name || state.server;
      elements.subtitle.textContent = 'Loading ' + srvName + ' through the beta proxy…';
    }

    setModeBadge('checking', 'Checking proxy…');
    showLoading('Contacting proxy…');
    hideError();

    // 1) Is the same-origin worker route reachable?
    var proxyCheck = await PROXY.checkProxy({ timeout: 6000 });
    state.proxyCheck = proxyCheck;

    var proxyUrl = PROXY.buildPlayerUrl(buildProxyParams());
    var preflight = { ok: false, status: 0 };
    if (proxyCheck.ok && proxyCheck.sameOrigin) {
      // 2) Can /beta/player actually serve this title?
      preflight = await PROXY.preflightPlayer(proxyUrl, { timeout: 15000 });
    } else {
      preflight.error = proxyCheck.sameOrigin
        ? 'Proxy health check failed: ' + (proxyCheck.error || 'unreachable')
        : 'Worker is not on this origin — same-origin proxy is not available here.';
    }

    state.preflight = preflight;
    state.mode = null;

    if (proxyCheck.ok && proxyCheck.sameOrigin && preflight.ok) {
      state.mode = 'proxy';
      setModeBadge('checking', 'Proxy ready — loading player through ' + new URL(location.href).origin + ' …');
      if (elements.subtitle) elements.subtitle.textContent = 'Proxy mode — player served from the YStream beta origin.';
      loadIntoFrame(proxyUrl);
      return;
    }

    // 3) Proxy experiment unavailable/rejected → direct embed fallback.
    state.mode = 'direct';
    var why = preflight.error ||
      (proxyCheck.error) ||
      (preflight.status ? 'Player preflight failed with HTTP ' + preflight.status : 'Unknown proxy failure');
    setModeBadge('fallback', 'Proxy unavailable — using direct embed (fallback)');
    if (elements.subtitle) elements.subtitle.textContent = 'Fallback mode — normal direct embed (cross-origin).';
    var directUrl = buildDirectUrl();
    loadIntoFrame(directUrl);
    state.lastFallbackReason = why;
    toast('Proxy experiment failed — direct embed fallback loaded', 'warn');
  }

  function handleFrameLoaded() {
    hideLoading();
    state.loadedOnce = true;
    var frame = elements.frame;
    var sameOrigin = probeSameOrigin(frame);

    state.diagCtx = {
      mode: state.mode,
      frame: frame,
      proxyCheck: state.proxyCheck,
      preflight: state.preflight,
      server: state.server,
      provider: state.server,
      url: state.playerUrl,
      playbackSample: state.playbackSample,
      fullscreenTried: state.fullscreenTried,
      fullscreenResult: state.fullscreenResult
    };

    // Update the badge based on what we can actually observe.
    if (state.mode === 'proxy' && sameOrigin) {
      setModeBadge('ok', 'Proxy player loaded — same-origin DOM access works.');
    } else if (state.mode === 'proxy' && !sameOrigin) {
      setModeBadge('partial', 'Proxy player loaded but iframe is cross-origin (worker not on this origin).');
    } else {
      setModeBadge('fallback', 'Direct embed loaded (fallback) — cross-origin, DOM access blocked by design.');
    }

    // Sample playback ~2.2s after load to distinguish "loaded" from "playing".
    if (sameOrigin) {
      samplePlayback(frame);
    }

    if (window.YStreamBeta.app) {
      window.YStreamBeta.app.refreshDiagnostics();
    }
  }

  function probeSameOrigin(frame) {
    try {
      return !!frame.contentDocument;
    } catch (e) {
      return false;
    }
  }

  function samplePlayback(frame) {
    var video = null;
    try { video = frame.contentDocument && frame.contentDocument.querySelector('video'); } catch (e) { video = null; }
    if (!video) {
      state.playbackSample = { value: 'NO', status: 'no', detail: 'No <video> element to sample.' };
      return;
    }
    var t0 = typeof video.currentTime === 'number' ? video.currentTime : 0;
    var ready0 = video.readyState || 0;
    setTimeout(function () {
      var t1 = video.currentTime || 0;
      var advanced = t1 > t0 + 0.25;
      var ready1 = video.readyState || 0;
      state.playbackSample = {
        value: advanced ? 'YES' : 'NO',
        status: advanced ? 'yes' : 'no',
        detail: 'currentTime ' + t0.toFixed(1) + 's → ' + t1.toFixed(1) + 's over ~2s · readyState ' + ready0 + '→' + ready1 +
          (advanced ? ' · playback is advancing.' : ' · video is paused/stalled or the media failed to load.')
      };
      if (window.YStreamBeta.app) window.YStreamBeta.app.refreshDiagnostics();
    }, 2200);
  }

  function getVideo() {
    if (!state.diagCtx) return null;
    try { return state.diagCtx.frame.contentDocument.querySelector('video'); } catch (e) { return null; }
  }

  function probe(action) {
    var video = getVideo();
    var sameOrigin = state.diagCtx && probeSameOrigin(state.diagCtx.frame);
    switch (action) {
      case 'play':
        if (video && sameOrigin) { video.play().then(function(){toast('Play probe: OK','ok');},function(e){toast('Play probe rejected: '+e,'warn');}); }
        else toast('Play probe: N/A (no same-origin video)', 'info');
        break;
      case 'pause':
        if (video && sameOrigin) { video.pause(); toast('Pause probe: OK', 'ok'); }
        else toast('Pause probe: N/A (no same-origin video)', 'info');
        break;
      case 'seek':
        if (video && sameOrigin && isFinite(video.duration)) { var t = Math.min(video.currentTime + 15, video.duration - 1); video.currentTime = t; toast('Seek probe → ' + Math.floor(t) + 's', 'ok'); }
        else toast('Seek probe: N/A (no same-origin video)', 'info');
        break;
      case 'volume':
        if (video && sameOrigin) { video.volume = Math.min(1, (video.volume || 0) + 0.1); video.muted = false; toast('Volume probe → ' + Math.round(video.volume * 100) + '%', 'ok'); }
        else toast('Volume probe: N/A (no same-origin video)', 'info');
        break;
      case 'mute':
        if (video && sameOrigin) { video.muted = !video.muted; toast('Mute probe → ' + (video.muted ? 'muted' : 'unmuted'), 'ok'); }
        else toast('Mute probe: N/A (no same-origin video)', 'info');
        break;
      case 'fullscreen':
        state.fullscreenTried = true;
        try {
          var f = elements.frame;
          if (f.requestFullscreen) { f.requestFullscreen().then(function(){state.fullscreenResult=true;toast('Fullscreen probe: OK','ok');},function(){state.fullscreenResult=false;toast('Fullscreen probe rejected','warn');}); }
          else if (f.webkitRequestFullscreen) { f.webkitRequestFullscreen(); state.fullscreenResult = true; }
          else { state.fullscreenResult = false; toast('Fullscreen probe: API unavailable', 'info'); }
        } catch (e) { state.fullscreenResult = false; toast('Fullscreen probe error: ' + e, 'bad'); }
        if (window.YStreamBeta.app) window.YStreamBeta.app.refreshDiagnostics();
        break;
      case 'pip':
        if (video && sameOrigin && video.requestPictureInPicture) {
          video.requestPictureInPicture().then(function(){toast('PiP probe: OK','ok');},function(e){toast('PiP probe: ' + e,'warn');});
        } else toast('PiP probe: N/A (no same-origin video / unsupported)', 'info');
        break;
      case 'popup-test': {
        if (sameOrigin && state.diagCtx.frame.contentWindow && state.diagCtx.frame.contentWindow.__YSTREAM_BETA__ && state.diagCtx.frame.contentWindow.__YSTREAM_BETA__.popup) {
          var n = state.diagCtx.frame.contentWindow.__YSTREAM_BETA__.popup._fire('https://ads.example/landing?campaign=test', '_blank');
          toast('Popup probe: stub returned ' + n + ' · no tab opened', 'ok');
          window.YStreamBeta.app.refreshDiagnostics();
        } else {
          toast('Popup probe: blocker not installed inside player (cross-origin?)', 'info');
        }
        break;
      }
    }
  }

  function switchServer(server, opts) {
    state.server = server;
    load(opts || {});
  }

  // ---- resume / continue (beta-isolated storage) ------------------------
  function getResume(id, type) {
    try {
      var data = JSON.parse(localStorage.getItem('screenify_beta_resume_' + id) || 'null');
      if (!data || typeof data !== 'object') return null;
      var ct = Number(data.currentTime);
      return {
        currentTime: isFinite(ct) ? Math.max(0, Math.min(ct, 864000)) : 0,
        duration: Number(data.duration) || 0,
        season: data.season || 1,
        episode: data.episode || 1
      };
    } catch (e) { return null; }
  }

  function saveResume(id, type, data) {
    try { localStorage.setItem('screenify_beta_resume_' + id, JSON.stringify(Object.assign({ type: type }, data))); } catch (e) {}
  }

  function onMessage(e) {
    if (state.mode === 'direct' && !DIRECT_ORIGINS.has(e.origin)) return;
    if (state.mode === 'proxy' && e.origin !== location.origin) return;
    if (typeof e.data !== 'string') return;
    var msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (!msg || msg.type !== 'PLAYER_EVENT') return;
    var d = msg.data;
    if (!d || typeof d !== 'object') return;
    if (!state.item || state.item.id == null) return;
    var event = String(d.event || '');
    var currentTime = Number(d.currentTime);
    if (!isFinite(currentTime)) currentTime = 0;
    var duration = Number(d.duration) || 0;
    if (['pause', 'ended', 'seeked'].indexOf(event) >= 0 || (event === 'timeupdate' && Math.floor(currentTime) % 10 === 0)) {
      var season = d.season || state.item.season || 1;
      var episode = d.episode || state.item.episode || 1;
      saveResume(state.item.id, state.item.type, { currentTime: currentTime >= 180 ? currentTime : 0, duration: duration, season: season, episode: episode });
    }
  }

  window.YStreamBeta = window.YStreamBeta || {};
  window.YStreamBeta.player = {
    EMBED_BUILDERS: EMBED_BUILDERS,
    state: state,
    init: init,
    load: load,
    switchServer: switchServer,
    probe: probe,
    probeSameOrigin: probeSameOrigin,
    getVideo: getVideo,
    buildProxyParams: buildProxyParams,
    buildDirectUrl: buildDirectUrl,
    onMessage: onMessage
  };
})();
