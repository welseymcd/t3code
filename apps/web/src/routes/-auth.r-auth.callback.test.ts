import { describe, expect, it, vi } from "vitest";

import { resolveRAuthCallbackRedirectUrl } from "./auth.r-auth.callback";

describe("resolveRAuthCallbackRedirectUrl", () => {
  it("submits the grant and returns to the original route", async () => {
    const submitCredential = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const writeSessionState = vi.fn();

    const nextUrl = await resolveRAuthCallbackRedirectUrl({
      search:
        "?redirectTo=http%3A%2F%2Flocalhost%3A3773%2Fsettings%2Fconnections&credential=grant-token",
      hash: "",
      fallbackOrigin: "http://localhost:3773",
      submitCredential,
      writeSessionState,
    });

    expect(submitCredential).toHaveBeenCalledWith("grant-token");
    expect(writeSessionState).toHaveBeenCalledWith(true);
    expect(nextUrl.toString()).toBe("http://localhost:3773/settings/connections");
  });

  it("returns bootstrap failures to the original route with an r-auth error", async () => {
    const submitCredential = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("This grant is for a different environment."));
    const writeSessionState = vi.fn();

    const nextUrl = await resolveRAuthCallbackRedirectUrl({
      search:
        "?redirectTo=http%3A%2F%2Flocalhost%3A3773%2Fsettings%2Fconnections&credential=grant-token",
      hash: "",
      fallbackOrigin: "http://localhost:3773",
      submitCredential,
      writeSessionState,
    });

    expect(writeSessionState).not.toHaveBeenCalled();
    expect(nextUrl.toString()).toBe(
      "http://localhost:3773/settings/connections?rAuthError=This+grant+is+for+a+different+environment.",
    );
  });

  it("returns hosted r-auth errors to the original route without marking the session signed in", async () => {
    const submitCredential = vi.fn<() => Promise<void>>();
    const writeSessionState = vi.fn();

    const nextUrl = await resolveRAuthCallbackRedirectUrl({
      search:
        "?redirectTo=http%3A%2F%2Flocalhost%3A3773%2Fsettings%2Fconnections&error=You%20are%20not%20authorized",
      hash: "",
      fallbackOrigin: "http://localhost:3773",
      submitCredential,
      writeSessionState,
    });

    expect(submitCredential).not.toHaveBeenCalled();
    expect(writeSessionState).not.toHaveBeenCalled();
    expect(nextUrl.toString()).toBe(
      "http://localhost:3773/settings/connections?rAuthError=You+are+not+authorized",
    );
  });

  it("treats callbacks without a grant as a failed sign-in", async () => {
    const submitCredential = vi.fn<() => Promise<void>>();
    const writeSessionState = vi.fn();

    const nextUrl = await resolveRAuthCallbackRedirectUrl({
      search: "?redirectTo=http%3A%2F%2Flocalhost%3A3773%2Fsettings%2Fconnections",
      hash: "",
      fallbackOrigin: "http://localhost:3773",
      submitCredential,
      writeSessionState,
    });

    expect(submitCredential).not.toHaveBeenCalled();
    expect(writeSessionState).not.toHaveBeenCalled();
    expect(nextUrl.toString()).toBe(
      "http://localhost:3773/settings/connections?rAuthError=Missing+r-auth+credential.",
    );
  });

  it("reads callback parameters from the Electron hash route", async () => {
    const submitCredential = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const writeSessionState = vi.fn();

    const nextUrl = await resolveRAuthCallbackRedirectUrl({
      search: "",
      hash: "#/auth/r-auth/callback?redirectTo=http%3A%2F%2Flocalhost%3A3773%2F%23%2Fsettings%2Fconnections&credential=grant-token",
      fallbackOrigin: "http://localhost:3773",
      submitCredential,
      writeSessionState,
    });

    expect(submitCredential).toHaveBeenCalledWith("grant-token");
    expect(writeSessionState).toHaveBeenCalledWith(true);
    expect(nextUrl.toString()).toBe("http://localhost:3773/#/settings/connections");
  });

  it("unwraps stale callback return targets before redirecting", async () => {
    const submitCredential = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const writeSessionState = vi.fn();
    const staleCallbackUrl = new URL("http://localhost:3773/auth/r-auth/callback");
    staleCallbackUrl.searchParams.set("redirectTo", "http://localhost:3773/#/settings/connections");
    staleCallbackUrl.searchParams.set("credential", "stale-token");

    const nextUrl = await resolveRAuthCallbackRedirectUrl({
      search: `?redirectTo=${encodeURIComponent(staleCallbackUrl.toString())}&credential=grant-token`,
      hash: "#/settings/connections",
      fallbackOrigin: "http://localhost:3773",
      submitCredential,
      writeSessionState,
    });

    expect(submitCredential).toHaveBeenCalledWith("grant-token");
    expect(nextUrl.toString()).toBe("http://localhost:3773/#/settings/connections");
  });
});
