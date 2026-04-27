# Manual Save File Editing

## Purpose

Allow users to edit a workspace file in the viewer and explicitly save changes back through a server RPC. The behavior should be manual-save only, with dirty-state handling and conflict-conscious UI.

This feature differs from upstream by turning the read-only file viewer into a controlled editor for safe text-file changes.

## Context To Recreate

- Extend `packages/contracts/src/project.ts` with:
  - `ProjectWriteFileInput`: `cwd`, `relativePath`, `contents`
  - `ProjectWriteFileResult`: `relativePath`
  - `ProjectWriteFileError`
- Register `projects.writeFile` in `packages/contracts/src/rpc.ts`.
- Implement the server write in `apps/server/src/workspace/Layers/WorkspaceFileSystem.ts` and route it in `apps/server/src/ws.ts`.
- Client-side editing logic belongs in `apps/web/src/components/fileViewerEditing.ts` with tests in `apps/web/src/components/fileViewerEditing.test.ts`.
- UI integration belongs in `apps/web/src/components/FileViewerDialog.tsx`.
- Keep writes path-safe: write only under `cwd`, reject directory writes, reject invalid relative paths, and surface errors without closing the dialog.
- Do not autosave. Users should see dirty state and save intentionally.

## Prompt

Recreate manual-save editing for the workspace file viewer on top of upstream `main`.

Add a project write-file contract and WebSocket RPC. Implement a server handler that validates `cwd` plus `relativePath`, rejects path traversal, writes UTF-8 text, and returns the relative path on success. Keep the write implementation near the workspace filesystem layer.

Add editor state helpers for dirty tracking, reset behavior when switching files, and save enablement. Update the file viewer dialog so editable text files can be modified, saved, and restored after failed saves. Preserve read-only behavior for binary files and content that should not be edited.

Add focused tests for dirty-state transitions, save payload generation, reset behavior, server path safety, and RPC decode failures.

## Validation

Run:

```bash
bun run test apps/web/src/components/fileViewerEditing.test.ts
bun run test apps/server/src/workspace/Layers/WorkspaceFileSystem.test.ts
bun fmt
bun lint
bun typecheck
```

Manual validation:

- Open a text file from the explorer.
- Change text and confirm dirty state appears.
- Save and verify the file changes on disk.
- Switch files with unsaved changes and confirm the UI does not silently discard edits.
- Attempt to save a path outside the workspace and confirm the server rejects it.
