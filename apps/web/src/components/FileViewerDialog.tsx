import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BinaryIcon, CodeIcon, EyeIcon, FileWarningIcon, LoaderIcon, SaveIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { closeFileViewer, useFileViewerRequest } from "../fileViewerState";
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
  shouldIgnoreFileViewerDismiss,
  type FileViewerMode,
} from "./fileViewerEditing";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { toastManager } from "./ui/toast";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function FileViewerDialog() {
  const request = useFileViewerRequest();
  const queryClient = useQueryClient();
  const openedAtRef = useRef(0);
  const [draftContent, setDraftContent] = useState("");
  const [mode, setMode] = useState<FileViewerMode>("source");
  const [saveError, setSaveError] = useState<string | null>(null);
  const query = useQuery(
    projectReadFileQueryOptions({
      environmentId: request?.environmentId ?? null,
      cwd: request?.cwd ?? null,
      relativePath: request?.relativePath ?? null,
      enabled: request !== null,
    }),
  );

  const file = query.data ?? null;
  const canEdit = canEditFileContents(file);
  const canSave = canSaveFileViewerDraft({
    file,
    originalContent: file?.content,
    draftContent,
  });
  const isMarkdown = Boolean(request?.relativePath && isMarkdownFilePath(request.relativePath));

  useEffect(() => {
    if (!request) return;
    openedAtRef.current = Date.now();
    setSaveError(null);
    setDraftContent("");
    setMode(
      getDefaultFileViewerMode({
        relativePath: request.relativePath,
        line: request.line,
        column: request.column,
      }),
    );
  }, [request]);

  useEffect(() => {
    if (!file || file.isBinary) return;
    setDraftContent(file.content);
  }, [file]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!request || !file) throw new Error("No file is open.");
      const api = ensureEnvironmentApi(request.environmentId);
      return api.projects.writeFile({
        cwd: request.cwd,
        relativePath: request.relativePath,
        contents: draftContent,
      });
    },
    onSuccess: async () => {
      if (!request) return;
      setSaveError(null);
      toastManager.add({
        type: "success",
        title: "File saved",
        description: request.relativePath,
      });
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.readFile(
          request.environmentId,
          request.cwd,
          request.relativePath,
        ),
      });
      await queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
    },
    onError: (error) => {
      setSaveError(error instanceof Error ? error.message : "Failed to save file.");
    },
  });

  const runSave = useCallback(() => {
    if (!canSave || saveMutation.isPending) return;
    saveMutation.mutate();
  }, [canSave, saveMutation]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSaveKeyboardShortcut(event)) return;
      event.preventDefault();
      runSave();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [request, runSave]);

  const title = request?.relativePath ?? "Workspace file";
  const description = useMemo(() => {
    if (!file) return request?.cwd ?? "";
    const parts = [formatBytes(file.sizeBytes)];
    if (request?.line) {
      parts.push(`Line ${request.line}${request.column ? `, column ${request.column}` : ""}`);
    }
    return parts.join(" · ");
  }, [file, request?.column, request?.cwd, request?.line]);

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (open) return;
        if (
          shouldIgnoreFileViewerDismiss({
            openedAt: openedAtRef.current,
            now: Date.now(),
          })
        ) {
          return;
        }
        closeFileViewer();
      }}
    >
      <DialogPopup
        className="h-[min(86vh,860px)] max-w-[min(92vw,1040px)] rounded-xl"
        bottomStickOnMobile={false}
      >
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <div className="flex min-w-0 items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="truncate font-mono text-sm">{title}</DialogTitle>
              <DialogDescription className="mt-1 truncate font-mono text-[11px]">
                {description}
              </DialogDescription>
            </div>
            {isMarkdown ? (
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant={mode === "preview" ? "secondary" : "ghost"}
                  aria-label="Preview markdown"
                  onClick={() => setMode("preview")}
                >
                  <EyeIcon className="size-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant={mode === "source" ? "secondary" : "ghost"}
                  aria-label="Edit source"
                  onClick={() => setMode("source")}
                >
                  <CodeIcon className="size-3.5" />
                </Button>
              </div>
            ) : null}
          </div>
        </DialogHeader>

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
                  cwd={request?.cwd}
                  environmentId={request?.environmentId}
                  workspaceRoot={request?.cwd}
                  isStreaming={false}
                />
              </div>
            ) : (
              <textarea
                value={draftContent}
                onChange={(event) => setDraftContent(event.currentTarget.value)}
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

        <DialogFooter
          className="items-center justify-between gap-2 px-4 py-3 sm:flex-row"
          variant="default"
        >
          <p
            className={cn(
              "min-w-0 text-[12px] text-muted-foreground",
              canSave && "text-foreground",
            )}
          >
            {canEdit ? (canSave ? "Unsaved changes" : "No unsaved changes") : "Read-only"}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={closeFileViewer}>
              Close
            </Button>
            <Button onClick={runSave} disabled={!canSave || saveMutation.isPending}>
              {saveMutation.isPending ? (
                <LoaderIcon className="size-4 animate-spin" />
              ) : (
                <SaveIcon className="size-4" />
              )}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
