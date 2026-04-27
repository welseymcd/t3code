import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Path } from "effect";

import {
  createT3CodeDevContainerSettings,
  ensureT3CodeDevContainerSettings,
  slugForDevHost,
} from "./devContainerSettings.ts";

describe("devContainerSettings", () => {
  it("creates a stable dev-host slug", () => {
    assert.equal(slugForDevHost("T3 Code!"), "t3-code");
    assert.equal(slugForDevHost("  ---  "), "project");
  });

  it("creates t3code devcontainer settings", () => {
    assert.deepStrictEqual(
      createT3CodeDevContainerSettings({
        projectId: "project-1",
        title: "T3 Code",
        workspaceRoot: "/repo/t3code",
      }),
      {
        schemaVersion: 1,
        project: {
          id: "project-1",
          name: "T3 Code",
          slug: "t3-code",
          workspaceRoot: "/repo/t3code",
        },
        devHost: {
          domain: "rmcd.fyi",
          hostname: "t3-code.rmcd.fyi",
          dockerNetwork: "rmcd-devhost",
          webPort: 5173,
          apiPort: 13773,
          publicOrigin: "https://t3-code.rmcd.fyi",
        },
        devcontainer: {
          configPath: ".devcontainer/devcontainer.json",
          composeEnvPath: ".devcontainer/.env",
        },
      },
    );
  });

  it.effect("writes settings and preserves an existing devcontainer env file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-devcontainer-settings-",
      });
      const devcontainerDir = path.join(workspaceRoot, ".devcontainer");
      const envPath = path.join(devcontainerDir, ".env");

      yield* fs.makeDirectory(devcontainerDir, { recursive: true });
      yield* fs.writeFileString(envPath, "DEV_HOST_PROJECT=custom\n");
      yield* ensureT3CodeDevContainerSettings({
        projectId: "project-1",
        title: "T3 Code",
        workspaceRoot,
      });

      const settingsRaw = yield* fs.readFileString(path.join(devcontainerDir, "t3code.json"));
      const devcontainerRaw = yield* fs.readFileString(
        path.join(devcontainerDir, "devcontainer.json"),
      );
      const composeRaw = yield* fs.readFileString(path.join(devcontainerDir, "docker-compose.yml"));
      const settings = JSON.parse(settingsRaw) as {
        readonly project: { readonly slug: string };
        readonly devHost: { readonly publicOrigin: string };
      };
      const devcontainer = JSON.parse(devcontainerRaw) as {
        readonly workspaceFolder: string;
        readonly dockerComposeFile: string[];
      };
      const envRaw = yield* fs.readFileString(envPath);

      assert.equal(settings.project.slug, "t3-code");
      assert.equal(settings.devHost.publicOrigin, "https://t3-code.rmcd.fyi");
      assert.equal(devcontainer.workspaceFolder, "/workspaces/t3-code");
      assert.deepStrictEqual(devcontainer.dockerComposeFile, ["docker-compose.yml"]);
      assert.match(composeRaw, /traefik\.http\.routers\.t3-code-web\.rule/u);
      assert.match(composeRaw, /Host\(`t3-code\.rmcd\.fyi`\)/u);
      assert.match(composeRaw, /__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: t3-code\.rmcd\.fyi/u);
      assert.match(composeRaw, /loadbalancer\.server\.port: \$\{DEV_HOST_WEB_PORT:-5173\}/u);
      assert.equal(envRaw, "DEV_HOST_PROJECT=custom\n");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("creates a devcontainer env file when missing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-devcontainer-settings-env-",
      });

      yield* ensureT3CodeDevContainerSettings({
        projectId: "project-1",
        title: "T3 Code",
        workspaceRoot,
      });

      const envRaw = yield* fs.readFileString(path.join(workspaceRoot, ".devcontainer", ".env"));

      assert.match(envRaw, /DEV_HOST_PROJECT=t3-code/u);
      assert.match(envRaw, /DEV_HOST_DOMAIN=rmcd\.fyi/u);
      assert.match(envRaw, /DEV_HOST_WEB_PORT=5173/u);
      assert.match(envRaw, /DEV_HOST_DOCKER_NETWORK=rmcd-devhost/u);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("does not overwrite existing project devcontainer files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-devcontainer-settings-existing-",
      });
      const devcontainerDir = path.join(workspaceRoot, ".devcontainer");
      const devcontainerPath = path.join(devcontainerDir, "devcontainer.json");
      const composePath = path.join(devcontainerDir, "docker-compose.yml");

      yield* fs.makeDirectory(devcontainerDir, { recursive: true });
      yield* fs.writeFileString(devcontainerPath, '{ "name": "Custom" }\n');
      yield* fs.writeFileString(composePath, "services: {}\n");

      yield* ensureT3CodeDevContainerSettings({
        projectId: "project-1",
        title: "T3 Code",
        workspaceRoot,
      });

      assert.equal(yield* fs.readFileString(devcontainerPath), '{ "name": "Custom" }\n');
      assert.equal(yield* fs.readFileString(composePath), "services: {}\n");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
