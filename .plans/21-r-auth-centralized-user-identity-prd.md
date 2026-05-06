# PRD: r-auth Centralized User Identity

Triage label: `needs-triage`

## Problem Statement

T3 Code currently authenticates each T3 server independently. A user pairs a browser or remote environment by exchanging a local one-time token for a T3 Code session credential, and that credential is persisted per browser or desktop profile. This works for local and direct remote access, but it does not establish a shared user identity across T3 Code clients, hosted web sessions, remote environments, or future multi-device flows.

The result is that environment access is device-local, user identity is implicit, and authorization cannot be managed centrally. A user should be able to sign in once through `r-auth`, see the T3 environments they are allowed to use, authorize a new environment from inside T3 Code, and connect without manually copying backend pairing tokens as the primary product flow.

## Solution

Add an in-app `r-auth` integration that makes `r-auth` the centralized user identity and T3 environment authorization service while preserving T3 Code's existing runtime session boundary.

Users will sign in to `r-auth` from inside T3 Code. Once signed in, T3 Code will use `r-auth` to list authorized environments, claim new environments when a claim proof is available, and request short-lived T3 environment grants. T3 Code servers will verify those grants and exchange them for the existing T3 Code session credentials used by HTTP and WebSocket runtime traffic.

This keeps the T3 server as the execution boundary and avoids making Better Auth cookies the direct authorization mechanism for every T3 Code runtime request. `r-auth` owns global identity and authorization decisions. T3 Code owns local runtime sessions, websocket tokens, provider state, and execution.

## User Stories

1. As a T3 Code user, I want to sign in with my shared `r-auth` account inside T3 Code, so that my identity follows me across clients.
2. As a hosted web user, I want an in-app sign-in flow, so that I do not need to leave the app to understand why I cannot access an environment.
3. As a desktop user, I want local desktop bootstrap to continue working, so that local development remains fast when centralized auth is not needed.
4. As a remote environment user, I want to see environments authorized for my account, so that I can connect without manually pasting pairing tokens.
5. As a user with multiple T3 environments, I want each environment to show a readable label and role, so that I can choose the right backend confidently.
6. As an environment owner, I want to authorize a T3 server to my `r-auth` account, so that I can later connect to it from other clients.
7. As an environment owner, I want T3 Code to create or expose a claim proof for my current environment, so that `r-auth` can register it without trusting arbitrary client input.
8. As a signed-in user, I want T3 Code to request a short-lived environment grant from `r-auth`, so that environment access is tied to my central account.
9. As a signed-in user, I want expired environment grants to refresh through `r-auth`, so that reconnecting after idle time is predictable.
10. As a signed-in user, I want revoked or unauthorized environments to show an actionable auth state, so that I know whether to sign in, request access, or remove the environment.
11. As an owner, I want users with `client` role to get client-level T3 sessions, so that authorization roles remain consistent across `r-auth` and T3 Code.
12. As an owner, I want owner-only T3 Code actions to remain protected, so that centralized identity does not accidentally widen local administrative powers.
13. As a user, I want sign-out to clear `r-auth` state and disconnect centralized-auth environments, so that shared machines do not keep my access.
14. As a user, I want existing manually paired environments to keep working, so that migration does not break current workflows.
15. As a user, I want T3 Code to distinguish local pairing from `r-auth` authorization, so that error messages match the flow I am using.
16. As a hosted web user, I want the app to remember my signed-in identity when cookies are valid, so that reloads do not force re-authentication.
17. As a hosted web user, I want browser CORS and cookie failures to be surfaced clearly, so that deployment configuration problems can be diagnosed.
18. As a desktop user, I want external auth redirects to return to the app, so that the flow feels native.
19. As a developer running local T3 Code, I want a configurable `r-auth` base URL, so that local and production auth services can be tested safely.
20. As an operator, I want T3 Code to support disabling centralized auth, so that local-only and private deployments can keep their current posture.
21. As a server operator, I want the T3 server to verify `r-auth` grants locally, so that runtime auth does not depend on a remote network call for every request.
22. As a security reviewer, I want grant verification to check issuer, audience, signature, expiry, and role, so that a grant for one environment cannot be replayed against another.
23. As a user, I want the environment list to mark which environments are reachable, so that authorization and network connectivity are not conflated.
24. As a user, I want manually pairing a backend to optionally register it with `r-auth`, so that one successful local pairing can become a reusable central authorization.
25. As a support/debugging user, I want auth state to be visible in connection settings, so that I can see whether the current backend is local-token, bearer-session, or `r-auth` grant based.
26. As a tester, I want deterministic auth errors in integration tests, so that expired grants, revoked sessions, and missing identities do not become flaky reconnect failures.

## Implementation Decisions

- Build an `r-auth` client module in the web app that wraps the service's public REST API and Better Auth client operations behind a small typed interface.
- Add shared schema-only contracts for `r-auth` session, authorized T3 server, T3 grant, and claim-proof payloads. Keep these in the contracts package and avoid runtime logic there.
- Add server-side grant verification as a deep module. Its interface should accept a credential and expected environment identity, then return normalized user identity and role claims or a typed auth error.
- Extend the existing server auth bootstrap path with a new bootstrap credential method for `r-auth` T3 grants. The result should still be a normal T3 Code browser or bearer session.
- Keep existing `browser-session-cookie`, `bearer-session-token`, and websocket-token behavior for steady-state T3 Code traffic.
- Preserve desktop-managed local bootstrap and one-time token pairing as supported flows. `r-auth` should add a centralized identity path, not remove the local runtime auth model.
- Add server configuration for `r-auth` enablement, auth base URL, expected issuer, and grant shared secret. Missing required config should disable the centralized flow with explicit diagnostics.
- Add client configuration for `r-auth` base URL and whether in-app identity UX should be shown.
- Add an in-app identity surface under settings or connections that shows signed-in user, authorized environments, sign-in/sign-out, and refresh state.
- Add an in-app environment authorization flow that can request a grant for an authorized environment and then reuse the existing saved environment connection machinery.
- Add support for claim-proof based environment registration only after the server can produce a proof whose audience is the configured `r-auth` issuer.
- Store long-lived `r-auth` identity in the auth service cookie. Store T3 Code runtime bearer sessions as today, but annotate saved environment auth source so reconnect and error handling can refresh through the correct path.
- Treat short-lived `r-auth` T3 grants as exchange-only credentials. Do not persist grants as saved environment secrets.
- Map `r-auth` roles directly to T3 Code session roles: `owner` remains owner, `client` remains client.
- Treat connectivity and authorization as separate states. A user may be authorized in `r-auth` while the backend is unreachable.
- Keep remote environment access at the environment connection layer, consistent with the existing remote architecture.

## Testing Decisions

- Tests should assert external behavior at auth boundaries: issued sessions, rejected credentials, role mapping, reconnect behavior, and visible auth states. They should not assert private helper call ordering.
- Add focused unit tests for T3 grant verification covering malformed grants, invalid signatures, unexpected issuer, wrong environment audience, expired grants, and valid owner/client grants.
- Add server auth tests for exchanging an `r-auth` grant into browser and bearer T3 Code sessions.
- Add web auth client tests for `r-auth` REST responses, 401 handling, network failures, and grant request errors.
- Add environment runtime tests for saved environments whose auth source is `r-auth`: successful connect, expired local bearer session followed by grant refresh, unauthorized grant response, and sign-out cleanup.
- Add UI tests around the in-app identity surface once component structure is settled: signed out, signed in, no authorized environments, authorized environment available, and authorization error.
- Use existing auth bootstrap tests as prior art for primary browser auth behavior.
- Use existing remote environment runtime tests as prior art for bearer-token persistence and reconnect behavior.
- Use existing server auth tests as prior art for HTTP route and websocket token coverage.

## Out of Scope

- Replacing Better Auth or changing how `r-auth` sends email, stores users, or manages its D1 database.
- Replacing all T3 Code runtime session handling with Better Auth cookies.
- Syncing provider credentials, Codex auth, Claude auth, or source-control auth across machines.
- Building a hosted relay or proxy for unreachable T3 environments.
- Changing the core provider orchestration, thread, terminal, filesystem, or git runtime.
- Implementing organization/team administration beyond the role information already present in `r-auth` T3 environment authorizations.
- Removing existing manual pairing, desktop bootstrap, SSH environment, or bearer-session flows.

## Further Notes

The clean architecture boundary is: `r-auth` proves who the user is and whether they may access an environment; T3 Code proves the current client may operate a specific T3 runtime session. That split gives us centralized identity without making every local runtime request dependent on a remote auth service.

The first implementation should optimize for a narrow vertical slice: sign in, list authorized environments, request a grant, exchange it for a T3 Code bearer session, connect over WebSocket, and handle sign-out. Claim proof registration and richer management UX can follow after that path is reliable.

The current issue tracker publishing path is not configured in this checkout, so this PRD is recorded locally with the intended `needs-triage` label.
