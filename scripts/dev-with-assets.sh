#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export U2NET_HOME="$project_root/.qingshe-models"
stdout_log="$project_root/asset-removal.out.log"
stderr_log="$project_root/asset-removal.err.log"

cleanup() {
  if kill -0 "$service_pid" 2>/dev/null; then
    kill "$service_pid" 2>/dev/null || true
  fi
  wait "$service_pid" 2>/dev/null || true
}

cd "$project_root"
pnpm assets:server >"$stdout_log" 2>"$stderr_log" &
service_pid=$!
trap cleanup EXIT INT TERM
pnpm dev "$@"
