# Workspace File Explorer And Viewer

## Purpose

Add a project-scoped file browser to the chat workspace so users can inspect files without leaving T3 Code. The feature should expose safe server RPCs for listing directories and reading files, wire those through the web runtime API, and render a sidebar plus file viewer dialog in the chat UI.

This feature differs from upstream by adding the end-to-end workspace file exploration surface.

## Context To Recreate

- Keep cross-boundary shapes schema-first in `packages/contracts/src/project.ts`.
- Add RPC method names and RPC group entries in `packages/contracts/src/rpc.ts` and IPC/local types in `packages/contracts/src/ipc.ts`.
- Server ownership belongs in `apps/server/src/workspace/Layers/WorkspaceEntries.ts`, `apps/server/src/workspace/Layers/WorkspaceFileSystem.ts`, `apps/server/src/workspace/Services/*`, and `apps/server/src/ws.ts`.
- Web ownership belongs in `apps/web/src/lib/projectReactQuery.ts`, `apps/web/src/rpc/wsRpcClient.ts`, `apps/web/src/environmentApi.ts`, `apps/web/src/components/FileExplorerSidebar.tsx`, `apps/web/src/fileViewerState.ts`, `apps/web/src/hooks/useOpenWorkspaceFile.ts`, and `apps/web/src/components/FileViewerDialog.tsx`.
- The implemented contracts include:
  - `ProjectListDirectoryInput`: `cwd`, optional `parentPath`, optional `limit`
  - `ProjectListDirectoryResult`: `entries`, `truncated`
  - `ProjectReadFileInput`: `cwd`, `relativePath`
  - `ProjectReadFileResult`: `relativePath`, `absolutePath`, `content`, `sizeBytes`, `truncated`, `isBinary`
  - `ProjectSearchEntriesInput`: `cwd`, `query`, `limit`
  - `ProjectSearchEntriesResult`: `entries`, `truncated`
- Enforce limits: directory listing max 1000 entries, file read max 1 MiB, relative path max 512 chars.
- Use repo-relative paths only. Prevent escaping `cwd`, handle missing files cleanly, return binary/truncated state instead of crashing the UI.
- The sidebar should show directories/files, support expansion, search, loading/error states, and opening a file into the viewer.
- The viewer should support code/text rendering, markdown rendering through the existing chat markdown components, and clear binary/truncated messaging.

## Prompt

Recreate the workspace file explorer and file viewer feature on top of upstream `main`.

Start by adding project file browsing contracts in `packages/contracts/src/project.ts` and registering WebSocket RPCs in `packages/contracts/src/rpc.ts`. Implement server handlers in the workspace file system layer and expose them from `apps/server/src/ws.ts`. Directory listing and reading must be bounded, stable under large repos, and must reject paths outside the selected `cwd`.

On the web side, add query helpers and RPC client methods, then add a chat-integrated `FileExplorerSidebar` and `FileViewerDialog`. Use local state to track the open file and selected viewer mode. Preserve existing chat layout behavior and avoid blocking the chat timeline while file data loads.

Add tests for contract decode behavior, server filesystem edge cases, project query wiring, file viewer state, and sidebar logic.

## Validation

Run:

```bash
bun run test apps/server/src/workspace/Layers/WorkspaceEntries.test.ts
bun run test apps/server/src/workspace/Layers/WorkspaceFileSystem.test.ts
bun run test apps/web/src/fileViewerState.test.ts
bun run test apps/web/src/components/FileExplorerSidebar.logic.test.ts
bun fmt
bun lint
bun typecheck
```

Manual validation:

- Open a project in the app.
- Expand nested folders in the file explorer.
- Open a small text file and a markdown file.
- Try a large file and confirm truncation is visible.
- Try a binary file and confirm the UI does not render garbage text.
