# Remote Auth Pairing And R-Auth Sync

## Purpose

Support authenticated remote access and authorized-server synchronization with an external r-auth service. The feature should support explicit auth posture descriptors, one-time pairing credentials, bearer/browser session auth, external signed grant verification, saved remote environments, and access-management UI.

This feature differs from upstream by adding the remote auth model and r-auth sync path for network-accessible T3 Code environments.

## Context To Recreate

- Contract schemas live in `packages/contracts/src/auth.ts`.
- Desktop/local persistence shape changes live in `packages/contracts/src/ipc.ts`, `apps/desktop/src/clientPersistence.ts`, and `apps/web/src/clientPersistenceStorage.ts`.
- Server auth implementation lives in:
  - `apps/server/src/auth/http.ts`
  - `apps/server/src/auth/Layers/ServerAuth.ts`
  - `apps/server/src/auth/Layers/ExternalAuthGrantVerifier.ts`
  - `apps/server/src/auth/Services/ExternalAuthGrantVerifier.ts`
  - `apps/server/src/http.ts`
  - `apps/server/src/server.ts`
  - `apps/server/src/config.ts`
  - `apps/server/src/cli.ts`
- Web r-auth implementation lives in:
  - `apps/web/src/rAuth/api.ts`
  - `apps/web/src/rAuth/sync.ts`
  - `apps/web/src/environments/primary/auth.ts`
  - `apps/web/src/environments/runtime/service.ts`
  - `apps/web/src/environments/runtime/catalog.ts`
  - `apps/web/src/components/settings/ConnectionsSettings.tsx`
  - `apps/web/src/components/WebSocketConnectionSurface.tsx`
- Auth policies include `desktop-managed-local`, `loopback-browser`, `remote-reachable`, and `unsafe-no-auth`.
- Bootstrap methods include `desktop-bootstrap` and `one-time-token`.
- Session methods include `browser-session-cookie` and `bearer-session-token`.
- External auth grant claims are signed as `header.claims.signature`, where claims include `v`, `iss`, `aud`, `sub`, `role`, `email`, `name`, `iat`, and `exp`.
- The verifier must check signature, issuer, audience equals environment id, and expiry.
- R-auth endpoints used by the web client:
  - `GET /rest/v1/auth/session`
  - `GET /rest/v1/t3/servers`
  - `POST /rest/v1/t3/servers`
  - `POST /rest/v1/t3/servers/claim`
  - `POST /rest/v1/t3/grant`

## Prompt

Recreate remote authentication, pairing, and r-auth authorized-server synchronization on top of upstream `main`.

Model auth capabilities in contracts first. Add server-side auth descriptors, bootstrap routes, websocket token handling, session issuing, and access snapshot streaming. Keep unsafe no-auth as an explicit mode only. Add external grant verification using a configured issuer and shared secret, with timing-safe signature comparison and strict audience/expiry checks.

On the web side, add an r-auth API client and sync layer that can discover authorized T3 servers, claim/register environments, request grants, persist saved environments, and bootstrap connections using bearer or cookie sessions. Update connection settings and websocket connection surfaces so users can understand local vs remote auth state and reconnect with the correct credentials.

Add tests around descriptor shape, bootstrap behavior, external grant verification, saved environment sync, 401/404 r-auth behavior, and websocket connection fallback.

## Validation

Run:

```bash
bun run test apps/server/src/auth/Layers/ServerAuth.test.ts
bun run test apps/web/src/rAuth/api.test.ts
bun run test apps/web/src/rAuth/sync.test.ts
bun run test apps/web/src/environments/runtime/service.addSavedEnvironment.test.ts
bun run test apps/web/src/authBootstrap.test.ts
bun fmt
bun lint
bun typecheck
```

Manual validation:

- Start a local desktop-managed environment and confirm silent bootstrap still works.
- Start a remote-reachable environment and confirm pairing is required.
- Pair a browser session through a one-time credential.
- Sync an authorized server from r-auth and reconnect using the issued grant.
- Confirm expired or wrong-audience external grants fail.
