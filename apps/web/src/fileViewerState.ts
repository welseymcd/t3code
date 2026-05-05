import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

import { splitPathAndPosition } from "./terminal-links";

export interface FileViewerRequest {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ResolveFileViewerRequestInput {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly targetPath: string;
}

interface FileViewerStoreState {
  readonly request: FileViewerRequest | null;
  readonly open: (request: Omit<FileViewerRequest, "id">) => void;
  readonly close: () => void;
}

const WINDOWS_ROOT_PATTERN = /^[A-Za-z]:\//;

function normalizePathForComparison(input: string): string {
  const normalized = input.trim().replaceAll("\\", "/").replace(/\/+/g, "/").replace(/\/+$/, "");
  return WINDOWS_ROOT_PATTERN.test(normalized) ? normalized.toLowerCase() : normalized;
}

function normalizeRelativePath(input: string): string | null {
  const segments: string[] = [];
  for (const segment of input.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

function parsePositiveInt(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveFileViewerRequest(
  input: ResolveFileViewerRequestInput,
): Omit<FileViewerRequest, "id"> | null {
  const { path: rawPath, line, column } = splitPathAndPosition(input.targetPath.trim());
  if (!rawPath) return null;

  const normalizedRoot = normalizePathForComparison(input.workspaceRoot);
  const normalizedPath = normalizePathForComparison(rawPath);
  if (!normalizedRoot || normalizedPath === normalizedRoot) return null;

  const insideRoot = normalizedPath.startsWith(`${normalizedRoot}/`);
  if (!insideRoot) return null;

  const relativePath = normalizeRelativePath(rawPath.slice(input.workspaceRoot.length));
  if (!relativePath) return null;

  const parsedLine = parsePositiveInt(line);
  const parsedColumn = parsePositiveInt(column);
  return {
    environmentId: input.environmentId,
    cwd: input.workspaceRoot,
    relativePath,
    ...(parsedLine !== undefined ? { line: parsedLine } : {}),
    ...(parsedColumn !== undefined ? { column: parsedColumn } : {}),
  };
}

const useFileViewerRequestStore = create<FileViewerStoreState>((set) => ({
  request: null,
  open: (request) =>
    set({
      request: {
        ...request,
        id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
      },
    }),
  close: () => set({ request: null }),
}));

export function useFileViewerRequest(): FileViewerRequest | null {
  return useFileViewerRequestStore((store) => store.request);
}

export function openFileViewer(request: Omit<FileViewerRequest, "id">): void {
  useFileViewerRequestStore.getState().open(request);
}

export function closeFileViewer(): void {
  useFileViewerRequestStore.getState().close();
}

export function __resetFileViewerStateForTests(): void {
  useFileViewerRequestStore.setState({ request: null });
}
