import { describe, expect, it } from "vitest";
import { EnvironmentId } from "@t3tools/contracts";

import { resolveFileViewerRequest } from "./fileViewerState";

describe("resolveFileViewerRequest", () => {
  it("returns a workspace-relative viewer target for files inside the workspace", () => {
    expect(
      resolveFileViewerRequest({
        environmentId: EnvironmentId.make("environment-local"),
        workspaceRoot: "/repo/project",
        targetPath: "/repo/project/src/app.ts:12:4",
      }),
    ).toEqual({
      environmentId: EnvironmentId.make("environment-local"),
      workspaceRoot: "/repo/project",
      absolutePath: "/repo/project/src/app.ts",
      relativePath: "src/app.ts",
      line: 12,
      column: 4,
    });
  });

  it("rejects files outside the active workspace root", () => {
    expect(
      resolveFileViewerRequest({
        environmentId: EnvironmentId.make("environment-local"),
        workspaceRoot: "/repo/project",
        targetPath: "/repo/other/src/app.ts",
      }),
    ).toBeNull();
  });
});
