import type { EnvironmentId, GitBranch, ProjectId } from "@t3tools/contracts";
import { Schema } from "effect";
export {
  dedupeRemoteBranchesWithLocalMatches,
  deriveLocalBranchNameFromRemoteRef,
} from "@t3tools/shared/git";
import { formatWorktreePathForDisplay } from "../worktreeCleanup";

export interface EnvironmentOption {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  label: string;
  isPrimary: boolean;
}

export interface ExistingWorktreeOption {
  path: string;
  branch: string;
  label: string;
  current: boolean;
}

export const EnvMode = Schema.Literals(["local", "worktree"]);
export type EnvMode = typeof EnvMode.Type;

const GENERIC_LOCAL_ENVIRONMENT_LABELS = new Set(["local", "local environment"]);

function normalizeDisplayLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function resolveEnvironmentOptionLabel(input: {
  isPrimary: boolean;
  environmentId: EnvironmentId;
  runtimeLabel?: string | null;
  savedLabel?: string | null;
}): string {
  const runtimeLabel = normalizeDisplayLabel(input.runtimeLabel);
  const savedLabel = normalizeDisplayLabel(input.savedLabel);

  if (input.isPrimary) {
    const preferredLocalLabel = [runtimeLabel, savedLabel].find((label) => {
      if (!label) return false;
      return !GENERIC_LOCAL_ENVIRONMENT_LABELS.has(label.toLowerCase());
    });
    return preferredLocalLabel ?? "This device";
  }

  return runtimeLabel ?? savedLabel ?? input.environmentId;
}

export function resolveEnvModeLabel(mode: EnvMode): string {
  return mode === "worktree" ? "New worktree" : "Current checkout";
}

export function resolveCurrentWorkspaceLabel(_activeWorktreePath: string | null): string {
  return resolveEnvModeLabel("local");
}

export function resolveLockedWorkspaceLabel(activeWorktreePath: string | null): string {
  return activeWorktreePath ? "Worktree" : "Local checkout";
}

const EXISTING_WORKTREE_VALUE_PREFIX = "__existing_worktree__:";

export function createExistingWorktreeValue(path: string): string {
  return `${EXISTING_WORKTREE_VALUE_PREFIX}${path}`;
}

export function parseExistingWorktreeValue(value: string): string | null {
  return value.startsWith(EXISTING_WORKTREE_VALUE_PREFIX)
    ? value.slice(EXISTING_WORKTREE_VALUE_PREFIX.length)
    : null;
}

export function resolveWorkspaceTriggerLabel(input: {
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
}): string {
  if (input.activeWorktreePath) {
    return formatWorktreePathForDisplay(input.activeWorktreePath);
  }
  return resolveEnvModeLabel(input.effectiveEnvMode);
}

export function resolveWorkspaceSelectValue(input: {
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
}): string {
  if (input.activeWorktreePath) {
    return createExistingWorktreeValue(input.activeWorktreePath);
  }
  return input.effectiveEnvMode;
}

export function collectExistingWorktrees(
  branches: readonly Pick<GitBranch, "current" | "name" | "worktreePath">[],
): ExistingWorktreeOption[] {
  const worktreesByPath = new Map<string, ExistingWorktreeOption>();

  for (const branch of branches) {
    if (!branch.worktreePath) {
      continue;
    }

    const nextOption: ExistingWorktreeOption = {
      path: branch.worktreePath,
      branch: branch.name,
      label: formatWorktreePathForDisplay(branch.worktreePath),
      current: branch.current,
    };
    const existing = worktreesByPath.get(branch.worktreePath);
    if (!existing || (!existing.current && nextOption.current)) {
      worktreesByPath.set(branch.worktreePath, nextOption);
    }
  }

  return [...worktreesByPath.values()].toSorted((a, b) => {
    if (a.current !== b.current) {
      return a.current ? -1 : 1;
    }
    const labelCompare = a.label.localeCompare(b.label);
    if (labelCompare !== 0) {
      return labelCompare;
    }
    return a.branch.localeCompare(b.branch);
  });
}

export function resolveEffectiveEnvMode(input: {
  activeWorktreePath: string | null;
  hasServerThread: boolean;
  draftThreadEnvMode: EnvMode | undefined;
}): EnvMode {
  const { activeWorktreePath, hasServerThread, draftThreadEnvMode } = input;
  if (!hasServerThread) {
    if (activeWorktreePath) {
      return "local";
    }
    return draftThreadEnvMode === "worktree" ? "worktree" : "local";
  }
  return activeWorktreePath ? "worktree" : "local";
}

export function resolveDraftEnvModeAfterBranchChange(input: {
  nextWorktreePath: string | null;
  currentWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
}): EnvMode {
  const { nextWorktreePath, currentWorktreePath, effectiveEnvMode } = input;
  if (nextWorktreePath) {
    return "worktree";
  }
  if (effectiveEnvMode === "worktree" && !currentWorktreePath) {
    return "worktree";
  }
  return "local";
}

export function resolveBranchToolbarValue(input: {
  envMode: EnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
}): string | null {
  const { envMode, activeWorktreePath, activeThreadBranch, currentGitBranch } = input;
  if (envMode === "worktree" && !activeWorktreePath) {
    return activeThreadBranch ?? currentGitBranch;
  }
  return currentGitBranch ?? activeThreadBranch;
}

export function resolveBranchSelectionTarget(input: {
  activeProjectCwd: string;
  activeWorktreePath: string | null;
  branch: Pick<GitBranch, "isDefault" | "worktreePath">;
}): {
  checkoutCwd: string;
  nextWorktreePath: string | null;
  reuseExistingWorktree: boolean;
} {
  const { activeProjectCwd, activeWorktreePath, branch } = input;

  if (branch.worktreePath) {
    return {
      checkoutCwd: branch.worktreePath,
      nextWorktreePath: branch.worktreePath === activeProjectCwd ? null : branch.worktreePath,
      reuseExistingWorktree: true,
    };
  }

  const nextWorktreePath =
    activeWorktreePath !== null && branch.isDefault ? null : activeWorktreePath;

  return {
    checkoutCwd: nextWorktreePath ?? activeProjectCwd,
    nextWorktreePath,
    reuseExistingWorktree: false,
  };
}

export function shouldIncludeBranchPickerItem(input: {
  itemValue: string;
  normalizedQuery: string;
  createBranchItemValue: string | null;
  checkoutPullRequestItemValue: string | null;
}): boolean {
  const { itemValue, normalizedQuery, createBranchItemValue, checkoutPullRequestItemValue } = input;

  if (normalizedQuery.length === 0) {
    return true;
  }

  if (createBranchItemValue && itemValue === createBranchItemValue) {
    return true;
  }

  if (checkoutPullRequestItemValue && itemValue === checkoutPullRequestItemValue) {
    return true;
  }

  return itemValue.toLowerCase().includes(normalizedQuery);
}
