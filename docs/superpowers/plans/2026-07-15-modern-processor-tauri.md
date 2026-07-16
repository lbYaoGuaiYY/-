# Modern Processor Tauri Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dated Tkinter processor shell with a DESIGN.md-aligned Tauri 2 desktop app while retaining the proven Python/rembg worker protocol.

**Architecture:** A console PyInstaller sidecar emits newline-delimited JSON status events and keeps all enrollment/poll/render/upload logic in Python. A small Tauri frontend spawns the bundled sidecar, renders status/progress, and stops it only on the explicit exit action.

**Tech Stack:** Tauri 2, React 19, TypeScript, Rust, PyInstaller, Python 3.12, rembg, pytest, Vitest.

## Global Constraints

- Do not rewrite the background-removal algorithm in Rust or JavaScript.
- Do not expose processor tokens to browser JavaScript or logs.
- Follow DESIGN.md exactly: neutral charcoal, 1px borders, 4px radii, no shadow/gradient/glass.
- Preserve macOS Apple Silicon packaging and the existing server download artifact name.
- Work in the existing dirty checkout without commits or broad cleanup.

---

### Task 1: JSON sidecar protocol

**Files:**
- Create: `tools/asset_admin/processing_agent_sidecar.py`
- Modify: `tools/asset_admin/processing_agent.py`
- Test: `tests/test_processing_agent.py`

**Interfaces:**
- Produces newline JSON events `{type, state, detail, completed, task_name}` and accepts process termination as the stop mechanism.

- [ ] **Step 1: Write failing serialization tests**

```python
assert sidecar_event("status", state="ready", detail="已连接") == (
    '{"type":"status","state":"ready","detail":"已连接"}'
)
```

- [ ] **Step 2: Verify RED**

Run: `uv run pytest tests/test_processing_agent.py -k sidecar -q`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement status and completion callbacks**

Extend `run_agent()` with an optional completion callback while keeping all existing callers valid. The sidecar prints one JSON object per line with `ensure_ascii=False`, flushes immediately, and writes human diagnostics only to the existing log file.

- [ ] **Step 4: Run focused Python tests**

Run: `uv run pytest tests/test_processing_agent.py -q`
Expected: PASS.

### Task 2: Processor frontend

**Files:**
- Create: `processor.html`
- Create: `src/processor-main.tsx`
- Create: `src/features/processor/ProcessorApp.tsx`
- Create: `src/features/processor/processor-events.ts`
- Create: `src/styles/processor.css`
- Modify: `vite.config.ts`
- Test: `tests/processor-events.test.ts`

**Interfaces:**
- Produces: `parseProcessorEvent(value)` and processor UI states `starting|pairing|ready|processing|error|stopped`.

- [ ] **Step 1: Write failing event parser tests**

```ts
expect(parseProcessorEvent('{"type":"status","state":"ready","detail":"已连接"}')).toEqual({
  type: "status",
  state: "ready",
  detail: "已连接",
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test tests/processor-events.test.ts`
Expected: FAIL because the parser is missing.

- [ ] **Step 3: Implement the frontend and exact controls**

The 520x420 window contains product title, online status, node/server line, current task row, session completed count, recent event list, `打开素材面板`, `最小化`, and `退出抠图器`. Status always has text plus an icon.

- [ ] **Step 4: Implement DESIGN.md CSS**

Use the project font stack, 14px body, 12px metadata, 32px desktop controls, 4px radii, `#4D8DFF` focus ring, and no `box-shadow` or gradients.

- [ ] **Step 5: Run parser and type tests**

Run: `pnpm test tests/processor-events.test.ts && pnpm typecheck`
Expected: PASS.

### Task 3: Tauri sidecar lifecycle and config

**Files:**
- Create: `src-tauri/tauri.processor.conf.json`
- Create: `src-tauri/capabilities/processor.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `package.json`
- Test: `tests/processor-events.test.ts`

**Interfaces:**
- Produces Tauri commands `processor_start`, `processor_open_panel`, `processor_minimize`, and `processor_exit`, plus event `processor://event`.

- [ ] **Step 1: Add a failing config assertion**

```ts
expect(config.identifier).toBe("com.qingshe.processor")
expect(config.bundle.externalBin).toEqual(["binaries/qingshe-processing-agent"])
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test tests/processor-events.test.ts -t config`
Expected: FAIL because the config does not exist.

- [ ] **Step 3: Add shell sidecar permissions and lifecycle**

Use Tauri's sidecar API with the exact configured filename `qingshe-processing-agent`; forward stdout lines as `processor://event`, keep one child handle in managed state, kill it only from `processor_exit` or app exit, and prevent duplicate children.

- [ ] **Step 4: Build-check Rust**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

### Task 4: Local package build and visible acceptance

**Files:**
- Modify: `tools/asset_admin/qingshe_processor.spec`
- Modify: `scripts/build-processing-agent.mjs`
- Modify: `scripts/finalize-asset-admin-build.mjs`
- Test: `tests/test_asset_cloud.py`

**Interfaces:**
- Produces: `dist-processing-agent/轻设抠图器.app` and `dist-processing-agent/qingshe-processor-macos-aarch64.dmg`.

- [ ] **Step 1: Make the PyInstaller spec build a console sidecar**

The sidecar binary has no Tk imports and is copied to `src-tauri/binaries/qingshe-processing-agent-aarch64-apple-darwin` before the Tauri build.

- [ ] **Step 2: Build the complete local package**

Run: `pnpm processor:build`
Expected: Tauri app and DMG paths are printed.

- [ ] **Step 3: Verify package integrity**

Run: `codesign --verify --deep --strict dist-processing-agent/轻设抠图器.app`
Expected: success.

Run: `hdiutil verify dist-processing-agent/qingshe-processor-macos-aarch64.dmg`
Expected: checksum valid.

- [ ] **Step 4: Install the local app and perform visible acceptance**

Replace `/Applications/轻设抠图器.app` with the newly built local app, launch it, verify the modern Tauri UI is visible, pair through the material panel, and observe a real processing task move `pending -> processing -> ready`.
