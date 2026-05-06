import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { writeBrowserRAuthSessionState } from "../clientPersistenceStorage";
import { submitServerRAuthCredential } from "../environments/primary";

export const Route = createFileRoute("/auth/r-auth/callback")({
  component: RAuthCallbackRoute,
});

function RAuthCallbackRoute() {
  useEffect(() => {
    const complete = async () => {
      const nextUrl = await resolveRAuthCallbackRedirectUrl({
        search: window.location.search,
        hash: window.location.hash,
        fallbackOrigin: window.location.origin,
        submitCredential: submitServerRAuthCredential,
        writeSessionState: writeBrowserRAuthSessionState,
      });
      window.location.replace(nextUrl.toString());
    };

    void complete();
  }, []);

  return null;
}

export async function resolveRAuthCallbackRedirectUrl(input: {
  readonly search: string;
  readonly hash?: string;
  readonly fallbackOrigin: string;
  readonly submitCredential: (credential: string) => Promise<void>;
  readonly writeSessionState: (authenticated: boolean) => void;
}): Promise<URL> {
  const params = new URLSearchParams(resolveRAuthCallbackSearch(input.search, input.hash ?? ""));
  const redirectTo = params.get("redirectTo");
  const nextUrl = resolveRAuthCallbackNextUrl(redirectTo, input.fallbackOrigin);
  const credential = params.get("credential")?.trim() ?? "";
  const error = params.get("error")?.trim() ?? "";

  if (error) {
    nextUrl.searchParams.set("rAuthError", error);
    return nextUrl;
  }

  if (!credential) {
    nextUrl.searchParams.set("rAuthError", "Missing r-auth credential.");
    return nextUrl;
  }

  try {
    await input.submitCredential(credential);
    input.writeSessionState(true);
  } catch (error: unknown) {
    nextUrl.searchParams.set(
      "rAuthError",
      error instanceof Error ? error.message : "Failed to complete r-auth sign-in.",
    );
  }

  return nextUrl;
}

const R_AUTH_CALLBACK_ROUTE_PATHNAME = "/auth/r-auth/callback";
const R_AUTH_SETTINGS_ROUTE_HASH = "/settings/connections";

function resolveRAuthCallbackSearch(search: string, hash: string): string {
  if (search.trim().length > 0) {
    return search;
  }

  const hashRoute = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryStartIndex = hashRoute.indexOf("?");
  if (queryStartIndex === -1) {
    return "";
  }

  if (hashRoute.slice(0, queryStartIndex) !== R_AUTH_CALLBACK_ROUTE_PATHNAME) {
    return "";
  }

  return hashRoute.slice(queryStartIndex);
}

function resolveRAuthCallbackNextUrl(redirectTo: string | null, fallbackOrigin: string): URL {
  if (redirectTo && redirectTo.trim().length > 0) {
    try {
      return unwrapRAuthCallbackReturnUrl(new URL(redirectTo), fallbackOrigin);
    } catch {
      // Fall back below.
    }
  }

  return new URL("/", fallbackOrigin);
}

function unwrapRAuthCallbackReturnUrl(url: URL, fallbackOrigin: string, depth = 0): URL {
  if (!isRAuthCallbackRouteUrl(url)) {
    return url;
  }

  if (depth >= 3) {
    return resolveRAuthSettingsUrl(fallbackOrigin);
  }

  const nestedRedirectTo = getRAuthCallbackSearchParams(url).get("redirectTo");
  if (nestedRedirectTo && nestedRedirectTo.trim().length > 0) {
    try {
      return unwrapRAuthCallbackReturnUrl(new URL(nestedRedirectTo), fallbackOrigin, depth + 1);
    } catch {
      // Fall back below.
    }
  }

  return resolveRAuthSettingsUrl(fallbackOrigin);
}

function isRAuthCallbackRouteUrl(url: URL): boolean {
  if (url.pathname === R_AUTH_CALLBACK_ROUTE_PATHNAME) {
    return true;
  }

  const hashRoute = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  return (
    hashRoute === R_AUTH_CALLBACK_ROUTE_PATHNAME ||
    hashRoute.startsWith(`${R_AUTH_CALLBACK_ROUTE_PATHNAME}?`)
  );
}

function getRAuthCallbackSearchParams(url: URL): URLSearchParams {
  if (url.pathname === R_AUTH_CALLBACK_ROUTE_PATHNAME) {
    return url.searchParams;
  }

  const hashRoute = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const queryStartIndex = hashRoute.indexOf("?");
  if (queryStartIndex === -1) {
    return new URLSearchParams();
  }

  return new URLSearchParams(hashRoute.slice(queryStartIndex));
}

function resolveRAuthSettingsUrl(fallbackOrigin: string): URL {
  const url = new URL("/", fallbackOrigin);
  url.hash = R_AUTH_SETTINGS_ROUTE_HASH;
  return url;
}
