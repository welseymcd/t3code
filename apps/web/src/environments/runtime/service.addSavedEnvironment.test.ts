import { DEFAULT_SERVER_SETTINGS, EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveRemotePairingTarget = vi.fn();
const mockFetchRemoteEnvironmentDescriptor = vi.fn();
const mockFetchRemoteSessionState = vi.fn();
const mockBootstrapRemoteBearerSession = vi.fn();
const mockPersistSavedEnvironmentRecord = vi.fn();
const mockWriteSavedEnvironmentBearerToken = vi.fn();
const mockSetSavedEnvironmentRegistry = vi.fn();
const mockUpsert = vi.fn();
const mockListSavedEnvironmentRecords = vi.fn();
const mockGetSavedEnvironmentRecord = vi.fn();
const mockGetSavedEnvironmentRuntimeState = vi.fn();
const mockGetPrimaryKnownEnvironment = vi.fn();
const mockResolvePrimaryEnvironmentHttpUrl = vi.fn();
const mockClaimAuthorizedT3Server = vi.fn();
const mockRegisterAuthorizedT3Server = vi.fn();
const mockCreateEnvironmentConnection = vi.fn();

vi.mock("../remote/target", () => ({
  resolveRemotePairingTarget: mockResolveRemotePairingTarget,
}));

vi.mock("../remote/api", () => ({
  bootstrapRemoteBearerSession: mockBootstrapRemoteBearerSession,
  fetchRemoteEnvironmentDescriptor: mockFetchRemoteEnvironmentDescriptor,
  fetchRemoteSessionState: mockFetchRemoteSessionState,
  resolveRemoteWebSocketConnectionUrl: vi.fn(() => "wss://remote.example.com/ws"),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({
    persistence: {
      setSavedEnvironmentRegistry: mockSetSavedEnvironmentRegistry,
    },
  }),
}));

vi.mock("../../rAuth/api", () => ({
  claimAuthorizedT3Server: mockClaimAuthorizedT3Server,
  issueAuthorizedT3ServerGrant: vi.fn(),
  registerAuthorizedT3Server: mockRegisterAuthorizedT3Server,
}));

vi.mock("../primary", () => ({
  getPrimaryKnownEnvironment: mockGetPrimaryKnownEnvironment,
  resolvePrimaryEnvironmentHttpUrl: mockResolvePrimaryEnvironmentHttpUrl,
}));

vi.mock("./catalog", () => ({
  getSavedEnvironmentRecord: mockGetSavedEnvironmentRecord,
  getSavedEnvironmentRuntimeState: mockGetSavedEnvironmentRuntimeState,
  hasSavedEnvironmentRegistryHydrated: vi.fn(),
  listSavedEnvironmentRecords: mockListSavedEnvironmentRecords,
  persistSavedEnvironmentRecord: mockPersistSavedEnvironmentRecord,
  readSavedEnvironmentBearerToken: vi.fn(),
  removeSavedEnvironmentBearerToken: vi.fn(),
  useSavedEnvironmentRegistryStore: {
    getState: () => ({
      upsert: mockUpsert,
      remove: vi.fn(),
      markConnected: vi.fn(),
    }),
  },
  useSavedEnvironmentRuntimeStore: {
    getState: () => ({
      ensure: vi.fn(),
      patch: vi.fn(),
      clear: vi.fn(),
    }),
  },
  waitForSavedEnvironmentRegistryHydration: vi.fn(),
  writeSavedEnvironmentBearerToken: mockWriteSavedEnvironmentBearerToken,
}));

vi.mock("./connection", () => ({
  createEnvironmentConnection: mockCreateEnvironmentConnection,
}));

vi.mock("../../rpc/wsRpcClient", () => ({
  createWsRpcClient: vi.fn(() => ({
    server: {
      getConfig: vi.fn(async () => ({
        environment: {
          environmentId: EnvironmentId.make("environment-1"),
          label: "Remote environment",
          platform: {
            os: "linux",
            arch: "x64",
          },
          serverVersion: "0.0.0-test",
          capabilities: {
            repositoryIdentity: true,
          },
        },
        auth: {
          policy: "remote",
          bootstrapMethods: ["bearer-token"],
          sessionMethods: ["bearer-session-token"],
          sessionCookieName: "t3_session",
        },
        cwd: "/tmp/workspace",
        keybindingsConfigPath: "/tmp/workspace/keybindings.json",
        keybindings: [],
        issues: [],
        providers: [],
        availableEditors: [],
        observability: {
          logsDirectoryPath: "/tmp/logs",
          localTracingEnabled: false,
          otlpTracesEnabled: false,
          otlpMetricsEnabled: false,
        },
        settings: DEFAULT_SERVER_SETTINGS,
      })),
    },
  })),
}));

vi.mock("../../rpc/wsTransport", () => ({
  WsTransport: vi.fn(),
}));

describe("addSavedEnvironment", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockResolveRemotePairingTarget.mockReturnValue({
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      credential: "pairing-code",
    });
    mockFetchRemoteEnvironmentDescriptor.mockResolvedValue({
      environmentId: EnvironmentId.make("environment-1"),
      label: "Remote environment",
    });
    mockBootstrapRemoteBearerSession.mockResolvedValue({
      sessionToken: "bearer-token",
      role: "owner",
    });
    mockFetchRemoteSessionState.mockResolvedValue({
      authenticated: true,
      role: "owner",
    });
    mockPersistSavedEnvironmentRecord.mockResolvedValue(undefined);
    mockWriteSavedEnvironmentBearerToken.mockResolvedValue(false);
    mockSetSavedEnvironmentRegistry.mockResolvedValue(undefined);
    mockListSavedEnvironmentRecords.mockReturnValue([]);
    mockGetSavedEnvironmentRecord.mockReturnValue(null);
    mockGetSavedEnvironmentRuntimeState.mockReturnValue(null);
    mockGetPrimaryKnownEnvironment.mockReturnValue(null);
    mockResolvePrimaryEnvironmentHttpUrl.mockReturnValue(
      "https://code.example.com/api/auth/r-auth/claim-proof",
    );
    mockClaimAuthorizedT3Server.mockResolvedValue(null);
    mockRegisterAuthorizedT3Server.mockResolvedValue(null);
    mockCreateEnvironmentConnection.mockReturnValue({
      environmentId: EnvironmentId.make("environment-1"),
      ensureBootstrapped: vi.fn(),
      reconnect: vi.fn(),
      dispose: vi.fn(),
      kind: "saved",
    });
  });

  it("rolls back persisted metadata when bearer token persistence fails", async () => {
    const { addSavedEnvironment, resetEnvironmentServiceForTests } = await import("./service");

    await expect(
      addSavedEnvironment({
        label: "Remote environment",
        host: "remote.example.com",
        pairingCode: "123456",
      }),
    ).rejects.toThrow("Unable to persist saved environment credentials.");

    expect(mockPersistSavedEnvironmentRecord).toHaveBeenCalledTimes(1);
    expect(mockWriteSavedEnvironmentBearerToken).toHaveBeenCalledWith(
      EnvironmentId.make("environment-1"),
      "bearer-token",
    );
    expect(mockSetSavedEnvironmentRegistry).toHaveBeenCalledWith([]);
    expect(mockUpsert).not.toHaveBeenCalled();

    await resetEnvironmentServiceForTests();
  });

  it("registers successfully paired environments with r-auth", async () => {
    mockWriteSavedEnvironmentBearerToken.mockResolvedValue(true);
    const { addSavedEnvironment, resetEnvironmentServiceForTests } = await import("./service");

    await addSavedEnvironment({
      label: "Remote environment",
      host: "remote.example.com",
      pairingCode: "123456",
    });

    expect(mockRegisterAuthorizedT3Server).toHaveBeenCalledWith({
      environmentId: EnvironmentId.make("environment-1"),
      label: "Remote environment",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      role: "owner",
    });

    await resetEnvironmentServiceForTests();
  });

  it("registers an existing saved environment with r-auth", async () => {
    mockGetSavedEnvironmentRecord.mockReturnValue({
      environmentId: EnvironmentId.make("environment-1"),
      label: "Remote environment",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2036-04-07T00:00:00.000Z",
      lastConnectedAt: "2036-04-07T00:01:00.000Z",
      source: "manual",
      lastSyncedAt: null,
    });
    mockGetSavedEnvironmentRuntimeState.mockReturnValue({
      connectionState: "connected",
      authState: "authenticated",
      lastError: null,
      lastErrorAt: null,
      role: "owner",
      descriptor: null,
      serverConfig: null,
      connectedAt: "2036-04-07T00:01:00.000Z",
      disconnectedAt: null,
    });
    mockRegisterAuthorizedT3Server.mockResolvedValue({
      environmentId: EnvironmentId.make("environment-1"),
      label: "Remote environment",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      role: "owner",
      authorizedAt: "2036-04-07T00:02:00.000Z",
    });

    const { registerSavedEnvironmentWithRAuth, resetEnvironmentServiceForTests } =
      await import("./service");

    await registerSavedEnvironmentWithRAuth(EnvironmentId.make("environment-1"));

    expect(mockRegisterAuthorizedT3Server).toHaveBeenCalledWith({
      environmentId: EnvironmentId.make("environment-1"),
      label: "Remote environment",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      role: "owner",
    });

    await resetEnvironmentServiceForTests();
  });

  it("requires an r-auth session when registering an existing saved environment", async () => {
    mockGetSavedEnvironmentRecord.mockReturnValue({
      environmentId: EnvironmentId.make("environment-1"),
      label: "Remote environment",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2036-04-07T00:00:00.000Z",
      lastConnectedAt: null,
      source: "manual",
      lastSyncedAt: null,
    });
    mockRegisterAuthorizedT3Server.mockResolvedValue(null);

    const { registerSavedEnvironmentWithRAuth, resetEnvironmentServiceForTests } =
      await import("./service");

    await expect(
      registerSavedEnvironmentWithRAuth(EnvironmentId.make("environment-1")),
    ).rejects.toThrow("Sign in to r-auth before saving this environment.");

    await resetEnvironmentServiceForTests();
  });

  it("registers the current backend with r-auth", async () => {
    mockGetPrimaryKnownEnvironment.mockReturnValue({
      id: "environment-local",
      label: "Current backend",
      source: "window-origin",
      environmentId: EnvironmentId.make("environment-local"),
      target: {
        httpBaseUrl: "https://code.example.com/",
        wsBaseUrl: "wss://code.example.com/",
      },
    });
    mockClaimAuthorizedT3Server.mockResolvedValue({
      environmentId: EnvironmentId.make("environment-local"),
      label: "Current backend",
      httpBaseUrl: "https://code.example.com/",
      wsBaseUrl: "wss://code.example.com/",
      role: "owner",
      authorizedAt: "2036-04-07T00:02:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: true,
          proof: "claim-proof",
        }),
      ),
    );

    const { registerPrimaryEnvironmentWithRAuth, resetEnvironmentServiceForTests } =
      await import("./service");

    await registerPrimaryEnvironmentWithRAuth({ role: "owner" });

    expect(fetch).toHaveBeenCalledWith(
      "https://code.example.com/api/auth/r-auth/claim-proof",
      expect.objectContaining({
        body: JSON.stringify({
          environmentId: EnvironmentId.make("environment-local"),
          label: "Current backend",
          httpBaseUrl: "https://code.example.com/",
          wsBaseUrl: "wss://code.example.com/",
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(mockClaimAuthorizedT3Server).toHaveBeenCalledWith({
      proof: "claim-proof",
    });

    await resetEnvironmentServiceForTests();
    vi.unstubAllGlobals();
  });

  it("requires an r-auth session when registering the current backend", async () => {
    mockGetPrimaryKnownEnvironment.mockReturnValue({
      id: "environment-local",
      label: "Current backend",
      source: "window-origin",
      environmentId: EnvironmentId.make("environment-local"),
      target: {
        httpBaseUrl: "https://code.example.com/",
        wsBaseUrl: "wss://code.example.com/",
      },
    });
    mockClaimAuthorizedT3Server.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: true,
          proof: "claim-proof",
        }),
      ),
    );

    const { registerPrimaryEnvironmentWithRAuth, resetEnvironmentServiceForTests } =
      await import("./service");

    await expect(registerPrimaryEnvironmentWithRAuth({ role: "owner" })).rejects.toThrow(
      "Sign in to r-auth before saving this backend.",
    );

    await resetEnvironmentServiceForTests();
    vi.unstubAllGlobals();
  });
});
