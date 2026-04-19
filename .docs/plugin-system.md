# Plugin System

This document proposes the foundation for a T3 Code plugin system.

It is intentionally architecture-first. The goal is to answer the major design questions now so implementation can converge on a stable, minimal host contract instead of letting provider-specific or UI-specific shortcuts become the de facto plugin API.

## Goals

- Extend T3 without weakening its current performance, reliability, and reconnect behavior.
- Keep plugin failures isolated from the main server and from unrelated sessions.
- Make the stable plugin contract explicit instead of leaking server internals.
- Reuse existing architectural strengths: typed schemas, queue-backed orchestration, ordered pushes, and provider runtime normalization.
- Support multiple plugin contribution types over time without forcing all three into the first release.

## Non-goals

- Making every current server API pluggable.
- Letting plugins mutate orchestration state directly.
- Running third-party plugin code in-process with the server.
- Shipping an open web-extension ecosystem in the first iteration.

## Current constraints from the codebase

Today T3 already has a few boundaries worth preserving:

- The browser talks to the server over typed WebSocket/RPC contracts in [`packages/contracts`](../packages/contracts/src).
- Provider-specific behavior is hidden behind [`ProviderAdapter`](../apps/server/src/provider/Services/ProviderAdapter.ts) and routed through [`ProviderService`](../apps/server/src/provider/Services/ProviderService.ts).
- Provider-native events are normalized into canonical [`ProviderRuntimeEvent`](../packages/contracts/src/providerRuntime.ts) values, then ingested into orchestration workers and projected into [`OrchestrationEvent`](../packages/contracts/src/orchestration.ts).
- Runtime modes and approval semantics already exist at the thread/session layer in [`orchestration.ts`](../packages/contracts/src/orchestration.ts) and are surfaced in the UI via [`runtime-modes.md`](./runtime-modes.md).

Those boundaries are useful, but they are not yet plugin contracts.

## Recommended scope

### What counts as a plugin?

A plugin should mean one installable package with a manifest plus one or more contributions.

Supported contribution categories should be:

- `provider`: a new provider/runtime implementation that can back threads and sessions
- `tool` or `hook`: server-side functionality invoked during turns, approvals, setup, git workflows, indexing, retrieval, or other host-driven workflows
- `ui`: web-visible contributions such as settings panes, renderer enrichments, or custom panels

That said, the first production version should be server-only:

- v1 supports `provider` and `tool`/`hook` contributions.
- v1 does not execute arbitrary plugin code in the browser.
- v1 may expose small declarative UI metadata from the server, but not a general web-extension runtime.

This keeps the first version aligned with the current reliability model, which is heavily server-centered.

## Stable contracts vs private internals

### Stable plugin contracts

The plugin surface should be a new explicitly-versioned package, for example `packages/plugin-contracts`, and only the APIs exported from that package should be considered stable for plugin authors.

Stable contracts should include:

- `plugin-manifest.v1`
- `plugin-install-lock.v1`
- `plugin-host-rpc.v1`
- `provider-plugin-rpc.v1`
- `tool-plugin-rpc.v1`
- `plugin-permissions.v1`
- `plugin-health.v1`
- `plugin-event-envelope.v1`

Provider plugins may reuse existing canonical schemas, but only through re-exported plugin-contract types. The main reusable candidate is [`ProviderRuntimeEvent`](../packages/contracts/src/providerRuntime.ts).

### Current internals that must stay private

The following should remain host-private and must not become accidental plugin APIs:

- [`ProviderService`](../apps/server/src/provider/Services/ProviderService.ts)
- [`ProviderAdapterRegistry`](../apps/server/src/provider/Services/ProviderAdapterRegistry.ts)
- [`ProviderRegistry`](../apps/server/src/provider/Services/ProviderRegistry.ts)
- [`codexAppServerManager`](../apps/server/src/codexAppServerManager.ts)
- orchestration workers such as [`ProviderRuntimeIngestion`](../apps/server/src/orchestration/Services/ProviderRuntimeIngestion.ts)
- server push implementation details in [`apps/server/src/ws.ts`](../apps/server/src/ws.ts)
- read-model persistence layout and checkpoint internals
- server dependency-injection graph and Effect service tags

Rule of thumb:

- `packages/contracts` describes browser/server contracts.
- `packages/plugin-contracts` should describe host/plugin contracts.
- `apps/server/src/**` stays private unless explicitly re-exported through plugin contracts.

## Runtime model

### In-process vs separate process

Plugins should run as separate processes.

Reasoning:

- T3 is reliability-first.
- A plugin is untrusted relative to the host, even when locally authored.
- The current provider boundary already uses process isolation well via `codex app-server`.
- Separate processes make restart, health checks, memory caps, and crash attribution much cleaner.

In-process plugins should be reserved for host-owned testing shims only, not public plugin API.

### RPC/protocol

The host/plugin transport should be JSON-RPC 2.0 over stdio with `Content-Length` framing.

Reasoning:

- It matches the current `codex app-server` shape closely enough to reuse host machinery and operator intuition.
- It is streaming-friendly.
- It avoids ad hoc line-delimited protocol bugs.

The host contract should define:

- request/response methods for initialization, activation, permissioned host calls, and shutdown
- notifications for progress, health, logs, and event emission
- explicit error codes for timeout, permission denied, incompatible host version, and restart required

### Handshake

Recommended activation handshake:

1. Server startup reads plugin manifests only. No plugin code executes during discovery.
2. On first use, the host spawns the plugin with minimal environment and a neutral working directory.
3. Host sends `plugin.initialize`.
4. Plugin returns:
   - `pluginId`
   - `pluginVersion`
   - `pluginApiVersion`
   - `minimumHostVersion`
   - declared contributions
   - declared permissions
   - recovery capabilities
5. Host validates manifest, version compatibility, lockfile hash, and granted permissions.
6. Host sends `plugin.activate` with activation scope and runtime context.
7. Plugin emits `plugin.ready`.

### Heartbeat, timeout, and restart rules

Recommended defaults:

- Heartbeat interval: 15s while idle
- Heartbeat timeout: 5s
- Unhealthy after: 2 missed heartbeats
- Initialize timeout: 5s
- Tool/hook invocation start timeout: 10s
- Provider session start timeout: 15s to first runtime event
- Graceful shutdown timeout: 5s before kill

Restart rules:

- Crash during idle or startup: automatic restart with exponential backoff
- Crash during active tool/hook invocation: fail that invocation deterministically
- Crash during active provider session: fail that session unless the plugin explicitly supports session resume
- Crash loop threshold: 3 crashes in 5 minutes
- After crash loop threshold: mark plugin `unhealthy`, disable new activations, keep server running

The host should never retry mutating plugin work silently unless the invocation is explicitly declared idempotent.

## Failure isolation

A broken plugin must never be able to take down the whole T3 server through normal plugin failure paths.

Isolation targets:

- Tool/hook plugin failure: can fail one invocation or one turn
- Provider plugin failure: can fail one provider session
- Shared plugin manager bug: may affect one plugin family, but should not corrupt unrelated sessions
- Whole-server failure from plugin code: unacceptable by design

Practical consequence:

- Provider plugin instances should be session-scoped.
- Tool/hook plugins should be invocation-scoped in v1.
- If a later pooled mode is added for performance, it must preserve bounded blast radius and circuit-breaker behavior.

## Activation model

Plugin activation should be two-stage:

- discovery is eager at server startup
- execution is lazy on first actual use

Recommended behavior:

- At server startup, scan manifests, verify lockfile entries, and build a registry snapshot.
- Do not spawn plugin processes eagerly.
- Enablement is explicit, not implicit.
- A plugin can be enabled globally or per project.
- Provider plugins activate lazily when a thread selects that provider.
- Tool/hook plugins activate lazily when the host reaches the hook point or explicit tool call site.

This avoids server-start latency spikes while still making installed capabilities visible in settings and diagnostics.

## Lifecycle model

Recommended lifecycle states:

1. `installed`
2. `registered`
3. `disabled`
4. `enabled`
5. `active`
6. `unhealthy`
7. `upgrading`
8. `rolled-back`
9. `uninstalled`

Recommended lifecycle operations:

- `install`: place package in plugin store, verify manifest, hash, and optional signature
- `register`: add to host registry and lockfile
- `enable`: grant selected scopes and permissions
- `disable`: stop new activations, optionally drain active instances
- `upgrade`: install new version side-by-side, validate compatibility, then switch lockfile pointer
- `rollback`: revert lockfile pointer and optionally invoke state migration rollback
- `uninstall`: disable, stop, remove executable package, optionally keep state
- `cleanup`: remove plugin-owned state/cache/temp directories

The host should own lifecycle bookkeeping. Plugins should not mutate their own install metadata directly.

## Trust and authenticity

### Trust model

The recommended rollout is staged:

- v1: local installs plus first-party reviewed catalog entries
- v1 default: only first-party signed plugins enabled without extra warning
- v1 developer mode: allow local unsigned plugins by explicit path install
- later: broader third-party ecosystem only after stronger sandboxing and review tooling exist

Without OS-level sandboxing, T3 should not pretend that arbitrary third-party plugins are safely contained.

### Authenticity verification

Recommended verification stack:

- required manifest with immutable `pluginId` and `version`
- host-maintained lockfile with pinned version and content hash
- optional signature for catalog-distributed plugins
- explicit path allowlist for local development installs
- no floating versions at runtime

Trust levels should be surfaced in the UI:

- `builtin`
- `signed-first-party`
- `local-dev`
- `unsigned-third-party`

Unsigned third-party plugins should require an explicit unsafe enable flow.

## Permissions model

Plugins should not receive broad ambient access by default. They should request named host capabilities, and the host should broker those capabilities.

Recommended permission families:

- `filesystem.read`
- `filesystem.write`
- `git.read`
- `git.write`
- `network.outbound`
- `secrets.read`
- `model.invoke`
- `terminal.exec`
- `browser.openExternal`
- `ui.contribute`
- `events.emit`

Permissions should also carry scope restrictions, for example:

- project root only
- worktree only
- plugin state directory only
- named secret keys only
- outbound host allowlist

### Interaction with runtime modes and approvals

Plugin permissions must be capped by the thread/session runtime mode. A granted plugin permission is necessary but not sufficient.

Recommended policy:

- `approval-required`: plugin writes, terminal execution, model invocation, and unrestricted network access must go through normal approval flows
- `auto-accept-edits`: filesystem writes may proceed without per-action approval, but terminal, secrets, and broad network access still respect host policy
- `full-access`: plugin may use already-granted permissions without per-action approval

Important rule:

Plugins must never bypass the host approval model by operating directly on the workspace through ambient OS access.

That means the host should launch plugins with:

- minimal environment variables
- no inherited secrets by default
- a neutral cwd
- brokered access to project resources through host RPC

This is host-level containment, not full OS-level containment. Until stronger sandboxing exists, trust posture still matters.

## Plugin state

Plugin state should live in host-managed, namespaced directories.

Recommended layout:

- install store: `~/.t3/plugins/store/<pluginId>/<version>/`
- registry/lockfile: `~/.t3/plugins/registry.json`
- durable state: `~/.t3/plugins/state/<pluginId>/`
- cache: `~/.t3/plugins/cache/<pluginId>/`
- temp runtime files: `~/.t3/plugins/run/<instanceId>/`

Ownership rules:

- Host owns directory creation, removal, and top-level layout.
- Plugin owns the schema of files within its state directory.
- Plugin declares a state schema version in the manifest.
- Plugin provides forward migrations for upgrades.
- Host invokes migrations during upgrade and cleanup hooks during uninstall when possible.

Rollback rules:

- Package rollback is host-controlled.
- State rollback is best-effort unless the plugin provides explicit reverse migrations.
- If state is not reversible, the plugin must declare that and the host must warn before upgrade.

## Event model

Plugins should not emit canonical orchestration events directly.

Recommended rule set:

- Provider plugins may emit canonical [`ProviderRuntimeEvent`](../packages/contracts/src/providerRuntime.ts) values.
- The host ingests those runtime events through the same normalization and orchestration pipeline used for built-in providers.
- Tool/hook plugins emit plugin execution events such as `started`, `progress`, `request`, `result`, `warning`, and `error`.
- The host maps tool/hook events into user-visible thread activities, approval requests, or internal receipts.
- Opaque plugin payloads are allowed only in namespaced detail fields and must not become authoritative host state.

This preserves one source of truth for orchestration while still letting plugins stream useful progress.

## Reliability across reconnects and restarts

Provider plugins should meet the same durability expectations as built-in providers if they want to appear as first-class providers in the main UI.

Recommended policy:

- Provider plugins must declare either `resumable` or `ephemeral` recovery mode.
- Only `resumable` providers should be considered production-grade providers.
- Resumable providers must persist enough state for the host to reconnect after browser reconnects and server restarts.
- Tool/hook plugins are best treated as invocation-scoped in v1 and are not required to resume mid-stream after server restart.

Even when a tool/hook invocation cannot resume, the host should still preserve:

- already-committed orchestration events
- already-published thread activities
- deterministic failed status for the interrupted invocation

## Performance budgets

These budgets should be treated as product targets, not loose suggestions.

- Manifest discovery at server start: p95 under 200ms for 25 installed plugins, with no process spawn
- Tool/hook cold activation: p95 under 500ms
- Provider cold activation: p95 under 2s to first runtime event
- Additional host overhead per plugin-emitted event: p95 under 25ms
- Idle plugin RSS target: under 128MB for tool/hook instances
- Provider session RSS target: under 256MB per session-scoped instance
- Max concurrent active tool/hook invocations: bounded, default 16 global and 4 per plugin
- Backpressure: bounded queues only, never unbounded buffering

Backpressure policy:

- When a plugin exceeds queue or event-rate limits, the host should slow, reject, or fail that plugin invocation.
- The host must prefer dropping plugin work over risking server memory pressure or event-loop collapse.

## Observability requirements

Mandatory plugin observability:

- plugin-scoped structured logs
- plugin/process lifecycle events
- per-plugin health state
- crash count and last crash reason
- activation and invocation latency
- memory usage where available
- unload reason
- permission-denied audit events

Metrics should be namespaced separately from core provider metrics, for example:

- `t3_plugin_activations_total`
- `t3_plugin_activation_duration`
- `t3_plugin_invocations_total`
- `t3_plugin_invocation_duration`
- `t3_plugin_crashes_total`
- `t3_plugin_restarts_total`
- `t3_plugin_health_state`

All logs, traces, and metrics should carry:

- `pluginId`
- `pluginVersion`
- `instanceId`
- contribution type
- project/thread/session identifiers when applicable

## Compatibility policy

The plugin API needs its own versioning policy, separate from T3’s internal refactors.

Recommended policy:

- `pluginApiVersion` uses semver
- host and plugin must agree on major version
- minor versions are negotiated via capabilities during `initialize`
- plugin manifest includes `minimumHostVersion`
- deprecated plugin APIs stay available for at least 2 host minor releases before removal

Important principle:

Host internals can keep moving quickly as long as the plugin contract package stays stable.

## Testing strategy

Plugins need stronger-than-normal failure testing because they sit on a fault boundary.

Required test layers:

- contract tests for manifest validation and RPC schema compatibility
- host/plugin integration tests with golden protocol fixtures
- failure-injection tests for timeout, crash, malformed event, and permission denial
- restart/reconnect tests for provider plugins
- load tests for event storms and concurrent invocations
- compatibility tests against supported host/plugin version matrices

For production-quality provider plugins, add:

- partial stream recovery tests
- session restart tests
- approval flow tests under every runtime mode
- checkpoint/diff completion tests when the plugin participates in turn execution

## Web app plugin surface

The first version should be server-only.

Reasoning:

- The current reliability model is server-centric.
- Browser extensions create another trust and lifecycle boundary too early.
- Reconnect and version skew are easier when the server remains the source of truth.

Recommended first-step UI story:

- server exposes plugin metadata and health into settings
- server may expose declarative contributions such as settings schemas, badges, or provider descriptors
- the web app renders those declarative surfaces using built-in components

Only after the server-side system is stable should T3 consider a richer web-plugin runtime.

## Initial rollout plan

### Phase 1

- Introduce `packages/plugin-contracts`
- Add manifest, registry, lockfile, and verification model
- Support out-of-process server plugins only
- Support provider plugins and invocation-scoped tool/hook plugins
- Add plugin health, metrics, logs, and crash isolation

### Phase 2

- Add resumable provider plugin certification path
- Add project-scoped enablement and richer permission prompts
- Add upgrade and rollback workflows
- Add declarative web surfaces backed by server metadata

### Phase 3

- Consider pooled tool runtimes for performance where justified
- Consider broader third-party ecosystem distribution
- Consider stronger OS sandboxing and signature enforcement
- Consider a richer web-plugin runtime only if the reliability story remains acceptable

## Summary decisions

- A plugin is one package that may contribute providers, tools/hooks, and later UI.
- The first shipped system should be server-only.
- Stable plugin APIs should live in a new explicit contract package, not in current server internals.
- Plugins should run out-of-process over JSON-RPC 2.0 on stdio.
- Provider plugins should be session-scoped; tool/hook plugins should be invocation-scoped in v1.
- Plugin failures may fail one invocation or one session, but not the whole server.
- Discovery should be eager, execution lazy, and enablement explicit.
- Authenticity should rely on manifest + lockfile hash + optional signature.
- Permissions must be brokered by the host and capped by runtime mode.
- Plugins should not emit orchestration events directly.
- Production-grade provider plugins must support reconnect and restart recovery comparable to built-ins.
- Observability, crash isolation, and compatibility policy are mandatory parts of the design, not follow-up work.
