import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";

describe("project contracts", () => {
  it("decodes list directory payloads", () => {
    const parsed = Schema.decodeUnknownSync(ProjectListDirectoryInput)({
      cwd: "/repo",
      parentPath: "src",
      limit: 1000,
    });
    const result = Schema.decodeUnknownSync(ProjectListDirectoryResult)({
      entries: [{ path: "src/index.ts", kind: "file", parentPath: "src" }],
      truncated: false,
    });

    expect(parsed.parentPath).toBe("src");
    expect(result.entries[0]?.path).toBe("src/index.ts");
  });

  it("decodes search payloads with bounded limits", () => {
    const parsed = Schema.decodeUnknownSync(ProjectSearchEntriesInput)({
      cwd: "/repo",
      query: "index",
      limit: 100,
    });
    const result = Schema.decodeUnknownSync(ProjectSearchEntriesResult)({
      entries: [{ path: "src", kind: "directory" }],
      truncated: true,
    });

    expect(parsed.limit).toBe(100);
    expect(result.truncated).toBe(true);
  });

  it("decodes read file payloads", () => {
    const parsed = Schema.decodeUnknownSync(ProjectReadFileInput)({
      cwd: "/repo",
      relativePath: "README.md",
    });
    const result = Schema.decodeUnknownSync(ProjectReadFileResult)({
      relativePath: "README.md",
      absolutePath: "/repo/README.md",
      content: "# Repo\n",
      sizeBytes: 7,
      truncated: false,
      isBinary: false,
    });

    expect(parsed.relativePath).toBe("README.md");
    expect(result.content).toBe("# Repo\n");
  });

  it("decodes write file payloads", () => {
    const parsed = Schema.decodeUnknownSync(ProjectWriteFileInput)({
      cwd: "/repo",
      relativePath: "notes/todo.md",
      contents: "- ship\n",
    });
    const result = Schema.decodeUnknownSync(ProjectWriteFileResult)({
      relativePath: "notes/todo.md",
    });

    expect(parsed.contents).toBe("- ship\n");
    expect(result.relativePath).toBe("notes/todo.md");
  });
});
