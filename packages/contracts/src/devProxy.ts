import { Effect, Schema } from "effect";
import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DevProxyTargetId = TrimmedNonEmptyString.pipe(Schema.brand("DevProxyTargetId"));
export type DevProxyTargetId = typeof DevProxyTargetId.Type;

export const DevProxyTarget = Schema.Struct({
  id: DevProxyTargetId,
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  targetUrl: TrimmedNonEmptyString,
  routePath: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DevProxyTarget = typeof DevProxyTarget.Type;

export const DevProxyRuntimeStatus = Schema.Struct({
  targetId: DevProxyTargetId,
  status: Schema.Literals(["unknown", "reachable", "unreachable"]),
  lastCheckedAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(Schema.String),
});
export type DevProxyRuntimeStatus = typeof DevProxyRuntimeStatus.Type;

export const DevProxySettings = Schema.Struct({
  targets: Schema.Array(DevProxyTarget).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type DevProxySettings = typeof DevProxySettings.Type;

export const DevProxyTargetInput = Schema.Struct({
  id: Schema.optionalKey(DevProxyTargetId),
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  targetUrl: TrimmedNonEmptyString,
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type DevProxyTargetInput = typeof DevProxyTargetInput.Type;

export const DevProxyListTargetsInput = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
});
export type DevProxyListTargetsInput = typeof DevProxyListTargetsInput.Type;

export const DevProxyListTargetsResult = Schema.Struct({
  targets: Schema.Array(DevProxyTarget),
  statuses: Schema.Array(DevProxyRuntimeStatus),
});
export type DevProxyListTargetsResult = typeof DevProxyListTargetsResult.Type;

export const DevProxyUpsertTargetInput = Schema.Struct({
  target: DevProxyTargetInput,
});
export type DevProxyUpsertTargetInput = typeof DevProxyUpsertTargetInput.Type;

export const DevProxyUpsertTargetResult = Schema.Struct({
  target: DevProxyTarget,
  status: DevProxyRuntimeStatus,
});
export type DevProxyUpsertTargetResult = typeof DevProxyUpsertTargetResult.Type;

export const DevProxyRemoveTargetInput = Schema.Struct({
  projectId: ProjectId,
  targetId: DevProxyTargetId,
});
export type DevProxyRemoveTargetInput = typeof DevProxyRemoveTargetInput.Type;

export const DevProxyRemoveTargetResult = Schema.Struct({
  removed: Schema.Boolean,
});
export type DevProxyRemoveTargetResult = typeof DevProxyRemoveTargetResult.Type;

export const DevProxyHealthCheckTargetInput = Schema.Struct({
  projectId: ProjectId,
  targetId: DevProxyTargetId,
});
export type DevProxyHealthCheckTargetInput = typeof DevProxyHealthCheckTargetInput.Type;

export const DevProxyHealthCheckTargetResult = Schema.Struct({
  target: DevProxyTarget,
  status: DevProxyRuntimeStatus,
});
export type DevProxyHealthCheckTargetResult = typeof DevProxyHealthCheckTargetResult.Type;

export class DevProxyError extends Schema.TaggedErrorClass<DevProxyError>()("DevProxyError", {
  message: TrimmedNonEmptyString,
  code: Schema.Literals(["not_found", "disabled", "forbidden", "invalid_target", "upstream_error"]),
  cause: Schema.optional(Schema.Defect),
}) {}
