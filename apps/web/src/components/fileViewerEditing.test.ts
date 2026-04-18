import { describe, expect, it } from "vitest";

import {
  canEditFileContents,
  hasUnsavedFileChanges,
  isFileViewerSaveShortcut,
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
