# Cloud Automation Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scoped extension devices, durable automation runs/items, idempotent image upload, and dashboard visibility to the existing FastAPI cloud service.

**Architecture:** `ExtensionAutomationStore` owns a separate SQLite database and token hashes. FastAPI authenticates extension tokens independently from admin/editor/node credentials, while uploaded run items reuse `RemoteProcessingStore.create_task()` and synchronize back from processing task completion.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, SQLite, pytest/TestClient.

## Global Constraints

- Keep admin, editor, processor-node, and extension-device credentials separate.
- Preserve the existing manual stage-then-confirm route.
- Do not modify MediaCrawler or unrelated editor code.
- Work in the existing dirty checkout without commits or broad cleanup.

---

### Task 1: Durable extension automation store

**Files:**
- Create: `tools/asset_admin/extension_automation.py`
- Test: `tests/test_asset_cloud.py`

**Interfaces:**
- Produces: `ExtensionAutomationStore.pair_device(name, platform)`, `authenticate_device(token)`, `create_run(device_id, provider, prompt, count, category)`, `update_item(...)`, `attach_processing_task(...)`, `complete_processing_task(...)`, and `dashboard_payload()`.

- [ ] **Step 1: Write the failing store/API behavior test**

```python
def test_extension_device_can_create_a_durable_ten_item_run(tmp_path: Path) -> None:
    client = TestClient(create_app(cloud_settings(tmp_path)))
    paired = client.post(
        "/api/v1/admin/extension-devices/pair",
        headers=ADMIN_HEADERS,
        json={"name": "Chrome on Mac", "platform": "chrome"},
    ).json()
    run = client.post(
        "/api/v1/extension-runs",
        headers={"Authorization": f"Bearer {paired['token']}"},
        json={"provider": "chatgpt", "prompt": "婚庆素材", "count": 10},
    )
    assert run.status_code == 201
    assert len(run.json()["items"]) == 10
```

- [ ] **Step 2: Run the test and verify the endpoint is missing**

Run: `uv run pytest tests/test_asset_cloud.py -k extension_device_can_create -q`
Expected: FAIL with HTTP 404.

- [ ] **Step 3: Implement the store with exact state values**

```python
RUN_STATES = ("queued", "running", "completed", "failed", "cancelled")
ITEM_STATES = ("queued", "generating", "uploading", "processing", "ready", "failed")
DEVICE_ACTIVE_SECONDS = 90
```

The three tables use UUID text primary keys, SHA-256 token hashes, UTC ISO timestamps, and an item unique constraint on `(run_id, ordinal)`.

- [ ] **Step 4: Add Pydantic request models and scoped dependencies**

```python
class ExtensionDevicePairRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    platform: Literal["chrome", "firefox", "edge"]

class AutomationRunRequest(BaseModel):
    provider: Literal["chatgpt", "gemini"]
    prompt: str = Field(min_length=1, max_length=4000)
    count: int = Field(ge=1, le=50)
    category: str | None = None
```

- [ ] **Step 5: Run focused tests**

Run: `uv run pytest tests/test_asset_cloud.py -k 'extension_device or extension_run' -q`
Expected: PASS.

### Task 2: Idempotent run-item upload and processing linkage

**Files:**
- Modify: `tools/asset_admin/cloud_server.py`
- Modify: `tools/asset_admin/remote_processing.py`
- Modify: `tools/asset_admin/extension_automation.py`
- Test: `tests/test_asset_cloud.py`

**Interfaces:**
- Consumes: extension device authentication and run ownership.
- Produces: `POST /api/v1/extension-runs/{run_id}/items/{item_id}/upload` and task-to-item completion synchronization.

- [ ] **Step 1: Write a failing idempotency test**

```python
first = client.post(upload_url, headers=device_headers, files={"original": image_file})
second = client.post(upload_url, headers=device_headers, files={"original": image_file})
assert first.status_code == 201
assert second.status_code == 200
assert first.json()["task_id"] == second.json()["task_id"]
```

- [ ] **Step 2: Verify RED**

Run: `uv run pytest tests/test_asset_cloud.py -k extension_run_upload_is_idempotent -q`
Expected: FAIL with HTTP 404.

- [ ] **Step 3: Implement upload validation and reuse the processing store**

The endpoint validates item ownership/state, `image/jpeg|image/png|image/webp`, and `MAX_INPUT_BYTES`; it calls `processing.create_task(...)`, then atomically stores `task_id` and `processing` state. A second upload returns the existing task id without creating another processing row.

- [ ] **Step 4: Synchronize completion**

After `processing.complete_task(...)` succeeds, call:

```python
automation.complete_processing_task(task_id, asset_id)
```

This sets the item to `ready`, records `asset_id`, and marks the run `completed` only when every item is ready.

- [ ] **Step 5: Run focused tests**

Run: `uv run pytest tests/test_asset_cloud.py -k 'extension_run or remote_processing_node' -q`
Expected: PASS.

### Task 3: Heartbeat and unified dashboard

**Files:**
- Modify: `tools/asset_admin/cloud_server.py`
- Modify: `tools/asset_admin/extension_automation.py`
- Test: `tests/test_asset_cloud.py`

**Interfaces:**
- Produces: `POST /api/v1/extension-devices/heartbeat`, `GET /api/v1/extension-runs/{run_id}`, and dashboard keys `extension_devices` and `automation_runs`.

- [ ] **Step 1: Write stale-device and dashboard tests**

```python
dashboard = client.get("/api/v1/admin/processing-dashboard", headers=ADMIN_HEADERS).json()
assert dashboard["extension_devices"][0]["status"] == "offline"
assert dashboard["automation_runs"][0]["total"] == 10
```

- [ ] **Step 2: Verify RED**

Run: `uv run pytest tests/test_asset_cloud.py -k 'extension_heartbeat or automation_dashboard' -q`
Expected: FAIL because dashboard keys are absent.

- [ ] **Step 3: Implement heartbeat/status projections**

Authentication refreshes `last_seen`; heartbeat returns `{"ok": True}`. Dashboard run summaries include `id`, `provider`, `prompt`, `status`, `total`, `ready`, `failed`, `created_at`, `updated_at`, plus ordered item payloads.

- [ ] **Step 4: Run the cloud suite**

Run: `uv run pytest tests/test_asset_cloud.py -q`
Expected: PASS.
