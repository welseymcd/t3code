import type { ProjectReadFileResult } from "@t3tools/contracts";

export type FileViewerMode = "preview" | "source";

const MARKDOWN_EXTENSION_PATTERN = /\.(md|mdx|markdown)$/i;
const IMMEDIATE_DISMISS_GUARD_MS = 180;

export function isMarkdownFilePath(relativePath: string): boolean {
  return MARKDOWN_EXTENSION_PATTERN.test(relativePath);
}

export function canEditFileContents(
  file: Pick<ProjectReadFileResult, "isBinary" | "truncated"> | null | undefined,
): boolean {
  return Boolean(file && !file.isBinary && !file.truncated);
}

export function getDefaultFileViewerMode(input: {
  readonly relativePath: string;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
}): FileViewerMode {
  if (!isMarkdownFilePath(input.relativePath)) {
    return "source";
  }
  return input.line || input.column ? "source" : "preview";
}

export function isFileViewerDirty(input: {
  readonly originalContent: string | null | undefined;
  readonly draftContent: string;
}): boolean {
  return input.originalContent !== null && input.originalContent !== undefined
    ? input.originalContent !== input.draftContent
    : false;
}

export function canSaveFileViewerDraft(input: {
  readonly file: Pick<ProjectReadFileResult, "isBinary" | "truncated"> | null | undefined;
  readonly originalContent: string | null | undefined;
  readonly draftContent: string;
  readonly isSaving?: boolean | undefined;
}): boolean {
  return (
    canEditFileContents(input.file) &&
    !input.isSaving &&
    isFileViewerDirty({
      originalContent: input.originalContent,
      draftContent: input.draftContent,
    })
  );
}

export function isSaveKeyboardShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): boolean {
  return (
    event.key.toLowerCase() === "s" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function shouldIgnoreFileViewerDismiss(input: {
  readonly openedAt: number;
  readonly now: number;
}): boolean {
  return input.now - input.openedAt < IMMEDIATE_DISMISS_GUARD_MS;
}
