import { type EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { openInPreferredEditor } from "../editorPreferences";
import { openFileViewer, resolveFileViewerRequest } from "../fileViewerState";
import { readLocalApi } from "../localApi";
import { useSettings } from "./useSettings";

export interface OpenWorkspaceFileInput {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly workspaceRoot: string | null | undefined;
  readonly targetPath: string;
}

export function useOpenWorkspaceFile(): (input: OpenWorkspaceFileInput) => Promise<void> {
  const fileViewer = useSettings((settings) => settings.fileViewer);

  return useCallback(
    async (input: OpenWorkspaceFileInput) => {
      const internalTarget = fileViewer === "internal" ? resolveFileViewerRequest(input) : null;
      if (internalTarget) {
        openFileViewer(internalTarget);
        return;
      }

      const api = readLocalApi();
      if (!api) {
        throw new Error("Open file is unavailable");
      }

      await openInPreferredEditor(api, input.targetPath);
    },
    [fileViewer],
  );
}
