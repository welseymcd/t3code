import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCwIcon, ChevronRightIcon, PinIcon } from "lucide-react";
import { useOpenWorkspaceFile } from "../hooks/useOpenWorkspaceFile";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { projectListDirectoryQueryOptions } from "../lib/projectReactQuery";
import { cn } from "../lib/utils";
import { getWsConnectionUiState, useWsConnectionStatus } from "../rpc/wsConnectionState";
import { basenameOfPath } from "../vscode-icons";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import {
  resolveFileExplorerErrorPresentation,
  isUnsupportedDirectoryListingError,
  shouldAutoRefreshFileExplorerOnReconnect,
} from "./FileExplorerSidebar.logic";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Skeleton } from "./ui/skeleton";

const FILE_EXPLORER_PINNED_STORAGE_KEY = "chat_file_explorer_pinned";
const FILE_EXPLORER_WIDTH_CLASS = "w-[22rem]";
const FILE_EXPLORER_CLOSE_DELAY_MS = 140;

function rootLabelFromWorkspaceRoot(workspaceRoot: string): string {
  const normalizedRoot = workspaceRoot.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(
    normalizedRoot.lastIndexOf("/"),
    normalizedRoot.lastIndexOf("\\"),
  );
  return separatorIndex >= 0 ? normalizedRoot.slice(separatorIndex + 1) : normalizedRoot;
}

function joinWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const separator = workspaceRoot.includes("\\") ? "\\" : "/";
  const normalizedRelativePath =
    separator === "\\" ? relativePath.replaceAll("/", "\\") : relativePath;
  return `${workspaceRoot.replace(/[\\/]+$/, "")}${separator}${normalizedRelativePath}`;
}

function renderTreeIndent(depth: number): number {
  return 12 + depth * 14;
}

function isFileExplorerDirectoryQueryKey(input: {
  readonly environmentId: EnvironmentId;
  readonly queryKey: unknown;
  readonly workspaceRoot: string;
}): boolean {
  return (
    Array.isArray(input.queryKey) &&
    input.queryKey[0] === "projects" &&
    input.queryKey[1] === "list-directory" &&
    input.queryKey[2] === input.environmentId &&
    input.queryKey[3] === input.workspaceRoot
  );
}

const DirectorySkeletonRows = memo(function DirectorySkeletonRows({ depth }: { depth: number }) {
  return (
    <div className="space-y-1 py-2">
      {Array.from({ length: depth === 0 ? 8 : 3 }, (_, index) => (
        <div
          key={`${depth}:${index}`}
          className="flex items-center gap-2 pr-3"
          style={{ paddingLeft: `${renderTreeIndent(depth)}px` }}
        >
          <Skeleton className="size-3.5 rounded-sm" />
          <Skeleton className="h-3 w-full rounded-sm" />
        </div>
      ))}
    </div>
  );
});

const DirectoryListing = memo(function DirectoryListing(props: {
  depth: number;
  enabled: boolean;
  environmentId: EnvironmentId;
  connectionUiState: ReturnType<typeof getWsConnectionUiState>;
  expandedDirectories: ReadonlySet<string>;
  onUnsupported: () => void;
  onOpenFile: (relativePath: string) => void;
  onToggleDirectory: (pathValue: string) => void;
  parentPath?: string;
  resolvedTheme: "light" | "dark";
  workspaceRoot: string;
}) {
  const { onUnsupported } = props;
  const query = useQuery(
    projectListDirectoryQueryOptions({
      environmentId: props.environmentId,
      cwd: props.workspaceRoot,
      enabled: props.enabled,
      ...(props.parentPath ? { parentPath: props.parentPath } : {}),
    }),
  );
  const entries = query.data?.entries ?? [];

  useEffect(() => {
    if (query.isError && isUnsupportedDirectoryListingError(query.error)) {
      onUnsupported();
    }
  }, [onUnsupported, query.error, query.isError]);

  if (query.isPending && !query.data) {
    return <DirectorySkeletonRows depth={props.depth} />;
  }

  if (query.isError) {
    if (isUnsupportedDirectoryListingError(query.error)) {
      return (
        <div
          className="px-3 py-3 text-[11px] leading-relaxed text-muted-foreground/80"
          style={{ paddingLeft: `${renderTreeIndent(props.depth)}px` }}
        >
          File explorer requires a newer server build than the one currently connected.
        </div>
      );
    }
    const errorPresentation = resolveFileExplorerErrorPresentation({
      connectionUiState: props.connectionUiState,
      error: query.error,
    });
    return (
      <div
        className={cn(
          "px-3 py-3 text-[11px] leading-relaxed",
          errorPresentation.tone === "warning" ? "text-warning" : "text-destructive/90",
        )}
        style={{ paddingLeft: `${renderTreeIndent(props.depth)}px` }}
      >
        {errorPresentation.message}
      </div>
    );
  }

  if (entries.length === 0 && props.depth === 0) {
    return (
      <div className="px-4 py-6 text-center text-[12px] text-muted-foreground/75">
        This workspace is empty.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-0.5 py-2">
        {entries.map((entry) => {
          const isDirectory = entry.kind === "directory";
          const isExpanded = isDirectory && props.expandedDirectories.has(entry.path);
          return (
            <div key={`${entry.kind}:${entry.path}`}>
              <button
                type="button"
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md py-1.5 pr-3 text-left transition-colors",
                  isDirectory
                    ? "hover:bg-foreground/4"
                    : "hover:bg-primary/8 hover:text-foreground",
                )}
                style={{ paddingLeft: `${renderTreeIndent(props.depth)}px` }}
                onClick={() =>
                  isDirectory ? props.onToggleDirectory(entry.path) : props.onOpenFile(entry.path)
                }
                title={entry.path}
              >
                <ChevronRightIcon
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
                    isDirectory ? "opacity-100" : "opacity-0",
                    isExpanded && "rotate-90",
                  )}
                />
                <VscodeEntryIcon
                  pathValue={entry.path}
                  kind={entry.kind}
                  theme={props.resolvedTheme}
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground">
                  {basenameOfPath(entry.path)}
                </span>
              </button>
              {isDirectory && isExpanded ? (
                <DirectoryListing
                  connectionUiState={props.connectionUiState}
                  depth={props.depth + 1}
                  enabled={props.enabled}
                  environmentId={props.environmentId}
                  expandedDirectories={props.expandedDirectories}
                  onUnsupported={props.onUnsupported}
                  onOpenFile={props.onOpenFile}
                  onToggleDirectory={props.onToggleDirectory}
                  parentPath={entry.path}
                  resolvedTheme={props.resolvedTheme}
                  workspaceRoot={props.workspaceRoot}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {query.data?.truncated ? (
        <div className="border-t border-border/60 px-4 py-2 text-[10px] tracking-[0.16em] text-muted-foreground/55 uppercase">
          Directory listing truncated
        </div>
      ) : null}
    </>
  );
});

export const FileExplorerSidebar = memo(function FileExplorerSidebar(props: {
  environmentId: EnvironmentId;
  manualOpen?: boolean;
  resolvedTheme: "light" | "dark";
  workspaceRoot: string | undefined;
}) {
  const queryClient = useQueryClient();
  const wsConnectionStatus = useWsConnectionStatus();
  const openWorkspaceFile = useOpenWorkspaceFile();
  const [pinned, setPinned] = useLocalStorage(
    FILE_EXPLORER_PINNED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set());
  const [directoryListingSupported, setDirectoryListingSupported] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);
  const connectionUiState = getWsConnectionUiState(wsConnectionStatus);
  const previousConnectionUiStateRef = useRef(connectionUiState);

  const clearPendingClose = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const requestOpen = useCallback(() => {
    clearPendingClose();
    setPreviewOpen(true);
  }, [clearPendingClose]);

  const scheduleClose = useCallback(() => {
    if (pinned) {
      return;
    }
    clearPendingClose();
    closeTimeoutRef.current = window.setTimeout(() => {
      setPreviewOpen(false);
      closeTimeoutRef.current = null;
    }, FILE_EXPLORER_CLOSE_DELAY_MS);
  }, [clearPendingClose, pinned]);

  useEffect(
    () => () => {
      clearPendingClose();
    },
    [clearPendingClose],
  );

  useEffect(() => {
    setExpandedDirectories(new Set());
  }, [props.workspaceRoot]);
  useEffect(() => {
    setDirectoryListingSupported(true);
  }, [props.environmentId, props.workspaceRoot]);

  const open = Boolean(props.manualOpen) || pinned || previewOpen;
  const workspaceLabel = props.workspaceRoot
    ? rootLabelFromWorkspaceRoot(props.workspaceRoot)
    : null;
  const hasWorkspace = Boolean(props.workspaceRoot);
  const toggleDirectory = useCallback((pathValue: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(pathValue)) {
        next.delete(pathValue);
      } else {
        next.add(pathValue);
      }
      return next;
    });
  }, []);
  const handleOpenFile = useCallback(
    (relativePath: string) => {
      if (!props.workspaceRoot) {
        return;
      }
      void openWorkspaceFile({
        environmentId: props.environmentId,
        workspaceRoot: props.workspaceRoot,
        targetPath: joinWorkspacePath(props.workspaceRoot, relativePath),
      });
    },
    [openWorkspaceFile, props.environmentId, props.workspaceRoot],
  );
  const handleRefreshWorkspace = useCallback(() => {
    if (!props.workspaceRoot) {
      return;
    }
    const workspaceRoot = props.workspaceRoot;
    setDirectoryListingSupported(true);
    setIsRefreshing(true);
    void queryClient
      .invalidateQueries({
        predicate: (query) =>
          isFileExplorerDirectoryQueryKey({
            environmentId: props.environmentId,
            queryKey: query.queryKey,
            workspaceRoot,
          }),
        refetchType: "active",
      })
      .finally(() => {
        setIsRefreshing(false);
      });
  }, [props.environmentId, props.workspaceRoot, queryClient]);
  const headerDescription = useMemo(
    () => props.workspaceRoot?.replaceAll("\\", "/") ?? null,
    [props.workspaceRoot],
  );

  useEffect(() => {
    const previousConnectionUiState = previousConnectionUiStateRef.current;
    const workspaceRoot = props.workspaceRoot;

    if (
      workspaceRoot &&
      shouldAutoRefreshFileExplorerOnReconnect({
        nextConnectionUiState: connectionUiState,
        previousConnectionUiState,
        workspaceRoot,
      })
    ) {
      void queryClient.invalidateQueries({
        predicate: (query) =>
          isFileExplorerDirectoryQueryKey({
            environmentId: props.environmentId,
            queryKey: query.queryKey,
            workspaceRoot,
          }),
        refetchType: "active",
      });
    }

    previousConnectionUiStateRef.current = connectionUiState;
  }, [connectionUiState, props.environmentId, props.workspaceRoot, queryClient]);

  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 z-10 hidden w-3 md:block"
        onMouseEnter={requestOpen}
      />
      <aside
        className={cn(
          "relative hidden shrink-0 overflow-hidden border-l border-border/70 bg-card/90 backdrop-blur-sm transition-[width,border-color] duration-200 ease-out md:flex",
          open ? FILE_EXPLORER_WIDTH_CLASS : "w-0 border-l-transparent",
        )}
        onMouseEnter={requestOpen}
        onMouseLeave={scheduleClose}
      >
        <div
          className={cn(
            "flex h-full w-[22rem] flex-col transition-opacity duration-150",
            open ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold tracking-[0.24em] text-muted-foreground/60 uppercase">
                File Explorer
              </div>
              <div className="mt-1 truncate text-sm font-medium text-foreground">
                {workspaceLabel ?? "No workspace"}
              </div>
              <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">
                {headerDescription ?? "Open a thread with an attached project to browse files."}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                size="icon-xs"
                variant="outline"
                disabled={!hasWorkspace || isRefreshing}
                aria-label="Sync file explorer"
                title="Sync file explorer"
                onClick={handleRefreshWorkspace}
              >
                <RefreshCwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant={pinned ? "secondary" : "outline"}
                aria-label={pinned ? "Unpin file explorer" : "Pin file explorer"}
                aria-pressed={pinned}
                title={pinned ? "Unpin file explorer" : "Pin file explorer"}
                onClick={() => {
                  const nextPinned = !pinned;
                  setPinned(nextPinned);
                  if (nextPinned) {
                    requestOpen();
                  }
                }}
              >
                <PinIcon
                  className={cn("size-3.5 transition-transform", pinned ? "rotate-45" : "rotate-0")}
                />
              </Button>
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {props.workspaceRoot ? (
              <DirectoryListing
                connectionUiState={connectionUiState}
                depth={0}
                enabled={open && directoryListingSupported}
                environmentId={props.environmentId}
                expandedDirectories={expandedDirectories}
                onUnsupported={() => setDirectoryListingSupported(false)}
                onOpenFile={handleOpenFile}
                onToggleDirectory={toggleDirectory}
                resolvedTheme={props.resolvedTheme}
                workspaceRoot={props.workspaceRoot}
              />
            ) : (
              <div className="px-4 py-6 text-sm leading-relaxed text-muted-foreground/75">
                This sidebar activates once the current thread is attached to a project or worktree.
              </div>
            )}
          </ScrollArea>
        </div>
      </aside>
    </>
  );
});
