#!/bin/sh
set -eu

cd "$(dirname "$0")"
umask 077

if [ ! -f .env ]; then
  editor_token="$(openssl rand -hex 32)"
  admin_token="$(openssl rand -hex 32)"
  {
    printf '%s\n' "QINGSHE_EDITOR_TOKEN=$editor_token"
    printf '%s\n' "QINGSHE_ADMIN_TOKEN=$admin_token"
    printf '%s\n' "QINGSHE_ALLOWED_ORIGINS=http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:4174,http://localhost:4174,tauri://localhost,http://tauri.localhost"
  } > .env
fi

. ./.env

{
  printf '%s\n' "VITE_ASSET_ADMIN_SERVICE_URL=http://127.0.0.1:7000"
  printf '%s\n' "VITE_ASSET_SERVICE_URL=http://191.223.220.201/qingshe-assets/api/v1"
  printf '%s\n' "VITE_ASSET_EDITOR_TOKEN=$QINGSHE_EDITOR_TOKEN"
  printf '%s\n' "VITE_ASSET_SERVICE_EVENTS=0"
  printf '%s\n' "VITE_ASSET_CLOUD_URL=http://191.223.220.201/qingshe-assets/api/v1"
  printf '%s\n' "VITE_ASSET_CLOUD_ADMIN_TOKEN=$QINGSHE_ADMIN_TOKEN"
} > client.env

chmod 600 .env client.env
