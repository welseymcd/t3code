# Existing Worktrees In New Thread Picker

## Purpose

Let users start a new thread against an existing git worktree instead of only creating or selecting branches through the default branch flow. This improves workflows where multiple worktrees already exist for ongoing tasks.

This feature differs from upstream by adding existing-worktree discovery and selection to the branch/environment toolbar.

## Context To Recreate

- Web logic lives in:
  - `apps/web/src/components/BranchToolbar.logic.ts`
  - `apps/web/src/components/BranchToolbar.tsx`
  - `apps/web/src/components/BranchToolbarBranchSelector.tsx`
  - `apps/web/src/components/BranchToolbarEnvModeSelector.tsx`
  - `apps/web/src/components/ChatView.browser.tsx`
  - `apps/web/src/components/ChatView.tsx`
- Tests live in `apps/web/src/components/BranchToolbar.logic.test.ts`.
- The feature should preserve existing new branch/create worktree flows.
- Worktree entries should display enough information to distinguish path and branch/ref.
- Selection should update the draft thread target without accidentally creating a duplicate worktree.

## Prompt

Recreate existing-worktree support in the new thread picker on top of upstream `main`.

Extend branch toolbar logic to accept existing worktree candidates from the environment/git status data already available to the chat view. Add a picker mode or grouped option set that lets users choose an existing worktree as the draft thread target. Preserve existing branch selection, create-branch, and environment-mode behavior.

Make state transitions explicit: choosing an existing worktree should set the draft target to that worktree path/ref, not call create-worktree. Switching back to a normal branch mode should clear worktree-specific state.

Add tests for option derivation, labels, disabled states, switching modes, and submit payloads for existing worktrees vs new worktrees.

## Validation

Run:

```bash
bun run test apps/web/src/components/BranchToolbar.logic.test.ts
bun fmt
bun lint
bun typecheck
```

Manual validation:

- Create two git worktrees for a repo.
- Open the new thread picker.
- Confirm existing worktrees appear separately from normal branches.
- Select an existing worktree and start a thread.
- Confirm no duplicate worktree is created.
