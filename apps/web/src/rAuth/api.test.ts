import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDesktopRAuthCallbackUrl,
  buildRAuthLoginUrl,
  claimAuthorizedT3Server,
  fetchAuthorizedT3Servers,
  registerAuthorizedT3Server,
} from "./api";

describe("r-auth api", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the same-origin r-auth proxy by default", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, servers: [] }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });

    await expect(fetchAuthorizedT3Servers()).resolves.toEqual([]);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/r-auth/rest/v1/t3/servers",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
  });

  it("builds login URLs through the same-origin r-auth proxy", () => {
    vi.stubGlobal("window", {
      location: {
        href: "http://localhost:3000/settings/connections",
        origin: "http://localhost:3000",
      },
    });

    expect(buildRAuthLoginUrl()).toBe(
      "http://localhost:3000/api/r-auth/dashboard?redirectTo=http%3A%2F%2Flocalhost%3A3000%2Fsettings%2Fconnections",
    );
  });

  it("strips the local proxy prefix from configured external r-auth login URLs", () => {
    vi.stubEnv("VITE_R_AUTH_URL", "https://auth.rmcd.cc/api/r-auth");
    vi.stubGlobal("window", {
      location: {
        href: "http://localhost:3000/settings/connections",
        origin: "http://localhost:3000",
      },
    });

    expect(buildRAuthLoginUrl()).toBe(
      "https://auth.rmcd.cc/dashboard?redirectTo=http%3A%2F%2Flocalhost%3A3000%2Fsettings%2Fconnections",
    );
  });

  it("keeps desktop r-auth requests on the current origin", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, servers: [] }));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VITE_R_AUTH_URL", "https://auth.rmcd.cc/api/r-auth");
    vi.stubGlobal("window", {
      location: {
        href: "http://localhost:5734/settings/connections",
        origin: "http://localhost:5734",
      },
      desktopBridge: {
        getLocalEnvironmentBootstrap: () => ({
          label: "Local environment",
          httpBaseUrl: "http://127.0.0.1:3773",
          wsBaseUrl: "ws://127.0.0.1:3773",
          bootstrapToken: "desktop-bootstrap-token",
        }),
      },
    });

    await expect(fetchAuthorizedT3Servers()).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5734/api/r-auth/rest/v1/t3/servers",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
    expect(buildRAuthLoginUrl(buildDesktopRAuthCallbackUrl("environment-test"))).toBe(
      "https://auth.rmcd.cc/dashboard?redirectTo=t3%3A%2F%2Fauth%2Fr-auth%2Fcallback%3FenvironmentId%3Denvironment-test",
    );
  });

  it("treats a missing r-auth T3 servers endpoint as no authorized servers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not Found", { status: 404 })),
    );
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });

    await expect(fetchAuthorizedT3Servers()).resolves.toEqual([]);
  });

  it("registers authorized T3 servers through the same-origin proxy", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        ok: true,
        server: {
          environmentId: "environment-1",
          label: "Remote environment",
          httpBaseUrl: "https://remote.example.com/",
          wsBaseUrl: "wss://remote.example.com/",
          role: "owner",
          authorizedAt: "2026-04-26T00:00:00.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });

    await expect(
      registerAuthorizedT3Server({
        environmentId: "environment-1",
        label: "Remote environment",
        httpBaseUrl: "https://remote.example.com/",
        wsBaseUrl: "wss://remote.example.com/",
        role: "owner",
      }),
    ).resolves.toMatchObject({
      environmentId: "environment-1",
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/r-auth/rest/v1/t3/servers",
      expect.objectContaining({
        body: JSON.stringify({
          environmentId: "environment-1",
          label: "Remote environment",
          httpBaseUrl: "https://remote.example.com/",
          wsBaseUrl: "wss://remote.example.com/",
          role: "owner",
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
  });

  it("claims authorized T3 servers through the same-origin proxy", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        ok: true,
        server: {
          environmentId: "environment-1",
          label: "Remote environment",
          httpBaseUrl: "https://remote.example.com/",
          wsBaseUrl: "wss://remote.example.com/",
          role: "owner",
          authorizedAt: "2026-04-26T00:00:00.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });

    await expect(claimAuthorizedT3Server({ proof: "claim-proof" })).resolves.toMatchObject({
      environmentId: "environment-1",
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/r-auth/rest/v1/t3/servers/claim",
      expect.objectContaining({
        body: JSON.stringify({
          proof: "claim-proof",
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
  });
});
