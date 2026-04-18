# Project Structure Template

Use this file as the canonical framework for new projects that should follow the same monorepo structure as this repository.

Replace placeholder names, but keep the package boundaries and responsibilities intact unless there is a strong reason to diverge.

## Goal

This template is for projects that want:

- a server-first runtime
- a separate web UI
- an optional desktop shell
- shared contracts between server and client
- shared runtime utilities without turning the repo into a dependency tangle
- clear boundaries for future growth

## Top-Level Layout

```text
/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   ├── scripts/
│   │   ├── integration/
│   │   └── package.json
│   ├── web/
│   │   ├── src/
│   │   ├── public/
│   │   ├── test/
│   │   └── package.json
│   ├── desktop/
│   │   ├── src/
│   │   ├── scripts/
│   │   ├── resources/
│   │   └── package.json
│   └── marketing/
│       ├── src/
│       ├── public/
│       └── package.json
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   └── package.json
│   ├── shared/
│   │   ├── src/
│   │   └── package.json
│   ├── client-runtime/
│   │   ├── src/
│   │   └── package.json
│   └── effect-acp/
│       ├── src/
│       ├── scripts/
│       ├── test/
│       └── package.json
├── scripts/
├── .docs/
├── package.json
└── turbo.json
```

## Package Responsibilities

### `apps/server`

Purpose:

- the main backend runtime
- owns HTTP/WebSocket serving
- owns orchestration, persistence, provider/runtime process management, and server-side business logic

Put here:

- API entrypoints
- WebSocket handlers
- orchestration engines
- persistence layers
- checkpointing and recovery logic
- provider or external-runtime adapters

Do not put here:

- browser-only UI logic
- shared types that must also be consumed by the web app

### `apps/web`

Purpose:

- the main browser UI
- owns rendering, interaction, routing, local UI state, and API/WebSocket consumption

Put here:

- React components
- routes
- client state
- browser persistence
- view-specific logic

Do not put here:

- server authority logic
- duplicated shared helpers that should live in `packages/shared`
- contract definitions that cross the server/client boundary

### `apps/desktop`

Purpose:

- optional Electron or native desktop shell around the product
- owns desktop-only startup, packaging, and OS integrations

Put here:

- desktop bootstrap code
- auto-update integration
- tray/menu/window behavior
- desktop packaging scripts

Do not put here:

- shared application logic unless it is truly desktop-specific

### `apps/marketing`

Purpose:

- separate public-facing site
- should be isolated from product runtime concerns

Put here:

- landing pages
- docs marketing pages
- product announcement pages

Do not put here:

- product runtime logic
- shared app state or orchestration logic

### `packages/contracts`

Purpose:

- the shared schema and contract boundary between server and clients

Put here:

- request/response types
- event payload types
- shared model types
- schema definitions for cross-process or cross-network payloads

Rules:

- keep this package schema-only
- no runtime side effects
- no app-specific business logic

### `packages/shared`

Purpose:

- shared runtime utilities used by multiple apps

Put here:

- pure utilities
- reusable helpers
- cross-app runtime primitives
- small infrastructure helpers that are not tied to one app

Rules:

- use explicit subpath exports
- avoid a giant barrel file
- prefer focused modules over broad grab-bags

### `packages/client-runtime`

Purpose:

- shared client-facing runtime helpers that support the main UI

Put here:

- client-side runtime adapters
- shared browser-facing coordination helpers
- reusable frontend runtime primitives

### `packages/effect-acp`

Purpose:

- protocol/runtime support package for advanced integration flows

Put here:

- protocol helpers
- generated runtime schemas
- protocol client/server helpers
- package-specific scripts and tests

## Dependency Direction

Prefer this dependency flow:

```text
apps/server  -> packages/contracts
apps/server  -> packages/shared

apps/web     -> packages/contracts
apps/web     -> packages/shared
apps/web     -> packages/client-runtime

apps/desktop -> apps/server
apps/desktop -> apps/web
apps/desktop -> packages/contracts
apps/desktop -> packages/shared

packages/client-runtime -> packages/contracts
packages/shared         -> packages/contracts
```

Rules:

- `packages/contracts` should sit near the bottom of the dependency graph
- `packages/shared` may depend on `packages/contracts`, but should not depend on app packages
- app packages should not depend on each other unless there is a deliberate shell relationship, like desktop wrapping the core product
- avoid circular dependencies at all costs

## File Placement Rules

Use these defaults when adding new code:

- If it defines data crossing server/client or process boundaries, put it in `packages/contracts`.
- If it is shared runtime logic used by multiple apps, put it in `packages/shared`.
- If it only affects browser rendering or interaction, put it in `apps/web`.
- If it only affects backend orchestration, persistence, or process management, put it in `apps/server`.
- If it only affects packaging or desktop integration, put it in `apps/desktop`.
- If it only affects the public website, put it in `apps/marketing`.

## Suggested Internal Organization

Within `apps/server/src`, prefer folders like:

- `provider/`
- `orchestration/`
- `persistence/`
- `checkpointing/`
- `auth/`
- `observability/`
- `git/`

Within `apps/web/src`, prefer folders like:

- `components/`
- `hooks/`
- `lib/`
- `observability/`

Within `packages/shared/src`, prefer focused modules with explicit names, for example:

- `git.ts`
- `logging.ts`
- `shell.ts`
- `path.ts`
- `projectScripts.ts`

## Documentation Expectations

Every project using this structure should keep:

- `AGENTS.md` for repo-specific working rules
- `.docs/workspace-layout.md` for a short package map
- `.docs/architecture.md` for runtime and system flow

Optional but recommended:

- `.docs/provider-architecture.md`
- `.docs/runtime-modes.md`
- `.docs/ci.md`

## Validation Workflow

At the repo root, define a consistent validation path. A Bun/Turbo version of that looks like:

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`

If the project uses a different toolchain, keep the same categories:

- formatting
- linting
- typechecking
- tests

## Copy-Forward Rules

When starting a new project from this template:

1. Keep the same top-level app and package split.
2. Rename package scopes and binaries, but do not blur responsibilities.
3. Keep contracts schema-only.
4. Keep shared runtime logic extracted into `packages/shared`.
5. Keep desktop and marketing isolated from core runtime concerns.
6. Document any intentional deviation from this structure in `.docs/workspace-layout.md`.
