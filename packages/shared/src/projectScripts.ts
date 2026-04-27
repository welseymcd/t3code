import type { ProjectScript } from "@t3tools/contracts";

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
    name?: string | undefined;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

const DEFAULT_DEV_HOST_DOMAIN = "rmcd.fyi";

export function slugForDevHost(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "project";
}

function projectNameFromCwd(cwd: string): string {
  const segments = cwd.split(/[\\/]+/u);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment) {
      return segment;
    }
  }
  return "project";
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const devHostName = `${slugForDevHost(input.project.name ?? projectNameFromCwd(input.project.cwd))}.${DEFAULT_DEV_HOST_DOMAIN}`;
  const env: Record<string, string> = {
    T3CODE_PROJECT_ROOT: input.project.cwd,
    T3CODE_DEV_HOSTNAME: devHostName,
    T3CODE_DEV_PUBLIC_ORIGIN: `https://${devHostName}`,
    __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: devHostName,
  };
  if (input.worktreePath) {
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}
