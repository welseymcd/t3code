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
      const params = new URLSearchParams(window.location.search);
      const redirectTo = params.get("redirectTo");
      const credential = params.get("credential");
      const error = params.get("error");

      if (!error && credential && credential.trim().length > 0) {
        await submitServerRAuthCredential(credential);
      }

      writeBrowserRAuthSessionState(true);

      const nextUrl =
        redirectTo && redirectTo.trim().length > 0
          ? new URL(redirectTo)
          : new URL("/", window.location.origin);
      if (error && error.trim().length > 0) {
        nextUrl.searchParams.set("rAuthError", error.trim());
      }
      window.location.replace(nextUrl.toString());
    };

    void complete().catch((error: unknown) => {
      const nextUrl = new URL("/", window.location.origin);
      nextUrl.searchParams.set(
        "rAuthError",
        error instanceof Error ? error.message : "Failed to complete r-auth sign-in.",
      );
      window.location.replace(nextUrl.toString());
    });
  }, []);

  return null;
}
