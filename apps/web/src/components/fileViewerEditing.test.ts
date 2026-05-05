import { describe, expect, it } from "vitest";

import {
  canEditFileContents,
  canSaveFileViewerDraft,
  getDefaultFileViewerMode,
  isFileViewerDirty,
  isSaveKeyboardShortcut,
  shouldIgnoreFileViewerDismiss,
} from "./fileViewerEditing";

describe("fileViewerEditing", () => {
  it("allows editing only for present non-binary, non-truncated files", () => {
    expect(canEditFileContents({ isBinary: false, truncated: false })).toBe(true);
    expect(canEditFileContents({ isBinary: true, truncated: false })).toBe(false);
    expect(canEditFileContents({ isBinary: false, truncated: true })).toBe(false);
    expect(canEditFileContents(null)).toBe(false);
  });

  it("tracks dirty state and save validity", () => {
    expect(isFileViewerDirty({ originalContent: "a", draftContent: "b" })).toBe(true);
    expect(
      canSaveFileViewerDraft({
        file: { isBinary: false, truncated: false },
        originalContent: "a",
        draftContent: "b",
      }),
    ).toBe(true);
    expect(
      canSaveFileViewerDraft({
        file: { isBinary: false, truncated: false },
        originalContent: "a",
        draftContent: "a",
      }),
    ).toBe(false);
  });

  it("defaults markdown to preview unless a position was requested", () => {
    expect(getDefaultFileViewerMode({ relativePath: "README.md" })).toBe("preview");
    expect(getDefaultFileViewerMode({ relativePath: "README.md", line: 2 })).toBe("source");
    expect(getDefaultFileViewerMode({ relativePath: "src/index.ts" })).toBe("source");
  });

  it("recognizes Cmd/Ctrl+S save shortcuts", () => {
    expect(
      isSaveKeyboardShortcut({
        key: "s",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isSaveKeyboardShortcut({
        key: "s",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isSaveKeyboardShortcut({
        key: "s",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
  });

  it("guards immediate dismiss after opening", () => {
    expect(shouldIgnoreFileViewerDismiss({ openedAt: 1000, now: 1100 })).toBe(true);
    expect(shouldIgnoreFileViewerDismiss({ openedAt: 1000, now: 1300 })).toBe(false);
  });
});
