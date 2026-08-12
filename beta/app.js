/* yStream BETA — app.js
 * Beta mirror entry point. Wires the beta UI to the player + proxy + diagnostics
 * modules. Everything is isolated under /beta and does not touch the production
 * site or the production player.
 */
(function () {
  'use strict';

  var state = {
    server: 'videasy',
    item: null,
    diagnosticsOpen: false
  };

  var els = {};

  function $(id) { return document.getElementById(id); }

  function sanitize(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function showToast(message, type) {
    var c = $('betaToastContainer');
    if (!c) return;
    var t = document.createElement('div');
    t.className = 'beta-toast ' + (type || '');
    t.textContent = message;
    c.appendChild(t);
    setTimeout(function () { t.remove(); }, 2800);
  }

  // ---- URL params --------------------------------------------------------
  function readParams() {
    var p = new URLSearchParams(location.search);
    var type = p.get('type');
    var id = p.get('id');
    var season = p.get('s') || p.get('season');
    var episode = p.get('e') || p.get('episode');
    if (type !== 'tv' && type !== 'movie') type = 'movie';
    var numId = parseInt(id, 10);
    if (!isFinite(numId) || numId <= 0) return null;
    return {
      id: numId,
      type: type,
      season: parseInt(season, 10) || 1,
      episode: parseInt(episode, 10) || 1,
      title: p.get('title') || (type === 'tv' ? 'TV Show #' + numId : 'Movie #' + numId),
      year: p.get('year') || '',
      poster: p.get('poster') || null,
      overview: p.get('overview') || ''
    };
  }

  function makeItemFromForm() {
    var id = parseInt($('betaId').value, 10);
    if (!isFinite(id) || id <= 0) { showToast('Enter a valid TMDB id', 'bad'); return null; }
    var type = $('betaType').value;
    var season = parseInt($('betaSeason').value, 10) || 1;
    var episode = parseInt($('betaEpisode').value, 10) || 1;
    return {
      id: id,
      type: type,
      season: season,
      episode: episode,
      title: (type === 'tv' ? 'TV Show #' + id : 'Movie #' + id) + (type === 'tv' ? ' · S' + season + 'E' + episode : '')
    };
  }

  function setFormFromItem(item) {
    if (!$('betaId')) return;
    $('betaId').value = item.id;
    $('betaType').value = item.type;
    $('betaSeason').value = item.season || 1;
    $('betaEpisode').value = item.episode || 1;
  }

  // ---- loading -----------------------------------------------------------
  function doLoad(item, server) {
    state.item = item;
    if (server) state.server = server;
    syncServerPills();
    setFormFromItem(item);
    window.YStreamBeta.player.load({ item: state.item, server: state.server });
  }

  function loadFromForm() {
    var item = makeItemFromForm();
    if (!item) return;
    doLoad(item, state.server);
  }

  function syncServerPills() {
    document.querySelectorAll('#betaServerPills .beta-server-pill').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.server === state.server);
    });
  }

  // ---- diagnostics -------------------------------------------------------
  function refreshDiagnostics() {
    if (!state.diagnosticsOpen) return;
    var player = window.YStreamBeta.player;
    var ctx = player.state.diagCtx || {};
    ctx.playbackSample = player.state.playbackSample;
    ctx.fullscreenTried = player.state.fullscreenTried;
    ctx.fullscreenResult = player.state.fullscreenResult;
    var diag = window.YStreamBeta.diagnostics;
    var checks = diag.collectChecks(ctx);
    var cls = diag.classify(checks, ctx);
    diag.render($('betaDiagnosticsPanel'), ctx, checks, cls);
  }

  function setDiagnosticsOpen(open) {
    state.diagnosticsOpen = open;
    var panel = $('betaDiagnosticsPanel');
    var empty = $('betaDiagnosticsEmpty');
    var toggle = $('betaDiagnosticsToggle');
    if (toggle) toggle.checked = open;
    if (panel) panel.style.display = open ? 'block' : 'none';
    if (empty) empty.style.display = open ? 'none' : 'block';
    if (open && window.YStreamBeta.player.state.loadedOnce) refreshDiagnostics();
  }

  // ---- service worker (beta scope only) ---------------------------------
  function registerBetaSW() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        console.log('[beta] service worker registered for scope', reg.scope);
      }).catch(function (err) {
        console.warn('[beta] service worker registration failed', err);
      });
    });
  }

  // ---- keyboard (beta page only) ----------------------------------------
  function setupKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      var player = window.YStreamBeta.player;
      switch (e.key.toLowerCase()) {
        case 'f':
          e.preventDefault();
          player.probe('fullscreen');
          break;
        case 'arrowright':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); player.probe('seek'); }
          break;
        case 'arrowleft':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            var v = player.getVideo();
            var frame = player.state.diagCtx && player.state.diagCtx.frame;
            if (v && frame && player.probeSameOrigin(frame)) v.currentTime = Math.max(0, v.currentTime - 15);
          }
          break;
      }
    });
  }

  function wireUI() {
    $('betaLoadBtn').addEventListener('click', loadFromForm);
    document.querySelectorAll('.beta-example').forEach(function (btn) {
      btn.addEventListener('click', function () {
        doLoad({
          id: parseInt(btn.dataset.id, 10),
          type: btn.dataset.type,
          season: 1,
          episode: 1,
          title: btn.dataset.type === 'tv' ? ('TV Show #' + btn.dataset.id) : ('Movie #' + btn.dataset.id)
        });
      });
    });
    document.querySelectorAll('#betaServerPills .beta-server-pill').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.server = btn.dataset.server;
        syncServerPills();
        if (state.item) {
          showToast('Switching to Server ' + (state.server === 'videasy' ? '1 (Videasy)' : '2 (VidKing)'), 'ok');
          window.YStreamBeta.player.switchServer(state.server, { item: state.item });
        } else {
          showToast('Server ' + (state.server === 'videasy' ? '1 (Videasy)' : '2 (VidKing)') + ' selected — enter a title to load.', 'info');
        }
      });
    });
    $('betaDiagnosticsToggle').addEventListener('change', function (e) { setDiagnosticsOpen(e.target.checked); });
    $('betaRetryProxyBtn').addEventListener('click', function () {
      if (state.item) { showToast('Retrying proxy…', 'info'); window.YStreamBeta.player.load({ item: state.item, server: state.server }); }
    });
    $('betaFallbackBtn').addEventListener('click', function () {
      if (!state.item) return;
      // Force a direct-embed load regardless of proxy health.
      var p = window.YStreamBeta.player;
      p.state.mode = null;
      p.state.proxyCheck = null;
      p.state.preflight = null;
      p.load({ item: state.item, server: state.server });
    });
    document.querySelectorAll('[data-probe]').forEach(function (btn) {
      btn.addEventListener('click', function () { window.YStreamBeta.player.probe(btn.dataset.probe); });
    });
    ['betaId', 'betaSeason', 'betaEpisode'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') loadFromForm(); });
    });
  }

  // ---- boot --------------------------------------------------------------
  function boot() {
    window.YStreamBeta = window.YStreamBeta || {};
    window.YStreamBeta.app = {
      state: state,
      refreshDiagnostics: refreshDiagnostics,
      setDiagnosticsOpen: setDiagnosticsOpen,
      doLoad: doLoad,
      showToast: showToast
    };
    window.YStreamBeta.player.init();
    wireUI();
    setupKeys();
    setDiagnosticsOpen(false);
    registerBetaSW();
    window.addEventListener('message', window.YStreamBeta.player.onMessage);

    var paramItem = readParams();
    if (paramItem) {
      setFormFromItem(paramItem);
      doLoad(paramItem, state.server);
    } else {
      // Prefill a sensible default so the page is instantly usable.
      doLoad({ id: 603, type: 'movie', season: 1, episode: 1, title: 'The Matrix (603)' });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
