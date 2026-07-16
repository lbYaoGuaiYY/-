#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_directory/../.." && pwd)

cd "$script_directory"
umask 077

if [ ! -f .env ]; then
  editor_token="$(openssl rand -hex 32)"
  admin_token="$(openssl rand -hex 32)"
  {
    printf '%s\n' "QINGSHE_EDITOR_TOKEN=$editor_token"
    printf '%s\n' "QINGSHE_ADMIN_TOKEN=$admin_token"
    printf '%s\n' "QINGSHE_ALLOWED_ORIGINS=https://assets.xiduoduo.top,http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:4174,http://localhost:4174,tauri://localhost,http://tauri.localhost"
  } > .env
fi

. ./.env

{
  printf '%s\n' "VITE_APP_ENV=production"
  printf '%s\n' "VITE_ASSET_SERVICE_URL=https://assets.xiduoduo.top/api/v1"
  printf '%s\n' "VITE_ASSET_EDITOR_TOKEN=$QINGSHE_EDITOR_TOKEN"
  printf '%s\n' "VITE_ASSET_SERVICE_EVENTS=0"
} > "$project_root/.env.local"

chmod 600 .env "$project_root/.env.local"
