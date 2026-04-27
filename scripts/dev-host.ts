#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Path } from "effect";
import { Command, Flag } from "effect/unstable/cli";

const execFile = promisify(execFileCallback);

const DEFAULT_AUTH_ENV_PATH = "~/Development/r-auth/.env";
const DEFAULT_DOMAIN = "rmcd.fyi";
const DEFAULT_TUNNEL_NAME = "rmcd-devhost";
const DEFAULT_DOCKER_NETWORK = "rmcd-devhost";
const DEFAULT_OUTPUT_ENV_PATH = "docker/dev-host/.env";
const CF_API_BASE_URL = "https://api.cloudflare.com/client/v4";

interface CloudflareAuth {
  readonly email: string;
  readonly globalKey: string;
}

interface CloudflareZone {
  readonly id: string;
  readonly accountId: string;
}

interface CloudflareTunnel {
  readonly id: string;
  readonly token?: string | undefined;
}

interface CloudflareDnsRecord {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly content: string;
  readonly proxied: boolean;
}

export function parseDotEnv(raw: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key.length > 0) {
      values[key] = value;
    }
  }

  return values;
}

export function serializeEnvFile(values: Record<string, string>): string {
  return Object.entries(values)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
    .concat("\n");
}

export function wildcardHostnameForDomain(domain: string): string {
  return `*.${domain}`;
}

export function resolveTunnelHostname(tunnelId: string): string {
  return `${tunnelId}.cfargotunnel.com`;
}

function expandHomePath(inputPath: string): string {
  return inputPath.startsWith("~/") ? `${homedir()}/${inputPath.slice(2)}` : inputPath;
}

async function cfRequest<Result>(
  auth: CloudflareAuth,
  pathname: string,
  init?: {
    readonly method?: string | undefined;
    readonly body?: Record<string, unknown> | undefined;
  },
): Promise<Result> {
  const response = await fetch(`${CF_API_BASE_URL}${pathname}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Email": auth.email,
      "X-Auth-Key": auth.globalKey,
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const payload = (await response.json()) as {
    readonly success: boolean;
    readonly errors?: ReadonlyArray<{ readonly message?: string | undefined }>;
    readonly result: Result;
  };

  if (!response.ok || !payload.success) {
    const message =
      payload.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join(", ") || `Cloudflare API request failed for ${pathname}`;
    throw new Error(message);
  }

  return payload.result;
}

async function resolveZone(auth: CloudflareAuth, domain: string): Promise<CloudflareZone> {
  const result = await cfRequest<
    ReadonlyArray<{
      readonly id: string;
      readonly account: { readonly id: string };
    }>
  >(auth, `/zones?name=${encodeURIComponent(domain)}`);
  const zone = result[0];
  if (!zone) {
    throw new Error(`Unable to find a Cloudflare zone named ${domain}.`);
  }
  return { id: zone.id, accountId: zone.account.id };
}

async function findTunnelByName(
  auth: CloudflareAuth,
  accountId: string,
  tunnelName: string,
): Promise<CloudflareTunnel | undefined> {
  const result = await cfRequest<
    ReadonlyArray<{
      readonly id: string;
      readonly name: string;
    }>
  >(auth, `/accounts/${accountId}/cfd_tunnel?is_deleted=false`);
  const tunnel = result.find((candidate) => candidate.name === tunnelName);
  return tunnel ? { id: tunnel.id } : undefined;
}

async function createTunnel(
  auth: CloudflareAuth,
  accountId: string,
  tunnelName: string,
): Promise<CloudflareTunnel> {
  const result = await cfRequest<{
    readonly id: string;
    readonly token: string;
  }>(auth, `/accounts/${accountId}/cfd_tunnel`, {
    method: "POST",
    body: {
      name: tunnelName,
      config_src: "cloudflare",
    },
  });
  return result;
}

async function resolveTunnelToken(
  auth: CloudflareAuth,
  accountId: string,
  tunnelId: string,
): Promise<string> {
  const result = await cfRequest<{ readonly token: string }>(
    auth,
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`,
  );
  return result.token;
}

async function putTunnelConfiguration(input: {
  readonly auth: CloudflareAuth;
  readonly accountId: string;
  readonly tunnelId: string;
  readonly domain: string;
}): Promise<void> {
  await cfRequest(
    input.auth,
    `/accounts/${input.accountId}/cfd_tunnel/${input.tunnelId}/configurations`,
    {
      method: "PUT",
      body: {
        config: {
          ingress: [
            {
              hostname: wildcardHostnameForDomain(input.domain),
              service: "http://traefik:80",
              originRequest: {},
            },
            {
              service: "http_status:404",
            },
          ],
        },
      },
    },
  );
}

async function listDnsRecords(
  auth: CloudflareAuth,
  zoneId: string,
  name: string,
): Promise<ReadonlyArray<CloudflareDnsRecord>> {
  return cfRequest<ReadonlyArray<CloudflareDnsRecord>>(
    auth,
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`,
  );
}

async function upsertWildcardDnsRecord(input: {
  readonly auth: CloudflareAuth;
  readonly zoneId: string;
  readonly domain: string;
  readonly tunnelId: string;
}): Promise<void> {
  const recordName = wildcardHostnameForDomain(input.domain);
  const desiredContent = resolveTunnelHostname(input.tunnelId);
  const existing = await listDnsRecords(input.auth, input.zoneId, recordName);
  const current = existing.find((record) => record.name === recordName);

  if (!current) {
    await cfRequest(input.auth, `/zones/${input.zoneId}/dns_records`, {
      method: "POST",
      body: {
        type: "CNAME",
        proxied: true,
        name: recordName,
        content: desiredContent,
      },
    });
    return;
  }

  if (current.type === "CNAME" && current.content === desiredContent && current.proxied) {
    return;
  }

  await cfRequest(input.auth, `/zones/${input.zoneId}/dns_records/${current.id}`, {
    method: "PUT",
    body: {
      type: "CNAME",
      proxied: true,
      name: recordName,
      content: desiredContent,
    },
  });
}

async function ensureDockerNetwork(networkName: string): Promise<void> {
  try {
    await execFile("docker", ["network", "inspect", networkName]);
    return;
  } catch {
    await execFile("docker", ["network", "create", networkName]);
  }
}

interface SetupInput {
  readonly authEnvPath: string;
  readonly domain: string;
  readonly tunnelName: string;
  readonly dockerNetwork: string;
  readonly outputEnvPath: string;
}

export const setupDevHost = Effect.fn("setupDevHost")(function* (input: SetupInput) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const authEnvPath = path.resolve(expandHomePath(input.authEnvPath));
  const outputEnvPath = path.resolve(input.outputEnvPath);
  const outputDir = path.dirname(outputEnvPath);

  const parsedAuth = parseDotEnv(yield* fs.readFileString(authEnvPath));
  const email = parsedAuth.EMAIL?.trim();
  const globalKey = parsedAuth.GLOBAL?.trim();
  if (!email || !globalKey) {
    throw new Error(`Missing GLOBAL or EMAIL in ${authEnvPath}.`);
  }

  const auth: CloudflareAuth = { email, globalKey };
  const zone = yield* Effect.promise(() => resolveZone(auth, input.domain));

  const existingTunnel = yield* Effect.promise(() =>
    findTunnelByName(auth, zone.accountId, input.tunnelName),
  );
  const tunnel =
    existingTunnel ??
    (yield* Effect.promise(() => createTunnel(auth, zone.accountId, input.tunnelName)));
  const tunnelToken =
    tunnel.token ??
    (yield* Effect.promise(() => resolveTunnelToken(auth, zone.accountId, tunnel.id)));

  yield* Effect.promise(() =>
    putTunnelConfiguration({
      auth,
      accountId: zone.accountId,
      tunnelId: tunnel.id,
      domain: input.domain,
    }),
  );
  yield* Effect.promise(() =>
    upsertWildcardDnsRecord({
      auth,
      zoneId: zone.id,
      domain: input.domain,
      tunnelId: tunnel.id,
    }),
  );
  yield* Effect.promise(() => ensureDockerNetwork(input.dockerNetwork));

  yield* fs.makeDirectory(outputDir, { recursive: true });
  yield* fs.writeFileString(
    outputEnvPath,
    serializeEnvFile({
      CLOUDFLARE_TUNNEL_ID: tunnel.id,
      CLOUDFLARE_TUNNEL_TOKEN: tunnelToken,
      DEV_HOST_DOCKER_NETWORK: input.dockerNetwork,
      DEV_HOST_DOMAIN: input.domain,
      DEV_HOST_TUNNEL_NAME: input.tunnelName,
      DEV_HOST_WILDCARD: wildcardHostnameForDomain(input.domain),
    }),
  );

  yield* Effect.log(
    `Configured Cloudflare tunnel ${input.tunnelName} for ${wildcardHostnameForDomain(input.domain)} and wrote ${outputEnvPath}.`,
  );
});

const setupCommand = Command.make(
  "setup",
  {
    authEnvPath: Flag.string("auth-env").pipe(
      Flag.withDescription("Path to the auth env file that contains GLOBAL and EMAIL."),
      Flag.withDefault(DEFAULT_AUTH_ENV_PATH),
    ),
    domain: Flag.string("domain").pipe(
      Flag.withDescription("Base domain to expose through the wildcard tunnel."),
      Flag.withDefault(DEFAULT_DOMAIN),
    ),
    tunnelName: Flag.string("tunnel-name").pipe(
      Flag.withDescription("Cloudflare Tunnel name."),
      Flag.withDefault(DEFAULT_TUNNEL_NAME),
    ),
    dockerNetwork: Flag.string("docker-network").pipe(
      Flag.withDescription(
        "Shared Docker network name used by Traefik and project dev containers.",
      ),
      Flag.withDefault(DEFAULT_DOCKER_NETWORK),
    ),
    outputEnvPath: Flag.string("output-env").pipe(
      Flag.withDescription("Where to write the generated Cloudflare tunnel env file."),
      Flag.withDefault(DEFAULT_OUTPUT_ENV_PATH),
    ),
  },
  (flags) =>
    setupDevHost({
      authEnvPath: flags.authEnvPath,
      domain: flags.domain,
      tunnelName: flags.tunnelName,
      dockerNetwork: flags.dockerNetwork,
      outputEnvPath: flags.outputEnvPath,
    }),
).pipe(Command.withDescription("Configure the shared Cloudflare-backed dev host stack."));

if (import.meta.main) {
  Command.run(setupCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
