# Provider Session And Worktree Recovery

## Purpose

Improve recovery when Codex/provider sessions fail because their worktree is missing, moved, or otherwise unrecoverable. The UI should guide users to restart or recover instead of showing misleading stopped-session messages, and server orchestration should emit useful recovery metadata.

This feature differs from upstream by adding provider/worktree recovery handling and improving chat failure UX.

## Context To Recreate

- Server provider/session logic lives in:
  - `apps/server/src/codexAppServerManager.ts`
  - `apps/server/src/provider/Layers/CodexAdapter.ts`
  - `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
  - `apps/server/src/provider/Layers/ClaudeAdapter.ts`
  - `apps/server/src/provider/Layers/OpenCodeAdapter.ts`
  - `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
  - `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
  - `apps/server/src/orchestration/Normalizer.ts`
- Provider contracts live in `packages/contracts/src/provider.ts`.
- Web chat logic lives in:
  - `apps/web/src/components/ChatView.logic.ts`
  - `apps/web/src/components/ChatView.tsx`
  - `apps/web/src/components/chat/ProviderSessionFailureBanner.tsx`
  - `apps/web/src/components/chat/ThreadErrorBanner.tsx`
- Current local commits also remove the noisy "session stopped" message from provider adapters and chat logic.
- A template was added at `TEMPLATE.md` for recovery-related copy/context.

## Prompt

Recreate provider session and worktree recovery improvements on top of upstream `main`.

Extend provider/session contracts and server runtime handling so Codex worktree recovery failures are detected explicitly. Propagate actionable failure information through orchestration events instead of flattening everything into a generic stopped session. Ensure provider adapters do not emit redundant user-facing "session stopped" messages when the UI has better structured failure state.

On the web side, add chat logic that distinguishes normal idle/stopped states from recoverable provider failures. Render a provider session failure banner with clear actions while preserving normal chat input and thread history behavior.

Add tests for Codex worktree recovery, provider command reactor handling, event ingestion/normalization, chat failure classification, and removal of stale stopped-session copy.

## Validation

Run:

```bash
bun run test apps/server/src/codexAppServerManager.test.ts
bun run test apps/server/src/provider/Layers/CodexAdapter.test.ts
bun run test apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts
bun run test apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
bun run test apps/web/src/components/ChatView.logic.test.ts
bun run test apps/web/src/components/chat/ProviderSessionFailureBanner.test.tsx
bun fmt
bun lint
bun typecheck
```

Manual validation:

- Start a Codex thread.
- Remove or move the associated worktree.
- Resume the thread and confirm the UI shows a recovery/failure banner instead of a misleading stopped-session message.
- Start a healthy thread and confirm normal session lifecycle messages remain clean.
