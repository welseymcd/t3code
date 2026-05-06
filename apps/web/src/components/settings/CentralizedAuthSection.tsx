import { RefreshCwIcon, LogOutIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  fetchRAuthSessionState,
  openRAuthSignInWindow,
  signOutRAuth,
  type RAuthSessionState,
} from "../../environments/rAuth/api";
import { fetchServerRAuthClaimProof, usePrimaryEnvironmentId } from "../../environments/primary";
import type { RAuthAuthorizedEnvironment } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { disconnectCentralizedAuthEnvironments } from "../../environments/runtime";
import { subscribeBrowserRAuthSessionStateChanges } from "../../clientPersistenceStorage";

type CentralizedAuthState = {
  readonly status: "loading" | "loaded";
  readonly error: string | null;
  readonly session: RAuthSessionState | null;
  readonly environments: ReadonlyArray<RAuthAuthorizedEnvironment>;
  readonly claimProof: string | null;
};

const DEFAULT_STATE: CentralizedAuthState = {
  status: "loading",
  error: null,
  session: null,
  environments: [],
  claimProof: null,
};

function useCentralizedAuthState() {
  const [state, setState] = useState<CentralizedAuthState>(DEFAULT_STATE);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const session = await fetchRAuthSessionState();

        if (cancelled) return;

        setState((current) => ({
          ...current,
          status: "loaded",
          error: null,
          session,
          environments: session.authorizedEnvironments,
          claimProof: null,
        }));
      } catch (error) {
        if (cancelled) return;

        setState({
          status: "loaded",
          error: error instanceof Error ? error.message : "Failed to load centralized auth state.",
          session: null,
          environments: [],
          claimProof: null,
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading", error: null }));
    try {
      const session = await fetchRAuthSessionState();
      setState((current) => ({
        ...current,
        status: "loaded",
        error: null,
        session,
        environments: session.authorizedEnvironments,
        claimProof: null,
      }));
    } catch (error) {
      setState({
        status: "loaded",
        error: error instanceof Error ? error.message : "Failed to load centralized auth state.",
        session: null,
        environments: [],
        claimProof: null,
      });
    }
  }, []);

  useEffect(() => subscribeBrowserRAuthSessionStateChanges(() => void refresh()), [refresh]);

  return { state, refresh, setState };
}

export function CentralizedAuthSection() {
  const { state, refresh, setState } = useCentralizedAuthState();
  const currentEnvironmentId = usePrimaryEnvironmentId();
  const supportsCentralizedBootstrap =
    state.session?.auth?.bootstrapMethods.includes("r-auth-grant") ?? false;
  const handleRequestClaimProof = useCallback(async () => {
    if (!supportsCentralizedBootstrap) {
      setState((current) => ({
        ...current,
        error: "Centralized auth is not enabled for this backend.",
      }));
      return;
    }

    try {
      const proof = await fetchServerRAuthClaimProof();
      setState((current) => ({ ...current, claimProof: proof.proof, error: null }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Failed to generate claim proof.",
      }));
    }
  }, [setState, supportsCentralizedBootstrap]);

  const handleSignOut = async () => {
    try {
      await signOutRAuth();
      await disconnectCentralizedAuthEnvironments();
      await refresh();
    } catch (error) {
      setState({
        status: "loaded",
        error: error instanceof Error ? error.message : "Failed to sign out of centralized auth.",
        session: state.session,
        environments: state.environments,
        claimProof: state.claimProof,
      });
    }
  };

  const handleSignIn = async () => {
    try {
      const proof = supportsCentralizedBootstrap
        ? await fetchServerRAuthClaimProof().catch(() => null)
        : null;
      openRAuthSignInWindow(window.location.href, {
        environmentId: proof?.environmentId ?? currentEnvironmentId,
        claimProof: proof?.proof ?? null,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Failed to open r-auth sign-in.",
      }));
    }
  };

  const signedInUserDescription = (() => {
    if (state.status === "loading") {
      return "Loading…";
    }
    if (!state.session?.authenticated) {
      return "Not signed in.";
    }

    const identity = state.session.identity;
    if (!identity) {
      return "Authenticated";
    }

    return [identity.displayName ?? identity.subject, identity.email].filter(Boolean).join(" · ");
  })();

  const authorizedEnvironmentsDescription =
    state.environments.length > 0
      ? state.environments
          .map((environment) => `${environment.label} (${environment.role})`)
          .join(" · ")
      : "No authorized environments loaded.";

  return (
    <SettingsSection
      title="Centralized auth"
      headerAction={
        <div className="flex items-center gap-2">
          <Button size="xs" variant="outline" onClick={() => void refresh()}>
            <RefreshCwIcon className="size-3" />
            Refresh
          </Button>
          {state.session?.authenticated ? (
            <Button size="xs" variant="outline" onClick={() => void handleSignOut()}>
              <LogOutIcon className="size-3" />
              Sign out
            </Button>
          ) : (
            <Button size="xs" onClick={() => void handleSignIn()}>
              Sign in
            </Button>
          )}
        </div>
      }
    >
      <SettingsRow title="Signed in user" description={signedInUserDescription} />
      <SettingsRow
        title="Authorized environments"
        description={authorizedEnvironmentsDescription}
      />
      <SettingsRow
        title="Claim proof"
        description={
          state.claimProof ? (
            <code className="break-all text-xs text-foreground/90">{state.claimProof}</code>
          ) : supportsCentralizedBootstrap ? (
            "Generate a claim proof for this backend when you are ready to register it with r-auth."
          ) : (
            "This backend does not currently advertise centralized auth support."
          )
        }
        control={
          supportsCentralizedBootstrap ? (
            <Button size="xs" variant="outline" onClick={() => void handleRequestClaimProof()}>
              Generate
            </Button>
          ) : null
        }
      />
    </SettingsSection>
  );
}
