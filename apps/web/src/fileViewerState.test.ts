import { describe, expect, it } from "vitest";
import { EnvironmentId } from "@t3tools/contracts";

import { resolveFileViewerRequest } from "./fileViewerState";

const ENVIRONMENT_ID = EnvironmentId.make("env-test");

describe("resolveFileViewerRequest", () => {
  it("resolves absolute POSIX paths inside the workspace root", () => {
    expect(
      resolveFileViewerRequest({
        environmentId: ENVIRONMENT_ID,
        workspaceRoot: "/repo/project",
        targetPath: "/repo/project/src/index.ts",
      }),
    ).toEqual({
      environmentId: ENVIRONMENT_ID,
      cwd: "/repo/project",
      relativePath: "src/index.ts",
    });
  });

  it("preserves line and column suffixes", () => {
    expect(
      resolveFileViewerRequest({
        environmentId: ENVIRONMENT_ID,
        workspaceRoot: "/repo/project",
        targetPath: "/repo/project/src/index.ts:12:4",
      }),
    ).toEqual({
      environmentId: ENVIRONMENT_ID,
      cwd: "/repo/project",
      relativePath: "src/index.ts",
      line: 12,
      column: 4,
    });
  });

  it("resolves Windows paths case-insensitively", () => {
    expect(
      resolveFileViewerRequest({
        environmentId: ENVIRONMENT_ID,
        workspaceRoot: "C:\\Repo\\Project",
        targetPath: "c:\\repo\\project\\src\\index.ts:3",
      }),
    ).toEqual({
      environmentId: ENVIRONMENT_ID,
      cwd: "C:\\Repo\\Project",
      relativePath: "src/index.ts",
      line: 3,
    });
  });

  it("rejects paths outside the workspace root", () => {
    expect(
      resolveFileViewerRequest({
        environmentId: ENVIRONMENT_ID,
        workspaceRoot: "/repo/project",
        targetPath: "/repo/other/src/index.ts",
      }),
    ).toBeNull();
  });
});
