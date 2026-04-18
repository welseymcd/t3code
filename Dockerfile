# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.11 AS base
WORKDIR /app

FROM base AS deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/marketing/package.json apps/marketing/package.json
COPY packages/client-runtime/package.json packages/client-runtime/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/effect-acp/package.json packages/effect-acp/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY scripts/package.json scripts/package.json

RUN bun install --frozen-lockfile --ignore-scripts

FROM deps AS build

COPY . .

RUN bun run build -- --filter=t3 --filter=@t3tools/web

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production \
  T3CODE_MODE=web \
  T3CODE_HOST=0.0.0.0 \
  T3CODE_PORT=3773 \
  T3CODE_NO_BROWSER=true \
  T3CODE_HOME=/data

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git openssh-client \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist

RUN mkdir -p /data \
  && chown -R node:node /app /data

USER node

EXPOSE 3773
VOLUME ["/data"]

# Provider CLIs such as `codex` or `claude` are intentionally not bundled here.
# Extend this image if you want those binaries available inside the container.
CMD ["node", "apps/server/dist/bin.mjs", "serve", "--host", "0.0.0.0", "--port", "3773", "--no-browser"]
