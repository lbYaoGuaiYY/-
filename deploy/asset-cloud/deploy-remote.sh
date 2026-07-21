#!/bin/sh
set -eu

lock_file=/var/lock/qingshe-assets-deploy.lock
mkdir -p "$(dirname "$lock_file")"
exec 9>"$lock_file"
if ! flock -n 9; then
  printf '%s\n' "another qingshe asset deployment is already running" >&2
  exit 75
fi

script_directory=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_directory/../.." && pwd)
cd "$script_directory"

backup_root=/root
backup_prefix=xiduoduo-site-disabled-
backup=""
previous_image=""
app_image=""
primary_replaced=0
canary_started=0
legacy_restore_needed=0
legacy_active_units=""
legacy_enabled_units=""

prune_site_backups() {
  candidates=$(find "$backup_root" -mindepth 1 -maxdepth 1 -type d \
    -name "${backup_prefix}*" -printf '%T@ %p\n' 2>/dev/null | sort -nr | tail -n +6)
  [ -n "$candidates" ] || return 0

  printf '%s\n' "$candidates" | while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    candidate=${entry#* }
    resolved=$(realpath -- "$candidate" 2>/dev/null) || continue
    case "$resolved" in
      "$backup_root"/"$backup_prefix"*) ;;
      *) continue ;;
    esac
    [ "$(dirname "$resolved")" = "$backup_root" ] || continue
    rm -rf -- "$resolved"
  done
}

prune_app_images() {
  current_container=$(docker compose ps -q qingshe-assets 2>/dev/null | head -n 1 || true)
  [ -n "$current_container" ] || return 0
  current_image_id=$(docker inspect --format '{{.Image}}' "$current_container" 2>/dev/null || true)
  [ -n "$current_image_id" ] || return 0
  retained=0
  docker image ls --no-trunc --filter reference='qingshe-assets:*' \
    --format '{{.Repository}}:{{.Tag}} {{.ID}}' | while IFS=' ' read -r reference image_id; do
    [ -n "$reference" ] || continue
    [ "$reference" = "qingshe-assets:<none>" ] && continue
    [ "$image_id" = "$current_image_id" ] && continue
    retained=$((retained + 1))
    [ "$retained" -le 2 ] && continue
    docker image rm "$reference" >/dev/null 2>&1 || true
  done
}

wait_for_healthy() {
  service=$1
  attempt=0
  max_attempts=${QINGSHE_HEALTH_ATTEMPTS:-60}
  until docker compose exec -T "$service" .venv/bin/python -c \
    "import json, urllib.request; response = urllib.request.urlopen('http://127.0.0.1:7000/api/v1/health', timeout=3); assert response.status == 200 and json.load(response).get('status') in {'ready', 'maintenance', 'degraded'}" \
    >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge "$max_attempts" ]; then
      return 1
    fi
    sleep 2
  done
}

validate_caddy() {
  if docker compose ps --status running --services caddy 2>/dev/null | grep -qx caddy; then
    docker compose exec -T caddy \
      caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  else
    docker compose run --rm --no-deps caddy \
      caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  fi
}

stop_legacy_units() {
  for unit in xiduoduo-site.service xiduoduo-site-https.service; do
    systemctl list-unit-files "$unit" --no-legend 2>/dev/null | grep -q "$unit" || continue
    if systemctl is-active --quiet "$unit"; then
      legacy_active_units="$legacy_active_units $unit"
    fi
    if systemctl is-enabled --quiet "$unit"; then
      legacy_enabled_units="$legacy_enabled_units $unit"
    fi
    systemctl disable --now "$unit"
  done
}

restore_legacy_units() {
  for unit in $legacy_enabled_units; do
    systemctl enable "$unit" || true
  done
  for unit in $legacy_active_units; do
    systemctl start "$unit" || true
  done
}

reload_or_start_caddy() {
  if docker compose ps --status running --services caddy 2>/dev/null | grep -qx caddy; then
    docker compose exec -T caddy \
      caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  else
    legacy_restore_needed=1
    stop_legacy_units
    docker compose up -d --no-deps caddy
  fi
}

probe_public_service() {
  public_base_url=${QINGSHE_PUBLIC_URL:-https://assets.xiduoduo.top}
  health_body=$(curl --fail --silent --show-error --max-time 15 \
    "$public_base_url/api/v1/health") || return 1
  printf '%s' "$health_body" | grep -Eq \
    '"status"[[:space:]]*:[[:space:]]*"(ready|maintenance|degraded)"' || return 1
  if printf '%s' "$health_body" | grep -Eq \
    '"status"[[:space:]]*:[[:space:]]*"ready"'; then
    curl --fail --silent --show-error --max-time 15 \
      -H "Authorization: Bearer $QINGSHE_EDITOR_TOKEN" \
      "$public_base_url/api/v1/catalog/revision" >/dev/null
  fi
}

on_exit() {
  status=$?
  trap - EXIT
  set +e

  if [ "$status" -ne 0 ]; then
    printf '%s\n' "deployment failed; preserving the canary as a fallback" >&2
    if [ "$primary_replaced" -eq 1 ]; then
      rollback_ok=0
      if [ -n "$previous_image" ]; then
        export QINGSHE_APP_IMAGE="$previous_image"
        if docker compose up -d --no-deps qingshe-assets && \
          wait_for_healthy qingshe-assets && probe_public_service; then
          rollback_ok=1
          docker compose stop qingshe-assets-canary || true
          canary_started=0
          printf '%s\n' "primary image rolled back and the canary was stopped" >&2
        else
          printf '%s\n' "primary rollback failed; preserving the ready canary" >&2
        fi
      else
        printf '%s\n' "previous primary image is unknown; preserving the ready canary" >&2
      fi
      if [ "$rollback_ok" -eq 0 ]; then
        printf '%s\n' "rollback did not restore primary; canary must remain available" >&2
      fi
    elif [ "$canary_started" -eq 1 ]; then
      docker compose stop qingshe-assets-canary || true
      if [ "$legacy_restore_needed" -eq 1 ]; then
        docker compose stop caddy || true
        restore_legacy_units
      fi
    fi
    if [ "$primary_replaced" -eq 0 ] && [ -n "$previous_image" ]; then
      docker image rm "$previous_image" >/dev/null 2>&1 || true
    fi
    if [ "$primary_replaced" -eq 0 ] && [ -n "$app_image" ]; then
      docker image rm "$app_image" >/dev/null 2>&1 || true
    fi
    docker compose ps --all || true
  fi

  exit "$status"
}
trap on_exit EXIT

backup=$(mktemp -d "${backup_root}/${backup_prefix}XXXXXXXX")
if [ -d /srv/xiduoduo-site ]; then
  cp -a /srv/xiduoduo-site "$backup/"
fi
cp -a /etc/systemd/system/xiduoduo-site-*.service "$backup/" 2>/dev/null || true

sh ./create-runtime-env.sh
. ./.env

primary_container=$(docker compose ps -q qingshe-assets 2>/dev/null | head -n 1 || true)
if [ -n "$primary_container" ]; then
  previous_image_id=$(docker inspect --format '{{.Image}}' \
    "$primary_container" 2>/dev/null || true)
  if [ -n "$previous_image_id" ]; then
    previous_image="qingshe-assets:rollback-$(date +%Y%m%d%H%M%S)-$$"
    docker image tag "$previous_image_id" "$previous_image"
  fi
fi
revision=$(git -C "$project_root" rev-parse --short=12 HEAD)
case "$revision" in
  ''|*[!A-Za-z0-9]*)
    printf '%s\n' "could not derive a safe git revision for the image tag" >&2
    exit 1
    ;;
esac
build_id="$(date +%Y%m%d%H%M%S)-$$"
app_image="qingshe-assets:${revision}-${build_id}"
docker build --file "$script_directory/Dockerfile" --tag "$app_image" "$project_root"
export QINGSHE_APP_IMAGE="$app_image"
docker compose config --quiet
docker compose pull caddy

# Stage the new image without touching the currently serving primary.
canary_started=1
docker compose up -d --no-deps qingshe-assets-canary
wait_for_healthy qingshe-assets-canary

# Validate before touching any legacy listener, then gracefully update Caddy.
validate_caddy
reload_or_start_caddy
probe_public_service
legacy_restore_needed=0

# Recreate the primary while the ready canary remains available as fallback.
primary_replaced=1
docker compose up -d --no-deps qingshe-assets
wait_for_healthy qingshe-assets
probe_public_service

docker compose stop qingshe-assets-canary
canary_started=0
[ -z "$previous_image" ] || docker image rm "$previous_image" >/dev/null 2>&1 || true
prune_site_backups
prune_app_images
docker compose ps --all
docker compose logs --tail=40 qingshe-assets caddy
