# Remote WebSocket Stability

## Purpose

Make the web client more reliable against remote WebSocket latency, stale connections, and reconnect races. The feature should add ping support, connection timeout behavior, clearer transport errors, and reconnection paths that work across local and remote environments.

This feature differs from upstream by hardening the RPC/WebSocket transport for remote use.

## Context To Recreate

- RPC contract changes belong in `packages/contracts/src/rpc.ts`; the current delta adds `server.ping`.
- Client transport changes live in:
  - `apps/web/src/rpc/wsRpcClient.ts`
  - `apps/web/src/rpc/wsTransport.ts`
  - `apps/web/src/rpc/transportError.ts`
  - `apps/web/src/components/WebSocketConnectionSurface.tsx`
  - `apps/web/src/components/ChatView.browser.tsx`
  - `apps/web/src/components/CommandPalette.tsx`
  - `apps/web/src/components/settings/SettingsPanels.tsx`
- Server routing changes live in `apps/server/src/ws.ts`.
- Settings/contracts include remote connection behavior flags in `packages/contracts/src/settings.ts`.
- Tests live in `apps/web/src/rpc/wsRpcClient.test.ts`, `apps/web/src/rpc/transportError.test.ts`, and `apps/web/src/components/WebSocketConnectionSurface.logic.test.ts`.
- Avoid treating an opened socket as healthy until the app-level RPC path responds.
- Reconnects must not leave old listeners or pending RPC promises active.

## Prompt

Recreate remote WebSocket stability improvements on top of upstream `main`.

Add a lightweight `server.ping` RPC and use it as an application-level health check. Update the web RPC client and low-level transport so connection establishment, reconnect, close, timeout, and auth failures produce predictable states and useful errors. Ensure pending requests are settled when a socket closes and that stale sockets cannot overwrite newer connection state.

Update connection surfaces and chat bootstrapping so remote users see actionable reconnect/auth information instead of silent hangs. Keep behavior compatible with desktop local bootstrap.

Add focused tests for ping behavior, connection timeout, close handling, stale connection suppression, pending request rejection, and transport error normalization.

## Validation

Run:

```bash
bun run test apps/web/src/rpc/wsRpcClient.test.ts
bun run test apps/web/src/rpc/transportError.test.ts
bun run test apps/web/src/components/WebSocketConnectionSurface.logic.test.ts
bun fmt
bun lint
bun typecheck
```

Manual validation:

- Connect to a normal local server and confirm chat still loads.
- Connect to a remote URL with added latency and confirm the UI reaches ready state only after ping succeeds.
- Kill the server and confirm pending work fails visibly.
- Restart the server and confirm reconnect uses the latest socket only.
