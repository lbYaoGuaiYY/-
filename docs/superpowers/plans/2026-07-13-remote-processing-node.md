# 远程本地抠图节点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` task-by-task with TDD.

**Goal:** 访问 `https://assets.xiduoduo.top/admin/asset-admin.html` 后可向已配对的 Mac 下发抠图任务，并将透明成品发布到云素材库。

**Architecture:** 云端保存原图、节点与任务队列；Mac 上的无界面 Agent 仅以出站 HTTPS 轮询领取任务，在本机运行 rembg 后上传结果。管理端与节点均只访问 `xiduoduo.top`，不开放 Mac 的入站端口。

**Tech Stack:** FastAPI、SQLite、Python rembg/Pillow、React/Vite、Docker Compose/Caddy。

## Global Constraints

- 所有外部传输使用 `assets.xiduoduo.top`；客户端与网页中不得出现源站 IP。
- 编辑器不取得节点或管理权限；处理节点凭证可单独撤销。
- 每个功能先写并运行失败测试，再写最小实现。

### Task 1: 云端节点与任务队列

**Files:** `tools/asset_admin/remote_processing.py`、`tools/asset_admin/cloud_server.py`、`tests/test_asset_cloud.py`

- [ ] 写出“管理员创建任务、节点领取并完成任务”的失败 API 测试。
- [ ] 实现 SQLite 持久节点、任务、原图和节点令牌哈希。
- [ ] 实现配对、心跳/领取、原图读取、上传完成与状态查询 API。
- [ ] 运行目标 pytest。

### Task 2: Mac 无界面处理节点

**Files:** `tools/asset_admin/processing_agent.py`、`tests/test_processing_agent.py`

- [ ] 写出任务图像处理输出 PNG/WebP 的失败测试。
- [ ] 实现轮询、下载、本地 rembg、缩略图、结果回传与心跳。
- [ ] 用真实配对凭证启动当前 Mac Agent。

### Task 3: 域名运营台与部署

**Files:** `src/features/asset-admin/RemoteProcessingPanel.tsx`、`src/features/asset-admin/AssetAdminApp.tsx`、`deploy/asset-cloud/Dockerfile`

- [ ] 写管理端任务状态解析/渲染测试。
- [ ] 实现上传、节点状态、任务状态和刷新控制。
- [ ] 构建并部署管理端到 `/qingshe-assets/admin`。

### Task 4: 真实验收

- [ ] 通过域名创建任务。
- [ ] 证明当前 Mac 节点领取并在本机完成抠图。
- [ ] 证明处理结果进入云素材库，且 API/前端产物不包含源站 IP。
