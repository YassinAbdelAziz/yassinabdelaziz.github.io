# yStream BETA — Cloudflare Worker proxy

The browser-facing player must be served from the **same origin** as `/beta`.
GitHub Pages cannot execute a reverse proxy, so the server-side piece lives in
this Cloudflare Worker.

The beta site auto-detects the proxy:

- Worker reachable + same-origin → **proxy mode** (the experiment).
- Worker reachable but cross-origin (e.g. deployed on `*.workers.dev` only) →
  the iframe loads but `SecurityError` is reported → diagnostics **state 3**.
- Worker absent → **direct embed fallback** (diagnostics state 0).

## How it works

```
/beta (GitHub Pages)  ── iframe ──►  /beta/player?provider=… (Cloudflare Worker)
                                        └─ fetch + rewrite Videasy/VidKing embed
                                        └─ all resource URLs → /beta/proxy?u=…
                                        └─ inject popup-blocker / ad-filter /
                                           fetch-patcher scripts
                                        └─ browser sees ONLY the YStream origin
```

The injected scripts (which implement `window.open` stubbing, `_blank` link
blocking, DOM ad-filtering and same-origin fetch/XHR routing) live as static
files under `/beta/popup-blocker`, `/beta/ad-filter` and `/beta/proxy` so they
are version-controlled and editable without redeploying the Worker.

## Deploy

1. `cp wrangler.toml.example wrangler.toml`
2. Fill in `zone_id` and confirm your custom domain is **proxied** (orange cloud)
   through Cloudflare so the exact-path routes take effect.
3. `npx wrangler deploy`

### Recommended routes (exact paths)

```
ystream.dpdns.org/beta/healthz
ystream.dpdns.org/beta/player
ystream.dpdns.org/beta/proxy
```

Exact paths matter: with wildcards like `/beta/proxy/*`, the Worker would also
swallow the static module files under `/beta/proxy/` and `/beta/player/`. If you
must use wildcard routes, set `STATIC_ORIGIN = "yassinabdelaziz.github.io"` in
the Worker vars so the Worker can pass those module files through from GitHub
Pages.

## Scope & limits (honest notes)

- The Worker only answers `/beta/healthz`, `/beta/player`, `/beta/proxy`.
  Everything else is left to GitHub Pages. Production is untouched.
- No DRM / auth / signed-token bypass. Endpoints like `license`, `widevine`,
  `playready`, `/auth`, `/token` are explicitly excluded from proxying.
- No header spoofing. A conservative browser-normal set of headers is forwarded
  (`User-Agent`, `Accept`, `Range`, …). No `Referer` is sent unless you set
  `REFERER` in `wrangler.toml`.
- Cookie sessions: provider `Set-Cookie` values are re-scoped to
  `Path=/beta; SameSite=None; Secure` on this origin and forwarded back, so a
  session can survive across proxied requests without leaking into production.
- Media: responses are streamed and `Range`/`206` are preserved. Cloudflare
  Workers caps a single `fetch()` response body at ~100 MB, so huge single-file
  MP4s can fail (state 5). HLS segments (the typical case) pass through fine.
- WebSockets are not proxied.

## Diagnostics on failures

Failures are never hidden: the beta UI shows one of the five experiment states
(proxied OK / proxied partial / proxied not same-origin / proxy rejected /
proxy impossible) and falls back to the normal direct embed when the proxy
cannot legitimately serve the player.
