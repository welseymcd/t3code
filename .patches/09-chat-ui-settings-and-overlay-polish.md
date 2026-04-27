# Chat UI Settings And Overlay Polish

## Purpose

Polish chat ergonomics by adding a plan-sidebar auto-open preference, fixing overlay close-button hitboxes, improving file dialog behavior, and tuning chat markdown/session message handling.

This feature differs from upstream by adding focused UX reliability fixes around chat surfaces and dialogs.

## Context To Recreate

- Plan sidebar setting:
  - `packages/contracts/src/settings.ts`
  - `apps/desktop/src/clientPersistence.test.ts`
  - `apps/web/src/localApi.test.ts`
  - `apps/web/src/session-logic.ts`
  - `apps/web/src/session-logic.test.ts`
  - `apps/web/src/components/ChatView.tsx`
  - `apps/web/src/components/settings/SettingsPanels.tsx`
- Overlay close button:
  - `apps/web/src/components/ui/overlayCloseButton.tsx`
  - `apps/web/src/components/ui/dialog.tsx`
  - `apps/web/src/components/ui/sheet.tsx`
- File dialog/markdown polish:
  - `apps/web/src/components/FileViewerDialog.tsx`
  - `apps/web/src/components/ChatMarkdown.tsx`
  - `apps/web/src/components/ChatMarkdown.browser.tsx`
  - `apps/web/src/components/DiffPanel.tsx`
  - `apps/web/src/routes/_chat.draft.$draftId.tsx`
- Chat session message cleanup:
  - `apps/web/src/components/ChatView.logic.ts`
  - `apps/web/src/components/ChatView.logic.test.ts`
  - provider adapters in `apps/server/src/provider/Layers/*`
- Avoid auto-opening the plan sidebar on initial thread load when the user did not just receive a new proposed plan.

## Prompt

Recreate the chat UI settings and overlay polish changes on top of upstream `main`.

Add a persisted client/server setting for plan-sidebar auto-open behavior. Update chat logic so the sidebar can open when a new plan appears, but does not unexpectedly open just because a thread containing an old plan loaded. Add settings UI and persistence tests.

Create a reusable overlay close button component with a reliable hitbox and use it in dialog and sheet primitives. Update file viewer dialog behavior so close controls, markdown rendering, and draft route behavior are consistent.

Remove redundant "session stopped" rendering from chat/provider paths where structured failure state now exists.

Add focused tests for plan-sidebar auto-open rules, settings persistence, overlay component behavior where practical, and chat message filtering.

## Validation

Run:

```bash
bun run test apps/web/src/session-logic.test.ts
bun run test apps/web/src/components/ChatView.logic.test.ts
bun run test apps/desktop/src/clientPersistence.test.ts
bun run test apps/web/src/localApi.test.ts
bun fmt
bun lint
bun typecheck
```

Manual validation:

- Toggle the plan-sidebar auto-open setting and reload.
- Open a historical thread with an existing plan and confirm the sidebar does not force-open unexpectedly.
- Trigger a new proposed plan and confirm the setting controls auto-open.
- Open dialogs/sheets and verify close buttons are easy to click at the visual edge.
