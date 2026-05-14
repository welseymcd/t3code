#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy-prod.sh [branch]

Deploy the selected branch to production over SSH.

Defaults:
  branch: current local Git branch
  host:   ross@100.103.194.85
  dir:    ~/t3code

Environment overrides:
  T3_DEPLOY_HOST         SSH target. Default: ross@100.103.194.85
  T3_DEPLOY_DIR          Repository directory on the server. Default: ~/t3code
  T3_DEPLOY_REMOTE       Git remote to fetch/pull from. Default: origin
  T3_DEPLOY_BUILD_CMD    Build command. Default: bun run build
  T3_DEPLOY_RESTART_CMD  Optional deploy/restart command to run after build.

If T3_DEPLOY_RESTART_CMD is not set, the remote script tries, in order:
  systemctl --user restart t3code
  sudo -n systemctl restart t3code
  pm2 reload t3code

Example:
  T3_DEPLOY_RESTART_CMD='sudo systemctl restart t3code' scripts/deploy-prod.sh main
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

current_branch() {
  git symbolic-ref --quiet --short HEAD
}

BRANCH="${1:-}"
if [[ -z "${BRANCH}" ]]; then
  BRANCH="$(current_branch || true)"
fi
DEPLOY_HOST="${T3_DEPLOY_HOST:-ross@100.103.194.85}"
DEPLOY_DIR="${T3_DEPLOY_DIR:-~/t3code}"
DEPLOY_REMOTE="${T3_DEPLOY_REMOTE:-origin}"
BUILD_CMD="${T3_DEPLOY_BUILD_CMD:-bun run build}"
RESTART_CMD="${T3_DEPLOY_RESTART_CMD:-}"

if [[ -z "${BRANCH}" ]]; then
  echo "Could not determine a branch. Pass one explicitly." >&2
  usage >&2
  exit 2
fi

if ! git check-ref-format --branch "${BRANCH}" >/dev/null 2>&1; then
  echo "Invalid branch name: ${BRANCH}" >&2
  exit 2
fi

echo "Deploying branch '${BRANCH}' to ${DEPLOY_HOST}:${DEPLOY_DIR}"

shell_quote() {
  printf "%q" "$1"
}

ssh "${DEPLOY_HOST}" \
  "BRANCH=$(shell_quote "${BRANCH}") DEPLOY_DIR=$(shell_quote "${DEPLOY_DIR}") DEPLOY_REMOTE=$(shell_quote "${DEPLOY_REMOTE}") BUILD_CMD=$(shell_quote "${BUILD_CMD}") RESTART_CMD=$(shell_quote "${RESTART_CMD}") bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

if [[ "${DEPLOY_DIR}" == "~" ]]; then
  DEPLOY_DIR="${HOME}"
elif [[ "${DEPLOY_DIR}" == "~/"* ]]; then
  DEPLOY_DIR="${HOME}/${DEPLOY_DIR#"~/"}"
fi

export PATH="${HOME}/.bun/bin:${HOME}/.local/bin:${HOME}/bin:${HOME}/.local/share/mise/shims:${HOME}/.mise/shims:${HOME}/.asdf/shims:${HOME}/.volta/bin:${PATH}"

if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
  set +u
  # shellcheck disable=SC1091
  . "${HOME}/.nvm/nvm.sh"
  nvm use --silent >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1 || nvm use --silent --lts >/dev/null 2>&1 || true
  set -u
fi

echo "Entering ${DEPLOY_DIR}"
cd "${DEPLOY_DIR}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Remote worktree has uncommitted changes. Refusing to deploy." >&2
  git status --short >&2
  exit 1
fi

echo "Fetching ${DEPLOY_REMOTE}/${BRANCH}"
git fetch --prune "${DEPLOY_REMOTE}" "${BRANCH}"

if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  git checkout "${BRANCH}"
else
  git checkout -b "${BRANCH}" "${DEPLOY_REMOTE}/${BRANCH}"
fi

echo "Pulling latest changes"
git pull --ff-only "${DEPLOY_REMOTE}" "${BRANCH}"

echo "Installing dependencies"
if ! command -v bun >/dev/null 2>&1; then
  echo "bun was not found on the remote PATH." >&2
  echo "Install Bun or set PATH for non-interactive SSH sessions before deploying." >&2
  exit 1
fi
bun install --frozen-lockfile

echo "Building"
bash -lc "${BUILD_CMD}"

echo "Restarting production service"
restart_production() {
  if [[ -n "${RESTART_CMD}" ]]; then
    bash -lc "${RESTART_CMD}"
    return
  fi

  if command -v systemctl >/dev/null 2>&1 && systemctl --user list-unit-files t3code.service --no-legend >/dev/null 2>&1; then
    systemctl --user restart t3code
    return
  fi

  if command -v sudo >/dev/null 2>&1 && sudo -n systemctl list-unit-files t3code.service --no-legend >/dev/null 2>&1; then
    sudo -n systemctl restart t3code
    return
  fi

  if command -v pm2 >/dev/null 2>&1 && pm2 describe t3code >/dev/null 2>&1; then
    pm2 reload t3code
    return
  fi

  echo "Could not find a t3code systemd service or PM2 process." >&2
  echo "Set T3_DEPLOY_RESTART_CMD to the production restart command and rerun." >&2
  exit 1
}

restart_production

echo "Deployed $(git rev-parse --short HEAD) from ${BRANCH}"
REMOTE_SCRIPT
