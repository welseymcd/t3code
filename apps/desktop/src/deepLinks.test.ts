import { describe, expect, it } from "vitest";

import { findDesktopDeepLinkArg, resolveDesktopDeepLinkRouteUrl } from "./deepLinks.ts";

describe("resolveDesktopDeepLinkRouteUrl", () => {
  it("loads the callback on the same loopback origin as redirectTo", () => {
    expect(
      resolveDesktopDeepLinkRouteUrl({
        deepLinkUrl:
          "t3://auth/r-auth/callback?redirectTo=http%3A%2F%2Flocalhost%3A3773%2Fsettings%2Fconnections",
        fallbackRootUrl: "http://127.0.0.1:3773/",
      }),
    ).toBe(
      "http://localhost:3773/auth/r-auth/callback?redirectTo=http%3A%2F%2Flocalhost%3A3773%2Fsettings%2Fconnections",
    );
  });

  it("falls back to the desktop root for non-loopback redirect origins", () => {
    expect(
      resolveDesktopDeepLinkRouteUrl({
        deepLinkUrl:
          "t3://auth/r-auth/callback?redirectTo=https%3A%2F%2Fexample.com%2Fsettings%2Fconnections",
        fallbackRootUrl: "http://127.0.0.1:3773/",
      }),
    ).toBe(
      "http://127.0.0.1:3773/auth/r-auth/callback?redirectTo=https%3A%2F%2Fexample.com%2Fsettings%2Fconnections",
    );
  });

  it("falls back to the desktop root when the loopback port does not match", () => {
    expect(
      resolveDesktopDeepLinkRouteUrl({
        deepLinkUrl:
          "t3://auth/r-auth/callback?redirectTo=http%3A%2F%2Flocalhost%3A5173%2Fsettings%2Fconnections",
        fallbackRootUrl: "http://127.0.0.1:3773/",
      }),
    ).toBe(
      "http://127.0.0.1:3773/auth/r-auth/callback?redirectTo=http%3A%2F%2Flocalhost%3A5173%2Fsettings%2Fconnections",
    );
  });

  it("ignores unsupported deep links", () => {
    expect(
      resolveDesktopDeepLinkRouteUrl({
        deepLinkUrl: "t3://workspace/open?path=%2Ftmp",
        fallbackRootUrl: "http://127.0.0.1:3773/",
      }),
    ).toBe(null);
  });
});

describe("findDesktopDeepLinkArg", () => {
  it("finds the t3 protocol argv entry", () => {
    expect(findDesktopDeepLinkArg(["/Applications/T3.app", "t3://auth/r-auth/callback"])).toBe(
      "t3://auth/r-auth/callback",
    );
  });
});
