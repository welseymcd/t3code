import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BinaryIcon,
  CodeIcon,
  EyeIcon,
  FileIcon,
  FileWarningIcon,
  LoaderIcon,
  SaveIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { FileViewerRequest } from "../fileViewerState";
import {
  activateFileViewerTab,
  closeAllFileViewerTabs,
  closeFileViewerTab,
  useActiveFileViewerTabId,
  useFileViewerTabs,
} from "../fileViewerState";
import { ensureEnvironmentApi } from "../environmentApi";
import { projectQueryKeys, projectReadFileQueryOptions } from "../lib/projectReactQuery";
import { cn } from "../lib/utils";
import ChatMarkdown from "./ChatMarkdown";
import {
  canEditFileContents,
  canSaveFileViewerDraft,
  getDefaultFileViewerMode,
  isMarkdownFilePath,
  isSaveKeyboardShortcut,
  type FileViewerMode,
} from "./fileViewerEditing";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";

interface TabEditorState {
  readonly draftContent: string;
  readonly loadedContent: string | null;
  readonly mode: FileViewerMode;
  readonly saveError: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function basenameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

function createInitialEditorState(tab: FileViewerRequest): TabEditorState {
  return {
    draftContent: "",
    loadedContent: null,
    mode: getDefaultFileViewerMode({
      relativePath: tab.relativePath,
      line: tab.line,
      column: tab.column,
    }),
    saveError: null,
  };
}

function closeViewerWindow(): void {
  if (window.opener) {
    window.close();
    return;
  }
  closeAllFileViewerTabs();
}

export function FileViewerWindow() {
  const tabs = useFileViewerTabs();
  const activeTabId = useActiveFileViewerTabId();
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs.at(-1) ?? null;
  const queryClient = useQueryClient();
  const [editorStateByTabId, setEditorStateByTabId] = useState<Record<string, TabEditorState>>({});

  useEffect(() => {
    if (!activeTab) return;
    setEditorStateByTabId((current) =>
      current[activeTab.id]
        ? current
        : { ...current, [activeTab.id]: createInitialEditorState(activeTab) },
    );
  }, [activeTab]);

  useEffect(() => {
    setEditorStateByTabId((current) => {
      const openTabIds = new Set(tabs.map((tab) => tab.id));
      let changed = false;
      const next: Record<string, TabEditorState> = {};
      for (const [tabId, state] of Object.entries(current)) {
        if (!openTabIds.has(tabId)) {
          changed = true;
          continue;
        }
        next[tabId] = state;
      }
      return changed ? next : current;
    });
  }, [tabs]);

  const query = useQuery(
    projectReadFileQueryOptions({
      environmentId: activeTab?.environmentId ?? null,
      cwd: activeTab?.cwd ?? null,
      relativePath: activeTab?.relativePath ?? null,
      enabled: activeTab !== null,
    }),
  );

  const file = query.data ?? null;
  const editorState = activeTab ? editorStateByTabId[activeTab.id] : undefined;
  const draftContent = editorState?.draftContent ?? "";
  const mode = editorState?.mode ?? "source";
  const saveError = editorState?.saveError ?? null;
  const canEdit = canEditFileContents(file);
  const canSave = canSaveFileViewerDraft({
    file,
    originalContent: file?.content,
    draftContent,
  });
  const isMarkdown = Boolean(activeTab?.relativePath && isMarkdownFilePath(activeTab.relativePath));

  useEffect(() => {
    if (!activeTab || !file || file.isBinary) return;
    setEditorStateByTabId((current) => {
      const state = current[activeTab.id] ?? createInitialEditorState(activeTab);
      const nextDraft =
        state.loadedContent === null || state.draftContent === state.loadedContent
          ? file.content
          : state.draftContent;
      return {
        ...current,
        [activeTab.id]: {
          ...state,
          draftContent: nextDraft,
          loadedContent: file.content,
        },
      };
    });
  }, [activeTab, file]);

  const updateActiveEditorState = useCallback(
    (update: (state: TabEditorState) => TabEditorState) => {
      if (!activeTab) return;
      setEditorStateByTabId((current) => {
        const state = current[activeTab.id] ?? createInitialEditorState(activeTab);
        return { ...current, [activeTab.id]: update(state) };
      });
    },
    [activeTab],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeTab || !file) throw new Error("No file is open.");
      const api = ensureEnvironmentApi(activeTab.environmentId);
      return api.projects.writeFile({
        cwd: activeTab.cwd,
        relativePath: activeTab.relativePath,
        contents: draftContent,
      });
    },
    onSuccess: async () => {
      if (!activeTab) return;
      updateActiveEditorState((state) => ({
        ...state,
        loadedContent: state.draftContent,
        saveError: null,
      }));
      toastManager.add({
        type: "success",
        title: "File saved",
        description: activeTab.relativePath,
      });
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.readFile(
          activeTab.environmentId,
          activeTab.cwd,
          activeTab.relativePath,
        ),
      });
      await queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
    },
    onError: (error) => {
      updateActiveEditorState((state) => ({
        ...state,
        saveError: error instanceof Error ? error.message : "Failed to save file.",
      }));
    },
  });

  const runSave = useCallback(() => {
    if (!canSave || saveMutation.isPending) return;
    saveMutation.mutate();
  }, [canSave, saveMutation]);

  useEffect(() => {
    if (!activeTab) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSaveKeyboardShortcut(event)) return;
      event.preventDefault();
      runSave();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, runSave]);

  const description = useMemo(() => {
    if (!activeTab) return "";
    if (!file) return activeTab.cwd;
    const parts = [formatBytes(file.sizeBytes)];
    if (activeTab.line) {
      parts.push(`Line ${activeTab.line}${activeTab.column ? `, column ${activeTab.column}` : ""}`);
    }
    return parts.join(" · ");
  }, [activeTab, file]);

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileIcon className="size-4 shrink-0 text-muted-foreground/70" />
          <span className="truncate text-sm font-medium">Files</span>
        </div>
        <div className="flex items-center gap-2">
          {isMarkdown ? (
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant={mode === "preview" ? "secondary" : "ghost"}
                aria-label="Preview markdown"
                onClick={() => updateActiveEditorState((state) => ({ ...state, mode: "preview" }))}
              >
                <EyeIcon className="size-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant={mode === "source" ? "secondary" : "ghost"}
                aria-label="Edit source"
                onClick={() => updateActiveEditorState((state) => ({ ...state, mode: "source" }))}
              >
                <CodeIcon className="size-3.5" />
              </Button>
            </div>
          ) : null}
          <Button
            size="sm"
            onClick={runSave}
            disabled={!activeTab || !canSave || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <LoaderIcon className="size-4 animate-spin" />
            ) : (
              <SaveIcon className="size-4" />
            )}
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={closeViewerWindow}>
            Close
          </Button>
        </div>
      </header>

      <div className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-border/70 bg-muted/30 px-2 pt-1">
        {tabs.map((tab) => {
          const active = tab.id === activeTab?.id;
          return (
            <div
              key={tab.id}
              className={cn(
                "group flex h-8 min-w-32 max-w-56 items-center gap-2 rounded-t-md border border-b-0 px-2 text-left text-[12px]",
                active
                  ? "border-border bg-background text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground",
              )}
              title={tab.relativePath}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-mono"
                onClick={() => activateFileViewerTab(tab.id)}
              >
                {basenameOf(tab.relativePath)}
              </button>
              <button
                type="button"
                aria-label={`Close ${tab.relativePath}`}
                className="shrink-0 rounded-sm p-0.5 text-muted-foreground/60 hover:bg-accent hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  closeFileViewerTab(tab.id);
                }}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}
      </div>

      {activeTab ? (
        <>
          <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4">
            <div className="min-w-0">
              <h1 className="truncate font-mono text-sm">{activeTab.relativePath}</h1>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{description}</p>
            </div>
            <p
              className={cn(
                "shrink-0 text-[12px] text-muted-foreground",
                canSave && "text-foreground",
              )}
            >
              {canEdit ? (canSave ? "Unsaved changes" : "No unsaved changes") : "Read-only"}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {query.isLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderIcon className="size-4 animate-spin" />
                Loading file
              </div>
            ) : query.error ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <FileWarningIcon className="size-8 text-destructive/80" />
                <p className="text-sm font-medium text-foreground">Could not read file</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {query.error instanceof Error ? query.error.message : "An error occurred."}
                </p>
              </div>
            ) : file?.isBinary ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <BinaryIcon className="size-8 text-muted-foreground/70" />
                <p className="text-sm font-medium text-foreground">Binary file</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Binary contents are not rendered in the workspace viewer.
                </p>
              </div>
            ) : file ? (
              mode === "preview" && isMarkdown ? (
                <div className="h-full overflow-auto p-5">
                  <ChatMarkdown
                    text={draftContent}
                    cwd={activeTab.cwd}
                    environmentId={activeTab.environmentId}
                    workspaceRoot={activeTab.cwd}
                    isStreaming={false}
                  />
                </div>
              ) : (
                <textarea
                  value={draftContent}
                  onChange={(event) =>
                    updateActiveEditorState((state) => ({
                      ...state,
                      draftContent: event.currentTarget.value,
                      saveError: null,
                    }))
                  }
                  readOnly={!canEdit}
                  spellCheck={false}
                  className="h-full w-full resize-none overflow-auto bg-background p-4 font-mono text-[12px] leading-relaxed text-foreground outline-none disabled:opacity-70"
                  aria-label="File contents"
                />
              )
            ) : null}
          </div>

          {file?.truncated ? (
            <div className="border-t border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[12px] text-amber-700 dark:text-amber-300">
              This file is larger than the read limit. Editing is disabled.
            </div>
          ) : null}
          {saveError ? (
            <div className="border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-[12px] text-destructive">
              {saveError}
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <FileIcon className="size-8 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">No files open</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Open a file from the workspace explorer or a file link to add it here.
          </p>
        </div>
      )}
    </main>
  );
}
