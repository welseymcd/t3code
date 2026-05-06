import {
  ClientSettingsSchema,
  EnvironmentId,
  type ClientSettings,
  type EnvironmentId as EnvironmentIdValue,
  type PersistedSavedEnvironmentRecord,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

export const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";
export const SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY = "t3code:saved-environment-registry:v1";
export const R_AUTH_SESSION_STATE_STORAGE_KEY = "t3code:r-auth-session-state:v1";
export const R_AUTH_SESSION_STATE_CHANGED_EVENT = "t3code:r-auth-session-state-changed";
const R_AUTH_SESSION_STATE_BROADCAST_CHANNEL = "t3code:r-auth-session-state";

const BrowserSavedEnvironmentRecordSchema = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
  createdAt: Schema.String,
  lastConnectedAt: Schema.NullOr(Schema.String),
  authSource: Schema.optionalKey(
    Schema.Union([
      Schema.Literal("manual-pairing"),
      Schema.Literal("r-auth"),
      Schema.Literal("desktop-ssh"),
    ]),
  ),
  desktopSsh: Schema.optionalKey(
    Schema.Struct({
      alias: Schema.String,
      hostname: Schema.String,
      username: Schema.NullOr(Schema.String),
      port: Schema.NullOr(Schema.Number),
    }),
  ),
  bearerToken: Schema.optionalKey(Schema.String),
});
type BrowserSavedEnvironmentRecord = typeof BrowserSavedEnvironmentRecordSchema.Type;
type MutableBrowserSavedEnvironmentRecord = {
  -readonly [Key in keyof BrowserSavedEnvironmentRecord]: BrowserSavedEnvironmentRecord[Key];
};

const BrowserSavedEnvironmentRegistryDocumentSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Number),
  records: Schema.optionalKey(Schema.Array(BrowserSavedEnvironmentRecordSchema)),
});
type BrowserSavedEnvironmentRegistryDocument =
  typeof BrowserSavedEnvironmentRegistryDocumentSchema.Type;

const BrowserRAuthSessionStateSchema = Schema.Struct({
  authenticated: Schema.Boolean,
});
type BrowserRAuthSessionState = typeof BrowserRAuthSessionStateSchema.Type;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function readBrowserRAuthSessionState(): BrowserRAuthSessionState | null {
  if (!hasWindow()) {
    return null;
  }

  try {
    return getLocalStorageItem(R_AUTH_SESSION_STATE_STORAGE_KEY, BrowserRAuthSessionStateSchema);
  } catch {
    return null;
  }
}

export function writeBrowserRAuthSessionState(authenticated: boolean): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(
    R_AUTH_SESSION_STATE_STORAGE_KEY,
    { authenticated },
    BrowserRAuthSessionStateSchema,
  );
  publishBrowserRAuthSessionStateChange({ authenticated });
}

function publishBrowserRAuthSessionStateChange(state: BrowserRAuthSessionState): void {
  if (!hasWindow()) {
    return;
  }

  if (typeof window.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(R_AUTH_SESSION_STATE_CHANGED_EVENT, { detail: state }));
  }

  if (typeof BroadcastChannel === "undefined") {
    return;
  }

  const channel = new BroadcastChannel(R_AUTH_SESSION_STATE_BROADCAST_CHANNEL);
  const postMessage = channel.postMessage.bind(channel) as (
    message: BrowserRAuthSessionState,
  ) => void;
  postMessage(state);
  channel.close();
}

export function subscribeBrowserRAuthSessionStateChanges(
  callback: (state: BrowserRAuthSessionState | null) => void,
): () => void {
  if (!hasWindow()) {
    return () => {};
  }

  const handleCustomEvent = (event: Event) => {
    callback(
      event instanceof CustomEvent &&
        typeof event.detail === "object" &&
        event.detail !== null &&
        "authenticated" in event.detail
        ? (event.detail as BrowserRAuthSessionState)
        : readBrowserRAuthSessionState(),
    );
  };
  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key === R_AUTH_SESSION_STATE_STORAGE_KEY) {
      callback(readBrowserRAuthSessionState());
    }
  };

  if (
    typeof window.addEventListener !== "function" ||
    typeof window.removeEventListener !== "function"
  ) {
    return () => {};
  }

  window.addEventListener(R_AUTH_SESSION_STATE_CHANGED_EVENT, handleCustomEvent);
  window.addEventListener("storage", handleStorageEvent);

  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(R_AUTH_SESSION_STATE_BROADCAST_CHANNEL);
  const handleChannelMessage = () => callback(readBrowserRAuthSessionState());
  if (channel) {
    channel.addEventListener("message", handleChannelMessage);
  }

  return () => {
    window.removeEventListener(R_AUTH_SESSION_STATE_CHANGED_EVENT, handleCustomEvent);
    window.removeEventListener("storage", handleStorageEvent);
    channel?.removeEventListener("message", handleChannelMessage);
    channel?.close();
  };
}

function toPersistedSavedEnvironmentRecord(
  record: PersistedSavedEnvironmentRecord,
): PersistedSavedEnvironmentRecord {
  const nextRecord = {
    environmentId: record.environmentId,
    label: record.label,
    httpBaseUrl: record.httpBaseUrl,
    wsBaseUrl: record.wsBaseUrl,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
  };
  return {
    ...nextRecord,
    ...(record.authSource ? { authSource: record.authSource } : {}),
    ...(record.desktopSsh ? { desktopSsh: record.desktopSsh } : {}),
  };
}

export function readBrowserClientSettings(): ClientSettings | null {
  if (!hasWindow()) {
    return null;
  }

  try {
    return getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema);
  } catch {
    return null;
  }
}

export function writeBrowserClientSettings(settings: ClientSettings): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, settings, ClientSettingsSchema);
}

function readBrowserSavedEnvironmentRegistryDocument(): BrowserSavedEnvironmentRegistryDocument {
  if (!hasWindow()) {
    return {};
  }

  try {
    const parsed = getLocalStorageItem(
      SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY,
      BrowserSavedEnvironmentRegistryDocumentSchema,
    );
    return parsed ?? {};
  } catch {
    return {};
  }
}

function writeBrowserSavedEnvironmentRegistryDocument(
  document: BrowserSavedEnvironmentRegistryDocument,
): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(
    SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY,
    document,
    BrowserSavedEnvironmentRegistryDocumentSchema,
  );
}

function readBrowserSavedEnvironmentRecordsWithSecrets(): ReadonlyArray<BrowserSavedEnvironmentRecord> {
  return readBrowserSavedEnvironmentRegistryDocument().records ?? [];
}

function writeBrowserSavedEnvironmentRecords(
  records: ReadonlyArray<BrowserSavedEnvironmentRecord>,
): void {
  writeBrowserSavedEnvironmentRegistryDocument({
    version: 1,
    records,
  });
}

export function readBrowserSavedEnvironmentRegistry(): ReadonlyArray<PersistedSavedEnvironmentRecord> {
  return readBrowserSavedEnvironmentRecordsWithSecrets().map((record) =>
    toPersistedSavedEnvironmentRecord(record),
  );
}

export function writeBrowserSavedEnvironmentRegistry(
  records: ReadonlyArray<PersistedSavedEnvironmentRecord>,
): void {
  const existing = new Map(
    readBrowserSavedEnvironmentRecordsWithSecrets().map(
      (record) => [record.environmentId, record] as const,
    ),
  );
  writeBrowserSavedEnvironmentRecords(
    records.map((record) => {
      const bearerToken = existing.get(record.environmentId)?.bearerToken;
      return bearerToken
        ? {
            environmentId: record.environmentId,
            label: record.label,
            httpBaseUrl: record.httpBaseUrl,
            wsBaseUrl: record.wsBaseUrl,
            createdAt: record.createdAt,
            lastConnectedAt: record.lastConnectedAt,
            ...(record.authSource ? { authSource: record.authSource } : {}),
            ...(record.desktopSsh ? { desktopSsh: record.desktopSsh } : {}),
            bearerToken,
          }
        : toPersistedSavedEnvironmentRecord(record);
    }),
  );
}

export function readBrowserSavedEnvironmentSecret(
  environmentId: EnvironmentIdValue,
): string | null {
  return (
    readBrowserSavedEnvironmentRecordsWithSecrets().find(
      (record) => record.environmentId === environmentId,
    )?.bearerToken ?? null
  );
}

export function writeBrowserSavedEnvironmentSecret(
  environmentId: EnvironmentIdValue,
  secret: string,
): boolean {
  const document = readBrowserSavedEnvironmentRegistryDocument();
  const records = document.records ?? [];
  let found = false;
  writeBrowserSavedEnvironmentRegistryDocument({
    version: document.version ?? 1,
    records: records.map((record) => {
      if (record.environmentId !== environmentId) {
        return record;
      }
      found = true;
      const nextRecord: MutableBrowserSavedEnvironmentRecord = {
        environmentId: record.environmentId,
        label: record.label,
        httpBaseUrl: record.httpBaseUrl,
        wsBaseUrl: record.wsBaseUrl,
        createdAt: record.createdAt,
        lastConnectedAt: record.lastConnectedAt,
        bearerToken: secret,
      };
      if (record.authSource) {
        nextRecord.authSource = record.authSource;
      }
      if (record.desktopSsh) {
        nextRecord.desktopSsh = record.desktopSsh;
      }
      return nextRecord;
    }),
  });
  return found;
}

export function removeBrowserSavedEnvironmentSecret(environmentId: EnvironmentIdValue): void {
  const document = readBrowserSavedEnvironmentRegistryDocument();
  writeBrowserSavedEnvironmentRegistryDocument({
    version: document.version ?? 1,
    records: (document.records ?? []).map((record) => {
      if (record.environmentId !== environmentId) {
        return record;
      }
      return toPersistedSavedEnvironmentRecord(record);
    }),
  });
}
