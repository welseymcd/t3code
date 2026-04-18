import { type EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

import { splitPathAndPosition } from "./terminal-links";

export interface FileViewerRequest {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly line?: number;
  readonly column?: number;
}

interface ResolveFileViewerRequestInput {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly workspaceRoot: string | null | undefined;
  readonly targetPath: string;
}

interface FileViewerState {
  readonly request: FileViewerRequest | null;
  readonly open: (request: FileViewerRequest) => void;
  readonly close: () => void;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

export function resolveFileViewerRequest(
  input: ResolveFileViewerRequestInput,
): FileViewerRequest | null {
  if (!input.environmentId || !input.workspaceRoot) {
    return null;
  }

  const { path, line, column } = splitPathAndPosition(input.targetPath);
  const normalizedRoot = normalizePath(input.workspaceRoot);
  const normalizedPath = path.replaceAll("\\", "/");
  const compareCaseInsensitively =
    isWindowsPath(input.workspaceRoot) || isWindowsPath(input.targetPath);
  const comparableRoot = compareCaseInsensitively ? normalizedRoot.toLowerCase() : normalizedRoot;
  const comparablePath = compareCaseInsensitively ? normalizedPath.toLowerCase() : normalizedPath;

  if (
    comparablePath.length <= comparableRoot.length ||
    !comparablePath.startsWith(`${comparableRoot}/`)
  ) {
    return null;
  }

  const relativePath = normalizedPath.slice(normalizedRoot.length + 1);
  if (relativePath.length === 0) {
    return null;
  }

  const parsedLine = line ? Number.parseInt(line, 10) : Number.NaN;
  const parsedColumn = column ? Number.parseInt(column, 10) : Number.NaN;

  return {
    environmentId: input.environmentId,
    workspaceRoot: input.workspaceRoot,
    absolutePath: path,
    relativePath,
    ...(Number.isFinite(parsedLine) ? { line: parsedLine } : {}),
    ...(Number.isFinite(parsedColumn) ? { column: parsedColumn } : {}),
  };
}

export const useFileViewerState = create<FileViewerState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

export function openFileViewer(request: FileViewerRequest): void {
  useFileViewerState.getState().open(request);
}

export function closeFileViewer(): void {
  useFileViewerState.getState().close();
}
