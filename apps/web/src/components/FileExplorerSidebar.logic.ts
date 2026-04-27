import type { WsConnectionUiState } from "../rpc/wsConnectionState";
import {
  isTransportConnectionErrorMessage,
  isTransientRpcInterruptionMessage,
} from "../rpc/transportError";

export interface FileExplorerErrorPresentation {
  readonly message: string;
  readonly tone: "error" | "warning";
}

const UNSUPPORTED_DIRECTORY_LISTING_MESSAGE = "Unknown request tag: projects.listDirectory";

function describeQueryError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }
  return "Could not load this directory.";
}

export function isUnsupportedDirectoryListingError(error: unknown): boolean {
  return describeQueryError(error).includes(UNSUPPORTED_DIRECTORY_LISTING_MESSAGE);
}

export function resolveFileExplorerErrorPresentation(input: {
  readonly connectionUiState: WsConnectionUiState;
  readonly error: unknown;
}): FileExplorerErrorPresentation {
  const message = describeQueryError(input.error);

  if (isTransportConnectionErrorMessage(message)) {
    return {
      message:
        input.connectionUiState === "offline"
          ? "Connection lost while loading files. The explorer will refresh when the network returns."
          : "Connection interrupted while loading files. The explorer will refresh once T3 Code reconnects.",
      tone: "warning",
    };
  }

  if (isTransientRpcInterruptionMessage(message)) {
    return {
      message:
        input.connectionUiState === "connected"
          ? "Loading files was interrupted. Sync the explorer to try again."
          : "Connection interrupted while loading files. The explorer will refresh once T3 Code reconnects.",
      tone: "warning",
    };
  }

  return {
    message,
    tone: "error",
  };
}

export function shouldAutoRefreshFileExplorerOnReconnect(input: {
  readonly nextConnectionUiState: WsConnectionUiState;
  readonly previousConnectionUiState: WsConnectionUiState;
  readonly workspaceRoot: string | undefined;
}): boolean {
  return Boolean(
    input.workspaceRoot &&
    input.nextConnectionUiState === "connected" &&
    input.previousConnectionUiState !== "connected",
  );
}
