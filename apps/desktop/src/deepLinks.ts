const DESKTOP_SCHEME = "t3:";
const AUTH_DEEP_LINK_HOST = "auth";
const R_AUTH_CALLBACK_PATHNAME = "/r-auth/callback";
const R_AUTH_CALLBACK_ROUTE_PATHNAME = "/auth/r-auth/callback";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

function canUseRedirectOriginForCallback(redirectTo: URL, fallbackRoot: URL): boolean {
  if (
    (redirectTo.protocol !== "http:" && redirectTo.protocol !== "https:") ||
    (fallbackRoot.protocol !== "http:" && fallbackRoot.protocol !== "https:")
  ) {
    return false;
  }

  if (redirectTo.origin === fallbackRoot.origin) {
    return true;
  }

  return (
    redirectTo.protocol === fallbackRoot.protocol &&
    redirectTo.port === fallbackRoot.port &&
    isLoopbackHostname(redirectTo.hostname) &&
    isLoopbackHostname(fallbackRoot.hostname)
  );
}

function resolveCallbackRootUrl(input: {
  readonly fallbackRootUrl: string;
  readonly redirectTo: string | null;
}): URL | null {
  let fallbackRoot: URL;
  try {
    fallbackRoot = new URL(input.fallbackRootUrl);
  } catch {
    return null;
  }

  if (!input.redirectTo) {
    return fallbackRoot;
  }

  try {
    const redirectTo = new URL(input.redirectTo);
    return canUseRedirectOriginForCallback(redirectTo, fallbackRoot) ? redirectTo : fallbackRoot;
  } catch {
    return fallbackRoot;
  }
}

export function resolveDesktopDeepLinkRouteUrl(input: {
  readonly deepLinkUrl: string;
  readonly fallbackRootUrl: string | null;
}): string | null {
  if (!input.fallbackRootUrl) {
    return null;
  }

  let deepLinkUrl: URL;
  try {
    deepLinkUrl = new URL(input.deepLinkUrl);
  } catch {
    return null;
  }

  if (
    deepLinkUrl.protocol !== DESKTOP_SCHEME ||
    deepLinkUrl.hostname !== AUTH_DEEP_LINK_HOST ||
    deepLinkUrl.pathname !== R_AUTH_CALLBACK_PATHNAME
  ) {
    return null;
  }

  const redirectTo = deepLinkUrl.searchParams.get("redirectTo");
  const rootUrl = resolveCallbackRootUrl({
    fallbackRootUrl: input.fallbackRootUrl,
    redirectTo,
  });
  if (!rootUrl) {
    return null;
  }

  const localUrl = new URL(R_AUTH_CALLBACK_ROUTE_PATHNAME, rootUrl.origin);
  if (redirectTo) {
    localUrl.searchParams.set("redirectTo", redirectTo);
  }
  return localUrl.toString();
}

export function isSupportedDesktopDeepLink(inputUrl: string): boolean {
  try {
    const deepLinkUrl = new URL(inputUrl);
    return (
      deepLinkUrl.protocol === DESKTOP_SCHEME &&
      deepLinkUrl.hostname === AUTH_DEEP_LINK_HOST &&
      deepLinkUrl.pathname === R_AUTH_CALLBACK_PATHNAME
    );
  } catch {
    return false;
  }
}

export function findDesktopDeepLinkArg(argv: ReadonlyArray<string>): string | undefined {
  return argv.find((arg) => arg.startsWith("t3://"));
}
