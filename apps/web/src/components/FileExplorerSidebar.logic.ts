export type FileExplorerErrorKind = "unsupported" | "interrupted" | "generic";

export interface FileExplorerErrorPresentation {
  readonly kind: FileExplorerErrorKind;
  readonly title: string;
  readonly description: string;
  readonly canRetry: boolean;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

export function isUnsupportedProjectFilesBackend(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("projects.listdirectory") ||
    message.includes("projects.readfile") ||
    message.includes("method not found") ||
    message.includes("no such method") ||
    message.includes("unknown rpc")
  );
}

export function isTransientExplorerInterruption(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("interrupted") ||
    message.includes("connection") ||
    message.includes("websocket") ||
    message.includes("reconnect") ||
    message.includes("closed before")
  );
}

export function presentFileExplorerError(error: unknown): FileExplorerErrorPresentation {
  if (isUnsupportedProjectFilesBackend(error)) {
    return {
      kind: "unsupported",
      title: "File explorer unavailable",
      description: "The connected backend does not support workspace file browsing yet.",
      canRetry: false,
    };
  }

  if (isTransientExplorerInterruption(error)) {
    return {
      kind: "interrupted",
      title: "Connection interrupted",
      description: "Reconnect and refresh the file explorer.",
      canRetry: true,
    };
  }

  return {
    kind: "generic",
    title: "Could not load files",
    description: errorMessage(error) || "The workspace directory could not be read.",
    canRetry: true,
  };
}

export function shouldRefreshExplorerOnReconnect(input: {
  readonly enabled: boolean;
  readonly hasLoaded: boolean;
  readonly hasError: boolean;
}): boolean {
  return input.enabled && (input.hasLoaded || input.hasError);
}
