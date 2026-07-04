// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  ApprovalRequestId,
  PiAgentSettings,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { parsePiListModelsOutput, PiAgentDriver } from "./PiAgentDriver.ts";

const decodePiAgentSettings = Schema.decodeSync(PiAgentSettings);

async function makeMockPiWrapper(input: {
  readonly requestLogPath: string;
  readonly failFirstPrompt?: boolean;
  readonly toolLoop?: boolean;
}) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "pi-agent-mock-"));
  const wrapperPath = NodePath.join(dir, "fake-pi.sh");
  const mockPath = NodePath.join(dir, "mock-pi-rpc.mjs");
  const mockScript = `import fs from "node:fs";
import readline from "node:readline";

const logPath = process.env.T3_PI_REQUEST_LOG_PATH;
let promptCount = 0;
const rl = readline.createInterface({ input: process.stdin });
const write = (event) => process.stdout.write(JSON.stringify(event) + "\\n");

for await (const line of rl) {
  if (line.trim().length === 0) continue;
  const request = JSON.parse(line);
  fs.appendFileSync(logPath, JSON.stringify(request) + "\\n");
  if (
    request.type === "set_session_name" ||
    request.type === "switch_session" ||
    request.type === "set_model" ||
    request.type === "set_thinking_level" ||
    request.type === "extension_ui_response"
  ) {
    write({ type: "response", id: request.id, success: true, data: {} });
    continue;
  }
  if (request.type === "get_state") {
    write({
      type: "response",
      id: request.id,
      success: true,
      data: { sessionId: "mock-session-1", sessionFile: "/tmp/mock-pi-session.json" },
    });
    continue;
  }
  if (request.type === "prompt") {
    promptCount += 1;
    if (process.env.T3_PI_FAIL_FIRST_PROMPT === "1" && promptCount === 1) {
      write({
        type: "response",
        id: request.id,
        success: false,
        error: "Agent is already processing.",
      });
      continue;
    }
    write({ type: "turn_start" });
    if (request.message === "ask") {
      write({
        type: "extension_ui_request",
        id: "ui-1",
        method: "confirm",
        title: "Proceed?",
        message: "Allow action?",
      });
      write({ type: "response", id: request.id, success: true, data: {} });
      continue;
    }
    if (request.message === "snapshot") {
      write({
        type: "message_update",
        assistantMessageEvent: {
          type: "message_snapshot",
          id: "assistant-1",
          contentIndex: 0,
          message: { role: "assistant", content: [{ type: "text", text: "o" }] },
        },
      });
      write({
        type: "message_update",
        assistantMessageEvent: {
          type: "message_snapshot",
          id: "assistant-1",
          contentIndex: 0,
          message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
        },
      });
      write({ type: "turn_end", message: { role: "assistant", content: [], stopReason: "stop" } });
      write({ type: "agent_end" });
      write({ type: "response", id: request.id, success: true, data: {} });
      continue;
    }
    if (process.env.T3_PI_TOOL_LOOP === "1") {
      write({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "bash",
        args: { command: "pwd" },
      });
      write({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "/tmp\\n" }] },
        isError: false,
      });
      write({
        type: "turn_end",
        message: { role: "assistant", content: [], stopReason: "toolUse" },
        toolResults: [{ role: "toolResult", toolCallId: "tool-1" }],
      });
      write({ type: "turn_start" });
    }
    write({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "ok", contentIndex: 0 },
    });
    write({ type: "turn_end", message: { role: "assistant", content: [], stopReason: "stop" } });
    write({ type: "agent_end" });
    write({ type: "response", id: request.id, success: true, data: {} });
    continue;
  }
  if (request.type === "abort") {
    write({ type: "response", id: request.id, success: true, data: {} });
  }
}
`;
  const script = `#!/bin/sh
export T3_PI_REQUEST_LOG_PATH=${JSON.stringify(input.requestLogPath)}
export T3_PI_FAIL_FIRST_PROMPT=${JSON.stringify(input.failFirstPrompt ? "1" : "")}
export T3_PI_TOOL_LOOP=${JSON.stringify(input.toolLoop ? "1" : "")}
if [ "$1" = "--version" ]; then
  echo "pi 1.0.0"
  exit 0
fi
if [ "$1" = "--list-models" ]; then
  printf "provider model context max-out thinking images\\nmock model 128K 32K yes no\\n"
  exit 0
fi
if [ "$1" = "--print" ] || [ "$1" = "-p" ]; then
  cat >/dev/null
  printf '{"title":"Fix Pi agent"}\\n'
  exit 0
fi
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockPath)} "$@"
`;
  await NodeFSP.writeFile(mockPath, mockScript, "utf8");
  await NodeFSP.writeFile(wrapperPath, script, "utf8");
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

async function readJsonLines(filePath: string) {
  const raw = await NodeFSP.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function makeTestInstance(binaryPath: string) {
  return PiAgentDriver.create({
    instanceId: ProviderInstanceId.make("piAgent"),
    displayName: undefined,
    environment: [],
    enabled: true,
    config: decodePiAgentSettings({ binaryPath, enabled: true }),
  });
}

it("maps Pi list-models thinking availability into per-model option descriptors", () => {
  const models = parsePiListModelsOutput(`
provider      model        context  max-out  thinking  images
openai-codex  gpt-5.4     272K     128K     yes       yes
example       no-thoughts  128K     32K      no        no
`);

  const thinkingModel = models.find((model) => model.slug === "openai-codex/gpt-5.4");
  const noThinkingModel = models.find((model) => model.slug === "example/no-thoughts");

  assert.deepStrictEqual(thinkingModel?.capabilities?.optionDescriptors?.[0], {
    id: "thinking",
    label: "Thinking",
    type: "select",
    currentValue: "medium",
    options: [
      { id: "off", label: "Off" },
      { id: "minimal", label: "Minimal" },
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium", isDefault: true },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra high" },
    ],
  });
  assert.deepStrictEqual(noThinkingModel?.capabilities?.optionDescriptors, []);
});

it.layer(NodeServices.layer)("PiAgentDriver lifecycle", (it) => {
  it.effect("clears the active turn when Pi emits agent_end without turn_end", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("pi-agent-end-clears-active-turn");
        const requestLogPath = NodePath.join(
          yield* Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "pi-log-"))),
          "requests.jsonl",
        );
        const wrapperPath = yield* Effect.promise(() => makeMockPiWrapper({ requestLogPath }));
        const instance = yield* makeTestInstance(wrapperPath);
        const runtimeEvents: ProviderRuntimeEvent[] = [];
        const runtimeEventsFiber = yield* Stream.runForEach(
          instance.adapter.streamEvents,
          (event) =>
            Effect.sync(() => {
              runtimeEvents.push(event);
            }),
        ).pipe(Effect.forkChild);

        yield* instance.adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: { instanceId: ProviderInstanceId.make("piAgent"), model: "mock/model" },
        });
        yield* instance.adapter.sendTurn({ threadId, input: "first", attachments: [] });
        yield* instance.adapter.sendTurn({ threadId, input: "second", attachments: [] });

        const requests = yield* Effect.promise(() => readJsonLines(requestLogPath));
        const prompts = requests.filter((request) => request.type === "prompt");
        const turnCompletedEvents = runtimeEvents.filter(
          (event) => event.type === "turn.completed",
        );

        assert.lengthOf(prompts, 2);
        assert.notProperty(prompts[1] ?? {}, "streamingBehavior");
        assert.lengthOf(turnCompletedEvents, 2);

        yield* Fiber.interrupt(runtimeEventsFiber);
        yield* instance.adapter.stopSession(threadId);
      }),
    ),
  );

  it.effect("keeps the active turn through Pi tool-use subturns", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("pi-tool-use-subturns");
        const requestLogPath = NodePath.join(
          yield* Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "pi-log-"))),
          "requests.jsonl",
        );
        const wrapperPath = yield* Effect.promise(() =>
          makeMockPiWrapper({ requestLogPath, toolLoop: true }),
        );
        const instance = yield* makeTestInstance(wrapperPath);
        const runtimeEvents: ProviderRuntimeEvent[] = [];
        const runtimeEventsFiber = yield* Stream.runForEach(
          instance.adapter.streamEvents,
          (event) =>
            Effect.sync(() => {
              runtimeEvents.push(event);
            }),
        ).pipe(Effect.forkChild);

        yield* instance.adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: { instanceId: ProviderInstanceId.make("piAgent"), model: "mock/model" },
        });
        yield* instance.adapter.sendTurn({ threadId, input: "first", attachments: [] });

        const contentDeltas = runtimeEvents.filter((event) => event.type === "content.delta");
        const completedTurns = runtimeEvents.filter((event) => event.type === "turn.completed");
        const completedTool = runtimeEvents.find(
          (event) => event.type === "item.completed" && event.payload.title === "bash",
        );

        assert.lengthOf(contentDeltas, 1);
        assert.equal(contentDeltas[0]?.payload.delta, "ok");
        assert.lengthOf(completedTurns, 1);
        assert.equal(completedTool?.type, "item.completed");
        if (completedTool?.type === "item.completed") {
          assert.equal(completedTool.payload.detail, "/tmp\n");
          assert.deepInclude(completedTool.payload.data as Record<string, unknown>, {
            command: "pwd",
            toolCallId: "tool-1",
          });
        }

        yield* Fiber.interrupt(runtimeEventsFiber);
        yield* instance.adapter.stopSession(threadId);
      }),
    ),
  );

  it.effect("sends model and thinking updates on an existing session", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("pi-model-switch");
        const requestLogPath = NodePath.join(
          yield* Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "pi-log-"))),
          "requests.jsonl",
        );
        const wrapperPath = yield* Effect.promise(() => makeMockPiWrapper({ requestLogPath }));
        const instance = yield* makeTestInstance(wrapperPath);

        yield* instance.adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: { instanceId: ProviderInstanceId.make("piAgent"), model: "mock/model" },
        });
        yield* instance.adapter.sendTurn({
          threadId,
          input: "switch",
          attachments: [],
          modelSelection: {
            instanceId: ProviderInstanceId.make("piAgent"),
            model: "mock/other",
            options: [{ id: "thinking", value: "high" }],
          },
        });

        const requests = yield* Effect.promise(() => readJsonLines(requestLogPath));
        const setModel = requests.find((request) => request.type === "set_model");
        const setThinking = requests.find((request) => request.type === "set_thinking_level");
        const prompt = requests.find((request) => request.type === "prompt");
        assert.deepInclude(setModel ?? {}, { provider: "mock", modelId: "other" });
        assert.deepInclude(setThinking ?? {}, { level: "high" });
        assert.notProperty(prompt ?? {}, "model");
        assert.notProperty(prompt ?? {}, "thinking");

        yield* instance.adapter.stopSession(threadId);
      }),
    ),
  );

  it.effect("emits first assistant text from Pi snapshot message updates", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("pi-message-snapshot");
        const requestLogPath = NodePath.join(
          yield* Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "pi-log-"))),
          "requests.jsonl",
        );
        const wrapperPath = yield* Effect.promise(() => makeMockPiWrapper({ requestLogPath }));
        const instance = yield* makeTestInstance(wrapperPath);
        const runtimeEvents: ProviderRuntimeEvent[] = [];
        const runtimeEventsFiber = yield* Stream.runForEach(
          instance.adapter.streamEvents,
          (event) =>
            Effect.sync(() => {
              runtimeEvents.push(event);
            }),
        ).pipe(Effect.forkChild);

        yield* instance.adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: { instanceId: ProviderInstanceId.make("piAgent"), model: "mock/model" },
        });
        yield* instance.adapter.sendTurn({ threadId, input: "snapshot", attachments: [] });

        const contentDeltas = runtimeEvents.filter((event) => event.type === "content.delta");
        assert.deepStrictEqual(
          contentDeltas.map((event) => (event.type === "content.delta" ? event.payload.delta : "")),
          ["o", "k"],
        );

        yield* Fiber.interrupt(runtimeEventsFiber);
        yield* instance.adapter.stopSession(threadId);
      }),
    ),
  );

  it.effect("bridges Pi extension UI requests through structured user input", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("pi-extension-ui");
        const requestLogPath = NodePath.join(
          yield* Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "pi-log-"))),
          "requests.jsonl",
        );
        const wrapperPath = yield* Effect.promise(() => makeMockPiWrapper({ requestLogPath }));
        const instance = yield* makeTestInstance(wrapperPath);
        const runtimeEvents: ProviderRuntimeEvent[] = [];
        const runtimeEventsFiber = yield* Stream.runForEach(
          instance.adapter.streamEvents,
          (event) =>
            Effect.sync(() => {
              runtimeEvents.push(event);
            }),
        ).pipe(Effect.forkChild);

        yield* instance.adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: { instanceId: ProviderInstanceId.make("piAgent"), model: "mock/model" },
        });
        yield* instance.adapter.sendTurn({ threadId, input: "ask", attachments: [] });
        const requested = runtimeEvents.find((event) => event.type === "user-input.requested");
        assert.equal(requested?.type, "user-input.requested");
        yield* instance.adapter.respondToUserInput(threadId, ApprovalRequestId.make("ui-1"), {
          confirmed: "Yes",
        });
        for (let index = 0; index < 5; index += 1) {
          yield* Effect.yieldNow;
        }

        const requests = yield* Effect.promise(() => readJsonLines(requestLogPath));
        const response = requests.find((request) => request.type === "extension_ui_response");
        assert.deepInclude(response ?? {}, { id: "ui-1", confirmed: true });

        yield* Fiber.interrupt(runtimeEventsFiber);
        yield* instance.adapter.stopSession(threadId);
      }),
    ),
  );

  it.effect("generates thread titles through an isolated Pi RPC prompt", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const requestLogPath = NodePath.join(
          yield* Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "pi-log-"))),
          "requests.jsonl",
        );
        const wrapperPath = yield* Effect.promise(() => makeMockPiWrapper({ requestLogPath }));
        const instance = yield* makeTestInstance(wrapperPath);

        const result = yield* instance.textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "Fix the Pi agent driver",
          modelSelection: { instanceId: ProviderInstanceId.make("piAgent"), model: "mock/model" },
        });

        assert.deepStrictEqual(result, { title: "Fix Pi agent" });
      }),
    ),
  );

  it.effect("clears the active turn when the Pi prompt RPC fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("pi-prompt-failure-clears-active-turn");
        const requestLogPath = NodePath.join(
          yield* Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "pi-log-"))),
          "requests.jsonl",
        );
        const wrapperPath = yield* Effect.promise(() =>
          makeMockPiWrapper({ requestLogPath, failFirstPrompt: true }),
        );
        const instance = yield* makeTestInstance(wrapperPath);
        const runtimeEvents: ProviderRuntimeEvent[] = [];
        const runtimeEventsFiber = yield* Stream.runForEach(
          instance.adapter.streamEvents,
          (event) =>
            Effect.sync(() => {
              runtimeEvents.push(event);
            }),
        ).pipe(Effect.forkChild);

        yield* instance.adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: { instanceId: ProviderInstanceId.make("piAgent"), model: "mock/model" },
        });
        const error = yield* Effect.flip(
          instance.adapter.sendTurn({ threadId, input: "first", attachments: [] }),
        );
        yield* instance.adapter.sendTurn({ threadId, input: "second", attachments: [] });

        const requests = yield* Effect.promise(() => readJsonLines(requestLogPath));
        const prompts = requests.filter((request) => request.type === "prompt");
        const failedTurn = runtimeEvents.find(
          (event) => event.type === "turn.completed" && event.payload.state === "failed",
        );

        assert.equal(error._tag, "ProviderAdapterRequestError");
        assert.lengthOf(prompts, 2);
        assert.notProperty(prompts[1] ?? {}, "streamingBehavior");
        assert.isDefined(failedTurn);

        yield* Fiber.interrupt(runtimeEventsFiber);
        yield* instance.adapter.stopSession(threadId);
      }),
    ),
  );
});
