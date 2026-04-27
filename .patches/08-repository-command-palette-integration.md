# Repository Command Palette Integration

## Purpose

Add repository-aware command palette actions so users can quickly search project entries and perform git/repository actions from the keyboard-driven command palette.

This feature differs from upstream by adding repository search/RPC support and command palette integration.

## Context To Recreate

- GitHub CLI abstraction changes live in:
  - `apps/server/src/git/Layers/GitHubCli.ts`
  - `apps/server/src/git/Services/GitHubCli.ts`
  - `apps/server/src/git/Layers/GitManager.test.ts`
- Workspace search changes live in:
  - `apps/server/src/workspace/Layers/WorkspaceEntries.ts`
  - `apps/server/src/workspace/Layers/WorkspaceEntries.test.ts`
  - `apps/server/src/workspace/Services/WorkspaceEntries.ts`
- RPC/contract changes live in:
  - `packages/contracts/src/git.ts`
  - `packages/contracts/src/ipc.ts`
  - `packages/contracts/src/rpc.ts`
  - `apps/server/src/ws.ts`
  - `apps/web/src/rpc/wsRpcClient.ts`
  - `apps/web/src/environmentApi.ts`
- Web UI lives in `apps/web/src/components/CommandPalette.tsx`.
- Search should be bounded and fast for large repositories.
- GitHub CLI availability should be detected gracefully; missing `gh` must not break the palette.

## Prompt

Recreate repository command palette integration on top of upstream `main`.

Add server-side workspace entry search and GitHub CLI-backed repository helpers, exposed through typed RPC contracts. Use bounded search results and return structured entries with kind/path/parent data. Handle missing GitHub CLI or non-git directories gracefully.

Update the command palette so it can search files/directories in the current repository, expose relevant repository commands, and call the correct environment RPC methods. Keep keyboard navigation responsive, debounce expensive work, and avoid blocking palette rendering while async searches run.

Add tests for workspace search limits, GitHub CLI command construction/error handling, server RPC routing, and command palette result grouping.

## Validation

Run:

```bash
bun run test apps/server/src/workspace/Layers/WorkspaceEntries.test.ts
bun run test apps/server/src/git/Layers/GitManager.test.ts
bun fmt
bun lint
bun typecheck
```

Manual validation:

- Open the command palette in a repository.
- Search for a known file and open it.
- Try the same flow in a directory without git metadata.
- Temporarily remove `gh` from PATH and confirm the palette remains usable.
