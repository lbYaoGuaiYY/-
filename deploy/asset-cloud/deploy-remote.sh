#!/bin/sh
set -eu

backup="/root/xiduoduo-site-disabled-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
if [ -d /srv/xiduoduo-site ]; then
  cp -a /srv/xiduoduo-site "$backup/"
fi
cp -a /etc/systemd/system/xiduoduo-site-*.service "$backup/" 2>/dev/null || true

for unit in xiduoduo-site.service xiduoduo-site-https.service; do
  if systemctl list-unit-files "$unit" --no-legend 2>/dev/null | grep -q "$unit"; then
    systemctl disable --now "$unit"
  fi
done

cd /opt/qingshe-assets/deploy/asset-cloud
sh ./create-runtime-env.sh
docker compose config --quiet
docker compose pull caddy
docker compose up -d --build --remove-orphans
docker compose ps

attempt=0
until docker compose exec -T qingshe-assets .venv/bin/python -c \
  "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7000/api/v1/health', timeout=3)"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker compose logs --tail=100 qingshe-assets caddy
    exit 1
  fi
  sleep 2
done

docker compose logs --tail=40 qingshe-assets caddy
