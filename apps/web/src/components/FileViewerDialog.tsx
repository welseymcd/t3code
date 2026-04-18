import { useQuery } from "@tanstack/react-query";
import { PROJECT_READ_FILE_MAX_BYTES_LIMIT } from "@t3tools/contracts";
import { ExternalLinkIcon, LoaderIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import type * as MonacoApi from "monaco-editor";

import { openInPreferredEditor } from "../editorPreferences";
import { type FileViewerRequest, useFileViewerState } from "../fileViewerState";
import { useTheme } from "../hooks/useTheme";
import { projectReadFileQueryOptions } from "../lib/projectReactQuery";
import { readLocalApi } from "../localApi";
import { configureMonaco } from "../monacoSetup";
import { cn } from "../lib/utils";
import { toastManager } from "./ui/toast";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
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
  const editorRef = useRef<MonacoApi.editor.IStandaloneCodeEditor | null>(null);
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

  const openExternal = useCallback(async () => {
    if (!request) {
      return;
    }
    const api = readLocalApi();
    if (!api) {
      throw new Error("Open in editor is unavailable");
    }
    await openInPreferredEditor(
      api,
      [
        request.absolutePath,
        typeof request.line === "number" ? request.line : null,
        typeof request.column === "number" ? request.column : null,
      ]
        .filter((part): part is string | number => part !== null)
        .join(":"),
    );
  }, [request]);

  const titlePath = useMemo(() => request?.relativePath ?? request?.absolutePath ?? "", [request]);

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          close();
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
              {query.data?.truncated ? <Badge variant="secondary">Truncated</Badge> : null}
              {query.data?.isBinary ? <Badge variant="secondary">Binary</Badge> : null}
              {query.data ? (
                <Badge variant="secondary">{formatBytes(query.data.sizeBytes)}</Badge>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void openExternal().catch((error) => {
                    toastManager.add({
                      type: "error",
                      title: "Unable to open file",
                      description:
                        error instanceof Error ? error.message : "An unknown error occurred.",
                    });
                  });
                }}
              >
                <ExternalLinkIcon className="size-4" />
                Open in editor
              </Button>
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
                Open this file in your editor to inspect it directly.
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
                  value={query.data?.content ?? ""}
                  theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                  loading={<FileViewerLoadingState />}
                  options={{
                    automaticLayout: true,
                    domReadOnly: true,
                    fontSize: 13,
                    glyphMargin: false,
                    lineNumbersMinChars: 3,
                    minimap: { enabled: false },
                    readOnly: true,
                    renderValidationDecorations: "off",
                    scrollBeyondLastLine: false,
                    stickyScroll: { enabled: false },
                    wordWrap: "off",
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
              {formatBytes(query.data.sizeBytes)}.
            </div>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
