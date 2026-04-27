import { afterEach, describe, expect, it, vi } from "vitest";

import {
  claimAuthorizedT3Server,
  fetchAuthorizedT3Servers,
  registerAuthorizedT3Server,
} from "./api";

describe("r-auth api", () => {
  afterEach(() => {
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
