import type { EnvironmentId } from "@t3tools/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FolderGit2Icon, FolderGitIcon, FolderIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { gitBranchSearchInfiniteQueryOptions } from "../lib/gitReactQuery";
import {
  collectExistingWorktrees,
  createExistingWorktreeValue,
  parseExistingWorktreeValue,
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveLockedWorkspaceLabel,
  resolveWorkspaceSelectValue,
  resolveWorkspaceTriggerLabel,
  type EnvMode,
} from "./BranchToolbar.logic";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface BranchToolbarEnvModeSelectorProps {
  environmentId: EnvironmentId;
  activeProjectCwd: string | null;
  envLocked: boolean;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  onWorkspaceChange: (input: {
    envMode: EnvMode;
    worktreePath: string | null;
    branch?: string | null;
  }) => void;
}

export const BranchToolbarEnvModeSelector = memo(function BranchToolbarEnvModeSelector({
  environmentId,
  activeProjectCwd,
  envLocked,
  effectiveEnvMode,
  activeWorktreePath,
  onWorkspaceChange,
}: BranchToolbarEnvModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    gitBranchSearchInfiniteQueryOptions({
      environmentId,
      cwd: activeProjectCwd,
      query: "",
      enabled: !envLocked && activeProjectCwd !== null,
    }),
  );
  const branches = useMemo(() => data?.pages.flatMap((page) => page.branches) ?? [], [data?.pages]);
  const existingWorktrees = useMemo(() => collectExistingWorktrees(branches), [branches]);
  const currentCheckoutBranch = branches.find((branch) => branch.current)?.name ?? null;
  const selectedValue = resolveWorkspaceSelectValue({ activeWorktreePath, effectiveEnvMode });
  const triggerLabel = resolveWorkspaceTriggerLabel({ activeWorktreePath, effectiveEnvMode });

  useEffect(() => {
    if (!open || !hasNextPage || isFetchingNextPage) {
      return;
    }
    void fetchNextPage().catch(() => undefined);
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, open]);

  if (envLocked) {
    return (
      <span className="inline-flex items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs">
        {activeWorktreePath ? (
          <>
            <FolderGitIcon className="size-3" />
            {resolveLockedWorkspaceLabel(activeWorktreePath)}
          </>
        ) : (
          <>
            <FolderIcon className="size-3" />
            {resolveLockedWorkspaceLabel(activeWorktreePath)}
          </>
        )}
      </span>
    );
  }

  return (
    <Select
      value={selectedValue}
      onOpenChange={setOpen}
      onValueChange={(value) => {
        const selectedWorktreePath = value ? parseExistingWorktreeValue(value) : null;
        if (selectedWorktreePath) {
          const selectedWorktree = existingWorktrees.find(
            (worktree) => worktree.path === selectedWorktreePath,
          );
          onWorkspaceChange({
            envMode: "local",
            worktreePath: selectedWorktreePath,
            ...(selectedWorktree ? { branch: selectedWorktree.branch } : {}),
          });
          return;
        }

        if (value === "worktree") {
          onWorkspaceChange({
            envMode: "worktree",
            worktreePath: null,
            ...(currentCheckoutBranch ? { branch: currentCheckoutBranch } : {}),
          });
          return;
        }

        onWorkspaceChange({
          envMode: "local",
          worktreePath: null,
          ...(currentCheckoutBranch ? { branch: currentCheckoutBranch } : {}),
        });
      }}
    >
      <SelectTrigger variant="ghost" size="xs" className="font-medium" aria-label="Workspace">
        {activeWorktreePath ? (
          <FolderGitIcon className="size-3" />
        ) : effectiveEnvMode === "worktree" ? (
          <FolderGit2Icon className="size-3" />
        ) : (
          <FolderIcon className="size-3" />
        )}
        <SelectValue>{triggerLabel}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectGroupLabel>Workspace</SelectGroupLabel>
          <SelectItem value="local">
            <span className="inline-flex items-center gap-1.5">
              <FolderIcon className="size-3" />
              {resolveCurrentWorkspaceLabel(activeWorktreePath)}
            </span>
          </SelectItem>
          <SelectItem value="worktree">
            <span className="inline-flex items-center gap-1.5">
              <FolderGit2Icon className="size-3" />
              {resolveEnvModeLabel("worktree")}
            </span>
          </SelectItem>
        </SelectGroup>
        {existingWorktrees.length > 0 ? (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectGroupLabel>Existing worktrees</SelectGroupLabel>
              {existingWorktrees.map((worktree) => (
                <SelectItem key={worktree.path} value={createExistingWorktreeValue(worktree.path)}>
                  <div className="flex min-w-0 items-center gap-2">
                    <FolderGitIcon className="mt-0.5 size-3 shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate text-sm">{worktree.label}</div>
                      <div className="truncate text-muted-foreground text-[11px]">
                        {worktree.branch}
                        {worktree.current ? " • current" : ""}
                      </div>
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        ) : null}
      </SelectPopup>
    </Select>
  );
});
