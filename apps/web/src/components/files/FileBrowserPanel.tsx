import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { T3_PIERRE_ICONS } from "~/pierre-icons";
import { useUiStateStore } from "~/uiStateStore";

import { useProjectEntriesQuery } from "./projectFilesQueryState";

interface FileBrowserPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  onOpenFile: (relativePath: string) => void;
}

const TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
  }
  button[data-type='item'] { border-radius: 5px; }
`;

function treePath(entry: ProjectEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function defaultExpandedDirectoryPaths(paths: readonly string[]): string[] {
  return paths.filter((path) => path.endsWith("/") && path.split("/").filter(Boolean).length <= 1);
}

export default function FileBrowserPanel({
  environmentId,
  cwd,
  projectName,
  onOpenFile,
}: FileBrowserPanelProps) {
  const { resolvedTheme } = useTheme();
  const entriesQuery = useProjectEntriesQuery(environmentId, cwd);
  const entries = entriesQuery.data?.entries ?? [];
  const fileExplorerStateKey = `${environmentId}:${cwd}`;
  const persistedExpandedPaths = useUiStateStore(
    (state) => state.fileExplorerExpandedPathsByKey[fileExplorerStateKey],
  );
  const setFileExplorerExpandedPaths = useUiStateStore(
    (state) => state.setFileExplorerExpandedPaths,
  );
  const entryKinds = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry.kind] as const)),
    [entries],
  );
  const entryKindsRef = useRef<ReadonlyMap<string, ProjectEntry["kind"]>>(entryKinds);
  const treePaths = useMemo(() => entries.map(treePath), [entries]);
  const previousTreeResetRef = useRef<{ key: string; paths: readonly string[] } | null>(null);

  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: persistedExpandedPaths === undefined ? 1 : "closed",
    ...(persistedExpandedPaths === undefined
      ? {}
      : { initialExpandedPaths: persistedExpandedPaths }),
    icons: T3_PIERRE_ICONS,
    onSelectionChange: (selectedPaths) => {
      const selectedPath = selectedPaths.at(-1)?.replace(/\/$/, "");
      if (selectedPath && entryKindsRef.current.get(selectedPath) === "file") {
        onOpenFile(selectedPath);
      }
    },
    paths: [],
    search: true,
    unsafeCSS: TREE_UNSAFE_CSS,
  });

  useEffect(() => {
    const previousReset = previousTreeResetRef.current;
    if (previousReset?.key === fileExplorerStateKey && previousReset.paths === treePaths) return;
    entryKindsRef.current = entryKinds;
    previousTreeResetRef.current = { key: fileExplorerStateKey, paths: treePaths };
    model.resetPaths(treePaths, {
      initialExpandedPaths: persistedExpandedPaths ?? defaultExpandedDirectoryPaths(treePaths),
    });
  }, [entryKinds, fileExplorerStateKey, model, persistedExpandedPaths, treePaths]);

  useEffect(() => {
    const saveExpandedPaths = () => {
      if (model.isSearchOpen()) {
        return;
      }
      const expandedPaths = treePaths.filter((path) => {
        if (!path.endsWith("/")) {
          return false;
        }
        const item = model.getItem(path);
        if (!item?.isDirectory()) {
          return false;
        }
        return (item as { isExpanded: () => boolean }).isExpanded();
      });
      setFileExplorerExpandedPaths(fileExplorerStateKey, expandedPaths);
    };

    saveExpandedPaths();
    return model.subscribe(saveExpandedPaths);
  }, [fileExplorerStateKey, model, setFileExplorerExpandedPaths, treePaths]);

  const fileCount = useMemo(
    () => entries.reduce((count, entry) => count + (entry.kind === "file" ? 1 : 0), 0),
    [entries],
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background"
      data-file-browser-panel={`${environmentId}:${cwd}`}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{projectName}</div>
          <div className="truncate text-[10px] leading-none text-muted-foreground">
            {entriesQuery.isPending && entriesQuery.data === null
              ? "Indexing…"
              : `${fileCount.toLocaleString()} files`}
            {entriesQuery.data?.truncated ? " · partial" : ""}
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Search workspace files"
          onClick={() => model.openSearch()}
        >
          <Search className="size-3.5" />
        </button>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Refresh workspace files"
          onClick={entriesQuery.refresh}
        >
          <RefreshCw className={cn("size-3.5", entriesQuery.isPending && "animate-spin")} />
        </button>
      </div>
      {entriesQuery.error && entriesQuery.data === null ? (
        <div className="p-4 text-xs leading-relaxed text-destructive">{entriesQuery.error}</div>
      ) : (
        <FileTree
          model={model}
          aria-label={`${projectName} files`}
          className="min-h-0 flex-1 overflow-hidden"
          style={{
            colorScheme: resolvedTheme,
            ["--trees-fg-override" as string]: "var(--foreground)",
          }}
        />
      )}
    </div>
  );
}
