#!/usr/bin/env bash
set -euo pipefail

project_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$project_root"

workdir=$(mktemp -d /tmp/qingshe-pipeline-e2e.XXXXXX)
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
base="http://127.0.0.1:${port}/api/v1"
server_log="$workdir/server.log"

QINGSHE_ASSET_LIBRARY="$workdir/library" \
QINGSHE_EDITOR_TOKEN="pipeline-editor-token" \
QINGSHE_ADMIN_TOKEN="pipeline-admin-token" \
QINGSHE_ALLOWED_ORIGINS="http://127.0.0.1" \
QINGSHE_ADMIN_STATIC="$project_root/dist-asset-admin" \
  deploy/asset-cloud/.venv/bin/uvicorn tools.asset_admin.cloud_server:create_app \
    --factory --host 127.0.0.1 --port "$port" >"$server_log" 2>&1 &
server_pid=$!

cleanup() {
  exit_code=$?
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  if [ "$exit_code" -ne 0 ]; then
    tail -n 80 "$server_log" >&2 || true
  fi
  rm -rf "$workdir"
  exit "$exit_code"
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 50); do
  if curl -fsS "$base/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done
if [ "$ready" -ne 1 ]; then
  echo "临时素材服务未启动" >&2
  exit 1
fi

pair_json=$(curl -fsS -X POST "$base/admin/processing-nodes/pair" \
  -H "Authorization: Bearer pipeline-admin-token" \
  -H "Content-Type: application/json" \
  --data '{"name":"本机闭环验收节点","platform":"macos"}')
node_token=$(printf '%s' "$pair_json" | jq -er '.token')

task_json=$(curl -fsS -X POST "$base/admin/processing-tasks" \
  -H "Authorization: Bearer pipeline-admin-token" \
  -F 'metadata={"name":"本机全自动闭环验收","category":"花艺","needs_review":false}' \
  -F 'original=@src/features/assets/media/burgundy-autumn-floral.png;type=image/png')
task_id=$(printf '%s' "$task_json" | jq -er '.id')

QINGSHE_PIPELINE_BASE="$base" QINGSHE_PIPELINE_TOKEN="$node_token" \
  .processing-node-py312-venv/bin/python - <<'PY'
import os
import signal
from threading import Event

from tools.asset_admin.processing_agent import run_agent

stopped = Event()
completed: list[str] = []


def deadline(_signum: int, _frame: object) -> None:
    raise TimeoutError("本机抠图闭环超过 180 秒")


signal.signal(signal.SIGALRM, deadline)
signal.alarm(180)
run_agent(
    os.environ["QINGSHE_PIPELINE_BASE"],
    os.environ["QINGSHE_PIPELINE_TOKEN"],
    completion_callback=lambda name: (completed.append(name), stopped.set()),
    stop_event=stopped,
)
signal.alarm(0)
if completed != ["本机全自动闭环验收"]:
    raise SystemExit(f"unexpected completion events: {completed}")
print("LOCAL_PROCESSOR=completed")
PY

dashboard=$(curl -fsS "$base/admin/processing-dashboard" \
  -H "Authorization: Bearer pipeline-admin-token")
asset_id=$(printf '%s' "$dashboard" | jq -er --arg task "$task_id" \
  '.tasks[] | select(.id == $task and .status == "ready") | .asset_id')
catalog=$(curl -fsS "$base/assets" -H "Authorization: Bearer pipeline-editor-token")
printf '%s' "$catalog" | jq -e --arg asset "$asset_id" \
  '.assets[] | select(.id == $asset and .name == "本机全自动闭环验收" and .status == "ready" and .needs_review == false)' \
  >/dev/null

processed_status=$(curl -sS -o /dev/null -w '%{http_code}' \
  "$base/assets/$asset_id/processed?access_token=pipeline-editor-token")
thumbnail_status=$(curl -sS -o /dev/null -w '%{http_code}' \
  "$base/assets/$asset_id/thumbnail?access_token=pipeline-editor-token")

if [ "$processed_status" != "200" ] || [ "$thumbnail_status" != "200" ]; then
  echo "处理结果不可读取：processed=$processed_status thumbnail=$thumbnail_status" >&2
  exit 1
fi

printf 'PIPELINE task=%s asset=%s processed=%s thumbnail=%s catalog=ready\n' \
  "$task_id" "$asset_id" "$processed_status" "$thumbnail_status"
