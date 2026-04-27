# Plan: r-auth Integration and Authorized Server Sync

## Summary

Integrate `r-auth` (`auth.rmcd.cc`, `~/Development/r-auth`) into `t3code` as the user identity and server-authorization authority, while keeping each T3 server responsible for issuing its own local session after a verified external grant.

When a user is logged into the client, the client should automatically sync the list of servers that user is authorized to access and surface them as managed environments in T3 Code.

## Assumption

This plan assumes "adding clients" means:

- the T3 Code app becomes an authenticated `r-auth` client
- optionally each install/browser profile gets a stable client-install identity for audit and future device-scoped policy
- synced "clients" in T3 Code map to saved remote environments, not to the existing server-local `auth_client_sessions` table

## Current state

### In `t3code`

- Local/server auth already exists and is server-owned:
  - bootstrap/session contracts in `packages/contracts/src/auth.ts`
  - HTTP auth routes in `apps/server/src/auth/http.ts`
  - auth/session issuance in `apps/server/src/auth/Layers/ServerAuth.ts`
- Remote environments already exist:
  - manual add flow in `apps/web/src/environments/runtime/service.ts`
  - saved environment persistence in `apps/web/src/environments/runtime/catalog.ts`
  - browser-side secret persistence in `apps/web/src/clientPersistenceStorage.ts`
- Auth access UI already exists for the primary server in `apps/web/src/components/settings/ConnectionsSettings.tsx`

### In `r-auth`

- User authentication exists via Better Auth.
- Public session/config endpoints already exist.
- There is currently no model for:
  - T3 servers
  - user-to-server authorization
  - T3 client installs
  - issuing environment-scoped grants for T3 servers

## Goals

- Let a signed-in `r-auth` user see and connect to their authorized T3 servers from T3 Code.
- Keep T3's existing local session/cookie/bearer model intact where possible.
- Make synced environments server-authoritative without clobbering manual environments.
- Avoid persisting unnecessary long-lived remote secrets in the browser.
- Leave room for desktop-friendly secure persistence and future multi-user policy.

## Non-goals

- Replacing T3's local auth/session store with Better Auth directly.
- Full RBAC inside a T3 server.
- Offline access to synced remote servers without either a valid `r-auth` session or a server-issued local credential.
- A generic OAuth provider abstraction in the first pass.

## Core decisions

### 1. `r-auth` is the identity and authorization plane

`r-auth` should own:

- authenticated user identity
- the catalog of known T3 servers
- which users may access which servers
- optional client-install registration and audit metadata

### 2. Each T3 server remains the session plane

Each T3 server should continue to issue its existing local browser/bearer sessions via `SessionCredentialService`.

The new integration point is:

- `r-auth` issues a short-lived signed environment grant
- the T3 server verifies that grant
- the T3 server exchanges it for its normal local session token/cookie

This preserves the current WebSocket/session architecture and limits blast radius.

### 3. Synced environments and manual environments must be distinct

The current saved-environment registry is effectively manual-only. Add source metadata so the client can safely:

- upsert `r-auth`-managed environments
- remove only `r-auth`-managed environments that were revoked
- preserve user-added manual environments

### 4. Browser sync should prefer short-lived grants over stored bearer secrets

The current browser persistence model stores remote bearer tokens inline. For `r-auth`-managed environments, prefer:

- storing environment metadata persistently
- obtaining fresh grants/local server sessions when needed
- only persisting long-lived remote secrets where the platform storage is strong enough

Desktop can later persist more aggressively than the browser if needed.

## Target architecture

### `r-auth` data model

Add server-authorization tables in `~/Development/r-auth`:

1. `t3_servers`
   - `environment_id`
   - `label`
   - `http_base_url`
   - `ws_base_url`
   - `status`
   - trust/issuer metadata needed by T3 servers
2. `t3_user_server_authorizations`
   - `user_id`
   - `environment_id`
   - `role` (`owner` or `client`)
   - `authorized_at`
   - `revoked_at`
3. `t3_client_installs` (recommended)
   - `client_install_id`
   - `user_id`
   - platform/device metadata
   - `last_seen_at`

### `r-auth` API surface

Add versioned T3-specific endpoints:

1. `GET /rest/v1/t3/session`
   - returns authenticated user info plus sync capability flags
2. `GET /rest/v1/t3/servers`
   - returns the current user's authorized servers
3. `POST /rest/v1/t3/clients/register`
   - optional client-install registration/update heartbeat
4. `POST /rest/v1/t3/servers/:environmentId/grant`
   - returns a short-lived signed grant scoped to one T3 environment

### T3 server integration

Extend `t3code` server auth to accept an external bootstrap/grant method:

1. Add an external bootstrap method to `packages/contracts/src/auth.ts`
   - e.g. `external-auth-grant` or `r-auth-grant`
2. Add server config/env for grant verification
   - issuer URL
   - audience / expected environment id
   - JWKS/public key or shared signing secret
3. Add a new exchange path in `apps/server/src/auth/Layers/ServerAuth.ts`
   - verify grant
   - map grant subject/role into existing local session issuance
   - issue the normal T3 bearer/cookie session

The server should not call `r-auth` synchronously on every request. Verification should be local after config/bootstrap.

### T3 client integration

Add an `r-auth` client module in `apps/web` that can:

- fetch `r-auth` session state using `credentials: "include"`
- fetch the authorized server list
- optionally register the client install
- request per-environment grants

This should be a separate client path from the existing primary-environment auth code in `apps/web/src/environments/primary/auth.ts`.

## T3 client sync behavior

### Registry model changes

Extend the persisted saved-environment model (`packages/contracts/src/ipc.ts` and the related browser/desktop persistence paths) with metadata like:

- `source: "manual" | "r-auth"`
- `authorizationId` or equivalent stable sync key
- `lastSyncedAt`
- optional `managedBy: "auth.rmcd.cc"`

### Sync algorithm

On app startup, reconnect, and explicit refresh:

1. Check whether the user has an active `r-auth` session.
2. If not signed in:
   - leave manual environments untouched
   - leave synced environments visible but marked signed-out/stale, or hide them behind a policy flag
3. If signed in:
   - fetch the authorized server list from `r-auth`
   - upsert all `r-auth`-managed environments into the saved environment registry
   - remove only previously synced environments that are no longer authorized
   - invalidate runtime metadata for removed environments and disconnect them cleanly
4. When a synced environment needs a live T3 connection:
   - request an environment-scoped grant from `r-auth`
   - exchange it with the T3 server for a local bearer session
   - proceed through the existing remote connection path

### Recommended rollout

#### Milestone A: directory sync first

- Add `r-auth` session + authorized-server sync.
- Show synced environments in the UI.
- Keep manual connect/pair fallback available.

#### Milestone B: full grant exchange

- Add `r-auth` environment grants.
- Add T3 server external grant verification.
- Auto-bootstrap synced environments without manual pairing.

This keeps the first integration small and makes debugging far easier.

## UI work

### In T3 Code

Update `apps/web/src/components/settings/ConnectionsSettings.tsx` to add:

- `r-auth` sign-in/sign-out/session status
- sync status and last sync timestamp
- a clear distinction between:
  - local primary environment access
  - manual saved environments
  - `r-auth`-managed environments
- retry/resync controls

### In `r-auth`

Extend the admin app so operators can:

- register/edit T3 servers
- grant/revoke user access to servers
- inspect client installs if that table is added

## File and module work by repo

### `t3code`

Expected touch points:

- `packages/contracts/src/auth.ts`
- `packages/contracts/src/ipc.ts`
- `apps/server/src/auth/Services/ServerAuth.ts`
- `apps/server/src/auth/Layers/ServerAuth.ts`
- `apps/server/src/auth/http.ts`
- `apps/server/src/config.ts` and related env parsing
- `apps/web/src/environments/runtime/catalog.ts`
- `apps/web/src/environments/runtime/service.ts`
- `apps/web/src/clientPersistenceStorage.ts`
- new `apps/web/src/rAuth/*` or equivalent client modules
- `apps/web/src/components/settings/ConnectionsSettings.tsx`

### `r-auth`

Expected touch points:

- `src/contracts/*`
- `src/http/rest.ts`
- `src/trpc/router.ts` if you also want typed admin management endpoints
- `src/auth/*` only as needed for Better Auth session reuse
- `admin/src/routes/*`
- D1 migrations / schema additions

## Risks and constraints

- Current browser secret persistence is too loose for a central multi-server auth model if long-lived bearer tokens keep being stored client-side.
- Cross-origin auth must be deliberate:
  - `r-auth` must trust the T3 client origin
  - client fetches must use `credentials: "include"`
  - T3 servers should not depend on `r-auth` cookies directly
- Environment identifiers must be stable and globally unique across the authorized server catalog.
- Sync must be idempotent and robust against partial failure:
  - stale environments
  - revoked access
  - failed grant exchange
  - server temporarily offline

## Validation

### `t3code`

- unit tests for synced-environment upsert/remove behavior
- unit tests for external grant verification and exchange
- UI tests for signed-in vs signed-out sync states
- `bun fmt`
- `bun lint`
- `bun typecheck`

### `r-auth`

- contract tests for T3 endpoints
- auth/session tests for signed-in and unauthorized cases
- migration tests if schema changes are non-trivial

## Exit criteria

- A signed-in `r-auth` user sees their authorized servers appear in T3 Code without manual duplication.
- Revoking server access in `r-auth` removes that environment from the synced set on the next sync.
- T3 Code can establish a remote connection to an authorized server using an `r-auth`-issued grant instead of a manually pasted pairing token.
- Manual environments still work and are not destroyed by sync.
