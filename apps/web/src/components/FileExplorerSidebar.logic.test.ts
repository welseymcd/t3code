import { describe, expect, it } from "vitest";

import {
  presentFileExplorerError,
  shouldRefreshExplorerOnReconnect,
} from "./FileExplorerSidebar.logic";

describe("FileExplorerSidebar.logic", () => {
  it("presents unsupported backends clearly", () => {
    const presentation = presentFileExplorerError(
      new Error("Method not found: projects.listDirectory"),
    );

    expect(presentation.kind).toBe("unsupported");
    expect(presentation.canRetry).toBe(false);
  });

  it("presents transient interruptions as retryable", () => {
    const presentation = presentFileExplorerError(new Error("WebSocket connection interrupted"));

    expect(presentation.kind).toBe("interrupted");
    expect(presentation.canRetry).toBe(true);
  });

  it("refreshes after reconnect only when there is useful explorer state", () => {
    expect(
      shouldRefreshExplorerOnReconnect({
        enabled: true,
        hasLoaded: true,
        hasError: false,
      }),
    ).toBe(true);
    expect(
      shouldRefreshExplorerOnReconnect({
        enabled: true,
        hasLoaded: false,
        hasError: false,
      }),
    ).toBe(false);
  });
});
