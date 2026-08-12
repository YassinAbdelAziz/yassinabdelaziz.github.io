# yStream BETA — same-origin proxy player experiment

An isolated experimental mirror under `/beta`. It attempts to reproduce the
same-origin/proxy concept used by projects like `niutech/x-frame-bypass`, then
measures how much control YStream can gain over the Videasy (Server 1) and
VidKing (Server 2) embeds.

The production site, production player and the production service worker are
**not touched**. Every change lives under `/beta`.

## Architecture

```
GitHub Pages /beta (static shell + modules)
      │
      ▼  iframe src = /beta/player?provider=videasy|vidking&id=…
Cloudflare Worker  ── reverse proxy (this repo: /beta/worker/worker.js)
      │   └─ fetches the provider embed page (server-side)
      │   └─ rewrites every script/css/img/media/iframe URL → /beta/proxy?u=…
      │   └─ injects /beta/popup-blocker, /beta/ad-filter, /beta/proxy/proxy-bootstrap
      ▼
Browser sees the player ONLY through the YStream origin
      ▼
same-origin DOM access → popup interception → ad filtering → playback intact
```

The browser-facing player URL is same-origin with `/beta`, so the beta page can
read the player DOM (no `SecurityError`) and install popup/ad controls the
provider never expected. The fact that the bytes come from Videasy/VidKing is
invisible to the browser.

## Layout

```
/beta/
  index.html                 Beta shell (looks like yStream, labelled BETA)
  styles.css                 Beta styling (production look, isolated)
  app.js                     Beta app entry: UI wiring, SW registration, params
  sw.js                      Beta service worker (scope = /beta only)
  player/beta-player.js      Proxy/direct player controller + control probes
  proxy/proxy-client.js      Proxy URL builders + health/preflight checks
  proxy/proxy-bootstrap.js   Injected: routes player fetch/XHR/media through /beta/proxy
  popup-blocker/popup-blocker.js  Injected: window.open stub + _blank + nav blocking
  ad-filter/ad-filter.js     Injected: modular, conservative DOM ad rules
  diagnostics/diagnostics.js Experiment diagnostics + 5-state classification
  worker/worker.js           Cloudflare Worker reverse proxy (beta routes only)
  worker/wrangler.toml.example
  worker/README.md           Worker deployment notes
```

## Running it

1. **Without the Worker** (static only): open `https://<github-pages>/beta/`.
   The health probe fails, the beta reports it, and the normal direct embed is
   used as a fallback. Playback works like production.
2. **With the Worker** (the experiment): deploy `/beta/worker` per
   [`/beta/worker/README.md`](worker/README.md) on the exact routes
   `/beta/healthz`, `/beta/player`, `/beta/proxy` of your Cloudflare-proxied
   domain, then open `https://<your-domain>/beta/?id=603&type=movie`.

Query params: `?id=603&type=movie|tv&s=1&e=1&title=…`

## Diagnostics

Open the *Diagnostics* toggle after loading a title. It verifies, live:

```
Proxy reachable            YES/NO
Player HTML loaded         YES/NO
Player scripts loaded      YES/NO (+ injected modules)
Player APIs loaded         YES/NO
Media initialized          YES/NO
Same-origin DOM access     YES/NO
Fullscreen                 YES/NO (probe button)
Popup interception         YES/NO (block counts)
Ad filter                  YES/NO (removed count)
Playback                   YES/NO (sampled currentTime)
Provider requests proxied  count
```

No cookies, API keys, signed URLs or sensitive headers are ever shown.

### The five experiment states

1. **Proxied successfully** — same-origin + media playing.
2. **Proxied but player partially broken** — same-origin, some part failed.
3. **Proxied but NOT same-origin** — worker answered but the iframe is
   cross-origin (worker not on this origin, or provider redirected away).
4. **Proxy rejected by provider** — upstream refused (HTTP error/bot check);
   never bypassed, falls back to the direct embed.
5. **Proxy technically impossible** — required resources can't pass (e.g.
   >100 MB single media bodies, WebSockets); explained, then fallback.

## Popup / ad experiments

With the player same-origin, the injected `popup-blocker.js` runs *before* the
provider scripts and:

- returns an experimental compatible **stub** from `window.open()` (no real tab),
- blocks `target="_blank"` / `target="_new"` links at the DOM level
  (capture listener + MutationObserver + patched `anchor.click()`),
- best-effort filters top-level navigation away from provider/beta origins,
- reports every interception into `__YSTREAM_BETA__.popup.blocked` (no secrets).

`ad-filter.js` is a modular rule list (`RULES` array) that starts conservative
(obvious ad overlays + ad iframes), protects the `<video>` element, and is
trivially expandable or fully disableable.

## Testing checklist

- Desktop Chrome / Edge / mobile browser
- Server 1 (Videasy) and Server 2 (VidKing)
- play / pause / seek / volume / mute / fullscreen / PiP / keyboard (`F`,
  `Ctrl+←/→`) / progress resume
- reload, server switching, direct fallback
- popup attempts (`window.open`, `_blank` links, programmatic `a.click()`)
- player errors, proxy errors, redirects, range/`206` media requests

## Known honest limitations

- The proxy cannot beat DRM, authentication, signed tokens or anti-proxy
  protections — it doesn't try. Those cases surface as state 4/5.
- Cloudflare Workers caps a single `fetch()` body at ~100 MB; huge single-file
  MP4s can fail (HLS segments are fine).
- WebSockets are not proxied.
- The `location`-assignment interception is best-effort (the browser forbids
  overriding `window.location` in some engines); `window.open` and anchor
  blocking are the reliable layers.
