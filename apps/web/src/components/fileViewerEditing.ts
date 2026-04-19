import type { ProjectReadFileResult } from "@t3tools/contracts";

const MARKDOWN_FILE_EXTENSIONS = [
  ".md",
  ".markdown",
  ".mdown",
  ".mkd",
  ".mkdn",
  ".mdtxt",
  ".mdtext",
] as const;

export type FileViewerMarkdownView = "preview" | "source";
const FILE_VIEWER_IMMEDIATE_OUTSIDE_DISMISS_REASON = "outside-press";

export function canEditFileContents(
  file: Pick<ProjectReadFileResult, "isBinary" | "truncated"> | null | undefined,
): boolean {
  return file !== null && file !== undefined && !file.isBinary && !file.truncated;
}

export function hasUnsavedFileChanges(savedContent: string, draftContent: string): boolean {
  return savedContent !== draftContent;
}

export function isMarkdownFilePath(path: string | null | undefined): boolean {
  const normalizedPath = path?.trim().replaceAll("\\", "/").toLowerCase();
  if (!normalizedPath) {
    return false;
  }

  return MARKDOWN_FILE_EXTENSIONS.some((extension) => normalizedPath.endsWith(extension));
}

export function getDefaultMarkdownView(input: {
  absolutePath?: string | null | undefined;
  relativePath?: string | null | undefined;
  line?: number | null | undefined;
  column?: number | null | undefined;
}): FileViewerMarkdownView {
  const path = input.absolutePath ?? input.relativePath;
  if (!isMarkdownFilePath(path)) {
    return "source";
  }

  if (input.line != null || input.column != null) {
    return "source";
  }

  return "preview";
}

export function shouldIgnoreImmediateFileViewerDismiss(input: {
  openedAtMs: number;
  dismissedAtMs: number;
  reason: string | undefined;
  guardWindowMs: number;
}): boolean {
  return (
    input.reason === FILE_VIEWER_IMMEDIATE_OUTSIDE_DISMISS_REASON &&
    input.dismissedAtMs - input.openedAtMs < input.guardWindowMs
  );
}

export function isFileViewerSaveShortcut(input: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (
    input.key.toLowerCase() === "s" &&
    (input.metaKey || input.ctrlKey) &&
    !input.altKey &&
    !input.shiftKey
  );
}
