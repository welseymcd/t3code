#!/usr/bin/env bash
set -euo pipefail

docker_socket=/var/run/docker.sock
runtime_user="${RUNTIME_USER:-bun}"
runtime_home="${HOME:-/data/home}"

prepare_host_linked_auth() {
  local user_home
  user_home="$(getent passwd "${runtime_user}" | cut -d: -f6 || true)"

  mkdir -p \
    "${runtime_home}/.codex" \
    "${runtime_home}/.config/gh" \
    "${runtime_home}/.config/opencode" \
    "${runtime_home}/.local/share/opencode"

  chown -R "${runtime_user}:${runtime_user}" "${runtime_home}"

  if [[ -z "${user_home}" || "${user_home}" == "${runtime_home}" ]]; then
    return
  fi

  mkdir -p "${user_home}/.config" "${user_home}/.local/share"
  chown "${runtime_user}:${runtime_user}" \
    "${user_home}" \
    "${user_home}/.config" \
    "${user_home}/.local" \
    "${user_home}/.local/share"

  link_path "${runtime_home}/.codex" "${user_home}/.codex"
  link_path "${runtime_home}/.config/gh" "${user_home}/.config/gh"
  link_path "${runtime_home}/.config/opencode" "${user_home}/.config/opencode"
  link_path "${runtime_home}/.local/share/opencode" "${user_home}/.local/share/opencode"

  chown -h "${runtime_user}:${runtime_user}" \
    "${user_home}/.codex" \
    "${user_home}/.config/gh" \
    "${user_home}/.config/opencode" \
    "${user_home}/.local/share/opencode"
}

link_path() {
  local target="$1"
  local path="$2"

  if [[ -L "${path}" ]]; then
    if [[ "$(readlink "${path}")" == "${target}" ]]; then
      return
    fi
    rm "${path}"
  elif [[ -e "${path}" ]]; then
    if [[ -d "${path}" && -z "$(find "${path}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      rmdir "${path}"
    else
      return
    fi
  fi

  ln -s "${target}" "${path}"
}

prepare_host_linked_auth

if [[ -S "${docker_socket}" ]]; then
  socket_gid="$(stat -c '%g' "${docker_socket}")"

  if [[ "${socket_gid}" != "0" ]]; then
    existing_group="$(getent group "${socket_gid}" | cut -d: -f1 || true)"

    if [[ -n "${existing_group}" ]]; then
      usermod -aG "${existing_group}" "${runtime_user}"
    else
      groupadd --gid "${socket_gid}" docker-host
      usermod -aG docker-host "${runtime_user}"
    fi
  fi
fi

if [[ -S "${docker_socket}" ]] && ! gosu "${runtime_user}" test -w "${docker_socket}"; then
  exec "$@"
fi

exec gosu "${runtime_user}" "$@"
