#!/usr/bin/env bash
set -euo pipefail

docker_socket=/var/run/docker.sock
runtime_user="${RUNTIME_USER:-bun}"

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
