# Docker Dev Host And Local Deploy

## Purpose

Add containerized development and remote-friendly local deployment support. The feature should make T3 Code runnable in Docker, support devcontainer setup for projects, install required CLI tools in the image, and provide scripts for staging a local service behind a dev host.

This feature differs from upstream by adding the Docker image, compose files, dev host script, deployment helper, and generated devcontainer settings.

## Context To Recreate

- Root-level infrastructure:
  - `Dockerfile`
  - `.dockerignore`
  - `docker-compose.yml`
  - `docker/docker-entrypoint.sh`
  - `docker/dev-host/compose.yml`
  - `.devcontainer/devcontainer.json`
  - `.devcontainer/docker-compose.yml`
  - `.devcontainer/.env.example`
  - `docs/dev-host.md`
- Server devcontainer generation:
  - `apps/server/src/project/devContainerSettings.ts`
  - `apps/server/src/project/devContainerSettings.test.ts`
- Shared slug helper:
  - `packages/shared/src/projectScripts.ts`
  - `packages/shared/src/projectScripts.test.ts`
- CLI/scripts:
  - `scripts/dev-host.ts`
  - `scripts/dev-host.test.ts`
  - `scripts/deploy-local-service.sh`
  - `scripts/dev-runner.ts`
  - `scripts/dev-runner.test.ts`
- Package scripts and task wiring need updates in `package.json` and `turbo.json`.
- Defaults from the current implementation:
  - domain: `rmcd.fyi`
  - Docker network: `rmcd-devhost`
  - web port: `5173`
  - API port: `13773`
- Devcontainer generation writes `.devcontainer/t3code.json`, `.devcontainer/.env`, `.devcontainer/devcontainer.json`, and `.devcontainer/docker-compose.yml`.
- The generated compose should use Traefik labels and expose project-specific hostnames.

## Prompt

Recreate Docker, dev-host, and local deploy support on top of upstream `main`.

Add a production-oriented Dockerfile that can run the server and web app, includes Bun/Node dependencies, and installs GitHub CLI for repo workflows. Add an entrypoint that persists CLI auth/config under a data volume so container restarts do not lose authentication.

Add root compose files for running T3 Code and dev-host compose files for Traefik/Cloudflare tunnel exposure. Implement `scripts/dev-host.ts` as an Effect CLI that reads Cloudflare credentials from dotenv, creates or reuses a named tunnel, configures wildcard DNS and tunnel ingress, and writes a sorted env file for compose.

Add project devcontainer generation on the server side. It should create stable project slugs, write a T3 Code settings file, and only create `.env`, `devcontainer.json`, and compose defaults when missing.

Document the local dev-host flow and add tests for slugging, dotenv parsing, env serialization, Cloudflare helper URL/hostname generation, and devcontainer generated content.

## Validation

Run:

```bash
bun run test scripts/dev-host.test.ts
bun run test scripts/dev-runner.test.ts
bun run test apps/server/src/project/devContainerSettings.test.ts
bun run test packages/shared/src/projectScripts.test.ts
bun fmt
bun lint
bun typecheck
```

Manual validation:

- Build the Docker image.
- Start the compose stack.
- Confirm CLI auth persists after container restart.
- Generate devcontainer settings for a project and confirm generated files are stable.
- Run the dev-host script against a test Cloudflare zone before using production credentials.
