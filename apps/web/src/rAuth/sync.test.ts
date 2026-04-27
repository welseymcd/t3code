import { EnvironmentId, type LocalApi } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchRAuthSession = vi.fn();
const mockFetchAuthorizedT3Servers = vi.fn();

vi.mock("./api", () => ({
  RAuthHttpError: class RAuthHttpError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  fetchRAuthSession: mockFetchRAuthSession,
  fetchAuthorizedT3Servers: mockFetchAuthorizedT3Servers,
  issueAuthorizedT3ServerGrant: vi.fn(),
}));

describe("r-auth environment sync", () => {
  beforeEach(async () => {
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [],
          setSavedEnvironmentRegistry: async () => undefined,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
      setInterval,
      clearInterval,
    });
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      visibilityState: "visible",
    });
    const { __resetLocalApiForTests } = await import("../localApi");
    await __resetLocalApiForTests();
    mockFetchRAuthSession.mockResolvedValue(null);
    mockFetchAuthorizedT3Servers.mockResolvedValue([]);
  });

  afterEach(async () => {
    const { __resetLocalApiForTests } = await import("../localApi");
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("upserts authorized r-auth environments and removes stale synced entries", async () => {
    const { syncAuthorizedSavedEnvironments } = await import("./sync");
    const { useSavedEnvironmentRegistryStore, listSavedEnvironmentRecords } =
      await import("../environments/runtime");

    useSavedEnvironmentRegistryStore.getState().upsert({
      environmentId: EnvironmentId.make("environment-manual"),
      label: "Manual environment",
      httpBaseUrl: "https://manual.example.com/",
      wsBaseUrl: "wss://manual.example.com/",
      createdAt: "2026-04-26T00:00:00.000Z",
      lastConnectedAt: null,
      source: "manual",
      lastSyncedAt: null,
    });
    useSavedEnvironmentRegistryStore.getState().upsert({
      environmentId: EnvironmentId.make("environment-stale"),
      label: "Stale synced environment",
      httpBaseUrl: "https://stale.example.com/",
      wsBaseUrl: "wss://stale.example.com/",
      createdAt: "2026-04-26T00:00:00.000Z",
      lastConnectedAt: null,
      source: "r-auth",
      lastSyncedAt: "2026-04-26T00:00:00.000Z",
    });

    mockFetchRAuthSession.mockResolvedValue({
      user: {
        id: "user_1",
        email: "ross@example.com",
        name: "Ross",
      },
      session: {
        id: "session_1",
        userId: "user_1",
        expiresAt: "2026-05-01T00:00:00.000Z",
      },
    });
    mockFetchAuthorizedT3Servers.mockResolvedValue([
      {
        environmentId: "environment-synced",
        label: "Synced environment",
        httpBaseUrl: "https://synced.example.com/",
        wsBaseUrl: "wss://synced.example.com/",
        role: "owner",
        authorizedAt: "2026-04-26T00:00:00.000Z",
      },
    ]);

    await syncAuthorizedSavedEnvironments();

    expect(listSavedEnvironmentRecords()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          environmentId: EnvironmentId.make("environment-manual"),
          source: "manual",
        }),
        expect.objectContaining({
          environmentId: EnvironmentId.make("environment-synced"),
          source: "r-auth",
        }),
      ]),
    );
    expect(
      listSavedEnvironmentRecords().some((record) => record.environmentId === "environment-stale"),
    ).toBe(false);
  });

  it("marks the sync state as signed out when no r-auth session exists", async () => {
    const { syncAuthorizedSavedEnvironments, useRAuthSyncStore } = await import("./sync");

    mockFetchRAuthSession.mockResolvedValue(null);

    await syncAuthorizedSavedEnvironments();

    expect(useRAuthSyncStore.getState().sessionState).toBe("signed-out");
    expect(useRAuthSyncStore.getState().user).toBeNull();
  });
});
