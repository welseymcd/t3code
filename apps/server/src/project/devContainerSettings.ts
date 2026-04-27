import { slugForDevHost } from "@t3tools/shared/projectScripts";
import { Effect, FileSystem, Path } from "effect";

const T3CODE_DEVCONTAINER_DIR = ".devcontainer";
const T3CODE_DEVCONTAINER_SETTINGS_FILE = "t3code.json";
const T3CODE_DEVCONTAINER_ENV_FILE = ".env";
const T3CODE_DEVCONTAINER_CONFIG_FILE = "devcontainer.json";
const T3CODE_DEVCONTAINER_COMPOSE_FILE = "docker-compose.yml";

const DEFAULT_DEV_HOST_DOMAIN = "rmcd.fyi";
const DEFAULT_DEV_HOST_DOCKER_NETWORK = "rmcd-devhost";
const DEFAULT_DEV_HOST_WEB_PORT = 5173;
const DEFAULT_DEV_HOST_API_PORT = 13773;

export interface T3CodeDevContainerSettingsInput {
  readonly projectId: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export interface T3CodeDevContainerSettings {
  readonly schemaVersion: 1;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly workspaceRoot: string;
  };
  readonly devHost: {
    readonly domain: string;
    readonly hostname: string;
    readonly dockerNetwork: string;
    readonly webPort: number;
    readonly apiPort: number;
    readonly publicOrigin: string;
  };
  readonly devcontainer: {
    readonly configPath: string;
    readonly composeEnvPath: string;
  };
}

export { slugForDevHost };

export function createT3CodeDevContainerSettings(
  input: T3CodeDevContainerSettingsInput,
): T3CodeDevContainerSettings {
  const slug = slugForDevHost(input.title || input.projectId);
  const hostname = `${slug}.${DEFAULT_DEV_HOST_DOMAIN}`;

  return {
    schemaVersion: 1,
    project: {
      id: input.projectId,
      name: input.title,
      slug,
      workspaceRoot: input.workspaceRoot,
    },
    devHost: {
      domain: DEFAULT_DEV_HOST_DOMAIN,
      hostname,
      dockerNetwork: DEFAULT_DEV_HOST_DOCKER_NETWORK,
      webPort: DEFAULT_DEV_HOST_WEB_PORT,
      apiPort: DEFAULT_DEV_HOST_API_PORT,
      publicOrigin: `https://${hostname}`,
    },
    devcontainer: {
      configPath: `${T3CODE_DEVCONTAINER_DIR}/devcontainer.json`,
      composeEnvPath: `${T3CODE_DEVCONTAINER_DIR}/${T3CODE_DEVCONTAINER_ENV_FILE}`,
    },
  };
}

function serializeDevHostEnv(settings: T3CodeDevContainerSettings): string {
  return [
    `DEV_HOST_PROJECT=${settings.project.slug}`,
    `DEV_HOST_DOMAIN=${settings.devHost.domain}`,
    `DEV_HOST_WEB_PORT=${settings.devHost.webPort}`,
    `DEV_HOST_API_PORT=${settings.devHost.apiPort}`,
    `DEV_HOST_DOCKER_NETWORK=${settings.devHost.dockerNetwork}`,
    "",
  ].join("\n");
}

function serializeDevContainerJson(settings: T3CodeDevContainerSettings): string {
  return `${JSON.stringify(
    {
      name: `${settings.project.name} Dev`,
      dockerComposeFile: [T3CODE_DEVCONTAINER_COMPOSE_FILE],
      service: "workspace",
      workspaceFolder: `/workspaces/${settings.project.slug}`,
      shutdownAction: "stopCompose",
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
        "ghcr.io/devcontainers-extra/features/bun:1": {},
        "ghcr.io/devcontainers/features/node:1": {
          version: "lts",
        },
      },
      overrideFeatureInstallOrder: [
        "ghcr.io/devcontainers/features/git",
        "ghcr.io/devcontainers-extra/features/bun",
      ],
      postCreateCommand: {
        "devcontainer-cli": "bun install -g @devcontainers/cli@0.86.0",
      },
      forwardPorts: [settings.devHost.webPort],
      customizations: {
        vscode: {
          extensions: ["oxc.oxc-vscode"],
        },
      },
    },
    null,
    2,
  )}\n`;
}

function serializeDockerComposeYaml(settings: T3CodeDevContainerSettings): string {
  const serviceName = `${settings.project.slug}-web`;

  return [
    "services:",
    "  workspace:",
    "    image: debian:bookworm",
    "    command: sleep infinity",
    "    init: true",
    `    working_dir: /workspaces/${settings.project.slug}`,
    "    volumes:",
    `      - ..:/workspaces/${settings.project.slug}:cached`,
    "    environment:",
    "      HOST: 0.0.0.0",
    `      PORT: \${DEV_HOST_WEB_PORT:-${settings.devHost.webPort}}`,
    `      T3CODE_DEV_PUBLIC_ORIGIN: https://${settings.devHost.hostname}`,
    `      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ${settings.devHost.hostname}`,
    "    labels:",
    '      traefik.enable: "true"',
    `      traefik.docker.network: \${DEV_HOST_DOCKER_NETWORK:-${settings.devHost.dockerNetwork}}`,
    `      traefik.http.routers.${settings.project.slug}-web.entrypoints: web`,
    `      traefik.http.routers.${settings.project.slug}-web.rule: Host(\`${settings.devHost.hostname}\`)`,
    `      traefik.http.routers.${settings.project.slug}-web.service: ${serviceName}`,
    `      traefik.http.services.${serviceName}.loadbalancer.server.port: \${DEV_HOST_WEB_PORT:-${settings.devHost.webPort}}`,
    "    networks:",
    "      - default",
    "      - devhost",
    "",
    "networks:",
    "  devhost:",
    "    external: true",
    `    name: \${DEV_HOST_DOCKER_NETWORK:-${settings.devHost.dockerNetwork}}`,
    "",
  ].join("\n");
}

const writeFileIfMissing = Effect.fn(function* (path: string, content: string) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    yield* fs.writeFileString(path, content);
  }
});

export const ensureT3CodeDevContainerSettings = Effect.fn(function* (
  input: T3CodeDevContainerSettingsInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settings = createT3CodeDevContainerSettings(input);
  const devcontainerDir = path.join(input.workspaceRoot, T3CODE_DEVCONTAINER_DIR);
  const settingsPath = path.join(devcontainerDir, T3CODE_DEVCONTAINER_SETTINGS_FILE);
  const envPath = path.join(devcontainerDir, T3CODE_DEVCONTAINER_ENV_FILE);
  const devcontainerJsonPath = path.join(devcontainerDir, T3CODE_DEVCONTAINER_CONFIG_FILE);
  const composePath = path.join(devcontainerDir, T3CODE_DEVCONTAINER_COMPOSE_FILE);

  yield* fs.makeDirectory(devcontainerDir, { recursive: true });
  yield* fs.writeFileString(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  yield* writeFileIfMissing(envPath, serializeDevHostEnv(settings));
  yield* writeFileIfMissing(devcontainerJsonPath, serializeDevContainerJson(settings));
  yield* writeFileIfMissing(composePath, serializeDockerComposeYaml(settings));

  return settings;
});
