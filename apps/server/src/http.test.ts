import { describe, expect, it } from "vitest";

import {
  isLoopbackHostname,
  resolveDevRedirectUrl,
  resolveRAuthDashboardAbsoluteTargetUrl,
  resolveRAuthProxyTargetUrl,
  rewriteRAuthProxyRequestJsonBody,
  rewriteRAuthProxyLocation,
  rewriteRAuthProxyTextContent,
} from "./http.ts";

describe("http dev routing", () => {
  it("treats localhost and loopback addresses as local", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("does not treat LAN addresses as local", () => {
    expect(isLoopbackHostname("192.168.86.35")).toBe(false);
    expect(isLoopbackHostname("10.0.0.24")).toBe(false);
    expect(isLoopbackHostname("example.local")).toBe(false);
  });

  it("preserves path and query when redirecting to the dev server", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("http://127.0.0.1:3774/pair?token=test-token");

    expect(resolveDevRedirectUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/pair?token=test-token",
    );
  });

  it("maps same-origin r-auth proxy paths to the configured issuer", () => {
    expect(
      resolveRAuthProxyTargetUrl(
        { rAuthIssuer: "https://auth.example.com" },
        "/api/r-auth/rest/v1/auth/session",
        "?include=user",
      ),
    ).toBe("https://auth.example.com/rest/v1/auth/session?include=user");
  });

  it("maps same-origin r-auth login paths to the configured issuer", () => {
    expect(
      resolveRAuthProxyTargetUrl(
        { rAuthIssuer: "https://auth.example.com" },
        "/api/r-auth/dashboard",
        "?redirectTo=http%3A%2F%2F127.0.0.1%3A3773%2Fsettings%2Fconnections",
      ),
    ).toBe(
      "https://auth.example.com/dashboard?redirectTo=http%3A%2F%2F127.0.0.1%3A3773%2Fsettings%2Fconnections",
    );
  });

  it("maps r-auth dashboard assets to the configured issuer", () => {
    expect(
      resolveRAuthProxyTargetUrl(
        { rAuthIssuer: "https://auth.example.com" },
        "/api/r-auth/dashboard/assets/index.js",
      ),
    ).toBe("https://auth.example.com/dashboard/assets/index.js");
  });

  it("maps documented r-auth health and tRPC paths to the configured issuer", () => {
    expect(
      resolveRAuthProxyTargetUrl(
        { rAuthIssuer: "https://auth.example.com" },
        "/api/r-auth/trpc/session.current",
      ),
    ).toBe("https://auth.example.com/trpc/session.current");
    expect(
      resolveRAuthProxyTargetUrl(
        { rAuthIssuer: "https://auth.example.com" },
        "/api/r-auth/rest/v1/health",
      ),
    ).toBe("https://auth.example.com/rest/v1/health");
  });

  it("maps dashboard absolute Better Auth paths to the configured issuer", () => {
    expect(
      resolveRAuthDashboardAbsoluteTargetUrl(
        { rAuthIssuer: "https://auth.example.com" },
        "/api/auth/get-session",
      ),
    ).toBe("https://auth.example.com/api/auth/get-session");
    expect(
      resolveRAuthDashboardAbsoluteTargetUrl(
        { rAuthIssuer: "https://auth.example.com" },
        "/dashboard/assets/login.js",
      ),
    ).toBe("https://auth.example.com/dashboard/assets/login.js");
  });

  it("rewrites same-issuer r-auth redirects back through the local proxy", () => {
    expect(
      rewriteRAuthProxyLocation(
        { rAuthIssuer: "https://auth.example.com" },
        "https://auth.example.com/dashboard?tab=t3",
        "http://127.0.0.1:3773",
      ),
    ).toBe("http://127.0.0.1:3773/api/r-auth/dashboard?tab=t3");
  });

  it("normalizes accidental proxied r-auth redirects before rewriting to the local proxy", () => {
    expect(
      rewriteRAuthProxyLocation(
        { rAuthIssuer: "https://auth.example.com" },
        "https://auth.example.com/api/r-auth/dashboard/?tab=t3",
        "http://127.0.0.1:3773",
      ),
    ).toBe("http://127.0.0.1:3773/api/r-auth/dashboard/?tab=t3");
  });

  it("normalizes proxied callback URLs in r-auth request bodies before forwarding upstream", () => {
    expect(
      rewriteRAuthProxyRequestJsonBody(
        {
          callbackURL: "http://127.0.0.1:3773/api/r-auth/dashboard/?tab=t3",
          nested: {
            next: "/api/r-auth/dashboard?redirectTo=http%3A%2F%2F127.0.0.1%3A3773%2Fsettings",
          },
        },
        "https://auth.example.com",
      ),
    ).toEqual({
      callbackURL: "https://auth.example.com/dashboard/?tab=t3",
      nested: {
        next: "/dashboard?redirectTo=http%3A%2F%2F127.0.0.1%3A3773%2Fsettings",
      },
    });
  });

  it("rewrites r-auth dashboard asset and API paths through the local proxy", () => {
    expect(
      rewriteRAuthProxyTextContent(
        `<script src="/dashboard/assets/app.js"></script><script>fetch("/api/auth/session");fetch("/trpc/session.current")</script><link href="/vite.svg">`,
      ),
    ).toBe(
      `<script src="/api/r-auth/dashboard/assets/app.js"></script><script>fetch("/api/r-auth/api/auth/session");fetch("/api/r-auth/trpc/session.current")</script><link href="/api/r-auth/vite.svg">`,
    );
  });

  it("rejects non r-auth proxy paths", () => {
    expect(
      resolveRAuthProxyTargetUrl(
        { rAuthIssuer: "https://auth.example.com" },
        "/api/r-auth/rest/v1/admin/users",
      ),
    ).toBeNull();
  });
});
