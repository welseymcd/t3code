import { QueryClient } from "@tanstack/react-query";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateEnvironmentConnection = vi.fn();
const mockCreateWsRpcClient = vi.fn();
const mockBootstrapRemoteBearerSession = vi.fn();
const mockFetchRemoteSessionState = vi.fn();
const mockRequestRAuthGrant = vi.fn();
const mockWaitForSavedEnvironmentRegistryHydration = vi.fn();
const mockListSavedEnvironmentRecords = vi.fn();
const mockSavedEnvironmentRegistrySubscribe = vi.fn();
const mockReadSavedEnvironmentBearerToken = vi.fn();
const mockWriteSavedEnvironmentBearerToken = vi.fn();
const mockRemoveSavedEnvironmentBearerToken = vi.fn();
const mockPatchRuntime = vi.fn();
const mockGetSavedEnvironmentRecord = vi.fn();

function MockWsTransport() {
  return undefined;
}

vi.mock("../primary", () => ({
  getPrimaryKnownEnvironment: vi.fn(() => ({
    id: "env-1",
    label: "Primary environment",
    source: "window-origin",
    target: {
      httpBaseUrl: "http://127.0.0.1:3000/",
      wsBaseUrl: "ws://127.0.0.1:3000/",
    },
    environmentId: EnvironmentId.make("env-1"),
  })),
}));

vi.mock("../remote/api", () => ({
  bootstrapRemoteBearerSession: mockBootstrapRemoteBearerSession,
  fetchRemoteEnvironmentDescriptor: vi.fn(),
  fetchRemoteSessionState: mockFetchRemoteSessionState,
  resolveRemoteWebSocketConnectionUrl: vi.fn(() => "ws://remote.example.test"),
}));

vi.mock("../rAuth/api", () => ({
  isRAuthHttpError: vi.fn(() => false),
  requestRAuthGrant: mockRequestRAuthGrant,
}));

vi.mock("./catalog", () => ({
  getSavedEnvironmentRecord: mockGetSavedEnvironmentRecord,
  hasSavedEnvironmentRegistryHydrated: vi.fn(() => true),
  listSavedEnvironmentRecords: mockListSavedEnvironmentRecords,
  persistSavedEnvironmentRecord: vi.fn(),
  readSavedEnvironmentBearerToken: mockReadSavedEnvironmentBearerToken,
  removeSavedEnvironmentBearerToken: mockRemoveSavedEnvironmentBearerToken,
  useSavedEnvironmentRegistryStore: {
    subscribe: mockSavedEnvironmentRegistrySubscribe,
    getState: () => ({
      upsert: vi.fn(),
      remove: vi.fn(),
      markConnected: vi.fn(),
      rename: vi.fn(),
    }),
  },
  useSavedEnvironmentRuntimeStore: {
    getState: () => ({
      ensure: vi.fn(),
      patch: mockPatchRuntime,
      clear: vi.fn(),
    }),
  },
  waitForSavedEnvironmentRegistryHydration: mockWaitForSavedEnvironmentRegistryHydration,
  writeSavedEnvironmentBearerToken: mockWriteSavedEnvironmentBearerToken,
}));

vi.mock("./connection", () => ({
  createEnvironmentConnection: mockCreateEnvironmentConnection,
}));

vi.mock("../../rpc/wsRpcClient", () => ({
  createWsRpcClient: mockCreateWsRpcClient,
}));

vi.mock("../../rpc/wsTransport", () => ({
  WsTransport: MockWsTransport,
}));

vi.mock("~/composerDraftStore", () => ({
  markPromotedDraftThreadByRef: vi.fn(),
  markPromotedDraftThreadsByRef: vi.fn(),
  useComposerDraftStore: {
    getState: () => ({
      getDraftThreadByRef: vi.fn(() => null),
      clearDraftThread: vi.fn(),
    }),
  },
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: vi.fn(() => ({
    persistence: {
      setSavedEnvironmentRegistry: vi.fn(async () => undefined),
    },
  })),
}));

vi.mock("~/lib/terminalStateCleanup", () => ({
  collectActiveTerminalThreadIds: vi.fn(() => []),
}));

vi.mock("~/orchestrationEventEffects", () => ({
  deriveOrchestrationBatchEffects: vi.fn(() => ({
    promotedThreadRefs: [],
    invalidatedProviderState: false,
  })),
}));

vi.mock("~/lib/projectReactQuery", () => ({
  projectQueryKeys: {
    all: ["projects"],
  },
}));

vi.mock("~/lib/providerReactQuery", () => ({
  providerQueryKeys: {
    all: ["providers"],
  },
}));

vi.mock("~/store", () => ({
  useStore: {
    getState: () => ({
      syncServerShellSnapshot: vi.fn(),
      syncServerThreadDetail: vi.fn(),
      removeServerThreadDetail: vi.fn(),
      applyServerShellEvent: vi.fn(),
    }),
  },
  selectProjectsAcrossEnvironments: vi.fn(() => []),
  selectSidebarThreadSummaryByRef: vi.fn(() => null),
  selectThreadByRef: vi.fn(() => null),
  selectThreadsAcrossEnvironments: vi.fn(() => []),
}));

vi.mock("~/terminalStateStore", () => ({
  useTerminalStateStore: {
    getState: () => ({
      applyTerminalEvent: vi.fn(),
      removeTerminalState: vi.fn(),
      clearTerminalSelection: vi.fn(),
    }),
  },
}));

vi.mock("~/uiStateStore", () => ({
  useUiStateStore: {
    getState: () => ({
      clearThreadUi: vi.fn(),
      syncPromotedDraftThreadRefs: vi.fn(),
    }),
  },
}));

const savedRecord = {
  environmentId: EnvironmentId.make("env-saved"),
  label: "Remote environment",
  httpBaseUrl: "https://remote.example.test/",
  wsBaseUrl: "wss://remote.example.test/",
};

const configSnapshot = {
  environment: {
    environmentId: savedRecord.environmentId,
    label: "Remote environment",
  },
};

function createClient() {
  return {
    dispose: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => undefined),
    server: {
      getConfig: vi.fn(async () => configSnapshot),
      subscribeConfig: vi.fn(() => () => undefined),
      subscribeLifecycle: vi.fn(() => () => undefined),
      subscribeAuthAccess: vi.fn(() => () => undefined),
      refreshProviders: vi.fn(async () => undefined),
      upsertKeybinding: vi.fn(async () => undefined),
      getSettings: vi.fn(async () => undefined),
      updateSettings: vi.fn(async () => undefined),
    },
    orchestration: {
      subscribeShell: vi.fn(() => () => undefined),
      subscribeThread: vi.fn(() => () => undefined),
      dispatchCommand: vi.fn(async () => undefined),
      getTurnDiff: vi.fn(async () => undefined),
      getFullThreadDiff: vi.fn(async () => undefined),
    },
    terminal: {
      open: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      restart: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      onEvent: vi.fn(() => () => undefined),
    },
    projects: {
      searchEntries: vi.fn(async () => []),
      writeFile: vi.fn(async () => undefined),
    },
    shell: {
      openInEditor: vi.fn(async () => undefined),
    },
    git: {
      pull: vi.fn(async () => undefined),
      refreshStatus: vi.fn(async () => undefined),
      onStatus: vi.fn(() => () => undefined),
      runStackedAction: vi.fn(async () => ({})),
      listBranches: vi.fn(async () => []),
      createWorktree: vi.fn(async () => undefined),
      removeWorktree: vi.fn(async () => undefined),
      createBranch: vi.fn(async () => undefined),
      checkout: vi.fn(async () => undefined),
      init: vi.fn(async () => undefined),
      resolvePullRequest: vi.fn(async () => undefined),
      preparePullRequestThread: vi.fn(async () => undefined),
    },
  };
}

describe("saved environment startup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();

    mockFetchRemoteSessionState.mockResolvedValue({
      authenticated: true,
      role: "owner",
    });
    mockBootstrapRemoteBearerSession.mockResolvedValue({
      sessionToken: "saved-bearer-token",
      role: "owner",
    });
    mockRequestRAuthGrant.mockResolvedValue({
      credential: "r-auth-grant",
      expiresAt: "2026-04-22T00:00:00.000Z",
    });
    mockGetSavedEnvironmentRecord.mockImplementation((environmentId: EnvironmentId) =>
      environmentId === savedRecord.environmentId ? savedRecord : null,
    );
    mockListSavedEnvironmentRecords.mockReturnValue([savedRecord]);
    mockSavedEnvironmentRegistrySubscribe.mockReturnValue(() => undefined);
    mockWaitForSavedEnvironmentRegistryHydration.mockResolvedValue(undefined);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("saved-bearer-token");
    mockWriteSavedEnvironmentBearerToken.mockResolvedValue(true);
    mockCreateWsRpcClient.mockImplementation(() => createClient());
    mockCreateEnvironmentConnection.mockImplementation((input) => {
      if (input.kind === "saved") {
        queueMicrotask(() => {
          input.onConfigSnapshot?.(configSnapshot);
        });
      }

      return {
        kind: input.kind,
        environmentId: input.knownEnvironment.environmentId,
        knownEnvironment: input.knownEnvironment,
        client: input.client,
        ensureBootstrapped: vi.fn(async () => undefined),
        reconnect: vi.fn(async () => undefined),
        dispose: vi.fn(async () => undefined),
      };
    });
  });

  afterEach(async () => {
    const { resetEnvironmentServiceForTests } = await import("./service");
    await resetEnvironmentServiceForTests();
    vi.useRealTimers();
  });

  it("uses the initial config snapshot instead of issuing an extra getConfig call", async () => {
    const { startEnvironmentConnectionService, resetEnvironmentServiceForTests } =
      await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    await vi.runAllTimersAsync();

    const savedConnectionCall = mockCreateEnvironmentConnection.mock.calls.find(
      ([input]) => input.kind === "saved",
    );
    expect(savedConnectionCall).toBeDefined();

    const savedClient = savedConnectionCall?.[0]?.client;
    expect(savedClient.server.getConfig).not.toHaveBeenCalled();
    expect(mockFetchRemoteSessionState).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("coalesces hydration and registry sync so the initial saved connection only starts once", async () => {
    let finishHydration!: () => void;
    let finishTokenRead!: (token: string) => void;

    mockWaitForSavedEnvironmentRegistryHydration.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishHydration = () => resolve();
        }),
    );
    mockReadSavedEnvironmentBearerToken.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishTokenRead = resolve;
        }),
    );

    const { startEnvironmentConnectionService, resetEnvironmentServiceForTests } =
      await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const registryListener = mockSavedEnvironmentRegistrySubscribe.mock.calls[0]?.[0];
    expect(registryListener).toBeTypeOf("function");

    registryListener?.();
    finishHydration();
    await vi.waitFor(() => {
      expect(mockReadSavedEnvironmentBearerToken).toHaveBeenCalledTimes(1);
    });

    finishTokenRead("saved-bearer-token");
    await vi.runAllTimersAsync();

    const savedConnectionCalls = mockCreateEnvironmentConnection.mock.calls.filter(
      ([input]) => input.kind === "saved",
    );
    expect(savedConnectionCalls).toHaveLength(1);
    expect(mockFetchRemoteSessionState).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("refreshes a missing r-auth saved environment credential through centralized auth", async () => {
    const rAuthRecord = {
      ...savedRecord,
      authSource: "r-auth" as const,
    };
    mockListSavedEnvironmentRecords.mockReturnValue([rAuthRecord]);
    mockGetSavedEnvironmentRecord.mockImplementation((environmentId: EnvironmentId) =>
      environmentId === rAuthRecord.environmentId ? rAuthRecord : null,
    );
    mockReadSavedEnvironmentBearerToken.mockResolvedValue(null);

    const { startEnvironmentConnectionService, resetEnvironmentServiceForTests } =
      await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    await vi.runAllTimersAsync();

    expect(mockRequestRAuthGrant).toHaveBeenCalledWith({
      environmentId: rAuthRecord.environmentId,
    });
    expect(mockBootstrapRemoteBearerSession).toHaveBeenCalledWith({
      httpBaseUrl: rAuthRecord.httpBaseUrl,
      credential: "r-auth-grant",
    });
    expect(mockCreateEnvironmentConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "saved",
        knownEnvironment: expect.objectContaining({
          environmentId: rAuthRecord.environmentId,
        }),
      }),
    );

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("disconnects r-auth saved environments when centralized auth signs out", async () => {
    const rAuthRecord = {
      ...savedRecord,
      authSource: "r-auth" as const,
    };
    mockListSavedEnvironmentRecords.mockReturnValue([rAuthRecord]);
    mockGetSavedEnvironmentRecord.mockImplementation((environmentId: EnvironmentId) =>
      environmentId === rAuthRecord.environmentId ? rAuthRecord : null,
    );
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("saved-bearer-token");

    const {
      disconnectCentralizedAuthEnvironments,
      listEnvironmentConnections,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    await vi.runAllTimersAsync();

    await disconnectCentralizedAuthEnvironments();

    expect(mockRemoveSavedEnvironmentBearerToken).toHaveBeenCalledWith(rAuthRecord.environmentId);
    expect(mockPatchRuntime).toHaveBeenCalledWith(
      rAuthRecord.environmentId,
      expect.objectContaining({
        authState: "requires-auth",
        connectionState: "disconnected",
      }),
    );
    expect(
      listEnvironmentConnections().find(
        (connection) => connection.environmentId === rAuthRecord.environmentId,
      ),
    ).toBeUndefined();

    stop();
    await resetEnvironmentServiceForTests();
  });
});
