import type { EnvironmentId, LocalApi } from "@t3tools/contracts";
import { useCallback } from "react";

import { openInPreferredEditor } from "../editorPreferences";
import { openFileViewer, resolveFileViewerRequest } from "../fileViewerState";
import { readLocalApi } from "../localApi";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useSettings } from "./useSettings";

export interface UseOpenWorkspaceFileInput {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string | null | undefined;
}

function reportOpenError(title: string, error?: unknown): void {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function openWorkspaceFileExternally(localApi: LocalApi | null, targetPath: string): void {
  if (!localApi) {
    toastManager.add({
      type: "error",
      title: "Open in editor is unavailable",
    });
    return;
  }

  void openInPreferredEditor(localApi, targetPath).catch((error) => {
    reportOpenError("Unable to open file", error);
  });
}

export function useOpenWorkspaceFile(input: UseOpenWorkspaceFileInput) {
  const workspaceFileOpenMode = useSettings((settings) => settings.workspaceFileOpenMode);

  return useCallback(
    (targetPath: string) => {
      if (workspaceFileOpenMode === "internal" && input.workspaceRoot) {
        const request = resolveFileViewerRequest({
          environmentId: input.environmentId,
          workspaceRoot: input.workspaceRoot,
          targetPath,
        });
        if (request) {
          openFileViewer(request);
          return;
        }
      }

      openWorkspaceFileExternally(readLocalApi() ?? null, targetPath);
    },
    [input.environmentId, input.workspaceRoot, workspaceFileOpenMode],
  );
}
