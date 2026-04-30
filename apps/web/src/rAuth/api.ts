export interface RAuthSessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface RAuthSession {
  readonly user: RAuthSessionUser;
  readonly session: {
    readonly id: string;
    readonly userId: string;
    readonly expiresAt: string | Date;
  };
}

export interface RAuthAuthorizedServer {
  readonly environmentId: string;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly role: "owner" | "client";
  readonly authorizedAt: string;
}

export interface RAuthEnvironmentGrant {
  readonly environmentId: string;
  readonly credential: string;
  readonly expiresAt: string;
}

export interface RegisterAuthorizedT3ServerInput {
  readonly environmentId: string;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly role: "owner" | "client";
}

export interface ClaimAuthorizedT3ServerInput {
  readonly proof: string;
}

export class RAuthHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RAuthHttpError";
    this.status = status;
  }
}

const R_AUTH_PROXY_PREFIX = "/api/r-auth";
const DEFAULT_R_AUTH_PROXY_BASE_URL = R_AUTH_PROXY_PREFIX;
const DEFAULT_R_AUTH_ISSUER = "https://auth.rmcd.cc";
export const DESKTOP_R_AUTH_CALLBACK_URL = "t3://auth/r-auth/callback";

function normalizeConfiguredRAuthBaseUrl(configured: string): string {
  const url = new URL(configured, window.location.origin);
  if (
    url.origin !== window.location.origin &&
    url.pathname.replace(/\/$/, "") === R_AUTH_PROXY_PREFIX
  ) {
    url.pathname = "/";
  }
  return url.toString();
}

function resolveRAuthBaseUrl(): string {
  if (window.desktopBridge) {
    return DEFAULT_R_AUTH_PROXY_BASE_URL;
  }

  const configured = import.meta.env.VITE_R_AUTH_URL?.trim();
  return configured && configured.length > 0
    ? normalizeConfiguredRAuthBaseUrl(configured)
    : DEFAULT_R_AUTH_PROXY_BASE_URL;
}

function resolveRAuthLoginBaseUrl(): string {
  if (window.desktopBridge) {
    const configured = import.meta.env.VITE_R_AUTH_URL?.trim();
    return configured && configured.length > 0
      ? normalizeConfiguredRAuthBaseUrl(configured)
      : DEFAULT_R_AUTH_ISSUER;
  }

  return resolveRAuthBaseUrl();
}

function resolveRAuthUrl(pathname: string): string {
  const url = new URL(resolveRAuthBaseUrl(), window.location.origin);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${pathname.replace(/^\//, "")}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildDesktopRAuthCallbackUrl(environmentId?: string | null): string {
  const url = new URL(DESKTOP_R_AUTH_CALLBACK_URL);
  if (environmentId) {
    url.searchParams.set("environmentId", environmentId);
  }
  return url.toString();
}

export function buildRAuthLoginUrl(returnTo: string = window.location.href): string {
  const url = new URL(resolveRAuthLoginBaseUrl(), window.location.origin);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/dashboard`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("redirectTo", returnTo);
  return url.toString();
}

async function readErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const text = await response.text();
  if (!text) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(text) as { readonly error?: { readonly message?: string } };
    const message = parsed.error?.message;
    return typeof message === "string" && message.length > 0 ? message : text;
  } catch {
    return text;
  }
}

async function fetchRAuthJson<T>(input: {
  readonly pathname: string;
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
}): Promise<T> {
  const init: RequestInit = {
    method: input.method ?? "GET",
    credentials: "include",
  };
  if (input.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(input.body);
  }

  const response = await fetch(resolveRAuthUrl(input.pathname), init);

  if (!response.ok) {
    throw new RAuthHttpError(
      await readErrorMessage(response, `r-auth request failed (${response.status}).`),
      response.status,
    );
  }

  return (await response.json()) as T;
}

export async function fetchRAuthSession(): Promise<RAuthSession | null> {
  try {
    return await fetchRAuthJson<RAuthSession>({
      pathname: "/rest/v1/auth/session",
    });
  } catch (error) {
    if (error instanceof RAuthHttpError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function fetchAuthorizedT3Servers(): Promise<ReadonlyArray<RAuthAuthorizedServer>> {
  try {
    const response = await fetchRAuthJson<{
      readonly ok: true;
      readonly servers: ReadonlyArray<RAuthAuthorizedServer>;
    }>({
      pathname: "/rest/v1/t3/servers",
    });
    return response.servers;
  } catch (error) {
    if (error instanceof RAuthHttpError && error.status === 404) {
      return [];
    }
    throw error;
  }
}

export async function registerAuthorizedT3Server(
  input: RegisterAuthorizedT3ServerInput,
): Promise<RAuthAuthorizedServer | null> {
  try {
    const response = await fetchRAuthJson<{
      readonly ok: true;
      readonly server: RAuthAuthorizedServer;
    }>({
      pathname: "/rest/v1/t3/servers",
      method: "POST",
      body: input,
    });
    return response.server;
  } catch (error) {
    if (error instanceof RAuthHttpError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function claimAuthorizedT3Server(
  input: ClaimAuthorizedT3ServerInput,
): Promise<RAuthAuthorizedServer | null> {
  try {
    const response = await fetchRAuthJson<{
      readonly ok: true;
      readonly server: RAuthAuthorizedServer;
    }>({
      pathname: "/rest/v1/t3/servers/claim",
      method: "POST",
      body: input,
    });
    return response.server;
  } catch (error) {
    if (error instanceof RAuthHttpError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function issueAuthorizedT3ServerGrant(
  environmentId: string,
): Promise<RAuthEnvironmentGrant> {
  const response = await fetchRAuthJson<{
    readonly ok: true;
    readonly environmentId: string;
    readonly credential: string;
    readonly expiresAt: string;
  }>({
    pathname: "/rest/v1/t3/grant",
    method: "POST",
    body: {
      environmentId,
    },
  });

  return {
    environmentId: response.environmentId,
    credential: response.credential,
    expiresAt: response.expiresAt,
  };
}
