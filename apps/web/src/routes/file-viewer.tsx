import { EnvironmentId } from "@t3tools/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";

import { APP_DISPLAY_NAME } from "../branding";
import { FileViewerWindow } from "../components/FileViewerWindow";
import { addFileViewerTab } from "../fileViewerState";

interface FileViewerRouteSearch {
  readonly environmentId?: EnvironmentId;
  readonly cwd?: string;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizePositiveInt(value: unknown): number | undefined {
  const raw = typeof value === "number" ? String(value) : normalizeSearchString(value);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseFileViewerRouteSearch(search: Record<string, unknown>): FileViewerRouteSearch {
  const environmentId = normalizeSearchString(search.environmentId);
  const cwd = normalizeSearchString(search.cwd);
  const path = normalizeSearchString(search.path);
  const line = normalizePositiveInt(search.line);
  const column = normalizePositiveInt(search.column);
  return {
    ...(environmentId ? { environmentId: EnvironmentId.make(environmentId) } : {}),
    ...(cwd ? { cwd } : {}),
    ...(path ? { path } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  };
}

export const Route = createFileRoute("/file-viewer")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  validateSearch: (search) => parseFileViewerRouteSearch(search),
  component: FileViewerRouteView,
});

function FileViewerRouteView() {
  const search = Route.useSearch() as FileViewerRouteSearch;

  useEffect(() => {
    document.title = `Files - ${APP_DISPLAY_NAME}`;
  }, []);

  useEffect(() => {
    if (!search.environmentId || !search.cwd || !search.path) return;
    addFileViewerTab({
      environmentId: search.environmentId,
      cwd: search.cwd,
      relativePath: search.path,
      ...(search.line !== undefined ? { line: search.line } : {}),
      ...(search.column !== undefined ? { column: search.column } : {}),
    });
  }, [search.column, search.cwd, search.environmentId, search.line, search.path]);

  return <FileViewerWindow />;
}
