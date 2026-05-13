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
  readonly tabs: readonly FileViewerRequest[];
  readonly activeTabId: string | null;
  readonly open: (request: Omit<FileViewerRequest, "id">) => void;
  readonly activate: (tabId: string) => void;
  readonly close: (tabId: string) => void;
  readonly closeAll: () => void;
}

const WINDOWS_ROOT_PATTERN = /^[A-Za-z]:\//;
const FILE_VIEWER_STORAGE_KEY = "t3code:file-viewer:v1";
const FILE_VIEWER_WINDOW_NAME = "t3code-file-viewer";

let fileViewerWindowRef: Window | null = null;

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

function fileViewerRequestKey(request: Omit<FileViewerRequest, "id">): string {
  return [request.environmentId, request.cwd.trim(), request.relativePath.trim()].join("\u0000");
}

function createFileViewerRequest(request: Omit<FileViewerRequest, "id">): FileViewerRequest {
  return {
    ...request,
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`,
  };
}

function updateFileViewerRequestPosition(
  tab: FileViewerRequest,
  request: Omit<FileViewerRequest, "id">,
): FileViewerRequest {
  return {
    id: tab.id,
    environmentId: tab.environmentId,
    cwd: tab.cwd,
    relativePath: tab.relativePath,
    ...(request.line !== undefined ? { line: request.line } : {}),
    ...(request.column !== undefined ? { column: request.column } : {}),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPersistedFileViewerState(): Pick<FileViewerStoreState, "tabs" | "activeTabId"> {
  if (typeof window === "undefined") {
    return { tabs: [], activeTabId: null };
  }

  try {
    const raw = window.localStorage.getItem(FILE_VIEWER_STORAGE_KEY);
    if (!raw) return { tabs: [], activeTabId: null };
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed) || !Array.isArray(parsed.tabs)) {
      return { tabs: [], activeTabId: null };
    }

    const tabs = parsed.tabs.flatMap((tab): FileViewerRequest[] => {
      if (!isPlainRecord(tab)) return [];
      if (
        typeof tab.id !== "string" ||
        typeof tab.environmentId !== "string" ||
        typeof tab.cwd !== "string" ||
        typeof tab.relativePath !== "string"
      ) {
        return [];
      }
      return [
        {
          id: tab.id,
          environmentId: tab.environmentId as FileViewerRequest["environmentId"],
          cwd: tab.cwd,
          relativePath: tab.relativePath,
          ...(typeof tab.line === "number" ? { line: tab.line } : {}),
          ...(typeof tab.column === "number" ? { column: tab.column } : {}),
        },
      ];
    });

    const activeTabId =
      typeof parsed.activeTabId === "string" && tabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : (tabs.at(-1)?.id ?? null);
    return { tabs, activeTabId };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

function persistFileViewerState(state: Pick<FileViewerStoreState, "tabs" | "activeTabId">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FILE_VIEWER_STORAGE_KEY,
      JSON.stringify({ tabs: state.tabs, activeTabId: state.activeTabId }),
    );
  } catch {
    // Storage is best-effort; the in-memory store still drives the current window.
  }
}

function buildFileViewerWindowUrl(request: Omit<FileViewerRequest, "id">): string | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams({
    environmentId: request.environmentId,
    cwd: request.cwd,
    path: request.relativePath,
  });
  if (request.line !== undefined) params.set("line", String(request.line));
  if (request.column !== undefined) params.set("column", String(request.column));

  const url = new URL(window.location.href);
  if (url.protocol === "file:" || url.hash.startsWith("#/")) {
    url.hash = `/file-viewer?${params.toString()}`;
    return url.toString();
  }

  url.pathname = "/file-viewer";
  url.search = params.toString();
  url.hash = "";
  return url.toString();
}

function focusFileViewerWindow(request: Omit<FileViewerRequest, "id">): void {
  const url = buildFileViewerWindowUrl(request);
  if (!url || typeof window === "undefined") return;

  if (window.name === FILE_VIEWER_WINDOW_NAME) {
    window.focus();
    return;
  }

  fileViewerWindowRef =
    fileViewerWindowRef && !fileViewerWindowRef.closed
      ? fileViewerWindowRef
      : (window.open(
          "",
          FILE_VIEWER_WINDOW_NAME,
          "popup=yes,width=1280,height=860,noopener=false,noreferrer=false",
        ) ?? null);

  if (!fileViewerWindowRef) return;

  try {
    if (fileViewerWindowRef.location.href === "about:blank") {
      fileViewerWindowRef.location.href = url;
    }
  } catch {
    fileViewerWindowRef.location.href = url;
  }

  fileViewerWindowRef?.focus();
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
  ...readPersistedFileViewerState(),
  open: (request) =>
    set((current) => {
      const requestKey = fileViewerRequestKey(request);
      const existing = current.tabs.find((tab) => fileViewerRequestKey(tab) === requestKey);
      const nextTabs: readonly FileViewerRequest[] = existing
        ? current.tabs.map((tab) =>
            tab.id === existing.id ? updateFileViewerRequestPosition(tab, request) : tab,
          )
        : [...current.tabs, createFileViewerRequest(request)];
      const activeTabId = existing?.id ?? nextTabs.at(-1)?.id ?? null;
      const nextState = { tabs: nextTabs, activeTabId };
      persistFileViewerState(nextState);
      return nextState;
    }),
  activate: (tabId) =>
    set((current) => {
      if (!current.tabs.some((tab) => tab.id === tabId)) return current;
      const nextState = { tabs: current.tabs, activeTabId: tabId };
      persistFileViewerState(nextState);
      return nextState;
    }),
  close: (tabId) =>
    set((current) => {
      const tabIndex = current.tabs.findIndex((tab) => tab.id === tabId);
      if (tabIndex < 0) return current;
      const nextTabs = current.tabs.filter((tab) => tab.id !== tabId);
      const activeTabId =
        current.activeTabId === tabId
          ? (nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[0]?.id ?? null)
          : current.activeTabId;
      const nextState = { tabs: nextTabs, activeTabId };
      persistFileViewerState(nextState);
      return nextState;
    }),
  closeAll: () => {
    const nextState = { tabs: [], activeTabId: null };
    persistFileViewerState(nextState);
    set(nextState);
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== FILE_VIEWER_STORAGE_KEY) return;
    const current = useFileViewerRequestStore.getState();
    useFileViewerRequestStore.setState({
      ...current,
      ...readPersistedFileViewerState(),
    });
  });
}

export function useFileViewerTabs(): readonly FileViewerRequest[] {
  return useFileViewerRequestStore((store) => store.tabs);
}

export function useActiveFileViewerTabId(): string | null {
  return useFileViewerRequestStore((store) => store.activeTabId);
}

export function getActiveFileViewerTab(): FileViewerRequest | null {
  const state = useFileViewerRequestStore.getState();
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

export function addFileViewerTab(request: Omit<FileViewerRequest, "id">): void {
  useFileViewerRequestStore.getState().open(request);
}

export function openFileViewer(request: Omit<FileViewerRequest, "id">): void {
  useFileViewerRequestStore.getState().open(request);
  focusFileViewerWindow(request);
}

export function activateFileViewerTab(tabId: string): void {
  useFileViewerRequestStore.getState().activate(tabId);
}

export function closeFileViewerTab(tabId: string): void {
  useFileViewerRequestStore.getState().close(tabId);
}

export function closeAllFileViewerTabs(): void {
  useFileViewerRequestStore.getState().closeAll();
}

export function __resetFileViewerStateForTests(): void {
  const nextState = { tabs: [], activeTabId: null };
  persistFileViewerState(nextState);
  useFileViewerRequestStore.setState(nextState);
}
