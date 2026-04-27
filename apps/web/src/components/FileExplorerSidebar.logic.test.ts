import { describe, expect, it } from "vitest";

import {
  isUnsupportedDirectoryListingError,
  resolveFileExplorerErrorPresentation,
  shouldAutoRefreshFileExplorerOnReconnect,
} from "./FileExplorerSidebar.logic";

describe("FileExplorerSidebar.logic", () => {
  it("recognizes unsupported directory listing errors", () => {
    expect(
      isUnsupportedDirectoryListingError(new Error("Unknown request tag: projects.listDirectory")),
    ).toBe(true);
  });

  it("softens transport failures while reconnecting", () => {
    expect(
      resolveFileExplorerErrorPresentation({
        connectionUiState: "reconnecting",
        error: new Error("SocketCloseError: 1006"),
      }),
    ).toEqual({
      message:
        "Connection interrupted while loading files. The explorer will refresh once T3 Code reconnects.",
      tone: "warning",
    });
  });

  it("softens interrupted effect errors after disconnects", () => {
    expect(
      resolveFileExplorerErrorPresentation({
        connectionUiState: "reconnecting",
        error: new Error("All fibers interrupted without error"),
      }),
    ).toEqual({
      message:
        "Connection interrupted while loading files. The explorer will refresh once T3 Code reconnects.",
      tone: "warning",
    });
  });

  it("asks for a manual sync when an interruption happens while connected", () => {
    expect(
      resolveFileExplorerErrorPresentation({
        connectionUiState: "connected",
        error: new Error("All fibers interrupted without error"),
      }),
    ).toEqual({
      message: "Loading files was interrupted. Sync the explorer to try again.",
      tone: "warning",
    });
  });

  it("preserves non-transport errors", () => {
    expect(
      resolveFileExplorerErrorPresentation({
        connectionUiState: "connected",
        error: new Error("Permission denied"),
      }),
    ).toEqual({
      message: "Permission denied",
      tone: "error",
    });
  });

  it("auto-refreshes after reconnecting into a live workspace", () => {
    expect(
      shouldAutoRefreshFileExplorerOnReconnect({
        nextConnectionUiState: "connected",
        previousConnectionUiState: "reconnecting",
        workspaceRoot: "/repo/project",
      }),
    ).toBe(true);
  });

  it("does not auto-refresh without a workspace root", () => {
    expect(
      shouldAutoRefreshFileExplorerOnReconnect({
        nextConnectionUiState: "connected",
        previousConnectionUiState: "reconnecting",
        workspaceRoot: undefined,
      }),
    ).toBe(false);
  });
});
