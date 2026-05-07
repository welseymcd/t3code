import type {
  AuthSessionState,
  RAuthAuthorizedEnvironment,
  RAuthGrantCredentialResult,
  RAuthGrantRequest,
  RAuthIdentity,
} from "@t3tools/contracts";
import { DateTime } from "effect";

import {
  readBrowserRAuthSessionState,
  readBrowserSavedEnvironmentRegistry,
  writeBrowserRAuthSessionState,
} from "../../clientPersistenceStorage";
import { fetchSessionState } from "../primary";

export interface RAuthLoginOptions {
  readonly environmentId?: string | null;
  readonly claimProof?: string | null;
}

export interface RAuthSessionState {
  readonly authenticated: boolean;
  readonly auth: AuthSessionState["auth"] | null;
  readonly identity: RAuthIdentity | null;
  readonly authorizedEnvironments: ReadonlyArray<RAuthAuthorizedEnvironment>;
  readonly expiresAt: string | null;
}

class RAuthHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RAuthHttpError";
    this.status = status;
  }
}

export function __resetRAuthClientForTests(): void {
  writeBrowserRAuthSessionState(false);
}

export function isRAuthHttpError(error: unknown): error is RAuthHttpError {
  return error instanceof RAuthHttpError;
}

/**
 * Remote UI base URL for the hosted r-auth app.
 *
 * This is only used for the popup sign-in entrypoint. The browser-facing API
 * calls stay same-origin and are bridged through the T3 server.
 */
export function resolveRAuthBaseUrl(baseUrl?: string): string {
  const configuredBaseUrl = baseUrl?.trim() || import.meta.env.VITE_R_AUTH_BASE_URL?.trim();
  const uiBaseUrl = configuredBaseUrl || "https://auth.rmcd.cc";
  return new URL(uiBaseUrl, window.location.origin).toString();
}

export function resolveRAuthLoginUrl(
  baseUrl?: string,
  returnToUrl = new URL("/", window.location.origin).toString(),
  options: RAuthLoginOptions = {},
): string {
  const hasEnvironmentId =
    typeof options.environmentId === "string" && options.environmentId.trim().length > 0;
  const url = new URL(
    hasEnvironmentId ? "/dashboard/t3/authorize" : "/api/t3/auth",
    resolveRAuthBaseUrl(baseUrl),
  );
  const callbackUrl = new URL("t3://auth/r-auth/callback");
  callbackUrl.searchParams.set("redirectTo", returnToUrl);
  if (hasEnvironmentId) {
    callbackUrl.searchParams.set("environmentId", options.environmentId!.trim());
  }
  if (typeof options.claimProof === "string" && options.claimProof.trim().length > 0) {
    callbackUrl.searchParams.set("claimProof", options.claimProof.trim());
  }
  url.searchParams.set("redirectTo", callbackUrl.toString());
  return url.toString();
}

export function openRAuthSignInWindow(
  returnToUrl = new URL("/", window.location.origin).toString(),
  options: RAuthLoginOptions = {},
): void {
  window.open(
    resolveRAuthLoginUrl(undefined, returnToUrl, options),
    "r-auth-sign-in",
    "popup,width=720,height=840",
  );
}

function resolveRAuthBridgeUrl(pathname: string): string {
  const url = new URL("/api/auth/r-auth", window.location.origin);
  url.pathname = `/api/auth/r-auth${pathname}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function readErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const text = await response.text();
  if (!text) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(text) as { readonly error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error.trim();
    }
  } catch {
    // Fall back to raw text below.
  }

  return text;
}

function normalizeRAuthSessionState(
  session: Awaited<ReturnType<typeof fetchSessionState>>,
): RAuthSessionState {
  const persistedSession = readBrowserRAuthSessionState();

  return {
    authenticated: persistedSession?.authenticated ?? false,
    auth: session.auth,
    identity: null,
    authorizedEnvironments: [],
    expiresAt:
      typeof session.expiresAt === "string"
        ? session.expiresAt
        : session.expiresAt
          ? DateTime.formatIso(session.expiresAt)
          : null,
  };
}

function readAuthorizedEnvironmentsFromBrowserRegistry(
  sessionRole: RAuthAuthorizedEnvironment["role"] = "client",
): ReadonlyArray<RAuthAuthorizedEnvironment> {
  return readBrowserSavedEnvironmentRegistry()
    .filter((record) => record.authSource === "r-auth")
    .map((record) => ({
      environmentId: record.environmentId,
      label: record.label,
      role: sessionRole,
      reachable: true,
    }));
}

export async function fetchRAuthSessionState(): Promise<RAuthSessionState> {
  try {
    const session = await fetchSessionState();
    const signedIn = readBrowserRAuthSessionState()?.authenticated ?? false;
    const authorizedEnvironments = signedIn
      ? readAuthorizedEnvironmentsFromBrowserRegistry(session.role ?? "client")
      : [];
    const normalized = normalizeRAuthSessionState(session);
    return {
      ...normalized,
      authorizedEnvironments,
    };
  } catch {
    return {
      authenticated: false,
      auth: null,
      identity: null,
      authorizedEnvironments: [],
      expiresAt: null,
    };
  }
}

export async function listRAuthAuthorizedEnvironments(): Promise<
  ReadonlyArray<RAuthAuthorizedEnvironment>
> {
  if (!readBrowserRAuthSessionState()?.authenticated) {
    return [];
  }

  return readAuthorizedEnvironmentsFromBrowserRegistry();
}

async function fetchRAuthJson<T>(input: {
  readonly pathname: string;
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
}): Promise<T> {
  const requestUrl = resolveRAuthBridgeUrl(input.pathname);
  const headers = input.body !== undefined ? { "content-type": "application/json" } : undefined;
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: input.method ?? "GET",
      credentials: "include",
      ...(headers ? { headers } : {}),
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    });
  } catch (error) {
    throw new Error(
      `Failed to fetch centralized auth bridge ${requestUrl} (${(error as Error).message}).`,
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new RAuthHttpError(
      await readErrorMessage(response, `Centralized auth request failed (${response.status}).`),
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength === "0") {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function requestRAuthGrant(input: {
  readonly environmentId: string;
}): Promise<RAuthGrantCredentialResult> {
  const grant = await fetchRAuthJson<RAuthGrantCredentialResult>({
    pathname: "/grants",
    method: "POST",
    body: {
      environmentId: input.environmentId,
    } satisfies RAuthGrantRequest,
  });
  writeBrowserRAuthSessionState(true);
  return grant;
}

export async function signOutRAuth(): Promise<void> {
  writeBrowserRAuthSessionState(false);
}
