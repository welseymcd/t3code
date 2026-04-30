import {
  DevProxyError,
  type DevProxyHealthCheckTargetResult,
  DevProxyTarget,
  DevProxyTargetId,
  type DevProxyHealthCheckTargetInput,
  type DevProxyListTargetsInput,
  type DevProxyListTargetsResult,
  type DevProxyRemoveTargetInput,
  type DevProxyRemoveTargetResult,
  type DevProxyRuntimeStatus,
  type DevProxyUpsertTargetInput,
  type DevProxyUpsertTargetResult,
  ProjectId,
} from "@t3tools/contracts";
import { Context, Effect, Layer, Ref, Schema, Stream } from "effect";
import { ServerSettingsService } from "./serverSettings.ts";

const DEV_PROXY_ROUTE_PREFIX = "/proxy/projects";
const DEV_PROXY_HEALTH_TIMEOUT_MS = 2_000;

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export interface ParsedDevProxyRoute {
  readonly projectId: ProjectId;
  readonly targetId: DevProxyTargetId;
  readonly suffixPath: string;
}

export interface DevProxyTargetUrlValidation {
  readonly ok: boolean;
  readonly normalizedUrl?: string;
  readonly reason?: string;
}

export interface DevProxyRegistryShape {
  readonly listTargets: (
    input: DevProxyListTargetsInput,
  ) => Effect.Effect<DevProxyListTargetsResult, DevProxyError>;
  readonly upsertTarget: (
    input: DevProxyUpsertTargetInput,
  ) => Effect.Effect<DevProxyUpsertTargetResult, DevProxyError>;
  readonly removeTarget: (
    input: DevProxyRemoveTargetInput,
  ) => Effect.Effect<DevProxyRemoveTargetResult, DevProxyError>;
  readonly healthCheckTarget: (
    input: DevProxyHealthCheckTargetInput,
  ) => Effect.Effect<DevProxyHealthCheckTargetResult, DevProxyError>;
  readonly getTarget: (
    projectId: ProjectId,
    targetId: DevProxyTargetId,
  ) => Effect.Effect<DevProxyTarget, DevProxyError>;
}

export class DevProxyRegistry extends Context.Service<DevProxyRegistry, DevProxyRegistryShape>()(
  "t3/devProxy/DevProxyRegistry",
) {}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTargetId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function makeUniqueTargetId(input: {
  readonly preferredId: string;
  readonly existingIds: ReadonlySet<DevProxyTargetId>;
}): DevProxyTargetId {
  const base = normalizeTargetId(input.preferredId) || `target-${crypto.randomUUID()}`;
  let candidate = Schema.decodeSync(DevProxyTargetId)(base);
  let suffix = 2;
  while (input.existingIds.has(candidate)) {
    candidate = Schema.decodeSync(DevProxyTargetId)(`${base}-${suffix}`);
    suffix += 1;
  }
  return candidate;
}

export function makeDevProxyRoutePath(input: {
  readonly projectId: ProjectId;
  readonly targetId: DevProxyTargetId;
}): string {
  return `${DEV_PROXY_ROUTE_PREFIX}/${encodeURIComponent(input.projectId)}/${encodeURIComponent(input.targetId)}`;
}

export function parseDevProxyRoute(pathname: string): ParsedDevProxyRoute | null {
  if (!pathname.startsWith(`${DEV_PROXY_ROUTE_PREFIX}/`)) {
    return null;
  }

  const rest = pathname.slice(`${DEV_PROXY_ROUTE_PREFIX}/`.length);
  const [rawProjectId, rawTargetId, ...suffixSegments] = rest.split("/");
  if (!rawProjectId || !rawTargetId) {
    return null;
  }

  try {
    const projectId = Schema.decodeSync(ProjectId)(decodeURIComponent(rawProjectId));
    const targetId = Schema.decodeSync(DevProxyTargetId)(decodeURIComponent(rawTargetId));
    return {
      projectId,
      targetId,
      suffixPath: suffixSegments.length === 0 ? "/" : `/${suffixSegments.join("/")}`,
    };
  } catch {
    return null;
  }
}

export function isLoopbackDevProxyHostname(hostname: string): boolean {
  const normalizedHostname = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return LOOPBACK_HOSTNAMES.has(normalizedHostname);
}

export function validateDevProxyTargetUrl(input: string): DevProxyTargetUrlValidation {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "Enter a valid absolute URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "ws:") {
    return { ok: false, reason: "Only http:// and ws:// targets are supported." };
  }
  if (!isLoopbackDevProxyHostname(url.hostname)) {
    return { ok: false, reason: "Targets must use localhost, 127.0.0.1, or ::1." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Target URLs must not include credentials." };
  }

  url.hash = "";
  return { ok: true, normalizedUrl: url.toString() };
}

export function resolveDevProxyUpstreamUrl(input: {
  readonly targetUrl: string;
  readonly suffixPath: string;
  readonly search: string;
  readonly transport: "http" | "websocket";
}): URL {
  const upstreamUrl = new URL(input.targetUrl);
  upstreamUrl.protocol =
    input.transport === "websocket"
      ? upstreamUrl.protocol === "http:"
        ? "ws:"
        : upstreamUrl.protocol
      : upstreamUrl.protocol === "ws:"
        ? "http:"
        : upstreamUrl.protocol;

  const basePathname = upstreamUrl.pathname === "/" ? "" : upstreamUrl.pathname.replace(/\/+$/, "");
  upstreamUrl.pathname = `${basePathname}${input.suffixPath}` || "/";
  upstreamUrl.search = input.search;
  upstreamUrl.hash = "";
  return upstreamUrl;
}

export function rewriteDevProxyLocation(input: {
  readonly location: string;
  readonly requestOrigin: string;
  readonly proxyRoutePath: string;
  readonly targetUrl: string;
}): string {
  let locationUrl: URL;
  const targetUrl = new URL(input.targetUrl);
  const targetOrigin = targetUrl.origin;

  try {
    locationUrl = new URL(input.location, targetOrigin);
  } catch {
    return input.location;
  }

  if (locationUrl.origin !== targetOrigin) {
    return input.location;
  }

  const targetBasePath = targetUrl.pathname === "/" ? "" : targetUrl.pathname.replace(/\/+$/, "");
  const locationPath = locationUrl.pathname;
  const suffixPath =
    targetBasePath.length > 0 && locationPath.startsWith(`${targetBasePath}/`)
      ? locationPath.slice(targetBasePath.length)
      : targetBasePath.length > 0 && locationPath === targetBasePath
        ? "/"
        : locationPath;

  return `${input.requestOrigin}${input.proxyRoutePath}${suffixPath}${locationUrl.search}${locationUrl.hash}`;
}

function makeUnknownStatus(targetId: DevProxyTargetId): DevProxyRuntimeStatus {
  return {
    targetId,
    status: "unknown",
    lastCheckedAt: null,
    lastError: null,
  };
}

function toDevProxyError(error: unknown): DevProxyError {
  return Schema.is(DevProxyError)(error)
    ? error
    : new DevProxyError({
        code: "upstream_error",
        message: error instanceof Error ? error.message : "Dev proxy request failed.",
        cause: error,
      });
}

const makeDevProxyRegistry = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
  const initialSettings = yield* serverSettings.getSettings;
  const targetsRef = yield* Ref.make<ReadonlyArray<DevProxyTarget>>(
    initialSettings.devProxy.targets,
  );
  const statusesRef = yield* Ref.make<ReadonlyMap<DevProxyTargetId, DevProxyRuntimeStatus>>(
    new Map(initialSettings.devProxy.targets.map((target) => [target.id, makeUnknownStatus(target.id)])),
  );

  const syncTargets = (targets: ReadonlyArray<DevProxyTarget>) =>
    Ref.set(targetsRef, targets).pipe(
      Effect.zipRight(
        Ref.update(statusesRef, (statuses) => {
          const next = new Map<DevProxyTargetId, DevProxyRuntimeStatus>();
          for (const target of targets) {
            next.set(target.id, statuses.get(target.id) ?? makeUnknownStatus(target.id));
          }
          return next;
        }),
      ),
    );

  yield* serverSettings.streamChanges.pipe(
    Stream.map((settings) => settings.devProxy.targets),
    Stream.runForEach(syncTargets),
    Effect.ignoreCause({ log: true }),
    Effect.forkDaemon,
    Effect.asVoid,
  );

  const readTarget = (projectId: ProjectId, targetId: DevProxyTargetId) =>
    Ref.get(targetsRef).pipe(
      Effect.flatMap((targets) => {
        const target = targets.find(
          (candidate) => candidate.projectId === projectId && candidate.id === targetId,
        );
        return target
          ? Effect.succeed(target)
          : Effect.fail(
              new DevProxyError({
                code: "not_found",
                message: "Dev proxy target was not found.",
              }),
            );
      }),
    );

  const getStatus = (targetId: DevProxyTargetId) =>
    Ref.get(statusesRef).pipe(Effect.map((statuses) => statuses.get(targetId) ?? makeUnknownStatus(targetId)));

  const updateStatus = (status: DevProxyRuntimeStatus) =>
    Ref.update(statusesRef, (statuses) => {
      const next = new Map(statuses);
      next.set(status.targetId, status);
      return next;
    });

  const healthCheck = (target: DevProxyTarget) =>
    Effect.gen(function* () {
      const checkedAt = nowIso();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEV_PROXY_HEALTH_TIMEOUT_MS);
      try {
        yield* Effect.promise(() =>
          fetch(resolveDevProxyUpstreamUrl({
            targetUrl: target.targetUrl,
            suffixPath: "/",
            search: "",
            transport: "http",
          }), {
            method: "HEAD",
            signal: controller.signal,
          }),
        );
        const status = {
          targetId: target.id,
          status: "reachable" as const,
          lastCheckedAt: checkedAt,
          lastError: null,
        };
        yield* updateStatus(status);
        return status;
      } catch (error) {
        const status = {
          targetId: target.id,
          status: "unreachable" as const,
          lastCheckedAt: checkedAt,
          lastError: error instanceof Error ? error.message : "Health check failed.",
        };
        yield* updateStatus(status);
        return status;
      } finally {
        clearTimeout(timeout);
      }
    });

  return DevProxyRegistry.of({
    listTargets: (input) =>
      Effect.gen(function* () {
        const targets = yield* Ref.get(targetsRef);
        const visibleTargets = input.projectId
          ? targets.filter((target) => target.projectId === input.projectId)
          : targets;
        const statuses = yield* Ref.get(statusesRef);
        return {
          targets: [...visibleTargets],
          statuses: visibleTargets.map(
            (target) => statuses.get(target.id) ?? makeUnknownStatus(target.id),
          ),
        };
      }).pipe(Effect.mapError(toDevProxyError)),

    upsertTarget: ({ target: input }) =>
      Effect.gen(function* () {
        const validation = validateDevProxyTargetUrl(input.targetUrl);
        if (!validation.ok || !validation.normalizedUrl) {
          return yield* new DevProxyError({
            code: "invalid_target",
            message: validation.reason ?? "Invalid dev proxy target URL.",
          });
        }

        const currentTargets = yield* Ref.get(targetsRef);
        const existing =
          input.id === undefined
            ? undefined
            : currentTargets.find(
                (candidate) => candidate.projectId === input.projectId && candidate.id === input.id,
              );
        const existingIds = new Set(
          currentTargets
            .filter((candidate) => candidate.projectId === input.projectId)
            .map((candidate) => candidate.id),
        );
        const targetId =
          existing?.id ??
          (input.id && !existingIds.has(input.id)
            ? input.id
            : makeUniqueTargetId({
                preferredId: input.id ?? input.label,
                existingIds,
              }));
        const updatedAt = nowIso();
        const target: DevProxyTarget = {
          id: targetId,
          projectId: input.projectId,
          workspaceRoot: input.workspaceRoot,
          label: input.label.trim(),
          targetUrl: validation.normalizedUrl,
          routePath: makeDevProxyRoutePath({ projectId: input.projectId, targetId }),
          enabled: input.enabled,
          createdAt: existing?.createdAt ?? updatedAt,
          updatedAt,
        };
        const nextTargets = existing
          ? currentTargets.map((candidate) =>
              candidate.projectId === input.projectId && candidate.id === targetId ? target : candidate,
            )
          : [...currentTargets, target];
        const settings = yield* serverSettings.updateSettings({
          devProxy: {
            targets: nextTargets,
          },
        });
        yield* syncTargets(settings.devProxy.targets);
        const status = yield* getStatus(target.id);
        return { target, status };
      }).pipe(Effect.mapError(toDevProxyError)),

    removeTarget: (input) =>
      Effect.gen(function* () {
        const currentTargets = yield* Ref.get(targetsRef);
        const nextTargets = currentTargets.filter(
          (target) => !(target.projectId === input.projectId && target.id === input.targetId),
        );
        const removed = nextTargets.length !== currentTargets.length;
        if (!removed) {
          return { removed: false };
        }
        const settings = yield* serverSettings.updateSettings({
          devProxy: {
            targets: nextTargets,
          },
        });
        yield* syncTargets(settings.devProxy.targets);
        return { removed: true };
      }).pipe(Effect.mapError(toDevProxyError)),

    healthCheckTarget: (input) =>
      Effect.gen(function* () {
        const target = yield* readTarget(input.projectId, input.targetId);
        const status = yield* healthCheck(target);
        return { target, status };
      }).pipe(Effect.mapError(toDevProxyError)),

    getTarget: readTarget,
  });
});

export const DevProxyRegistryLive = Layer.effect(DevProxyRegistry, makeDevProxyRegistry);
