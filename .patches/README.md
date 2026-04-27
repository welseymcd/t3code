# Patch Prompts

These prompts describe the feature differences between `upstream/main` (`https://github.com/pingdotgg/t3code.git`) and this repository's `main`.

At the time of comparison, this repo's `main` was 26 commits ahead of `upstream/main`, with no upstream-only commits:

```text
git rev-list --left-right --count upstream/main...main
0 26
```

The full source diff was:

```text
157 files changed, 10446 insertions(+), 482 deletions(-)
```

Each markdown file is a prompt intended to recreate one coherent feature cluster on top of upstream. The prompts include purpose, implementation context, and validation steps.

## Files

- `01-workspace-file-explorer-and-viewer.md`
- `02-manual-save-file-editing.md`
- `03-docker-dev-host-and-local-deploy.md`
- `04-remote-auth-pairing-and-r-auth-sync.md`
- `05-remote-websocket-stability.md`
- `06-provider-session-and-worktree-recovery.md`
- `07-existing-worktrees-in-new-thread-picker.md`
- `08-repository-command-palette-integration.md`
- `09-chat-ui-settings-and-overlay-polish.md`
