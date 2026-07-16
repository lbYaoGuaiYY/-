# 轻设完整产品与素材云控制面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付仅通过 `xiduoduo.top` 传输、具备轻量云端遥测与管理控制、并统一为中性炭黑视觉的轻设编辑器和素材管理端。

**Architecture:** 保留现有 FastAPI + SQLite + Caddy + React/Tauri 架构，在云 API 内新增无原始 IP 的分钟级遥测、Linux 主机快照和有限控制。普通编辑器仅消费连接/传输状态，独立素材管理端消费 Admin API 并提供安全控制。

**Tech Stack:** React 19, TypeScript 7, Vite 8, Tauri 2, ky, Zod, FastAPI, Pydantic, SQLite, Caddy, Docker Compose, Vitest, Playwright, pytest.

## Global Constraints

- 必须使用 `pnpm`，不使用 npm 或 yarn。
- 普通编辑器生产端点必须是 `https://assets.xiduoduo.top/api/v1`。
- `191.223.220.201` 不得出现在新构建客户端、运行环境或用户可见文案。
- Admin Token 不得进入普通编辑器构建。
- 不增加账号、云项目、多人协作、微服务、Redis、Kafka 或 Kubernetes。
- 保留用户已有改动，提交必须使用路径限定。
- 视觉遵守 `DESIGN.md`：画布优先、borders-only、4px 间距、小圆角、无装饰插图。

---

### Task 1: 生产域名和构建泄露防线

**Files:**
- Modify: `src/features/assets/asset-service-config.ts`
- Modify: `deploy/asset-cloud/create-runtime-env.sh`
- Modify: `tests/asset-service-config.test.ts`
- Modify: `tests/create-runtime-env.test.mjs`
- Create: `scripts/check-production-endpoints.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `assertProductionEditorEndpoint(baseUrl: string): void` 对非 HTTPS、非 `xiduoduo.top` 或非标准路径抛错。
- Produces: `pnpm check:endpoints` 扫描 `dist`、`dist-asset-admin` 和客户配置中的 IPv4 生产端点。

- [ ] **Step 1: 先写失败测试**

```ts
expect(() => createAssetServiceConfig({
  VITE_APP_ENV: "production",
  VITE_ASSET_SERVICE_URL: "http://191.223.220.201/qingshe-assets/api/v1",
})).toThrow("生产素材服务必须使用 https://xiduoduo.top")
```

```js
expect(editorEnv).toContain(
  "VITE_ASSET_SERVICE_URL=https://assets.xiduoduo.top/api/v1",
)
expect(editorEnv).not.toMatch(/191\.223\.220\.201/)
```

- [ ] **Step 2: 验证测试失败**

Run: `pnpm vitest run tests/asset-service-config.test.ts tests/create-runtime-env.test.mjs`

Expected: FAIL，因为当前生产校验只拒绝回环地址，运行环境仍写入源站 IP。

- [ ] **Step 3: 实现唯一生产端点和扫描脚本**

```ts
const PRODUCTION_ASSET_ORIGIN = "https://xiduoduo.top"
const PRODUCTION_ASSET_PATH = "/qingshe-assets/api/v1"

if (parsed.origin !== PRODUCTION_ASSET_ORIGIN || parsed.pathname !== PRODUCTION_ASSET_PATH) {
  throw new Error("生产素材服务必须使用 https://assets.xiduoduo.top/api/v1")
}
```

`create-runtime-env.sh` 只输出：

```sh
printf '%s\n' "VITE_APP_ENV=production"
printf '%s\n' "VITE_ASSET_SERVICE_URL=https://assets.xiduoduo.top/api/v1"
printf '%s\n' "VITE_ASSET_EDITOR_TOKEN=$QINGSHE_EDITOR_TOKEN"
printf '%s\n' "VITE_ASSET_SERVICE_EVENTS=0"
```

- [ ] **Step 4: 验证与提交**

Run: `pnpm vitest run tests/asset-service-config.test.ts tests/create-runtime-env.test.mjs && pnpm check:endpoints`

Expected: PASS，扫描脚本在干净构建中返回 0。

Commit: `git commit --only src/features/assets/asset-service-config.ts deploy/asset-cloud/create-runtime-env.sh tests/asset-service-config.test.ts tests/create-runtime-env.test.mjs scripts/check-production-endpoints.mjs package.json -m "fix: enforce the production asset domain"`

### Task 2: 云端主机、素材库和传输遥测

**Files:**
- Create: `tools/asset_admin/observability.py`
- Modify: `tools/asset_admin/cloud_server.py`
- Modify: `tools/asset_admin/catalog.py`
- Modify: `tests/test_asset_cloud.py`

**Interfaces:**
- Produces: `ObservabilityStore.record(request_record: RequestRecord) -> None`.
- Produces: `ObservabilityStore.summary(catalog: Catalog) -> dict[str, object]`.
- Produces: `GET /api/v1/admin/observability/summary`, `/clients`, `/transfers`.

- [ ] **Step 1: 写权限、聚合和主机快照失败测试**

```py
def test_admin_observability_reports_library_clients_and_transfers(tmp_path: Path) -> None:
    client = TestClient(create_app(settings(tmp_path)))
    assert client.get("/api/v1/admin/observability/summary").status_code == 403
    response = client.get(
        "/api/v1/assets",
        headers={
            "Authorization": "Bearer editor-secret",
            "X-Qingshe-Client": "device-a",
            "X-Qingshe-Platform": "macos",
            "X-Qingshe-Version": "0.1.0",
        },
    )
    assert response.status_code == 200
    summary = client.get(
        "/api/v1/admin/observability/summary",
        headers={"Authorization": "Bearer admin-secret"},
    ).json()
    assert summary["clients"]["active_5m"] == 1
    assert summary["host"]["memory"]["total_bytes"] > 0
```

- [ ] **Step 2: 验证测试失败**

Run: `python3.12 -m pytest -q tests/test_asset_cloud.py`

Expected: FAIL with 404 for observability endpoint.

- [ ] **Step 3: 实现轻量遥测**

```py
@dataclass(frozen=True, slots=True)
class RequestRecord:
    path_group: str
    status_code: int
    duration_ms: float
    response_bytes: int
    client_id: str | None
    platform: str | None
    version: str | None

class ObservabilityStore:
    def record(self, record: RequestRecord) -> None: ...
    def summary(self, catalog: Catalog) -> dict[str, object]: ...
    def clients(self) -> tuple[dict[str, object], ...]: ...
    def transfers(self) -> tuple[dict[str, object], ...]: ...
```

中间件在响应完成后记录路由分组、状态、延迟和 `Content-Length`，设备 ID 使用服务端盐值 HMAC 后再保存。

- [ ] **Step 4: 验证与提交**

Run: `python3.12 -m pytest -q tests/test_asset_cloud.py`

Expected: PASS.

Commit: `git commit --only tools/asset_admin/observability.py tools/asset_admin/cloud_server.py tools/asset_admin/catalog.py tests/test_asset_cloud.py -m "feat: add asset cloud observability"`

### Task 3: 有限云端控制和退化策略

**Files:**
- Create: `tools/asset_admin/cloud_controls.py`
- Modify: `tools/asset_admin/cloud_server.py`
- Modify: `tests/test_asset_cloud.py`

**Interfaces:**
- Produces: `CloudControls(maintenance_mode: bool, downloads_enabled: bool, max_concurrent_downloads: int)`.
- Produces: `PATCH /api/v1/admin/controls`.

- [ ] **Step 1: 写失败测试**

```py
def test_admin_can_disable_new_media_downloads(tmp_path: Path) -> None:
    client = TestClient(create_app(settings(tmp_path)))
    changed = client.patch(
        "/api/v1/admin/controls",
        headers={"Authorization": "Bearer admin-secret"},
        json={"downloads_enabled": False},
    )
    assert changed.status_code == 200
    media = client.get(
        f"/api/v1/assets/{asset_id}/processed",
        headers={"Authorization": "Bearer editor-secret"},
    )
    assert media.status_code == 503
    assert media.headers["retry-after"] == "60"
```

- [ ] **Step 2: 验证测试失败**

Run: `python3.12 -m pytest -q tests/test_asset_cloud.py -k controls`

Expected: FAIL with 404.

- [ ] **Step 3: 实现原子持久化和并发门禁**

```py
class CloudControls(BaseModel):
    maintenance_mode: bool = False
    downloads_enabled: bool = True
    max_concurrent_downloads: int = Field(default=8, ge=1, le=64)
```

媒体路由进入时获取计数信号量，超限返回 `429 + Retry-After`；关闭下载或维护模式返回 `503 + Retry-After`。

- [ ] **Step 4: 验证与提交**

Run: `python3.12 -m pytest -q tests/test_asset_cloud.py`

Expected: PASS.

Commit: `git commit --only tools/asset_admin/cloud_controls.py tools/asset_admin/cloud_server.py tests/test_asset_cloud.py -m "feat: add safe cloud service controls"`

### Task 4: 客户端标识、连接状态和管理 API 客户端

**Files:**
- Create: `src/features/assets/asset-client-identity.ts`
- Create: `src/features/assets/asset-service-health.ts`
- Create: `src/features/asset-admin/cloud-operations-client.ts`
- Modify: `src/features/assets/asset-service-client.ts`
- Modify: `src/vite-env.d.ts`
- Create: `tests/asset-client-identity.test.ts`
- Create: `tests/cloud-operations-client.test.ts`

**Interfaces:**
- Produces: `getAssetClientIdentity(): AssetClientIdentity`.
- Produces: `readAssetServiceHealth(): Promise<AssetServiceHealth>`.
- Produces: `readCloudOperationsSummary(): Promise<CloudOperationsSummary>`.
- Produces: `patchCloudControls(patch: CloudControlsPatch): Promise<CloudControls>`.

- [ ] **Step 1: 先写 Zod 边界和请求头测试**

```ts
expect(createAssetClientHeaders({
  id: "8f03cde7-3d26-4a41-a245-42fb6a358e81",
  platform: "macos",
  version: "0.1.0",
})).toEqual({
  "X-Qingshe-Client": "8f03cde7-3d26-4a41-a245-42fb6a358e81",
  "X-Qingshe-Platform": "macos",
  "X-Qingshe-Version": "0.1.0",
})
```

- [ ] **Step 2: 验证测试失败**

Run: `pnpm vitest run tests/asset-client-identity.test.ts tests/cloud-operations-client.test.ts`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: 实现身份、健康和 Admin 客户端**

```ts
export type AssetServiceConnection = "online" | "slow" | "offline"
export type CloudControlsPatch = Partial<Pick<CloudControls,
  "maintenance_mode" | "downloads_enabled" | "max_concurrent_downloads"
>>
```

Admin Token 只从 `VITE_ASSET_CLOUD_ADMIN_TOKEN` 读取，该模块只被 `asset-admin-main.tsx` 的依赖图引用。

- [ ] **Step 4: 验证与提交**

Run: `pnpm vitest run tests/asset-client-identity.test.ts tests/cloud-operations-client.test.ts tests/asset-service-client-cache.test.ts`

Expected: PASS.

Commit: `git commit --only src/features/assets/asset-client-identity.ts src/features/assets/asset-service-health.ts src/features/asset-admin/cloud-operations-client.ts src/features/assets/asset-service-client.ts src/vite-env.d.ts tests/asset-client-identity.test.ts tests/cloud-operations-client.test.ts -m "feat: connect clients to cloud operations"`

### Task 5: 素材管理端运行概览和编辑器连接反馈

**Files:**
- Create: `src/features/asset-admin/CloudOperationsPanel.tsx`
- Modify: `src/features/asset-admin/AssetAdminApp.tsx`
- Modify: `src/features/assets/AssetPanel.tsx`
- Modify: `src/features/assets/use-managed-assets.ts`
- Modify: `src/styles/asset-admin.css`
- Modify: `src/styles/editor-components.css`
- Modify: `tests/e2e/asset-admin-preview.spec.ts`
- Modify: `tests/e2e/asset-panel.spec.ts`

**Interfaces:**
- Consumes: `CloudOperationsSummary`, `patchCloudControls`, `AssetServiceConnection` from Task 4.
- Produces: `CloudOperationsPanel` with overview, transfers, clients, alerts and safe controls.

- [ ] **Step 1: 写管理概览与离线反馈 E2E 失败测试**

```ts
await expect(page.getByRole("heading", { name: "云端运行" })).toBeVisible()
await expect(page.getByText("内存 62%")).toBeVisible()
await expect(page.getByText("活跃客户端 3")).toBeVisible()
await expect(page.getByText("下载中 2")).toBeVisible()
```

- [ ] **Step 2: 验证测试失败**

Run: `pnpm playwright test tests/e2e/asset-admin-preview.spec.ts tests/e2e/asset-panel.spec.ts`

Expected: FAIL because operation panel and connection labels do not exist.

- [ ] **Step 3: 实现紧凑运行视图**

概览使用 `dl` 数值网格，告警用图标+文字，客户端只显示短哈希、平台和最后活跃。危险控制需要二次确认，但不加入主机重启和 Shell。

- [ ] **Step 4: 验证与提交**

Run: `pnpm playwright test tests/e2e/asset-admin-preview.spec.ts tests/e2e/asset-panel.spec.ts && pnpm typecheck`

Expected: PASS.

Commit: `git commit --only src/features/asset-admin/CloudOperationsPanel.tsx src/features/asset-admin/AssetAdminApp.tsx src/features/assets/AssetPanel.tsx src/features/assets/use-managed-assets.ts src/styles/asset-admin.css src/styles/editor-components.css tests/e2e/asset-admin-preview.spec.ts tests/e2e/asset-panel.spec.ts -m "feat: add cloud operations surfaces"`

### Task 6: 中性炭黑主题和可见验收

**Files:**
- Modify: `DESIGN.md`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/components.css`
- Modify: `src/styles/layout.css`
- Modify: `src/styles/asset-admin.css`
- Modify: `src/styles/project-home.css`
- Modify: `tests/e2e/editor.spec.ts`

**Interfaces:**
- Produces: 单一中性炭黑 token 体系，蓝色只用于焦点、选区和主操作。

- [ ] **Step 1: 写主题 E2E 断言**

```ts
const theme = await page.locator(":root").evaluate((node) => {
  const style = getComputedStyle(node)
  return {
    app: style.getPropertyValue("--surface-app").trim(),
    panel: style.getPropertyValue("--surface-panel").trim(),
    selected: style.getPropertyValue("--surface-selected").trim(),
  }
})
expect(theme).toEqual({ app: "#161616", panel: "#252525", selected: "#3f3f3f" })
```

- [ ] **Step 2: 验证测试失败**

Run: `pnpm playwright test tests/e2e/editor.spec.ts -g "neutral charcoal"`

Expected: FAIL with old blue-black token values.

- [ ] **Step 3: 更新 token 并清理阴影**

```css
--surface-app: #161616;
--surface-stage: #202020;
--surface-panel: #252525;
--surface-control: #303030;
--surface-hover: #3a3a3a;
--surface-selected: #3f3f3f;
--border-default: #3c3c3c;
--border-strong: #555555;
--accent-primary: #4d8dff;
```

删除图层拖拽和素材选中中与 borders-only 相冲突的 `box-shadow`。

- [ ] **Step 4: 验证、截图和提交**

Run: `pnpm playwright test tests/e2e/editor.spec.ts tests/e2e/project-home.spec.ts tests/e2e/asset-admin-preview.spec.ts`

Expected: PASS；保存桌面、平板和手机截图用于人工可见验收。

Commit: `git commit --only DESIGN.md src/styles/tokens.css src/styles/components.css src/styles/layout.css src/styles/asset-admin.css src/styles/project-home.css tests/e2e/editor.spec.ts -m "style: adopt a neutral charcoal workspace"`

### Task 7: HTTPS 部署、服务启动和完整交付验收

**Files:**
- Modify: `deploy/asset-cloud/Caddyfile`
- Modify: `deploy/asset-cloud/compose.yaml`
- Modify: `deploy/asset-cloud/deploy-remote.sh`
- Modify: `docs/ASSET_CLOUD_ARCHITECTURE.md`
- Modify: `docs/PLATFORM_DEVELOPMENT.md`

**Interfaces:**
- Consumes: Task 1-6 的客户端、API 和主题产物。
- Produces: `https://assets.xiduoduo.top/api/v1/health` 可用的线上服务。

- [ ] **Step 1: 更新部署配置**

```caddy
xiduoduo.top {
  handle_path /qingshe-assets/* {
    reverse_proxy qingshe-assets:7000
  }
  respond "轻设素材服务" 200
}
```

Compose 增加 443 映射、应用健康检查、日志轮换和容器资源上限；不把端口 7000 暴露到主机。

- [ ] **Step 2: 本地完整验证**

Run: `pnpm typecheck && pnpm test && pnpm check && pnpm build && pnpm build:asset-admin && pnpm test:e2e && pnpm check:endpoints`

Expected: 全部 PASS。

Run: `python3.12 -m pytest -q tests/test_asset_cloud.py`

Expected: PASS.

- [ ] **Step 3: 实际运行页面可见验收**

启动编辑器和素材管理页，检查桌面、iPad 竖屏和手机宽度，确认无水平截断、素材网格可滚动、控制状态可读、蓝色不再主导界面。

- [ ] **Step 4: 从 Windows SSH 部署并启动**

当 macOS SSH 被源站关闭时，使用 Windows 管理通道执行：

```sh
cd /srv/qingshe-assets
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 qingshe-assets caddy
```

- [ ] **Step 5: 线上验收**

Run: `curl --fail --show-error https://assets.xiduoduo.top/api/v1/health`

Expected: HTTP 200 and `status` is `ready` or `degraded`, never 521.

使用 Editor Token 读取目录，使用 Admin Token 读取遥测，反向权限测试必须被 403 拒绝。

- [ ] **Step 6: 文档与提交**

Commit: `git commit --only deploy/asset-cloud/Caddyfile deploy/asset-cloud/compose.yaml deploy/asset-cloud/deploy-remote.sh docs/ASSET_CLOUD_ARCHITECTURE.md docs/PLATFORM_DEVELOPMENT.md -m "ops: deliver the asset cloud through xiduoduo.top"`
