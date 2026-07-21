#!/bin/sh
set -eu

repoRoot="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export PATH="$repoRoot/scripts:/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
export QINGSHE_IOS_MIN_VERSION="${QINGSHE_IOS_MIN_VERSION:-15.0}"
# Xcode build phases do not reliably preserve the outer GitHub Actions CI
# variable. pnpm otherwise tries to ask before refreshing node_modules and
# aborts because the Xcode phase has no TTY.
export CI="${CI:-true}"

run_tauri_xcode_script() {
  if command -v pnpm >/dev/null 2>&1; then
    "$(command -v pnpm)" -C "$repoRoot" tauri ios xcode-script "$@"
    return $?
  fi

  for corepack in /opt/homebrew/bin/corepack /usr/local/bin/corepack "$HOME/.volta/bin/corepack"; do
    if [ -x "$corepack" ]; then
      "$corepack" pnpm -C "$repoRoot" tauri ios xcode-script "$@"
      return $?
    fi
  done

  echo "Xcode 构建找不到 pnpm 或 corepack，请先安装 Node.js/pnpm。" >&2
  return 127
}

run_tauri_xcode_script "$@"
status=$?

# Xcode 27's linker asserts when a static archive embeds the same Swift object
# name more than once (Tauri.o / SwiftRs.o come from both Tauri and plugins).
if [ "$status" -eq 0 ]; then
  for archive in \
    "$repoRoot/src-tauri/gen/apple/Externals/arm64/release/libapp.a" \
    "$repoRoot/src-tauri/gen/apple/Externals/arm64/debug/libapp.a" \
    "$repoRoot/src-tauri/gen/apple/Externals/x86_64/release/libapp.a" \
    "$repoRoot/src-tauri/gen/apple/Externals/x86_64/debug/libapp.a" \
    "$repoRoot/src-tauri/target/aarch64-apple-ios/release/libqingshe_desktop_lib.a" \
    "$repoRoot/src-tauri/target/aarch64-apple-ios/debug/libqingshe_desktop_lib.a"
  do
    if [ -f "$archive" ]; then
      node "$repoRoot/scripts/dedupe-ios-staticlib.mjs" "$archive" || true
    fi
  done
fi

exit "$status"
