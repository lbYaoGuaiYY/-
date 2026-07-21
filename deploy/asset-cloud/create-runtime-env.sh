#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_directory/../.." && pwd)

cd "$script_directory"
umask 077

if [ ! -f .env ]; then
  editor_token="$(openssl rand -hex 32)"
  admin_token="$(openssl rand -hex 32)"
  admin_session_secret="$(openssl rand -hex 32)"
  submission_token="$(openssl rand -hex 32)"
  processing_registration_token="$(openssl rand -hex 32)"
  {
    printf '%s\n' "QINGSHE_EDITOR_TOKEN=$editor_token"
    printf '%s\n' "QINGSHE_ADMIN_TOKEN=$admin_token"
    printf '%s\n' "QINGSHE_ADMIN_SESSION_SECRET=$admin_session_secret"
    printf '%s\n' "QINGSHE_SUBMISSION_TOKEN=$submission_token"
    printf '%s\n' "QINGSHE_TRUSTED_PROXY_IPS=172.30.232.3/32"
    printf '%s\n' "QINGSHE_PROCESSING_REGISTRATION_TOKEN=$processing_registration_token"
    printf '%s\n' "QINGSHE_ALLOWED_ORIGINS=https://assets.xiduoduo.top,http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:4174,http://localhost:4174,tauri://localhost,http://tauri.localhost"
  } > .env
fi

. ./.env

python_bin="${PYTHON:-python}"
if ! command -v "$python_bin" >/dev/null 2>&1 || [ -z "$("$python_bin" -c 'import sys; print(sys.version_info[0])' 2>/dev/null)" ]; then
  python_bin="python3"
fi
if ! command -v "$python_bin" >/dev/null 2>&1 || [ -z "$("$python_bin" -c 'import sys; print(sys.version_info[0])' 2>/dev/null)" ]; then
  printf '%s\n' "python3/python is required to generate the admin password hash" >&2
  exit 1
fi

set_env_value() {
  key="$1"
  value="$2"
  if grep -Eq "^${key}=" .env; then
    temporary="$(mktemp .env.XXXXXX)"
    sed "s|^${key}=.*$|${key}=${value}|" .env > "$temporary"
    chmod 600 "$temporary"
    mv "$temporary" .env
  else
    printf '%s\n' "${key}=${value}" >> .env
  fi
}

if [ -z "${QINGSHE_ADMIN_USERNAME:-}" ]; then
  set_env_value "QINGSHE_ADMIN_USERNAME" "admin"
  QINGSHE_ADMIN_USERNAME="admin"
fi

admin_credentials_created=0
if [ -z "${QINGSHE_ADMIN_PASSWORD_SALT:-}" ] || [ -z "${QINGSHE_ADMIN_PASSWORD_HASH:-}" ]; then
  admin_password="$(openssl rand -hex 24)"
  admin_salt_hex="$(openssl rand -hex 16)"
  admin_salt="$(QINGSHE_SALT_HEX="$admin_salt_hex" "$python_bin" - <<'PY'
import base64
import os

print(base64.urlsafe_b64encode(bytes.fromhex(os.environ["QINGSHE_SALT_HEX"])).decode("ascii"))
PY
)"
  admin_hash="$(QINGSHE_ADMIN_PASSWORD="$admin_password" QINGSHE_SALT="$admin_salt" "$python_bin" - <<'PY'
import base64
import hashlib
import os

salt = base64.urlsafe_b64decode(os.environ["QINGSHE_SALT"])
candidate = hashlib.pbkdf2_hmac(
    "sha256", os.environ["QINGSHE_ADMIN_PASSWORD"].encode("utf-8"), salt, 120_000
)
print(base64.urlsafe_b64encode(candidate).decode("ascii"))
PY
)"
  # Replace both values when either side is missing; never keep a mismatched
  # salt/hash pair from a partially configured environment.
  set_env_value "QINGSHE_ADMIN_PASSWORD_SALT" "$admin_salt"
  set_env_value "QINGSHE_ADMIN_PASSWORD_HASH" "$admin_hash"
  admin_credentials_created=1
fi

if [ -z "${QINGSHE_ADMIN_SESSION_SECRET:-}" ]; then
  admin_session_secret="$(openssl rand -hex 32)"
  set_env_value "QINGSHE_ADMIN_SESSION_SECRET" "$admin_session_secret"
fi

if [ "$admin_credentials_created" -eq 1 ]; then
  # Keep the one-time password out of stdout, compose logs and frontend env.
  printf 'username=%s\npassword=%s\n' "$QINGSHE_ADMIN_USERNAME" "$admin_password" > .admin-credentials
fi

. ./.env

if [ -z "${QINGSHE_TRUSTED_PROXY_IPS:-}" ]; then
  trusted_proxy_ips="172.30.232.3/32"
  set_env_value "QINGSHE_TRUSTED_PROXY_IPS" "$trusted_proxy_ips"
  QINGSHE_TRUSTED_PROXY_IPS="$trusted_proxy_ips"
  export QINGSHE_TRUSTED_PROXY_IPS
fi

if [ -z "${QINGSHE_SUBMISSION_TOKEN:-}" ]; then
  submission_token="$(openssl rand -hex 32)"
  set_env_value "QINGSHE_SUBMISSION_TOKEN" "$submission_token"
  QINGSHE_SUBMISSION_TOKEN="$submission_token"
  export QINGSHE_SUBMISSION_TOKEN
fi

if [ -z "${QINGSHE_PROCESSING_REGISTRATION_TOKEN:-}" ]; then
  processing_registration_token="$(openssl rand -hex 32)"
  set_env_value "QINGSHE_PROCESSING_REGISTRATION_TOKEN" "$processing_registration_token"
  QINGSHE_PROCESSING_REGISTRATION_TOKEN="$processing_registration_token"
  export QINGSHE_PROCESSING_REGISTRATION_TOKEN
fi

{
  printf '%s\n' "VITE_APP_ENV=production"
  printf '%s\n' "VITE_ASSET_SERVICE_URL=https://assets.xiduoduo.top/api/v1"
  printf '%s\n' "VITE_ASSET_EDITOR_TOKEN=$QINGSHE_EDITOR_TOKEN"
  printf '%s\n' "VITE_ASSET_SERVICE_EVENTS=0"
} > "$project_root/.env.local"

chmod 600 .env "$project_root/.env.local"
[ ! -f .admin-credentials ] || chmod 600 .admin-credentials
