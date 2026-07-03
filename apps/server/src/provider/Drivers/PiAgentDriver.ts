import {
  PiAgentSettings,
  ProviderDriverKind,
  RuntimeItemId,
  TextGenerationError,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ServerProvider,
  type ServerProviderModel,
  TurnId,
  EventId,
} from "@t3tools/contracts";
import { createModelCapabilities, getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
} from "../Errors.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ProviderAdapterShape, ProviderThreadSnapshot } from "../Services/ProviderAdapter.ts";
import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
} from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";

const PROVIDER = ProviderDriverKind.make("piAgent");
const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const PI_THINKING_LEVEL_SET = new Set<string>(PI_THINKING_LEVELS);
const THINKING_CAPABILITIES = createModelCapabilities({
  optionDescriptors: [
    {
      id: "thinking",
      label: "Thinking",
      type: "select",
      currentValue: "medium",
      options: PI_THINKING_LEVELS.map((level) => ({
        id: level,
        label: level === "xhigh" ? "Extra high" : level.charAt(0).toUpperCase() + level.slice(1),
        ...(level === "medium" ? { isDefault: true } : {}),
      })),
    },
  ],
});
const DEFAULT_MODELS = [
  {
    slug: "openai-codex/gpt-5.4-mini",
    name: "GPT-5.4 Mini (Codex)",
    isCustom: false,
    capabilities: THINKING_CAPABILITIES,
  },
] as const;
const decodePiAgentSettings = Schema.decodeSync(PiAgentSettings);
const textEncoder = new TextEncoder();
const encodeJsonString = Schema.encodeEffect(Schema.UnknownFromJsonString);
const decodeJsonString = Schema.decodeEffect(Schema.UnknownFromJsonString);

const unknownToString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return String(value);
};

const formatPiProviderName = (provider: string): string =>
  provider
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatPiModelName = (model: string): string =>
  model
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => {
      if (/^gpt$/i.test(part)) return "GPT";
      if (/^glm$/i.test(part)) return "GLM";
      if (/^qwen$/i.test(part)) return "Qwen";
      if (/^kimi$/i.test(part)) return "Kimi";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");

export function parsePiListModelsOutput(output: string): ReadonlyArray<ServerProviderModel> {
  const models: ServerProviderModel[] = [];
  const seen = new Set<string>();
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("provider")) continue;
    const [provider, model, , , thinking] = line.split(/\s+/);
    if (!provider || !model) continue;
    const slug = `${provider}/${model}`;
    if (seen.has(slug)) continue;
    seen.add(slug);
    const subProvider = formatPiProviderName(provider);
    models.push({
      slug,
      name: formatPiModelName(model),
      shortName: model,
      subProvider,
      isCustom: false,
      capabilities: /^yes$/i.test(thinking ?? "") ? THINKING_CAPABILITIES : EMPTY_CAPABILITIES,
    });
  }
  return models;
}

type PiResumeCursor = {
  readonly sessionFile?: string;
  readonly sessionId?: string;
};

const readPiResumeCursor = (value: unknown): PiResumeCursor | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const cursor = value as { readonly sessionFile?: unknown; readonly sessionId?: unknown };
  const sessionFile = typeof cursor.sessionFile === "string" ? cursor.sessionFile : undefined;
  const sessionId = typeof cursor.sessionId === "string" ? cursor.sessionId : undefined;
  if (sessionFile === undefined && sessionId === undefined) return undefined;
  return {
    ...(sessionFile !== undefined ? { sessionFile } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
};

const readPiStateResumeCursor = (value: unknown): PiResumeCursor | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const state = value as { readonly sessionFile?: unknown; readonly sessionId?: unknown };
  return readPiResumeCursor({ sessionFile: state.sessionFile, sessionId: state.sessionId });
};

const readPiMessageStopReason = (message: unknown): string | undefined => {
  if (typeof message !== "object" || message === null) return undefined;
  const stopReason = (message as { readonly stopReason?: unknown }).stopReason;
  return typeof stopReason === "string" ? stopReason : undefined;
};

const piSessionDirFromEnv = (env: NodeJS.ProcessEnv): string | undefined => {
  const home = env.T3CODE_HOME?.trim();
  return home ? `${home}/pi-agent-sessions` : undefined;
};

const readPiToolCallKey = (toolCallId: unknown): string | undefined =>
  typeof toolCallId === "string" && toolCallId.length > 0 ? toolCallId : undefined;

const readPiTextContent = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const content = (value as { readonly content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) =>
      typeof part === "object" && part !== null ? (part as { text?: unknown }).text : undefined,
    )
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n");
  return text.length > 0 ? text : undefined;
};

const makePiToolData = (input: {
  readonly toolCallId: unknown;
  readonly args: unknown;
  readonly result?: unknown;
  readonly partialResult?: unknown;
}) => {
  const args = typeof input.args === "object" && input.args !== null ? input.args : undefined;
  const command =
    args !== undefined && typeof (args as { readonly command?: unknown }).command === "string"
      ? (args as { readonly command: string }).command
      : undefined;
  return {
    ...(readPiToolCallKey(input.toolCallId)
      ? { toolCallId: readPiToolCallKey(input.toolCallId) }
      : {}),
    ...(command !== undefined ? { command } : {}),
    ...(args !== undefined ? { args } : {}),
    ...(input.partialResult !== undefined ? { partialResult: input.partialResult } : {}),
    ...(input.result !== undefined ? { result: input.result } : {}),
  };
};

export type PiAgentDriverEnv = ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto;

type PiAdapterError =
  | ProviderAdapterProcessError
  | ProviderAdapterRequestError
  | ProviderAdapterSessionClosedError
  | ProviderAdapterSessionNotFoundError;

type PiRpcResponse = {
  readonly type: "response";
  readonly id?: string;
  readonly command?: string;
  readonly success?: boolean;
  readonly data?: unknown;
  readonly error?: unknown;
};

interface PiSessionContext {
  session: ProviderSession;
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
  readonly stdin: Queue.Queue<Uint8Array>;
  readonly pendingResponses: Map<string, Deferred.Deferred<unknown, ProviderAdapterRequestError>>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly toolItems: Map<string, RuntimeItemId>;
  readonly toolArgs: Map<string, unknown>;
  activeTurnId: TurnId | undefined;
  latestResumeCursor: PiResumeCursor | undefined;
  closed: boolean;
}

function modelsFromSettings(customModels: ReadonlyArray<string> | undefined) {
  return providerModelsFromSettings(
    DEFAULT_MODELS,
    PROVIDER,
    customModels ?? [],
    EMPTY_CAPABILITIES,
  );
}

function resolvePiThinkingLevel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  return PI_THINKING_LEVEL_SET.has(normalized) ? normalized : undefined;
}

const checkPiProviderStatus = (settings: PiAgentSettings, env: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const models = modelsFromSettings(settings.customModels);
    const presentation = {
      displayName: "Pi Agent",
      badgeLabel: "Early Access",
      showInteractionModeToggle: false,
      requiresNewThreadForModelChange: true,
    } as const;
    if (!settings.enabled) {
      return buildServerProvider({
        presentation,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pi Agent is disabled in T3 Code settings.",
        },
      });
    }

    const command = settings.binaryPath || "pi";
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], { env });
    const result = yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env,
        shell: spawnCommand.shell,
      }),
    ).pipe(Effect.timeoutOption(4_000), Effect.result);

    if (result._tag === "Failure") {
      const error = result.failure;
      return buildServerProvider({
        presentation,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: !isCommandMissingCause(error),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: isCommandMissingCause(error)
            ? "Pi CLI (`pi`) is not installed or not on PATH."
            : `Failed to execute Pi CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
        },
      });
    }

    if (result.success._tag === "None") {
      return buildServerProvider({
        presentation,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pi CLI health check timed out.",
        },
      });
    }

    const output = `${result.success.value.stdout}\n${result.success.value.stderr}`.trim();
    const listModelsCommand = yield* resolveSpawnCommand(command, ["--list-models"], { env });
    const listModelsResult = yield* spawnAndCollect(
      command,
      ChildProcess.make(listModelsCommand.command, listModelsCommand.args, {
        env,
        shell: listModelsCommand.shell,
      }),
    ).pipe(Effect.timeoutOption(8_000), Effect.result);
    const discoveredModels =
      listModelsResult._tag === "Success" && listModelsResult.success._tag === "Some"
        ? parsePiListModelsOutput(
            `${listModelsResult.success.value.stdout}\n${listModelsResult.success.value.stderr}`,
          )
        : [];
    const availableModels = providerModelsFromSettings(
      discoveredModels.length > 0 ? discoveredModels : DEFAULT_MODELS,
      PROVIDER,
      settings.customModels,
      EMPTY_CAPABILITIES,
    );
    return buildServerProvider({
      presentation,
      enabled: true,
      checkedAt,
      models: availableModels,
      probe: {
        installed: true,
        version: parseGenericCliVersion(output),
        status: "ready",
        auth: { status: "unknown", label: "Managed by Pi" },
        message:
          discoveredModels.length > 0
            ? `Pi CLI is available. ${discoveredModels.length} Pi models discovered. Models and subscriptions are managed by Pi.`
            : output || "Pi CLI is available. Models and subscriptions are managed by Pi.",
      },
    });
  });

function makeUnsupportedTextGeneration(): TextGeneration["Service"] {
  const fail = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: "Pi Agent does not currently support background text generation.",
      }),
    );
  return TextGeneration.of({
    generateCommitMessage: () => fail("generateCommitMessage"),
    generatePrContent: () => fail("generatePrContent"),
    generateBranchName: () => fail("generateBranchName"),
    generateThreadTitle: () => fail("generateThreadTitle"),
  });
}

function makePiAdapter(input: {
  readonly settings: PiAgentSettings;
  readonly env: NodeJS.ProcessEnv;
  readonly instanceId: ProviderInstance["instanceId"];
}) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const crypto = yield* Crypto.Crypto;
    const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<string, PiSessionContext>();
    const runtimeScope = yield* Scope.Scope;

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUUIDv4 = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate Pi runtime identifier.",
            cause,
          }),
      ),
    );
    const nextEventId = Effect.map(randomUUIDv4, EventId.make);
    const nextTurnId = Effect.map(randomUUIDv4, (id) => TurnId.make(`pi-turn-${id}`));

    const emitEvent = (
      context: PiSessionContext,
      type: ProviderRuntimeEvent["type"],
      payload: ProviderRuntimeEvent["payload"],
      options: {
        readonly turnId?: TurnId;
        readonly itemId?: RuntimeItemId;
        readonly raw?: unknown;
      } = {},
    ) =>
      Effect.gen(function* () {
        const event: ProviderRuntimeEvent = {
          eventId: yield* nextEventId,
          provider: PROVIDER,
          providerInstanceId: input.instanceId,
          threadId: context.session.threadId,
          createdAt: yield* nowIso,
          ...(options.turnId ? { turnId: options.turnId } : {}),
          ...(options.itemId ? { itemId: options.itemId } : {}),
          ...(options.raw ? { raw: options.raw } : {}),
          type,
          payload,
        } as ProviderRuntimeEvent;
        yield* PubSub.publish(events, event);
      });

    const rejectPending = (context: PiSessionContext, detail: string) =>
      Effect.forEach(context.pendingResponses, ([, pending]) =>
        Deferred.fail(
          pending,
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "rpc",
            detail,
          }),
        ),
      ).pipe(
        Effect.asVoid,
        Effect.tap(() => Effect.sync(() => context.pendingResponses.clear())),
      );

    const clearActiveTurn = (
      context: PiSessionContext,
      input:
        | { readonly state: "completed"; readonly raw?: unknown }
        | { readonly state: "failed"; readonly errorMessage: string; readonly raw?: unknown },
    ) =>
      Effect.gen(function* () {
        const turnId = context.activeTurnId;
        if (turnId === undefined) return;
        yield* emitEvent(
          context,
          "turn.completed",
          {
            state: input.state,
            stopReason: input.state === "completed" ? "stop" : "error",
            ...(input.state === "failed" ? { errorMessage: input.errorMessage } : {}),
          },
          { turnId, ...(input.raw !== undefined ? { raw: input.raw } : {}) },
        );
        context.activeTurnId = undefined;
        context.session = {
          ...context.session,
          status: input.state === "failed" ? "error" : "ready",
          activeTurnId: undefined,
          ...(input.state === "failed" ? { lastError: input.errorMessage } : {}),
          updatedAt: yield* nowIso,
        };
      });

    const getToolItemId = (context: PiSessionContext, toolCallId: unknown) =>
      Effect.gen(function* () {
        const key =
          typeof toolCallId === "string" && toolCallId.length > 0
            ? toolCallId
            : yield* randomUUIDv4;
        const existing = context.toolItems.get(key);
        if (existing !== undefined) return existing;
        const itemId = RuntimeItemId.make(key);
        context.toolItems.set(key, itemId);
        return itemId;
      });

    const handleRpcResponse = (context: PiSessionContext, event: PiRpcResponse) =>
      Effect.gen(function* () {
        const id = typeof event.id === "string" ? event.id : undefined;
        if (id === undefined) return;
        const pending = context.pendingResponses.get(id);
        if (pending === undefined) return;
        context.pendingResponses.delete(id);
        if (event.success === false) {
          yield* Deferred.fail(
            pending,
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: event.command ?? "rpc",
              detail: unknownToString(event.error ?? event),
              cause: event,
            }),
          );
          return;
        }
        yield* Deferred.succeed(pending, event.data ?? event);
      });

    const refreshResumeCursorInBackground = (context: PiSessionContext) =>
      refreshResumeCursor(context).pipe(Effect.ignore, Effect.forkIn(runtimeScope), Effect.asVoid);

    const handlePiEvent = (context: PiSessionContext, event: Record<string, unknown>) =>
      Effect.gen(function* () {
        if (event.type === "response") {
          yield* handleRpcResponse(context, event as PiRpcResponse);
          return;
        }

        const currentTurnId = context.activeTurnId;
        switch (event.type) {
          case "turn_start":
            if (currentTurnId !== undefined) {
              yield* emitEvent(
                context,
                "turn.started",
                { model: context.session.model },
                { turnId: currentTurnId, raw: event },
              );
            }
            break;
          case "message_update": {
            const delta = event.assistantMessageEvent as
              | {
                  readonly type?: unknown;
                  readonly delta?: unknown;
                  readonly contentIndex?: unknown;
                }
              | undefined;
            if (
              currentTurnId !== undefined &&
              delta?.type === "text_delta" &&
              typeof delta.delta === "string"
            ) {
              yield* emitEvent(
                context,
                "content.delta",
                {
                  streamKind: "assistant_text",
                  delta: delta.delta,
                  ...(Number.isInteger(delta.contentIndex)
                    ? { contentIndex: delta.contentIndex as number }
                    : {}),
                },
                { turnId: currentTurnId, raw: event },
              );
            }
            break;
          }
          case "tool_execution_start": {
            if (currentTurnId === undefined) break;
            const itemId = yield* getToolItemId(context, event.toolCallId);
            const toolCallKey = readPiToolCallKey(event.toolCallId);
            if (toolCallKey !== undefined) {
              context.toolArgs.set(toolCallKey, event.args);
            }
            yield* emitEvent(
              context,
              "item.started",
              {
                itemType: "dynamic_tool_call",
                status: "inProgress",
                title: String(event.toolName ?? "tool"),
                data: makePiToolData({ toolCallId: event.toolCallId, args: event.args }),
              },
              { turnId: currentTurnId, itemId, raw: event },
            );
            break;
          }
          case "tool_execution_update": {
            if (currentTurnId === undefined) break;
            const itemId = yield* getToolItemId(context, event.toolCallId);
            const toolCallKey = readPiToolCallKey(event.toolCallId);
            const args =
              event.args ??
              (toolCallKey !== undefined ? context.toolArgs.get(toolCallKey) : undefined);
            const content = readPiTextContent(event.partialResult);
            yield* emitEvent(
              context,
              "item.updated",
              {
                itemType: "dynamic_tool_call",
                status: "inProgress",
                title: String(event.toolName ?? "tool"),
                ...(content ? { detail: content } : {}),
                data: makePiToolData({
                  toolCallId: event.toolCallId,
                  args,
                  partialResult: event.partialResult,
                }),
              },
              { turnId: currentTurnId, itemId, raw: event },
            );
            break;
          }
          case "tool_execution_end": {
            if (currentTurnId === undefined) break;
            const itemId = yield* getToolItemId(context, event.toolCallId);
            const toolCallKey = readPiToolCallKey(event.toolCallId);
            const args = toolCallKey !== undefined ? context.toolArgs.get(toolCallKey) : undefined;
            const content = readPiTextContent(event.result);
            yield* emitEvent(
              context,
              "item.completed",
              {
                itemType: "dynamic_tool_call",
                status: event.isError === true ? "failed" : "completed",
                title: String(event.toolName ?? "tool"),
                ...(content ? { detail: content } : {}),
                data: makePiToolData({ toolCallId: event.toolCallId, args, result: event.result }),
              },
              { turnId: currentTurnId, itemId, raw: event },
            );
            break;
          }
          case "turn_end":
            if (currentTurnId !== undefined) {
              const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
              context.turns.push({ id: currentTurnId, items: [event.message, ...toolResults] });
              if (readPiMessageStopReason(event.message) === "toolUse") {
                break;
              }
              yield* emitEvent(
                context,
                "turn.completed",
                { state: "completed", stopReason: "stop" },
                { turnId: currentTurnId, raw: event },
              );
            }
            context.activeTurnId = undefined;
            context.session = {
              ...context.session,
              status: "ready",
              activeTurnId: undefined,
              updatedAt: yield* nowIso,
            };
            yield* refreshResumeCursorInBackground(context);
            break;
          case "agent_end":
            yield* clearActiveTurn(context, { state: "completed", raw: event });
            context.session = {
              ...context.session,
              status: "ready",
              activeTurnId: undefined,
              updatedAt: yield* nowIso,
            };
            yield* refreshResumeCursorInBackground(context);
            yield* emitEvent(context, "session.state.changed", { state: "ready" }, { raw: event });
            break;
          case "extension_error":
            yield* emitEvent(
              context,
              "runtime.error",
              { message: "Pi extension error", class: "provider_error", detail: event },
              { raw: event },
            );
            break;
        }
      });

    const startReader = (context: PiSessionContext) => {
      const processChunk = (chunk: string, remainder: { value: string }) => {
        const combined = remainder.value + chunk;
        const lines = combined.split("\n");
        remainder.value = lines.pop() ?? "";
        return Effect.forEach(
          lines,
          (rawLine) => {
            const line = rawLine.replace(/\r$/, "");
            if (line.trim().length === 0) return Effect.void;
            return decodeJsonString(line).pipe(
              Effect.flatMap((event) => handlePiEvent(context, event as Record<string, unknown>)),
              Effect.catch((cause) =>
                emitEvent(context, "runtime.warning", {
                  message: "Failed to parse Pi RPC event.",
                  detail: { line, cause: cause.message },
                }),
              ),
            );
          },
          { discard: true },
        );
      };
      const stdoutRemainder = { value: "" };
      const stderrRemainder = { value: "" };
      return Effect.all(
        [
          context.handle.stdout.pipe(
            Stream.decodeText(),
            Stream.runForEach((chunk) => processChunk(chunk, stdoutRemainder)),
            Effect.forkScoped,
          ),
          context.handle.stderr.pipe(
            Stream.decodeText(),
            Stream.runForEach((chunk) => {
              const combined = stderrRemainder.value + chunk;
              const lines = combined.split("\n");
              stderrRemainder.value = lines.pop() ?? "";
              return Effect.forEach(
                lines.map((line) => line.replace(/\r$/, "").trim()).filter(Boolean),
                (message) => emitEvent(context, "runtime.warning", { message }),
                { discard: true },
              );
            }),
            Effect.forkScoped,
          ),
          Stream.fromQueue(context.stdin).pipe(Stream.run(context.handle.stdin), Effect.forkScoped),
          context.handle.exitCode.pipe(
            Effect.flatMap((code) =>
              Effect.gen(function* () {
                if (context.activeTurnId !== undefined) {
                  yield* clearActiveTurn(context, {
                    state: "failed",
                    errorMessage: `Pi RPC process exited with code ${String(Number(code))}.`,
                  });
                }
                context.closed = true;
                context.session = {
                  ...context.session,
                  status: "closed",
                  activeTurnId: undefined,
                  updatedAt: yield* nowIso,
                };
                yield* emitEvent(context, "session.exited", {
                  reason: `exit code ${String(Number(code))}`,
                  recoverable: false,
                  exitKind: Number(code) === 0 ? "graceful" : "error",
                });
                yield* rejectPending(context, "Pi RPC process exited.");
              }),
            ),
            Effect.forkScoped,
          ),
        ],
        { discard: true },
      ).pipe(Effect.provideService(Scope.Scope, runtimeScope));
    };

    const spawnSession = (
      session: ProviderSession,
      model: string | undefined,
      thinkingLevel: string | undefined,
      cwd: string | undefined,
    ) =>
      Effect.gen(function* () {
        const args = ["--mode", "rpc"];
        const sessionDir = piSessionDirFromEnv(input.env);
        const systemPrompt = input.settings.systemPrompt.trim();
        if (sessionDir !== undefined) args.push("--session-dir", sessionDir);
        if (systemPrompt.length > 0) {
          args.push(
            input.settings.replaceSystemPrompt ? "--system-prompt" : "--append-system-prompt",
            systemPrompt,
          );
        }
        if (model !== undefined) args.push("--model", model);
        if (thinkingLevel !== undefined) args.push("--thinking", thinkingLevel);
        const command = yield* resolveSpawnCommand(input.settings.binaryPath || "pi", args, {
          env: input.env,
        });
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(command.command, command.args, {
              cwd,
              env: input.env,
              extendEnv: true,
              shell: command.shell,
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
              killSignal: "SIGTERM",
              forceKillAfter: "2 seconds",
            }),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: session.threadId,
                  detail: `Failed to start Pi RPC process: ${cause.message}`,
                  cause,
                }),
            ),
            Effect.provideService(Scope.Scope, runtimeScope),
          );
        const stdin = yield* Queue.unbounded<Uint8Array>();
        const context: PiSessionContext = {
          session,
          handle,
          stdin,
          pendingResponses: new Map(),
          turns: [],
          toolItems: new Map(),
          toolArgs: new Map(),
          activeTurnId: undefined,
          latestResumeCursor: readPiResumeCursor(session.resumeCursor),
          closed: false,
        };
        yield* startReader(context);
        return context;
      });

    const sendCommand = (context: PiSessionContext, command: Record<string, unknown>) =>
      Effect.gen(function* () {
        if (context.closed) {
          return yield* new ProviderAdapterSessionClosedError({
            provider: PROVIDER,
            threadId: context.session.threadId,
          });
        }
        const id = typeof command.id === "string" ? command.id : yield* randomUUIDv4;
        const deferred = yield* Deferred.make<unknown, ProviderAdapterRequestError>();
        context.pendingResponses.set(id, deferred);
        const encoded = yield* encodeJsonString({ ...command, id }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: String(command.type ?? "unknown"),
                detail: `Failed to encode Pi RPC command: ${cause.message}`,
                cause,
              }),
          ),
        );
        yield* Queue.offer(context.stdin, textEncoder.encode(`${encoded}\n`));
        const response = yield* Deferred.await(deferred).pipe(
          Effect.timeoutOption("30 seconds"),
          Effect.flatMap((result) =>
            Option.match(result, {
              onNone: () =>
                Effect.fail(
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: String(command.type ?? "unknown"),
                    detail: "Pi RPC request timed out.",
                  }),
                ),
              onSome: Effect.succeed,
            }),
          ),
          Effect.ensuring(Effect.sync(() => context.pendingResponses.delete(id))),
        );
        return response;
      });

    const refreshResumeCursor = (context: PiSessionContext) =>
      Effect.gen(function* () {
        const state = yield* sendCommand(context, { type: "get_state" }).pipe(Effect.result);
        if (state._tag !== "Success") return context.latestResumeCursor;
        const resumeCursor = readPiStateResumeCursor(state.success);
        if (resumeCursor === undefined) return context.latestResumeCursor;
        context.latestResumeCursor = resumeCursor;
        context.session = {
          ...context.session,
          resumeCursor,
          updatedAt: yield* nowIso,
        };
        return resumeCursor;
      });

    const getSession = (threadId: ProviderSession["threadId"]) =>
      Effect.gen(function* () {
        const context = sessions.get(String(threadId));
        if (context === undefined) {
          return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
        }
        if (context.closed) {
          return yield* new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId });
        }
        return context;
      });

    yield* Scope.addFinalizer(
      runtimeScope,
      Effect.forEach(sessions, ([, context]) => context.handle.kill().pipe(Effect.ignore), {
        discard: true,
      }).pipe(Effect.tap(() => Effect.sync(() => sessions.clear()))),
    );

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "unsupported" as const },
      startSession: (startInput) =>
        Effect.gen(function* () {
          const now = yield* nowIso;
          const resumeCursor = readPiResumeCursor(startInput.resumeCursor);
          const session: ProviderSession = {
            provider: PROVIDER,
            providerInstanceId: input.instanceId,
            status: "ready",
            runtimeMode: startInput.runtimeMode,
            ...(startInput.cwd ? { cwd: startInput.cwd } : {}),
            ...(startInput.modelSelection?.model ? { model: startInput.modelSelection.model } : {}),
            ...(resumeCursor !== undefined ? { resumeCursor } : {}),
            threadId: startInput.threadId,
            createdAt: now,
            updatedAt: now,
          };
          const context = yield* spawnSession(
            session,
            startInput.modelSelection?.model,
            resolvePiThinkingLevel(
              getModelSelectionStringOptionValue(startInput.modelSelection, "thinking"),
            ),
            startInput.cwd,
          );
          sessions.set(String(startInput.threadId), context);
          if (resumeCursor?.sessionFile !== undefined) {
            yield* sendCommand(context, {
              type: "switch_session",
              sessionPath: resumeCursor.sessionFile,
            });
          } else {
            yield* sendCommand(context, {
              type: "set_session_name",
              name: `T3 ${String(startInput.threadId)}`,
            }).pipe(Effect.ignore);
          }
          yield* refreshResumeCursor(context);
          yield* emitEvent(context, "session.started", {
            message: "Pi RPC session started.",
            ...(context.latestResumeCursor !== undefined
              ? { resume: context.latestResumeCursor }
              : {}),
          });
          yield* emitEvent(context, "thread.started", {});
          return context.session;
        }),
      sendTurn: (turnInput) =>
        Effect.gen(function* () {
          const context = yield* getSession(turnInput.threadId);
          const turnId = yield* nextTurnId;
          const wasRunning =
            context.activeTurnId !== undefined || context.session.status === "running";
          context.activeTurnId = turnId;
          context.session = {
            ...context.session,
            status: "running",
            activeTurnId: turnId,
            updatedAt: yield* nowIso,
          };
          const command = {
            type: "prompt",
            message: turnInput.input ?? "",
            ...(wasRunning ? { streamingBehavior: "steer" } : {}),
          };
          yield* sendCommand(context, command).pipe(
            Effect.tapError((error) =>
              clearActiveTurn(context, {
                state: "failed",
                errorMessage: unknownToString(error),
                raw: error,
              }),
            ),
          );
          const resumeCursor = yield* refreshResumeCursor(context);
          return {
            threadId: turnInput.threadId,
            turnId,
            ...(resumeCursor !== undefined ? { resumeCursor } : {}),
          };
        }),
      interruptTurn: (threadId) =>
        Effect.gen(function* () {
          const context = yield* getSession(threadId);
          yield* sendCommand(context, { type: "abort" }).pipe(Effect.ignore);
          if (context.activeTurnId !== undefined) {
            yield* emitEvent(
              context,
              "turn.aborted",
              { reason: "Interrupted by user." },
              { turnId: context.activeTurnId },
            );
          }
          context.activeTurnId = undefined;
          context.session = {
            ...context.session,
            status: "ready",
            activeTurnId: undefined,
            updatedAt: yield* nowIso,
          };
        }),
      respondToRequest: () => Effect.void,
      respondToUserInput: () => Effect.void,
      stopSession: (threadId) =>
        Effect.gen(function* () {
          const context = sessions.get(String(threadId));
          if (context === undefined) return;
          sessions.delete(String(threadId));
          yield* context.handle.kill().pipe(Effect.ignore);
        }),
      listSessions: () =>
        Effect.sync(() => Array.from(sessions.values()).map((context) => context.session)),
      hasSession: (threadId) => Effect.sync(() => sessions.has(String(threadId))),
      readThread: (threadId) =>
        Effect.gen(function* () {
          const context = yield* getSession(threadId);
          const response = yield* sendCommand(context, { type: "get_messages" }).pipe(
            Effect.result,
          );
          if (response._tag === "Success") {
            const data = response.success as { readonly messages?: unknown };
            if (Array.isArray(data.messages)) {
              return {
                threadId,
                turns: [{ id: TurnId.make("pi-history"), items: data.messages }],
              } satisfies ProviderThreadSnapshot;
            }
          }
          return { threadId, turns: context.turns } satisfies ProviderThreadSnapshot;
        }),
      rollbackThread: (threadId, numTurns) =>
        Effect.gen(function* () {
          const context = yield* getSession(threadId);
          context.turns.splice(Math.max(0, context.turns.length - numTurns), numTurns);
          return { threadId, turns: context.turns } satisfies ProviderThreadSnapshot;
        }),
      stopAll: () =>
        Effect.gen(function* () {
          yield* Effect.forEach(
            sessions,
            ([, context]) => context.handle.kill().pipe(Effect.ignore),
            { discard: true },
          );
          sessions.clear();
        }),
      streamEvents: Stream.fromPubSub(events),
    } satisfies ProviderAdapterShape<PiAdapterError>;
  });
}

export const PiAgentDriver: ProviderDriver<PiAgentSettings, PiAgentDriverEnv> = {
  driverKind: PROVIDER,
  metadata: {
    displayName: "Pi Agent",
    supportsMultipleInstances: true,
  },
  configSchema: PiAgentSettings,
  defaultConfig: (): PiAgentSettings => decodePiAgentSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const effectiveConfig = { ...config, enabled } satisfies PiAgentSettings;
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: PROVIDER,
        instanceId,
      });
      const adapter = yield* makePiAdapter({
        settings: effectiveConfig,
        env: processEnv,
        instanceId,
      });
      const snapshotDraft = yield* checkPiProviderStatus(effectiveConfig, processEnv);
      const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
        provider: PROVIDER,
        packageName: null,
      });
      const snapshot: ServerProvider = {
        ...snapshotDraft,
        driver: PROVIDER,
        instanceId,
        ...(displayName ? { displayName } : {}),
        ...(accentColor ? { accentColor } : {}),
        continuation: { groupKey: continuationIdentity.continuationKey },
      };

      return {
        instanceId,
        driverKind: PROVIDER,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot: {
          maintenanceCapabilities,
          getSnapshot: Effect.succeed(snapshot),
          refresh: Effect.succeed(snapshot),
          streamChanges: Stream.empty,
        },
        adapter,
        textGeneration: makeUnsupportedTextGeneration(),
      } satisfies ProviderInstance;
    }),
};
