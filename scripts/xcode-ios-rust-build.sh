#!/bin/sh
set -eu

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"

if command -v pnpm >/dev/null 2>&1; then
  exec "$(command -v pnpm)" -C "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)" tauri ios xcode-script "$@"
fi

for corepack in /opt/homebrew/bin/corepack /usr/local/bin/corepack "$HOME/.volta/bin/corepack"; do
  if [ -x "$corepack" ]; then
    exec "$corepack" pnpm -C "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)" tauri ios xcode-script "$@"
  fi
done

echo "Xcode 构建找不到 pnpm 或 corepack，请先安装 Node.js/pnpm。" >&2
exit 127
