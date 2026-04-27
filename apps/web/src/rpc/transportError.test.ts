import { describe, expect, it } from "vitest";

import {
  isTransportConnectionErrorMessage,
  isTransientRpcInterruptionMessage,
  sanitizeThreadErrorMessage,
} from "./transportError";

describe("transportError", () => {
  it("detects websocket transport failures", () => {
    expect(isTransportConnectionErrorMessage("SocketCloseError: 1006")).toBe(true);
    expect(isTransportConnectionErrorMessage("Unable to connect to the T3 server WebSocket.")).toBe(
      true,
    );
    expect(isTransportConnectionErrorMessage("SocketOpenError: Timeout")).toBe(true);
  });

  it("detects transient rpc interruptions", () => {
    expect(isTransientRpcInterruptionMessage("All fibers interrupted without error")).toBe(true);
    expect(isTransientRpcInterruptionMessage("Request was aborted")).toBe(true);
    expect(isTransientRpcInterruptionMessage("Turn failed")).toBe(false);
  });

  it("preserves non-transport thread errors", () => {
    expect(sanitizeThreadErrorMessage("Turn failed")).toBe("Turn failed");
    expect(sanitizeThreadErrorMessage("Select a base branch before sending.")).toBe(
      "Select a base branch before sending.",
    );
  });

  it("drops transport failures from thread surfaces", () => {
    expect(sanitizeThreadErrorMessage("SocketCloseError: 1006")).toBeNull();
  });
});
