#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
service_name="${T3CODE_SERVICE_NAME:-t3code}"
service_file="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/${service_name}.service"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/t3code"
deploy_root="${T3CODE_LOCAL_DEPLOY_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/t3code/local-service}"
releases_dir="$deploy_root/releases"
current_release_link="$deploy_root/current"
pid_file="$state_dir/${service_name}.pid"
log_file="$state_dir/${service_name}.log"
port="${T3CODE_PORT:-3773}"
host="${T3CODE_HOST:-127.0.0.1}"
service_path="${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
bun_bin="$(command -v bun || true)"

escape_systemd_environment_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

read_existing_systemd_environment_value() {
  local name="$1"
  if [ ! -f "$service_file" ]; then
    return 0
  fi

  sed -n -E "s/^Environment=\"?${name}=([^\" ]*)\"?$/\\1/p" "$service_file" | tail -n 1
}

resolve_optional_environment_value() {
  local name="$1"
  local current_value="${!name:-}"
  if [ -n "$current_value" ]; then
    printf '%s' "$current_value"
    return 0
  fi

  read_existing_systemd_environment_value "$name"
}

append_optional_systemd_environment() {
  local name="$1"
  local value="$2"
  if [ -n "$value" ]; then
    printf 'Environment="%s=%s"\n' "$name" "$(escape_systemd_environment_value "$value")"
  fi
}

is_pid_running() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1
}

stop_pid() {
  local pid="$1"
  if ! is_pid_running "$pid"; then
    return 0
  fi

  kill "$pid" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    if ! is_pid_running "$pid"; then
      return 0
    fi
    sleep 1
  done

  if is_pid_running "$pid"; then
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
}

find_listening_port_pids() {
  local lookup_port="$1"
  local tool_pids=""
  if command -v lsof >/dev/null 2>&1; then
    tool_pids="$(lsof -nP -tiTCP:"$lookup_port" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
    if [ -n "$tool_pids" ]; then
      printf '%s\n' "$tool_pids"
      return 0
    fi
  fi

  if command -v fuser >/dev/null 2>&1; then
    tool_pids="$(fuser -n tcp "$lookup_port" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' | sort -u || true)"
    if [ -n "$tool_pids" ]; then
      printf '%s\n' "$tool_pids"
      return 0
    fi
  fi

  find_listening_port_pids_from_proc "$lookup_port"
}

find_listening_socket_inodes_from_proc_file() {
  local proc_file="$1"
  local lookup_port="$2"
  local port_hex
  port_hex="$(printf '%04X' "$lookup_port")"

  if [ ! -r "$proc_file" ]; then
    return 0
  fi

  awk -v port_hex="$port_hex" '
    NR > 1 {
      split($2, local_address, ":")
      if (toupper(local_address[2]) == port_hex && $4 == "0A") {
        print $10
      }
    }
  ' "$proc_file"
}

find_listening_socket_inodes_from_proc() {
  local lookup_port="$1"
  {
    find_listening_socket_inodes_from_proc_file /proc/net/tcp "$lookup_port"
    find_listening_socket_inodes_from_proc_file /proc/net/tcp6 "$lookup_port"
  } | sort -u
}

find_listening_port_pids_from_proc() {
  local lookup_port="$1"
  local inodes
  inodes="$(find_listening_socket_inodes_from_proc "$lookup_port")"
  if [ -z "$inodes" ]; then
    return 0
  fi

  for fd in /proc/[0-9]*/fd/*; do
    local target=""
    target="$(readlink "$fd" 2>/dev/null || true)"
    case "$target" in
      socket:\[*\])
        local socket_inode="${target#socket:[}"
        socket_inode="${socket_inode%]}"
        if grep -Fxq "$socket_inode" <<<"$inodes"; then
          local pid_path="${fd#/proc/}"
          printf '%s\n' "${pid_path%%/*}"
        fi
        ;;
    esac
  done | sort -u
}

pid_matches_this_deploy() {
  local pid="$1"
  local cwd=""
  local command_line=""
  local normalized_cwd=""
  local normalized_repo_root=""
  local normalized_server_dir=""

  if [ -r "/proc/$pid/cwd" ]; then
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  fi
  if [ -r "/proc/$pid/cmdline" ]; then
    command_line="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
  elif command -v ps >/dev/null 2>&1; then
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  fi

  normalized_cwd="$(realpath "$cwd" 2>/dev/null || printf '%s' "$cwd")"
  normalized_repo_root="$(realpath "$repo_root" 2>/dev/null || printf '%s' "$repo_root")"
  normalized_server_dir="$(realpath "$repo_root/apps/server" 2>/dev/null || printf '%s/apps/server' "$repo_root")"
  if [[ "$command_line" == *"apps/server/dist/bin.mjs"* ]] || [[ "$command_line" == *"bin.mjs serve"* ]]; then
    return 0
  fi

  [ "$normalized_cwd" = "$normalized_repo_root" ] &&
    [[ "$command_line" == *"serve"* ]] &&
    { [[ "$command_line" == *"bun"* ]] || [[ "$command_line" == *"node"* ]]; }
  local matched_repo_root=$?
  if [ "$matched_repo_root" -eq 0 ]; then
    return 0
  fi

  [ "$normalized_cwd" = "$normalized_server_dir" ] &&
    [[ "$command_line" == *"src/bin.ts"* ]] &&
    { [[ "$command_line" == *"bun"* ]] || [[ "$command_line" == *"node"* ]]; }
}

describe_pid() {
  local pid="$1"
  local cwd=""
  local command_line=""

  if [ -r "/proc/$pid/cwd" ]; then
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  fi
  if [ -r "/proc/$pid/cmdline" ]; then
    command_line="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
  elif command -v ps >/dev/null 2>&1; then
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  fi

  printf 'pid=%s cwd=%s command=%s\n' "$pid" "${cwd:-unknown}" "${command_line:-unknown}"
}

stop_existing_pid_file_process() {
  if [ ! -f "$pid_file" ]; then
    return 0
  fi

  old_pid="$(cat "$pid_file")"
  if is_pid_running "$old_pid"; then
    echo "Stopping existing $service_name process ($old_pid)..."
    stop_pid "$old_pid"
  fi
}

stop_existing_port_processes() {
  local port_pids
  port_pids="$(find_listening_port_pids "$port" || true)"
  if [ -z "$port_pids" ]; then
    return 0
  fi

  local unknown_pids=()
  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    if pid_matches_this_deploy "$pid"; then
      echo "Stopping existing $service_name listener on $host:$port ($pid)..."
      stop_pid "$pid"
    else
      unknown_pids+=("$pid")
    fi
  done <<<"$port_pids"

  if [ "${#unknown_pids[@]}" -gt 0 ]; then
    echo "Port $port is already in use by another process: ${unknown_pids[*]}" >&2
    for unknown_pid in "${unknown_pids[@]}"; do
      describe_pid "$unknown_pid" >&2
    done
    echo "Set T3CODE_PORT to a free port or stop the listener before deploying." >&2
    exit 1
  fi
}

stage_local_service_release() {
  local release_id
  local release_dir
  local tmp_release_dir

  release_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  release_dir="$releases_dir/$release_id"
  tmp_release_dir="$releases_dir/.${release_id}.tmp"

  if [ ! -f "$repo_root/apps/server/dist/bin.mjs" ]; then
    echo "Missing server build output: $repo_root/apps/server/dist/bin.mjs" >&2
    exit 1
  fi
  if [ ! -f "$repo_root/apps/server/dist/client/index.html" ]; then
    echo "Missing bundled web build output: $repo_root/apps/server/dist/client/index.html" >&2
    exit 1
  fi

  rm -rf "$tmp_release_dir"
  mkdir -p "$tmp_release_dir/apps/server"
  cp -R "$repo_root/apps/server/dist" "$tmp_release_dir/apps/server/dist"
  ln -s "$repo_root/node_modules" "$tmp_release_dir/node_modules"
  ln -s "$repo_root/apps/server/node_modules" "$tmp_release_dir/apps/server/node_modules"

  mkdir -p "$releases_dir"
  mv "$tmp_release_dir" "$release_dir"
  ln -sfn "$release_dir" "$current_release_link"

  echo "Deployed local service build to $release_dir"
}

if [ -z "$bun_bin" ]; then
  echo "bun is required to deploy T3 Code locally." >&2
  exit 1
fi

r_auth_issuer="$(resolve_optional_environment_value T3CODE_R_AUTH_ISSUER)"
r_auth_shared_secret="$(resolve_optional_environment_value T3CODE_R_AUTH_SHARED_SECRET)"
r_auth_registration_token="$(resolve_optional_environment_value T3CODE_R_AUTH_REGISTRATION_TOKEN)"

echo "Building web and server..."
(
  cd "$repo_root"
  bun run build -- --filter=@t3tools/web --filter=t3 --concurrency=1
)

stage_local_service_release

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
mkdir -p "$(dirname "$service_file")"

cat >"$service_file" <<SERVICE
[Unit]
Description=T3 Code local web service
After=network.target

[Service]
Type=simple
WorkingDirectory=$current_release_link
Environment=NODE_ENV=production
Environment=T3CODE_MODE=web
Environment=T3CODE_HOST=$host
Environment=T3CODE_PORT=$port
Environment=T3CODE_NO_BROWSER=true
Environment="PATH=$(escape_systemd_environment_value "$service_path")"
$(append_optional_systemd_environment T3CODE_R_AUTH_ISSUER "$r_auth_issuer")
$(append_optional_systemd_environment T3CODE_R_AUTH_SHARED_SECRET "$r_auth_shared_secret")
$(append_optional_systemd_environment T3CODE_R_AUTH_REGISTRATION_TOKEN "$r_auth_registration_token")
ExecStart=$bun_bin $current_release_link/apps/server/dist/bin.mjs serve --host $host --port $port --no-browser
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
SERVICE

echo "Installed $service_file"

systemctl --user daemon-reload
systemctl --user enable --now "${service_name}.service"
systemctl --user restart "${service_name}.service"

echo "T3 Code is running at http://$host:$port"
echo "Service status: systemctl --user status ${service_name}.service"
exit 0
fi

mkdir -p "$state_dir"

stop_existing_pid_file_process
stop_existing_port_processes

echo "systemd user services are unavailable; starting a background local process instead."
(
  cd "$current_release_link"
  NODE_ENV=production \
    T3CODE_MODE=web \
    T3CODE_HOST="$host" \
    T3CODE_PORT="$port" \
    T3CODE_NO_BROWSER=true \
    T3CODE_R_AUTH_ISSUER="$r_auth_issuer" \
    T3CODE_R_AUTH_SHARED_SECRET="$r_auth_shared_secret" \
    T3CODE_R_AUTH_REGISTRATION_TOKEN="$r_auth_registration_token" \
    nohup "$bun_bin" "$current_release_link/apps/server/dist/bin.mjs" serve --host "$host" --port "$port" --no-browser \
      >"$log_file" 2>&1 &
  echo "$!" >"$pid_file"
)

sleep 1
pid="$(cat "$pid_file")"
if ! kill -0 "$pid" >/dev/null 2>&1; then
  echo "Failed to start $service_name. Recent logs:" >&2
  tail -n 40 "$log_file" >&2 || true
  exit 1
fi

echo "T3 Code is running at http://$host:$port"
echo "Process pid: $pid"
echo "Logs: $log_file"
echo "Stop: kill \$(cat \"$pid_file\")"
