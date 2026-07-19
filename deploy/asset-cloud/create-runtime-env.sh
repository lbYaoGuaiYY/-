#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_directory/../.." && pwd)

exec node "$project_root/scripts/create-runtime-env.mjs"
