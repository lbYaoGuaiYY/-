#!/bin/sh
set -eu

backup="/root/xiduoduo-site-disabled-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a /srv/xiduoduo-site "$backup/"
cp -a /etc/systemd/system/xiduoduo-site-*.service "$backup/" 2>/dev/null || true

for unit in xiduoduo-site.service xiduoduo-site-https.service; do
  if systemctl list-unit-files "$unit" --no-legend 2>/dev/null | grep -q "$unit"; then
    systemctl disable --now "$unit"
  fi
done

cd /opt/qingshe-assets/deploy/asset-cloud
docker compose up -d
docker compose ps
