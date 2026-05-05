import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRightIcon,
  FileSearchIcon,
  FolderOpenIcon,
  PanelRightCloseIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { openFileViewer } from "../fileViewerState";
import {
  projectListDirectoryQueryOptions,
  projectQueryKeys,
  projectSearchEntriesQueryOptions,
} from "../lib/projectReactQuery";
import { cn } from "../lib/utils";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { presentFileExplorerError } from "./FileExplorerSidebar.logic";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useTheme } from "../hooks/useTheme";

interface FileExplorerSidebarProps {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly mode?: "sheet" | "sidebar";
  readonly onClose?: () => void;
}

const SEARCH_LIMIT = 100;
const ROOT_PATH = "";

function basenameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

function parentDirectoriesOf(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  const parents: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join("/"));
  }
  return parents;
}

function EntryButton(props: {
  readonly entry: ProjectEntry;
  readonly depth: number;
  readonly expanded?: boolean;
  readonly loading?: boolean;
  readonly theme: "light" | "dark";
  readonly onClick: () => void;
}) {
  const label = basenameOf(props.entry.path);
  return (
    <button
      type="button"
      className="group flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
      style={{ paddingLeft: `${Math.max(6, props.depth * 14 + 6)}px` }}
      onClick={props.onClick}
      title={props.entry.path}
    >
      {props.entry.kind === "directory" ? (
        props.loading ? (
          <Spinner className="size-3 shrink-0 text-muted-foreground/55" />
        ) : (
          <ChevronRightIcon
            className={cn(
              "size-3 shrink-0 text-muted-foreground/45 transition-transform",
              props.expanded && "rotate-90",
            )}
          />
        )
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <VscodeEntryIcon
        pathValue={props.entry.path}
        kind={props.entry.kind}
        theme={props.theme}
        className="size-4"
      />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

const DirectoryNode = memo(function DirectoryNode(props: {
  readonly entry: ProjectEntry;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly depth: number;
  readonly expandedPaths: ReadonlySet<string>;
  readonly toggleDirectory: (path: string) => void;
  readonly openFile: (path: string) => void;
  readonly theme: "light" | "dark";
}) {
  const expanded = props.expandedPaths.has(props.entry.path);
  const query = useQuery(
    projectListDirectoryQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      parentPath: props.entry.path,
      enabled: expanded,
    }),
  );

  return (
    <>
      <EntryButton
        entry={props.entry}
        depth={props.depth}
        expanded={expanded}
        loading={expanded && query.isLoading}
        theme={props.theme}
        onClick={() => props.toggleDirectory(props.entry.path)}
      />
      {expanded && query.error ? (
        <div
          className="px-2 py-1 text-[11px] text-destructive"
          style={{ paddingLeft: `${props.depth * 14 + 26}px` }}
        >
          {presentFileExplorerError(query.error).description}
        </div>
      ) : null}
      {expanded && query.data?.entries
        ? query.data.entries.map((entry) =>
            entry.kind === "directory" ? (
              <DirectoryNode
                key={entry.path}
                entry={entry}
                environmentId={props.environmentId}
                cwd={props.cwd}
                depth={props.depth + 1}
                expandedPaths={props.expandedPaths}
                toggleDirectory={props.toggleDirectory}
                openFile={props.openFile}
                theme={props.theme}
              />
            ) : (
              <EntryButton
                key={entry.path}
                entry={entry}
                depth={props.depth + 1}
                theme={props.theme}
                onClick={() => props.openFile(entry.path)}
              />
            ),
          )
        : null}
    </>
  );
});

export function FileExplorerSidebar({
  environmentId,
  cwd,
  mode = "sidebar",
  onClose,
}: FileExplorerSidebarProps) {
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set([ROOT_PATH]));
  const [searchText, setSearchText] = useState("");
  const query = searchText.trim();
  const rootQuery = useQuery(
    projectListDirectoryQueryOptions({
      environmentId,
      cwd,
      enabled: query.length === 0,
    }),
  );
  const searchQuery = useQuery(
    projectSearchEntriesQueryOptions({
      environmentId,
      cwd,
      query,
      limit: SEARCH_LIMIT,
      enabled: query.length > 0,
    }),
  );

  const openFile = useCallback(
    (relativePath: string) => {
      if (!environmentId || !cwd) return;
      openFileViewer({
        environmentId,
        cwd,
        relativePath,
      });
    },
    [cwd, environmentId],
  );

  const toggleDirectory = useCallback((path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const revealDirectory = useCallback((entry: ProjectEntry) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      next.add(ROOT_PATH);
      for (const parentPath of parentDirectoriesOf(entry.path)) {
        next.add(parentPath);
      }
      if (entry.kind === "directory") {
        next.add(entry.path);
      }
      return next;
    });
    setSearchText("");
  }, []);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
  }, [queryClient]);

  const rootEntries = rootQuery.data?.entries;
  const searchEntries = searchQuery.data?.entries;
  const activeError = query.length > 0 ? searchQuery.error : rootQuery.error;
  const error = activeError ? presentFileExplorerError(activeError) : null;
  const isLoading = query.length > 0 ? searchQuery.isLoading : rootQuery.isLoading;

  const content = useMemo(() => {
    if (!environmentId || !cwd) {
      return (
        <div className="p-3 text-[12px] text-muted-foreground">
          Open a project to browse workspace files.
        </div>
      );
    }

    if (error) {
      return (
        <div className="space-y-2 p-3 text-[12px]">
          <p className="font-medium text-foreground">{error.title}</p>
          <p className="leading-relaxed text-muted-foreground">{error.description}</p>
          {error.canRetry ? (
            <Button size="xs" variant="outline" onClick={refresh}>
              Retry
            </Button>
          ) : null}
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="flex items-center gap-2 p-3 text-[12px] text-muted-foreground">
          <Spinner className="size-3.5" />
          Loading files
        </div>
      );
    }

    if (query.length > 0) {
      const entries = searchEntries ?? [];
      if (entries.length === 0) {
        return (
          <div className="p-3 text-[12px] text-muted-foreground">
            No files or folders match "{query}".
          </div>
        );
      }
      return (
        <div className="py-1">
          {entries.map((entry) => (
            <EntryButton
              key={`${entry.kind}:${entry.path}`}
              entry={entry}
              depth={0}
              theme={resolvedTheme}
              onClick={() =>
                entry.kind === "directory" ? revealDirectory(entry) : openFile(entry.path)
              }
            />
          ))}
          {searchQuery.data?.truncated ? (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground/70">
              Showing first {SEARCH_LIMIT} matches.
            </div>
          ) : null}
        </div>
      );
    }

    const entries = rootEntries ?? [];
    if (entries.length === 0) {
      return <div className="p-3 text-[12px] text-muted-foreground">This workspace is empty.</div>;
    }

    return (
      <div className="py-1">
        {entries.map((entry) =>
          entry.kind === "directory" ? (
            <DirectoryNode
              key={entry.path}
              entry={entry}
              environmentId={environmentId}
              cwd={cwd}
              depth={0}
              expandedPaths={expandedPaths}
              toggleDirectory={toggleDirectory}
              openFile={openFile}
              theme={resolvedTheme}
            />
          ) : (
            <EntryButton
              key={entry.path}
              entry={entry}
              depth={0}
              theme={resolvedTheme}
              onClick={() => openFile(entry.path)}
            />
          ),
        )}
        {rootQuery.data?.truncated ? (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground/70">
            Directory listing truncated.
          </div>
        ) : null}
      </div>
    );
  }, [
    cwd,
    environmentId,
    error,
    expandedPaths,
    isLoading,
    openFile,
    query,
    refresh,
    resolvedTheme,
    revealDirectory,
    rootEntries,
    rootQuery.data?.truncated,
    searchEntries,
    searchQuery.data?.truncated,
    toggleDirectory,
  ]);

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col bg-card/30",
        mode === "sidebar"
          ? "h-full w-[300px] shrink-0 border-l border-border/70"
          : "h-full w-full",
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground/70" />
          <span className="truncate text-[12px] font-medium text-foreground">Files</span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Refresh file explorer"
                  onClick={refresh}
                />
              }
            >
              <RefreshCwIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup>Refresh</TooltipPopup>
          </Tooltip>
          {onClose ? (
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={onClose}
              aria-label="Close file explorer"
              className="text-muted-foreground/50 hover:text-foreground/70"
            >
              <PanelRightCloseIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="border-b border-border/50 p-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            nativeInput
            type="search"
            size="sm"
            className="rounded-md"
            value={searchText}
            onChange={(event) => setSearchText(event.currentTarget.value)}
            placeholder="Search files"
            aria-label="Search workspace files"
          />
          {searchText ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
              aria-label="Clear file search"
              onClick={() => setSearchText("")}
            >
              <XIcon className="size-3.5" />
            </button>
          ) : (
            <FileSearchIcon className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/35" />
          )}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        {content}
      </ScrollArea>
    </aside>
  );
}
