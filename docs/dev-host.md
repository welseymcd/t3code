# Dev Host

This repo can expose its dev server at `https://t3code.rmcd.fyi` through a shared local reverse proxy and a Cloudflare Tunnel.

## Architecture

- `cloudflared` terminates the wildcard `*.rmcd.fyi` edge route and forwards traffic into Docker.
- `traefik` inspects container labels on the shared `rmcd-devhost` Docker network.
- The dev container advertises two routes for `t3code.rmcd.fyi`:
  - `/api`, `/.well-known`, `/attachments`, and `/ws` -> T3 backend port `13773`
  - everything else -> Vite dev server port `5733`

That keeps the browser on one public origin while preserving Vite HMR and the app WebSocket connection.

## One-time Cloudflare setup

1. Run `bun run devhost:setup`.
2. The script reads `~/Development/r-auth/.env`, creates or reuses the `rmcd-devhost` tunnel, configures wildcard ingress for `*.rmcd.fyi`, upserts the wildcard DNS record, and writes `docker/dev-host/.env`.
3. Start the shared ingress stack with `bun run devhost:up`.

## Repo setup

1. Copy `.devcontainer/.env.example` to `.devcontainer/.env` if you need to override the hostname or ports.
2. Open the repo in its dev container.
3. Inside the dev container, run `bun run dev`.
4. Browse to `https://t3code.rmcd.fyi`.

## Notes

- Traefik's dashboard is exposed at `http://127.0.0.1:8088`.
- `.devcontainer/.env` and `docker/dev-host/.env` are ignored because they contain machine-local configuration and tunnel secrets.
- The Vite dev server is configured with an explicit allowed host for the public domain instead of using `allowedHosts: true`.
