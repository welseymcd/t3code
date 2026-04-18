import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PROJECT_READ_FILE_MAX_BYTES_LIMIT, type ProjectReadFileResult } from "@t3tools/contracts";
import { LoaderIcon, SaveIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as MonacoApi from "monaco-editor";

import { ensureEnvironmentApi } from "../environmentApi";
import { type FileViewerRequest, useFileViewerState } from "../fileViewerState";
import { useTheme } from "../hooks/useTheme";
import { projectQueryKeys, projectReadFileQueryOptions } from "../lib/projectReactQuery";
import { ensureLocalApi } from "../localApi";
import { configureMonaco } from "../monacoSetup";
import { cn } from "../lib/utils";
import { toastManager } from "./ui/toast";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import {
  canEditFileContents,
  hasUnsavedFileChanges,
  isFileViewerSaveShortcut,
} from "./fileViewerEditing";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

configureMonaco();

const MonacoEditor = lazy(async () => {
  const module = await import("@monaco-editor/react");
  return { default: module.default };
});

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function inferLanguageId(monaco: typeof import("monaco-editor"), absolutePath: string): string {
  const normalizedPath = absolutePath.replaceAll("\\", "/").toLowerCase();
  const basename = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);

  for (const language of monaco.languages.getLanguages()) {
    if (language.filenames?.some((candidate) => candidate.toLowerCase() === basename)) {
      return language.id;
    }
    if (
      language.extensions?.some((candidate) => normalizedPath.endsWith(candidate.toLowerCase()))
    ) {
      return language.id;
    }
  }

  return "plaintext";
}

function revealPosition(
  editor: MonacoApi.editor.IStandaloneCodeEditor,
  request: FileViewerRequest,
): void {
  const lineNumber = Math.max(1, request.line ?? 1);
  const column = Math.max(1, request.column ?? 1);
  const position = { lineNumber, column };
  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  editor.focus();
}

function FileViewerLoadingState() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center text-sm text-muted-foreground">
      <LoaderIcon className="mr-2 size-4 animate-spin" />
      Loading editor...
    </div>
  );
}

export function FileViewerDialog() {
  const request = useFileViewerState((state) => state.request);
  const close = useFileViewerState((state) => state.close);
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const editorRef = useRef<MonacoApi.editor.IStandaloneCodeEditor | null>(null);
  const initializedRequestKeyRef = useRef<string | null>(null);
  const [savedContent, setSavedContent] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const query = useQuery(
    projectReadFileQueryOptions({
      environmentId: request?.environmentId ?? null,
      cwd: request?.workspaceRoot ?? null,
      relativePath: request?.relativePath ?? null,
      enabled: request !== null,
    }),
  );

  useEffect(() => {
    if (!request || !editorRef.current) {
      return;
    }
    revealPosition(editorRef.current, request);
  }, [request]);

  const requestKey = useMemo(() => {
    if (!request) {
      return null;
    }
    return [request.environmentId, request.workspaceRoot, request.relativePath].join(":");
  }, [request]);

  useEffect(() => {
    if (!requestKey) {
      initializedRequestKeyRef.current = null;
      setSavedContent("");
      setDraftContent("");
      return;
    }

    if (!query.data || !canEditFileContents(query.data)) {
      return;
    }

    if (initializedRequestKeyRef.current === requestKey) {
      return;
    }

    initializedRequestKeyRef.current = requestKey;
    setSavedContent(query.data.content);
    setDraftContent(query.data.content);
  }, [query.data, requestKey]);

  const isEditable = canEditFileContents(query.data);
  const isDirty = isEditable && hasUnsavedFileChanges(savedContent, draftContent);

  const saveMutation = useMutation({
    mutationFn: async (contents: string) => {
      if (!request) {
        throw new Error("Workspace file saving is unavailable.");
      }
      const api = ensureEnvironmentApi(request.environmentId);
      return api.projects.writeFile({
        cwd: request.workspaceRoot,
        relativePath: request.relativePath,
        contents,
      });
    },
    onSuccess: (result, contents) => {
      if (!request) {
        return;
      }

      setSavedContent(contents);
      queryClient.setQueryData<ProjectReadFileResult>(
        projectQueryKeys.readFile(
          request.environmentId,
          request.workspaceRoot,
          request.relativePath,
        ),
        (previous) =>
          previous
            ? {
                ...previous,
                content: contents,
                sizeBytes: new TextEncoder().encode(contents).length,
                truncated: false,
                isBinary: false,
              }
            : previous,
      );
      toastManager.add({
        type: "success",
        title: "File saved",
        description: result.relativePath,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not save file",
        description: error instanceof Error ? error.message : "An unknown error occurred.",
      });
    },
  });

  const handleSave = useCallback(() => {
    if (!request || !isEditable || !isDirty || saveMutation.isPending) {
      return;
    }

    void saveMutation.mutateAsync(draftContent);
  }, [draftContent, isDirty, isEditable, request, saveMutation]);

  useEffect(() => {
    if (!request || !isEditable) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isFileViewerSaveShortcut(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleSave();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleSave, isEditable, request]);

  const attemptClose = useCallback(async () => {
    if (saveMutation.isPending) {
      return;
    }

    if (isDirty) {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        "Discard unsaved changes to this file?",
      );
      if (!confirmed) {
        return;
      }
    }

    close();
  }, [close, isDirty, saveMutation.isPending]);

  const titlePath = useMemo(() => request?.relativePath ?? request?.absolutePath ?? "", [request]);

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          void attemptClose();
        }
      }}
    >
      <DialogPopup className="max-w-[min(94vw,96rem)] overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-5 py-4 pr-16">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex min-w-0 items-center gap-2">
                {request ? (
                  <VscodeEntryIcon
                    pathValue={request.absolutePath}
                    kind="file"
                    theme={resolvedTheme}
                    className="size-4 shrink-0"
                  />
                ) : null}
                <span className="truncate">{titlePath || "File viewer"}</span>
              </DialogTitle>
              <DialogDescription className="mt-1 truncate font-mono text-[11px]">
                {request?.absolutePath ?? "Open a workspace file to preview it here."}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isEditable ? (
                <Badge variant="secondary">{isDirty ? "Unsaved changes" : "Saved"}</Badge>
              ) : query.data && !query.data.isBinary ? (
                <Badge variant="secondary">Read-only</Badge>
              ) : null}
              {query.data?.truncated ? <Badge variant="secondary">Truncated</Badge> : null}
              {query.data?.isBinary ? <Badge variant="secondary">Binary</Badge> : null}
              {query.data ? (
                <Badge variant="secondary">{formatBytes(query.data.sizeBytes)}</Badge>
              ) : null}
              {isEditable ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={!isDirty || saveMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    <LoaderIcon className="size-4 animate-spin" />
                  ) : (
                    <SaveIcon className="size-4" />
                  )}
                  Save
                </Button>
              ) : null}
            </div>
          </div>
        </DialogHeader>
        <DialogPanel className="flex h-[min(84vh,64rem)] min-h-[28rem] flex-col overflow-hidden p-0">
          {!request ? null : query.isPending ? (
            <FileViewerLoadingState />
          ) : query.isError ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
              {query.error instanceof Error ? query.error.message : "Failed to read file."}
            </div>
          ) : query.data?.isBinary ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-medium text-foreground">
                Binary files can’t be previewed.
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                This file is not editable here.
              </p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 bg-background">
              <Suspense fallback={<FileViewerLoadingState />}>
                <MonacoEditor
                  key={[
                    request.absolutePath,
                    request.line ?? "",
                    request.column ?? "",
                    resolvedTheme,
                  ].join(":")}
                  height="100%"
                  path={request.absolutePath}
                  value={isEditable ? draftContent : (query.data?.content ?? "")}
                  theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                  loading={<FileViewerLoadingState />}
                  options={{
                    automaticLayout: true,
                    domReadOnly: !isEditable,
                    fontSize: 13,
                    glyphMargin: false,
                    lineNumbersMinChars: 3,
                    minimap: { enabled: false },
                    readOnly: !isEditable,
                    renderValidationDecorations: "off",
                    scrollBeyondLastLine: false,
                    stickyScroll: { enabled: false },
                    wordWrap: "off",
                  }}
                  onChange={(nextValue) => {
                    if (!isEditable) {
                      return;
                    }
                    setDraftContent(nextValue ?? "");
                  }}
                  onMount={(editor, monaco) => {
                    editorRef.current = editor;
                    const model = editor.getModel();
                    if (model) {
                      monaco.editor.setModelLanguage(
                        model,
                        inferLanguageId(monaco as typeof MonacoApi, request.absolutePath),
                      );
                    }
                    revealPosition(editor, request);
                  }}
                />
              </Suspense>
            </div>
          )}
          {query.data?.truncated ? (
            <div
              className={cn(
                "border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground/75",
                "bg-card/80",
              )}
            >
              Showing the first {formatBytes(PROJECT_READ_FILE_MAX_BYTES_LIMIT)} of{" "}
              {formatBytes(query.data.sizeBytes)}. Editing is disabled to avoid overwriting unseen
              content.
            </div>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
