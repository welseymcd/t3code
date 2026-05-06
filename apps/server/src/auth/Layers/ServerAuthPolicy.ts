import type { ServerAuthDescriptor } from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import { ServerAuthPolicy, type ServerAuthPolicyShape } from "../Services/ServerAuthPolicy.ts";
import { resolveSessionCookieName } from "../utils.ts";
import { isLoopbackHost, isWildcardHost } from "../../startupAccess.ts";

export const makeServerAuthPolicy = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const isRemoteReachable = isWildcardHost(config.host) || !isLoopbackHost(config.host);
  const centralizedAuthConfigured =
    config.rAuthEnabled &&
    typeof config.rAuthBaseUrl === "string" &&
    config.rAuthBaseUrl.trim().length > 0 &&
    typeof config.rAuthIssuer === "string" &&
    config.rAuthIssuer.trim().length > 0;

  const policy =
    config.mode === "desktop"
      ? isRemoteReachable
        ? "remote-reachable"
        : "desktop-managed-local"
      : isRemoteReachable
        ? "remote-reachable"
        : "loopback-browser";

  const bootstrapMethods: Array<ServerAuthDescriptor["bootstrapMethods"][number]> =
    policy === "desktop-managed-local"
      ? ["desktop-bootstrap"]
      : config.mode === "desktop" && policy === "remote-reachable"
        ? ["desktop-bootstrap", "one-time-token"]
        : ["one-time-token"];

  if (centralizedAuthConfigured) {
    bootstrapMethods.push("r-auth-grant");
  }

  const descriptor: ServerAuthDescriptor = {
    policy,
    bootstrapMethods,
    sessionMethods: ["browser-session-cookie", "bearer-session-token"],
    sessionCookieName: resolveSessionCookieName({
      mode: config.mode,
      port: config.port,
    }),
  };

  return {
    getDescriptor: () => Effect.succeed(descriptor),
  } satisfies ServerAuthPolicyShape;
});

export const ServerAuthPolicyLive = Layer.effect(ServerAuthPolicy, makeServerAuthPolicy);
