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
COPY packages/effect-codex-app-server/package.json packages/effect-codex-app-server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY scripts/package.json scripts/package.json

RUN bun install --frozen-lockfile --ignore-scripts

FROM deps AS build

COPY . .

RUN bun run build -- --filter=t3 --filter=@t3tools/web --concurrency=1

FROM oven/bun:1.3.11 AS runner

ARG CODEX_CLI_VERSION=0.124.0
ARG OPENCODE_CLI_VERSION=1.14.23

ENV NODE_ENV=production \
  HOME=/data/home \
  T3CODE_MODE=web \
  T3CODE_HOST=0.0.0.0 \
  T3CODE_PORT=3773 \
  T3CODE_NO_BROWSER=true \
  T3CODE_HOME=/data \
  CODEX_HOME=/data/home/.codex \
  GH_CONFIG_DIR=/data/home/.config/gh \
  OPENCODE_CONFIG_DIR=/data/home/.config/opencode \
  XDG_CONFIG_HOME=/data/home/.config \
  XDG_DATA_HOME=/data/home/.local/share

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates docker-cli git gosu openssh-client wget \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && wget -qO /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && ln -sf "$(command -v bun)" /usr/local/bin/node \
  && bun install -g "@openai/codex@${CODEX_CLI_VERSION}" \
  && bun install -g "opencode-ai@${OPENCODE_CLI_VERSION}" \
  && for binary in codex opencode; do \
    binary_path="$(command -v "$binary")"; \
    if [ "$binary_path" != "/usr/local/bin/$binary" ]; then \
      ln -sf "$binary_path" "/usr/local/bin/$binary"; \
    fi; \
  done \
  && command -v codex \
  && command -v opencode \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app ./
COPY docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data/home/.config/gh /data/home/.config/opencode /data/home/.codex /data/home/.local/share/opencode \
  && chmod +x /usr/local/bin/docker-entrypoint.sh \
  && chown -R bun:bun /app /data

EXPOSE 3773
VOLUME ["/data"]

# Provider CLIs bundled in this image: `codex` and `opencode`.
# Their auth/config paths, plus GitHub CLI auth, are rooted under the `/data` volume.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "apps/server/dist/bin.mjs", "serve", "--host", "0.0.0.0", "--port", "3773", "--no-browser"]
