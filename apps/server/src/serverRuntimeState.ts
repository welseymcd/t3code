import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { writeFileStringAtomically } from "./atomicWrite.ts";
import type * as ServerConfig from "./config.ts";
import { makeHtmlDocumentPublishingInfo } from "./htmlDocuments.ts";
import { formatHostForUrl, isWildcardHost } from "./startupAccess.ts";

export const PersistedServerRuntimeState = Schema.Struct({
  version: Schema.Literal(1),
  pid: Schema.Int,
  host: Schema.optional(Schema.String),
  port: Schema.Int,
  origin: Schema.String,
  htmlDocumentsDir: Schema.optional(Schema.String),
  htmlDocumentsUrl: Schema.optional(Schema.String),
  htmlDocumentProjectDirTemplate: Schema.optional(Schema.String),
  htmlDocumentProjectUrlTemplate: Schema.optional(Schema.String),
  htmlDocumentThreadDirTemplate: Schema.optional(Schema.String),
  htmlDocumentThreadUrlTemplate: Schema.optional(Schema.String),
  tailscaleOrigin: Schema.optional(Schema.String),
  tailscaleHtmlDocumentsUrl: Schema.optional(Schema.String),
  tailscaleHtmlDocumentProjectUrlTemplate: Schema.optional(Schema.String),
  tailscaleHtmlDocumentThreadUrlTemplate: Schema.optional(Schema.String),
  startedAt: Schema.String,
});
export type PersistedServerRuntimeState = typeof PersistedServerRuntimeState.Type;

export class ServerRuntimeStateError extends Schema.TaggedErrorClass<ServerRuntimeStateError>()(
  "ServerRuntimeStateError",
  {
    operation: Schema.Literals(["persist", "read", "decode", "clear"]),
    statePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} server runtime state at ${this.statePath}.`;
  }
}

const decodePersistedServerRuntimeState = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PersistedServerRuntimeState),
);

const runtimeOriginForConfig = (
  config: Pick<ServerConfig.ServerConfig["Service"], "host">,
  port: number,
): PersistedServerRuntimeState["origin"] => {
  const hostname =
    config.host && !isWildcardHost(config.host) ? formatHostForUrl(config.host) : "127.0.0.1";
  return `http://${hostname}:${port}`;
};

export const makePersistedServerRuntimeState = (input: {
  readonly config: Pick<ServerConfig.ServerConfig["Service"], "host"> &
    Partial<Pick<ServerConfig.ServerConfig["Service"], "htmlDocumentsDir">>;
  readonly port: number;
  readonly tailscaleOrigin?: string | null;
}): Effect.Effect<PersistedServerRuntimeState> =>
  Effect.map(DateTime.now, (now) => {
    const origin = runtimeOriginForConfig(input.config, input.port);
    const tailscaleOrigin = input.tailscaleOrigin
      ? new URL("/", input.tailscaleOrigin).origin
      : undefined;
    const publishingInfo = input.config.htmlDocumentsDir
      ? makeHtmlDocumentPublishingInfo({
          rootDirectory: input.config.htmlDocumentsDir,
          baseUrl: origin,
          ...(tailscaleOrigin ? { tailscaleBaseUrl: tailscaleOrigin } : {}),
        })
      : undefined;
    return {
      version: 1,
      pid: process.pid,
      ...(input.config.host ? { host: input.config.host } : {}),
      port: input.port,
      origin,
      ...(publishingInfo
        ? {
            htmlDocumentsDir: publishingInfo.rootDirectory,
            htmlDocumentsUrl: publishingInfo.rootUrl,
            htmlDocumentProjectDirTemplate: publishingInfo.projectDirectoryTemplate,
            htmlDocumentProjectUrlTemplate: publishingInfo.projectUrlTemplate,
            htmlDocumentThreadDirTemplate: publishingInfo.threadDirectoryTemplate,
            htmlDocumentThreadUrlTemplate: publishingInfo.threadUrlTemplate,
          }
        : {}),
      ...(tailscaleOrigin
        ? {
            tailscaleOrigin,
            ...(publishingInfo?.tailscaleRootUrl
              ? {
                  tailscaleHtmlDocumentsUrl: publishingInfo.tailscaleRootUrl,
                  tailscaleHtmlDocumentProjectUrlTemplate:
                    publishingInfo.tailscaleProjectUrlTemplate,
                  tailscaleHtmlDocumentThreadUrlTemplate: publishingInfo.tailscaleThreadUrlTemplate,
                }
              : {}),
          }
        : {}),
      startedAt: DateTime.formatIso(now),
    };
  });

export const persistServerRuntimeState = (input: {
  readonly path: string;
  readonly state: PersistedServerRuntimeState;
}) =>
  writeFileStringAtomically({
    filePath: input.path,
    contents: `${JSON.stringify(input.state)}\n`,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ServerRuntimeStateError({
          operation: "persist",
          statePath: input.path,
          cause,
        }),
    ),
  );

export const clearPersistedServerRuntimeState = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(path, { force: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ServerRuntimeStateError({
            operation: "clear",
            statePath: path,
            cause,
          }),
      ),
      Effect.catchTags({
        ServerRuntimeStateError: (error) =>
          Effect.logWarning(error.message).pipe(
            Effect.annotateLogs({
              operation: error.operation,
              statePath: error.statePath,
              cause: error,
            }),
          ),
      }),
    );
  });

export const readPersistedServerRuntimeState = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(path).pipe(
      Effect.matchEffect({
        onFailure: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : Effect.fail(
                new ServerRuntimeStateError({
                  operation: "read",
                  statePath: path,
                  cause,
                }),
              ),
        onSuccess: (contents) => Effect.succeed(Option.some(contents)),
      }),
    );
    if (Option.isNone(raw)) {
      return Option.none<PersistedServerRuntimeState>();
    }

    const trimmed = raw.value.trim();
    if (trimmed.length === 0) {
      return Option.none<PersistedServerRuntimeState>();
    }

    return yield* decodePersistedServerRuntimeState(trimmed).pipe(
      Effect.map(Option.some),
      Effect.mapError(
        (cause) =>
          new ServerRuntimeStateError({
            operation: "decode",
            statePath: path,
            cause,
          }),
      ),
    );
  }).pipe(
    Effect.catchTags({
      ServerRuntimeStateError: (error) =>
        Effect.logWarning(error.message).pipe(
          Effect.annotateLogs({
            operation: error.operation,
            statePath: error.statePath,
            cause: error,
          }),
          Effect.as(Option.none<PersistedServerRuntimeState>()),
        ),
    }),
  );
