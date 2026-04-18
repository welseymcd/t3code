import type { ProjectReadFileResult } from "@t3tools/contracts";

export function canEditFileContents(
  file: Pick<ProjectReadFileResult, "isBinary" | "truncated"> | null | undefined,
): boolean {
  return file !== null && file !== undefined && !file.isBinary && !file.truncated;
}

export function hasUnsavedFileChanges(savedContent: string, draftContent: string): boolean {
  return savedContent !== draftContent;
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
