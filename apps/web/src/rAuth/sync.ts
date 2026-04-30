import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

import {
  fetchAuthorizedT3Servers,
  fetchRAuthSession,
  RAuthHttpError,
  type RAuthAuthorizedServer,
  type RAuthSessionUser,
} from "./api";
import {
  listSavedEnvironmentRecordsBySource,
  type SavedEnvironmentRecord,
  useSavedEnvironmentRegistryStore,
} from "../environments/runtime";

const R_AUTH_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export type RAuthSessionState = "unknown" | "authenticated" | "signed-out";

export interface RAuthSyncState {
  readonly sessionState: RAuthSessionState;
  readonly user: RAuthSessionUser | null;
  readonly lastSyncedAt: string | null;
  readonly syncedEnvironmentCount: number;
  readonly isSyncing: boolean;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
}

interface RAuthSyncStore extends RAuthSyncState {
  readonly patch: (patch: Partial<RAuthSyncState>) => void;
  readonly reset: () => void;
}

const DEFAULT_R_AUTH_SYNC_STATE: RAuthSyncState = Object.freeze({
  sessionState: "unknown",
  user: null,
  lastSyncedAt: null,
  syncedEnvironmentCount: 0,
  isSyncing: false,
  lastError: null,
  lastErrorAt: null,
});

export const useRAuthSyncStore = create<RAuthSyncStore>()((set) => ({
  ...DEFAULT_R_AUTH_SYNC_STATE,
  patch: (patch) => set((state) => ({ ...state, ...patch })),
  reset: () => set(DEFAULT_R_AUTH_SYNC_STATE),
}));

function isoNow(): string {
  return new Date().toISOString();
}

function toSyncedSavedEnvironmentRecord(
  server: RAuthAuthorizedServer,
  current: SavedEnvironmentRecord | null,
  syncedAt: string,
): SavedEnvironmentRecord {
  return {
    environmentId: server.environmentId as EnvironmentId,
    label: server.label,
    httpBaseUrl: server.httpBaseUrl,
    wsBaseUrl: server.wsBaseUrl,
    createdAt: current?.createdAt ?? syncedAt,
    lastConnectedAt: current?.lastConnectedAt ?? null,
    source: "r-auth",
    lastSyncedAt: syncedAt,
  };
}

function setSignedOutState() {
  useRAuthSyncStore.getState().patch({
    sessionState: "signed-out",
    user: null,
    syncedEnvironmentCount: listSavedEnvironmentRecordsBySource("r-auth").length,
    isSyncing: false,
    lastError: null,
  });
}

export async function syncAuthorizedSavedEnvironments(): Promise<void> {
  const syncStore = useRAuthSyncStore.getState();
  syncStore.patch({
    isSyncing: true,
    lastError: null,
  });

  try {
    const session = await fetchRAuthSession();
    if (!session) {
      setSignedOutState();
      return;
    }

    const syncedAt = isoNow();
    const servers = await fetchAuthorizedT3Servers();
    const byId = useSavedEnvironmentRegistryStore.getState().byId;
    const nextEnvironmentIds = new Set<EnvironmentId>(
      servers.map((server) => server.environmentId as EnvironmentId),
    );

    for (const record of listSavedEnvironmentRecordsBySource("r-auth")) {
      if (!nextEnvironmentIds.has(record.environmentId)) {
        useSavedEnvironmentRegistryStore.getState().remove(record.environmentId);
      }
    }

    for (const server of servers) {
      const environmentId = server.environmentId as EnvironmentId;
      useSavedEnvironmentRegistryStore
        .getState()
        .upsert(toSyncedSavedEnvironmentRecord(server, byId[environmentId] ?? null, syncedAt));
    }

    useRAuthSyncStore.getState().patch({
      sessionState: "authenticated",
      user: session.user,
      lastSyncedAt: syncedAt,
      syncedEnvironmentCount: servers.length,
      isSyncing: false,
      lastError: null,
      lastErrorAt: null,
    });
  } catch (error) {
    if (error instanceof RAuthHttpError && error.status === 401) {
      setSignedOutState();
      return;
    }

    useRAuthSyncStore.getState().patch({
      isSyncing: false,
      lastError: error instanceof Error ? error.message : "Failed to sync authorized servers.",
      lastErrorAt: isoNow(),
    });
    throw error;
  }
}

let activeCleanup: (() => void) | null = null;
let activeRefCount = 0;

export function startRAuthEnvironmentSyncService(): () => void {
  activeRefCount += 1;
  if (activeCleanup === null) {
    const runSync = () => {
      void syncAuthorizedSavedEnvironments().catch(() => undefined);
    };
    const intervalId = window.setInterval(runSync, R_AUTH_SYNC_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        runSync();
      }
    };
    const handleFocus = () => {
      runSync();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    runSync();
    activeCleanup = () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      activeCleanup = null;
    };
  }

  return () => {
    activeRefCount -= 1;
    if (activeRefCount <= 0) {
      activeRefCount = 0;
      activeCleanup?.();
    }
  };
}

export function resetRAuthSyncStoreForTests() {
  activeRefCount = 0;
  activeCleanup?.();
  activeCleanup = null;
  useRAuthSyncStore.getState().reset();
}
