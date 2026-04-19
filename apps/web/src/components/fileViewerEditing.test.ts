import { describe, expect, it } from "vitest";

import {
  canEditFileContents,
  getDefaultMarkdownView,
  hasUnsavedFileChanges,
  isFileViewerSaveShortcut,
  isMarkdownFilePath,
  shouldIgnoreImmediateFileViewerDismiss,
} from "./fileViewerEditing";

describe("canEditFileContents", () => {
  it("allows editing for complete text files", () => {
    expect(canEditFileContents({ isBinary: false, truncated: false })).toBe(true);
  });

  it("disables editing for binary files", () => {
    expect(canEditFileContents({ isBinary: true, truncated: false })).toBe(false);
  });

  it("disables editing for truncated files", () => {
    expect(canEditFileContents({ isBinary: false, truncated: true })).toBe(false);
  });
});

describe("hasUnsavedFileChanges", () => {
  it("detects draft changes", () => {
    expect(hasUnsavedFileChanges("one\n", "two\n")).toBe(true);
  });

  it("treats identical content as saved", () => {
    expect(hasUnsavedFileChanges("same\n", "same\n")).toBe(false);
  });
});

describe("isMarkdownFilePath", () => {
  it("matches common markdown extensions", () => {
    expect(isMarkdownFilePath("/repo/README.md")).toBe(true);
    expect(isMarkdownFilePath("/repo/docs/guide.markdown")).toBe(true);
    expect(isMarkdownFilePath("notes.mkd")).toBe(true);
  });

  it("does not match mdx or non-markdown files", () => {
    expect(isMarkdownFilePath("/repo/docs/page.mdx")).toBe(false);
    expect(isMarkdownFilePath("/repo/src/index.ts")).toBe(false);
  });
});

describe("getDefaultMarkdownView", () => {
  it("defaults markdown files to preview mode", () => {
    expect(
      getDefaultMarkdownView({
        absolutePath: "/repo/README.md",
      }),
    ).toBe("preview");
  });

  it("keeps markdown files in source mode when opened at a specific line", () => {
    expect(
      getDefaultMarkdownView({
        absolutePath: "/repo/README.md",
        line: 12,
      }),
    ).toBe("source");
  });

  it("keeps non-markdown files in source mode", () => {
    expect(
      getDefaultMarkdownView({
        absolutePath: "/repo/src/index.ts",
      }),
    ).toBe("source");
  });
});

describe("shouldIgnoreImmediateFileViewerDismiss", () => {
  it("ignores immediate outside-press dismissals after opening", () => {
    expect(
      shouldIgnoreImmediateFileViewerDismiss({
        openedAtMs: 1_000,
        dismissedAtMs: 1_150,
        reason: "outside-press",
        guardWindowMs: 300,
      }),
    ).toBe(true);
  });

  it("does not ignore non-outside dismiss reasons", () => {
    expect(
      shouldIgnoreImmediateFileViewerDismiss({
        openedAtMs: 1_000,
        dismissedAtMs: 1_150,
        reason: "escape-key",
        guardWindowMs: 300,
      }),
    ).toBe(false);
  });

  it("does not ignore outside dismissals after the guard window", () => {
    expect(
      shouldIgnoreImmediateFileViewerDismiss({
        openedAtMs: 1_000,
        dismissedAtMs: 1_350,
        reason: "outside-press",
        guardWindowMs: 300,
      }),
    ).toBe(false);
  });
});

describe("isFileViewerSaveShortcut", () => {
  it("matches command/control+s", () => {
    expect(
      isFileViewerSaveShortcut({
        key: "s",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isFileViewerSaveShortcut({
        key: "S",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
  });

  it("ignores modified variants like shift+s", () => {
    expect(
      isFileViewerSaveShortcut({
        key: "s",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
    expect(
      isFileViewerSaveShortcut({
        key: "s",
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      }),
    ).toBe(false);
  });
});
