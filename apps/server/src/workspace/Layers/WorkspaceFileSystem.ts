import fsPromises from "node:fs/promises";

import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { PROJECT_READ_FILE_MAX_BYTES_LIMIT } from "@t3tools/contracts";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;
  const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });

      const sizeBytes = yield* Effect.tryPromise({
        try: async () => {
          const stat = await fsPromises.stat(target.absolutePath);
          return stat.size;
        },
        catch: (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.statFile",
            detail: cause instanceof Error ? cause.message : "Failed to inspect file.",
            cause,
          }),
      });

      const bytes = yield* Effect.tryPromise({
        try: async () => {
          const handle = await fsPromises.open(target.absolutePath, "r");
          try {
            const maxBytes = Math.min(sizeBytes, PROJECT_READ_FILE_MAX_BYTES_LIMIT + 1);
            const buffer = Buffer.allocUnsafe(maxBytes);
            const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
            return buffer.subarray(0, bytesRead);
          } finally {
            await handle.close();
          }
        },
        catch: (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.readFile",
            detail: cause instanceof Error ? cause.message : "Failed to read file.",
            cause,
          }),
      });

      const truncated = sizeBytes > PROJECT_READ_FILE_MAX_BYTES_LIMIT;
      const visibleBytes = truncated ? bytes.subarray(0, PROJECT_READ_FILE_MAX_BYTES_LIMIT) : bytes;
      const hasNullByte = visibleBytes.includes(0);
      let content = "";
      let isBinary = hasNullByte;

      if (!isBinary) {
        const decoded = yield* Effect.try({
          try: () => utf8Decoder.decode(visibleBytes),
          catch: () =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.decodeFile",
              detail: "File content is not valid UTF-8.",
            }),
        }).pipe(Effect.option);

        if (Option.isSome(decoded)) {
          content = decoded.value;
        } else {
          isBinary = true;
        }
      }

      return {
        relativePath: target.relativePath,
        absolutePath: target.absolutePath,
        content: isBinary ? "" : content,
        sizeBytes,
        truncated,
        isBinary,
      };
    },
  );

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.makeDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });
  return { readFile, writeFile } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
