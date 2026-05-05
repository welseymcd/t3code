import fsPromises from "node:fs/promises";

import { Effect, FileSystem, Layer, Path } from "effect";

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
    return yield* Effect.tryPromise({
      try: async () => {
        const handle = await fsPromises.open(input.absolutePath, "r");
        try {
          const buffer = Buffer.alloc(PROJECT_READ_FILE_MAX_BYTES_LIMIT + 1);
          const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
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
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  });

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: normalizedCwd,
        relativePath: input.relativePath,
      });

      const stat = yield* Effect.tryPromise({
        try: () => fsPromises.stat(target.absolutePath),
        catch: (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.stat",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

      if (!stat.isFile()) {
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
      const truncated =
        stat.size > PROJECT_READ_FILE_MAX_BYTES_LIMIT ||
        bytes.length > PROJECT_READ_FILE_MAX_BYTES_LIMIT;
      const readableBytes = bytes.subarray(0, PROJECT_READ_FILE_MAX_BYTES_LIMIT);
      const decoded = decodeTextFile(readableBytes);

      return {
        relativePath: target.relativePath,
        absolutePath: target.absolutePath,
        content: decoded.isBinary ? "" : decoded.content,
        sizeBytes: stat.size,
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
