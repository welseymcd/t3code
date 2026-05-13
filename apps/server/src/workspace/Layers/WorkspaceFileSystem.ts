import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { PROJECT_READ_FILE_MAX_BYTES_LIMIT } from "@t3tools/contracts";
import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

function decodeTextFile(bytes: Uint8Array): { content: string; isBinary: boolean } {
  if (bytes.includes(0)) {
    return { content: "", isBinary: true };
  }

  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      isBinary: false,
    };
  } catch {
    return { content: "", isBinary: true };
  }
}

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;

  const normalizeWorkspaceRoot = Effect.fn("WorkspaceFileSystem.normalizeWorkspaceRoot")(function* (
    cwd: string,
  ): Effect.fn.Return<string, WorkspaceFileSystemError> {
    return yield* workspacePaths.normalizeWorkspaceRoot(cwd).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd,
            operation: "workspaceFileSystem.normalizeWorkspaceRoot",
            detail: cause.message,
            cause,
          }),
      ),
    );
  });

  const readBytesPrefix = Effect.fn("WorkspaceFileSystem.readBytesPrefix")(function* (input: {
    readonly cwd: string;
    readonly relativePath: string;
    readonly absolutePath: string;
  }): Effect.fn.Return<Uint8Array, WorkspaceFileSystemError> {
    const chunks = yield* fileSystem
      .stream(input.absolutePath, {
        bytesToRead: PROJECT_READ_FILE_MAX_BYTES_LIMIT + 1,
        chunkSize: PROJECT_READ_FILE_MAX_BYTES_LIMIT + 1,
      })
      .pipe(
        Stream.runCollect,
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.readFile",
              detail: cause.message,
              cause,
            }),
        ),
      );
    return Buffer.concat(Array.from(chunks));
  });

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: normalizedCwd,
        relativePath: input.relativePath,
      });

      const stat = yield* fileSystem.stat(target.absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.stat",
              detail: cause.message,
              cause,
            }),
        ),
      );

      if (stat.type !== "File") {
        return yield* new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.stat",
          detail: "Workspace path is not a file.",
        });
      }

      const bytes = yield* readBytesPrefix({
        cwd: input.cwd,
        relativePath: input.relativePath,
        absolutePath: target.absolutePath,
      });
      const sizeBytes = Number(stat.size);
      const truncated =
        sizeBytes > PROJECT_READ_FILE_MAX_BYTES_LIMIT ||
        bytes.length > PROJECT_READ_FILE_MAX_BYTES_LIMIT;
      const readableBytes = bytes.subarray(0, PROJECT_READ_FILE_MAX_BYTES_LIMIT);
      const decoded = decodeTextFile(readableBytes);

      return {
        relativePath: target.relativePath,
        absolutePath: target.absolutePath,
        content: decoded.isBinary ? "" : decoded.content,
        sizeBytes,
        truncated,
        isBinary: decoded.isBinary,
      };
    },
  );

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: normalizedCwd,
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
    yield* workspaceEntries.invalidate(normalizedCwd);
    return { relativePath: target.relativePath };
  });
  return { readFile, writeFile } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
