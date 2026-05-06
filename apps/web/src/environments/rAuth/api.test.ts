import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnvironmentId } from "@t3tools/contracts";
import { writeBrowserSavedEnvironmentRegistry } from "../../clientPersistenceStorage";
import {
  __resetRAuthClientForTests,
  fetchRAuthSessionState,
  isRAuthHttpError,
  listRAuthAuthorizedEnvironments,
  openRAuthSignInWindow,
  requestRAuthGrant,
  resolveRAuthBaseUrl,
  resolveRAuthLoginUrl,
  signOutRAuth,
} from "./api";
import { writeBrowserRAuthSessionState } from "../../clientPersistenceStorage";

function installTestBrowser(url = "http://localhost/") {
  vi.stubGlobal("window", {
    location: new URL(url),
    open: vi.fn(),
  });
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    status: 200,
    ...init,
  });
}

describe("rAuth api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installTestBrowser();
  });

  afterEach(() => {
    writeBrowserSavedEnvironmentRegistry([]);
    writeBrowserRAuthSessionState(false);
    __resetRAuthClientForTests();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("defaults the auth ui base url to the hosted r-auth app", () => {
    expect(resolveRAuthBaseUrl()).toBe("https://auth.rmcd.cc/");
  });

  it("defaults the auth sign-in url to the hosted API T3 auth route", () => {
    expect(resolveRAuthLoginUrl()).toBe(
      "https://auth.rmcd.cc/api/t3/auth?redirectTo=t3code%3A%2F%2Fauth%2Fr-auth%2Fcallback%3FredirectTo%3Dhttp%253A%252F%252Flocalhost%252F",
    );
  });

  it("opens the hosted r-auth sign-in window", () => {
    const openMock = vi.mocked(window.open);
    openRAuthSignInWindow();

    expect(openMock).toHaveBeenCalledWith(
      "https://auth.rmcd.cc/api/t3/auth?redirectTo=t3code%3A%2F%2Fauth%2Fr-auth%2Fcallback%3FredirectTo%3Dhttp%253A%252F%252Flocalhost%252F",
      "r-auth-sign-in",
      "popup,width=720,height=840",
    );
  });

  it("opens the hosted r-auth sign-in window with an explicit return target", () => {
    const openMock = vi.mocked(window.open);

    openRAuthSignInWindow("http://localhost/settings/connections");

    expect(openMock).toHaveBeenCalledWith(
      "https://auth.rmcd.cc/api/t3/auth?redirectTo=t3code%3A%2F%2Fauth%2Fr-auth%2Fcallback%3FredirectTo%3Dhttp%253A%252F%252Flocalhost%252Fsettings%252Fconnections",
      "r-auth-sign-in",
      "popup,width=720,height=840",
    );
  });

  it("uses the hosted T3 authorize route when an environment is provided", () => {
    expect(
      resolveRAuthLoginUrl(undefined, "http://localhost/pair", {
        environmentId: "environment-123",
        claimProof: "proof.token",
      }),
    ).toBe(
      "https://auth.rmcd.cc/dashboard/t3/authorize?redirectTo=t3code%3A%2F%2Fauth%2Fr-auth%2Fcallback%3FredirectTo%3Dhttp%253A%252F%252Flocalhost%252Fpair%26environmentId%3Denvironment-123%26claimProof%3Dproof.token",
    );
  });

  it("preserves nested return URL query parameters in the hosted sign-in URL", () => {
    expect(
      resolveRAuthLoginUrl(undefined, "http://localhost/settings/connections?tab=auth&x=1"),
    ).toBe(
      "https://auth.rmcd.cc/api/t3/auth?redirectTo=t3code%3A%2F%2Fauth%2Fr-auth%2Fcallback%3FredirectTo%3Dhttp%253A%252F%252Flocalhost%252Fsettings%252Fconnections%253Ftab%253Dauth%2526x%253D1",
    );
  });

  it("does not reuse a stale callback URL as the hosted auth return target", () => {
    const staleCallbackUrl = new URL("http://127.0.0.1:3773/auth/r-auth/callback");
    staleCallbackUrl.searchParams.set("redirectTo", "http://127.0.0.1:3773/#/settings/connections");
    staleCallbackUrl.searchParams.set("credential", "stale-token");

    expect(
      resolveRAuthLoginUrl(undefined, staleCallbackUrl.toString(), {
        environmentId: "environment-123",
      }),
    ).toBe(
      "https://auth.rmcd.cc/dashboard/t3/authorize?redirectTo=t3code%3A%2F%2Fauth%2Fr-auth%2Fcallback%3FredirectTo%3Dhttp%253A%252F%252F127.0.0.1%253A3773%252F%2523%252Fsettings%252Fconnections%26environmentId%3Denvironment-123",
    );
  });

  it("loads the local T3 session state as the r-auth session surface", async () => {
    writeBrowserRAuthSessionState(true);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        authenticated: true,
        auth: {
          policy: "loopback-browser",
          bootstrapMethods: ["one-time-token"],
          sessionMethods: ["browser-session-cookie"],
          sessionCookieName: "t3_session",
        },
        role: "owner",
        sessionMethod: "browser-session-cookie",
        expiresAt: "2026-05-07T00:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRAuthSessionState()).resolves.toEqual({
      authenticated: true,
      auth: {
        policy: "loopback-browser",
        bootstrapMethods: ["one-time-token"],
        sessionMethods: ["browser-session-cookie"],
        sessionCookieName: "t3_session",
      },
      identity: null,
      authorizedEnvironments: [],
      expiresAt: "2026-05-07T00:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost/api/auth/session", {
      credentials: "include",
    });
  });

  it("derives the authorized r-auth environments from local saved state", async () => {
    writeBrowserRAuthSessionState(true);
    writeBrowserSavedEnvironmentRegistry([
      {
        environmentId: EnvironmentId.make("environment-123"),
        label: "Production",
        httpBaseUrl: "http://127.0.0.1:3773",
        wsBaseUrl: "ws://127.0.0.1:3773",
        createdAt: "2026-05-06T00:00:00.000Z",
        lastConnectedAt: null,
        authSource: "r-auth",
      },
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          auth: {
            policy: "loopback-browser",
            bootstrapMethods: ["one-time-token"],
            sessionMethods: ["browser-session-cookie"],
            sessionCookieName: "t3_session",
          },
          role: "owner",
          sessionMethod: "browser-session-cookie",
          expiresAt: "2026-05-07T00:00:00.000Z",
        }),
      ),
    );

    await expect(fetchRAuthSessionState()).resolves.toEqual({
      authenticated: true,
      auth: {
        policy: "loopback-browser",
        bootstrapMethods: ["one-time-token"],
        sessionMethods: ["browser-session-cookie"],
        sessionCookieName: "t3_session",
      },
      identity: null,
      authorizedEnvironments: [
        {
          environmentId: "environment-123",
          label: "Production",
          role: "owner",
          reachable: true,
        },
      ],
      expiresAt: "2026-05-07T00:00:00.000Z",
    });
  });

  it("lists authorized environments from the browser registry", async () => {
    const record = {
      environmentId: EnvironmentId.make("environment-123"),
      label: "Production",
      httpBaseUrl: "http://127.0.0.1:3773",
      wsBaseUrl: "ws://127.0.0.1:3773",
      createdAt: "2026-05-06T00:00:00.000Z",
      lastConnectedAt: null,
      authSource: "r-auth" as const,
    };

    writeBrowserSavedEnvironmentRegistry([record]);
    writeBrowserRAuthSessionState(true);

    await expect(listRAuthAuthorizedEnvironments()).resolves.toEqual([
      {
        environmentId: "environment-123",
        label: "Production",
        role: "client",
        reachable: true,
      },
    ]);
  });

  it("surfaces 401 responses as typed centralized-auth errors from the grant bridge", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ error: "Please sign in." }, { status: 401 })),
    );

    const error = await requestRAuthGrant({
      environmentId: "environment-123",
    }).catch((caught) => caught);

    expect(isRAuthHttpError(error)).toBe(true);
    if (isRAuthHttpError(error)) {
      expect(error.status).toBe(401);
      expect(error.message).toBe("Please sign in.");
    }
  });

  it("requests grants from the local bridge and ignores sign-out as a local cleanup step", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        credential: "r-auth-grant",
        expiresAt: "2026-05-07T00:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestRAuthGrant({
        environmentId: "environment-123",
      }),
    ).resolves.toEqual({
      credential: "r-auth-grant",
      expiresAt: "2026-05-07T00:00:00.000Z",
    });
    await expect(signOutRAuth()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith("http://localhost/api/auth/r-auth/grants", {
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
      body: JSON.stringify({
        environmentId: "environment-123",
      }),
    });

    await expect(listRAuthAuthorizedEnvironments()).resolves.toEqual([]);
  });
});
