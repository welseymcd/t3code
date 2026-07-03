# Workspace File Explorer, Viewer, And Manual Editor

## Purpose

Add a project-scoped file explorer to the chat workspace so users can inspect and manually edit files without leaving T3 Code. The feature should expose bounded server RPCs for listing, searching, reading, and writing workspace files; wire those RPCs through the web runtime API; and render a chat-integrated file explorer plus file viewer/editor dialog.

This feature differs from upstream by adding the end-to-end workspace file exploration surface and manual-save text editing for non-binary, non-truncated files.

## Context To Recreate

- Keep cross-boundary shapes schema-first in `packages/contracts/src/project.ts`.
- Register WebSocket RPC method names and RPC group entries in `packages/contracts/src/rpc.ts`.
- Add IPC/local API types in `packages/contracts/src/ipc.ts`.
- Server ownership belongs in:
  - `apps/server/src/workspace/Services/WorkspacePaths.ts`
  - `apps/server/src/workspace/Services/WorkspaceEntries.ts`
  - `apps/server/src/workspace/Services/WorkspaceFileSystem.ts`
  - `apps/server/src/workspace/Layers/WorkspacePaths.ts`
  - `apps/server/src/workspace/Layers/WorkspaceEntries.ts`
  - `apps/server/src/workspace/Layers/WorkspaceFileSystem.ts`
  - `apps/server/src/ws.ts`
- Web ownership belongs in:
  - `apps/web/src/environmentApi.ts`
  - `apps/web/src/rpc/wsRpcClient.ts`
  - `apps/web/src/lib/projectReactQuery.ts`
  - `apps/web/src/fileViewerState.ts`
  - `apps/web/src/hooks/useOpenWorkspaceFile.ts`
  - `apps/web/src/components/chat/ChatHeader.tsx`
  - `apps/web/src/components/ChatView.tsx`
  - `apps/web/src/components/FileExplorerSidebar.logic.ts`
  - `apps/web/src/components/FileExplorerSidebar.tsx`
  - `apps/web/src/components/fileViewerEditing.ts`
  - `apps/web/src/components/FileViewerDialog.tsx`

## Contracts And RPCs

Add these contracts to `packages/contracts/src/project.ts`:

- `ProjectEntry`: `path`, `kind: "file" | "directory"`, optional `parentPath`
- `ProjectSearchEntriesInput`: `cwd`, `query`, `limit`
- `ProjectSearchEntriesResult`: `entries`, `truncated`
- `ProjectSearchEntriesError`
- `ProjectListDirectoryInput`: `cwd`, optional `parentPath`, optional `limit`
- `ProjectListDirectoryResult`: `entries`, `truncated`
- `ProjectListDirectoryError`
- `ProjectReadFileInput`: `cwd`, `relativePath`
- `ProjectReadFileResult`: `relativePath`, `absolutePath`, `content`, `sizeBytes`, `truncated`, `isBinary`
- `ProjectReadFileError`
- `ProjectWriteFileInput`: `cwd`, `relativePath`, `contents`
- `ProjectWriteFileResult`: `relativePath`
- `ProjectWriteFileError`

Register these WebSocket methods in `packages/contracts/src/rpc.ts`:

- `projects.listDirectory`
- `projects.readFile`
- `projects.searchEntries`
- `projects.writeFile`

Use these bounds:

- Directory listing max: `1000` entries.
- Search max: `100` entries.
- Search query max length: `256` characters.
- Read max: `1 MiB`, exported as `PROJECT_READ_FILE_MAX_BYTES_LIMIT`.
- Relative path max length: `512` characters.

## Server Implementation

Create a shared `WorkspacePaths` service so listing, reading, and writing use the same path safety rules.

- Normalize workspace roots by expanding `~`, resolving absolute paths, optionally creating roots when requested by existing callers, and verifying the root exists and is a directory.
- Resolve repo-relative paths with `resolveRelativePathWithinRoot`.
- Reject absolute paths, empty paths, `.`, `..`, and traversal outside the workspace root.
- Normalize returned relative paths to POSIX separators for stable UI behavior.

Extend `WorkspaceEntries`.

- Implement `listDirectory` for direct children of `cwd` or `parentPath`.
- Sort directories before files, then by path.
- Respect the requested limit and return `truncated` when more entries exist.
- Implement `search` with a cached workspace index.
- Prefer git-backed file discovery when available, fall back to bounded filesystem scanning.
- Include directory ancestors in the index so users can expand search results.
- Ignore large/generated directories such as `.git`, `node_modules`, `.next`, `.turbo`, `dist`, `build`, `out`, and `.cache`.
- Invalidate the workspace entry cache after successful writes.

Extend `WorkspaceFileSystem`.

- Implement `readFile` by resolving the relative path through `WorkspacePaths`.
- Stat the file, read at most `PROJECT_READ_FILE_MAX_BYTES_LIMIT + 1`, and report `sizeBytes`.
- Return `truncated: true` when the file is larger than the read limit.
- Treat files with null bytes or invalid UTF-8 as binary and return empty `content` with `isBinary: true`.
- Implement `writeFile` by resolving the relative path through `WorkspacePaths`, creating parent directories, writing UTF-8 text, invalidating `WorkspaceEntries`, and returning the normalized relative path.
- Surface stat, read, decode, mkdir, and write failures as workspace filesystem errors instead of crashing the WebSocket handler.

Expose the four project RPC handlers from `apps/server/src/ws.ts`.

## Web Implementation

Extend the runtime API and WebSocket client.

- Add `projects.listDirectory`, `projects.readFile`, `projects.searchEntries`, and `projects.writeFile` to `apps/web/src/rpc/wsRpcClient.ts`.
- Expose those methods through `apps/web/src/environmentApi.ts`.
- Add React Query helpers in `apps/web/src/lib/projectReactQuery.ts` for list, search, and read operations.

Add file viewer state.

- Add `apps/web/src/fileViewerState.ts` with `resolveFileViewerRequest`, `openFileViewer`, `closeFileViewer`, and a Zustand-backed request store.
- Resolve absolute terminal/editor paths into workspace-relative viewer requests only when the target is inside the active workspace root.
- Preserve line/column suffixes from terminal links when available.
- Add `apps/web/src/hooks/useOpenWorkspaceFile.ts` so the existing "open file" behavior can choose the internal viewer when the user setting requests it, and otherwise fall back to the preferred external editor.

Add the file explorer sidebar.

- Render a project-scoped file tree in `apps/web/src/components/FileExplorerSidebar.tsx`.
- Mount the explorer as an optional right sidebar, not a left sidebar in the main chat column.
- Add a header icon toggle in `apps/web/src/components/chat/ChatHeader.tsx` immediately to the right of the terminal drawer toggle.
- Use a flat `FolderIcon` while the explorer is closed and an open `FolderOpenIcon` while the explorer sidebar is open.
- Disable the toggle when the active thread has no workspace root.
- Close the explorer when switching threads or when the active workspace root disappears.
- On narrow right-panel layouts, render the explorer through the existing right-side sheet surface; on wider layouts, render it inline on the right edge of the chat content.
- Include a close button in the file explorer header so the right sidebar/sheet can be dismissed from inside the panel.
- Support directory expansion, refresh, search, loading states, empty states, and error states.
- Use `apps/web/src/components/FileExplorerSidebar.logic.ts` for error presentation and reconnect refresh decisions.
- Handle unsupported older backends by presenting a clear error instead of breaking the chat UI.
- Keep file loading asynchronous and avoid blocking the chat timeline.

Add the file viewer/editor dialog.

- Render text/code files from `projects.readFile`.
- Render Markdown files through the existing chat Markdown components.
- Default Markdown files to preview mode unless a specific line/column was requested, in which case default to source mode.
- Show clear binary and truncation states; do not render binary bytes as text.
- Allow editing only when `canEditFileContents(file)` is true: the file is present, not binary, and not truncated.
- Track dirty state with explicit manual-save behavior only. Do not autosave.
- Save via `projects.writeFile`, keep the dialog open on errors, and leave the draft intact after failed saves.
- Support Cmd/Ctrl+S for save when saving is valid.
- Avoid immediate outside-click dismissal after opening the dialog from a file click.

## Tests To Add Or Update

- Contract decode/encode tests for list, search, read, and write payloads.
- `apps/server/src/workspace/Layers/WorkspacePaths.test.ts` for root normalization and traversal rejection.
- `apps/server/src/workspace/Layers/WorkspaceEntries.test.ts` for list/search limits, sorting, ignored directories, cache invalidation, and filesystem fallback.
- `apps/server/src/workspace/Layers/WorkspaceFileSystem.test.ts` for read truncation, binary detection, invalid UTF-8, path safety, write behavior, and write error handling.
- `apps/web/src/fileViewerState.test.ts` for resolving absolute paths, Windows paths, and line/column suffixes.
- `apps/web/src/components/FileExplorerSidebar.logic.test.ts` for unsupported backend, reconnect, and transient interruption presentation.
- `apps/web/src/components/fileViewerEditing.test.ts` for editability, dirty-state transitions, Markdown mode defaults, save shortcut handling, and immediate-dismiss guard behavior.
- Project query/RPC client tests where the codebase already has seams for runtime API wiring.

## Validation

Run:

```bash
bun run test apps/server/src/workspace/Layers/WorkspacePaths.test.ts
bun run test apps/server/src/workspace/Layers/WorkspaceEntries.test.ts
bun run test apps/server/src/workspace/Layers/WorkspaceFileSystem.test.ts
bun run test apps/web/src/fileViewerState.test.ts
bun run test apps/web/src/components/FileExplorerSidebar.logic.test.ts
bun run test apps/web/src/components/fileViewerEditing.test.ts
bun fmt
bun lint
bun typecheck
```

Manual validation:

- Open a project in the app.
- Confirm the file explorer is closed by default and the header button shows the flat folder icon.
- Click the file explorer button to open the right sidebar and confirm the button changes to the open folder icon.
- Close the explorer from its header close button and confirm the header button returns to the flat folder icon.
- Confirm the file explorer appears on the right side of the chat, not between the project sidebar and chat timeline.
- Expand nested folders in the file explorer.
- Search for files and directories.
- Open a small text file and a Markdown file.
- Confirm Markdown preview/source behavior.
- Try a large file and confirm truncation is visible and editing is disabled.
- Try a binary file and confirm the UI does not render garbage text and editing is disabled.
- Edit a normal text file, confirm dirty state appears, save, and verify the file changes on disk.
- Trigger a failed save and confirm the dialog stays open with the draft preserved.
- Open a terminal-linked file path with line/column metadata and confirm the viewer opens in source mode.
