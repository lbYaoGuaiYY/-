# qingshe-mvp-roadmap - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** 一个真正以婚礼提案为核心的本地设计工具：拖入现场照片，直接把内置或本地婚礼素材拖到目标位置，完成图层调整、自动保存、恢复和 PNG 出图。桌面、平板和手机都保留同一套关键操作。

**Why this approach:** 保留已经能工作的画布、撤销、保存和导出能力，只把拖拽和本地数据库这些通用难题交给成熟的免费开源模块，减少重写和后续维护。

**What it will NOT do:** 不引入付费 SDK、账号、云同步、后端、AI、模板或通用修图功能；本阶段也不发布上线、不做安装包或 PWA。

**Effort:** Large
**Risk:** Medium - 主要风险是旧本地项目的无损迁移，以及触控、键盘和响应式拖拽的一致性。
**Decisions to sanity-check:** 单张图片上限 25 MiB / 32 MP；空画布拖入的第一张图片作为现场底图；首个交付物是完全本地的静态版本，不含发布与安装。

Your next move: choose Start Work, or request a high-accuracy plan review first. Full execution detail follows below.

---

> TL;DR (machine): Large effort, medium migration/input risk; preserve React/Fabric, add zero-paid dnd-kit drag/sort, Dexie in-place migration, responsive wedding workflow, and offline local release evidence.

## Scope
### Must have
- Preserve the current React 19 + TypeScript + Fabric 7 editor as the product base; extend the working import, transform, history, autosave, restore, and PNG-export path instead of replacing it.
- Make the primary wedding-planning workflow genuinely drag-first: import a venue photo, drag a wedding asset from the asset panel to an exact canvas position, arrange it, reorder or control its layer, reload the project, and export the proposal image.
- Reuse only production-free, permissively licensed dependencies. Adopt `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities` for cross-input drag-and-drop; adopt Dexie core for IndexedDB access and migrations; keep Fabric as the rendering and transform engine.
- Keep all projects and imported images local. Migrate the existing `qingshe-projects-v1` database in place, atomically, without losing a saved active project or its blobs.
- Complete the layer and responsive behaviors already required by `DESIGN.md`: true layer sorting, visibility, locking, thumbnails, separate mobile layer/property destinations, panel hiding, keyboard access, and clear drag states.
- Prove the complete flow at desktop, tablet, and phone widths with targeted unit tests, browser tests, accessibility checks, visible screenshots, and one non-duplicated full release gate.
- Record exact dependency versions, direct and transitive licenses, upstream source links, and why each dependency is acceptable for free production use.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No paid SDK, trial-gated production feature, per-export fee, watermark, source-available license, remote SaaS requirement, Dexie Cloud, or dependency whose production rights are unclear.
- No replacement of Fabric with a whiteboard, generic Canva clone, or another full editor shell. Excalidraw, TUI Image Editor, Filerobot, and small Canva clones remain references only.
- No AI, templates, accounts, login, cloud sync, backend, collaboration, analytics, multi-project dashboard, text editor, drawing tools, filters, 3D, or plugin marketplace.
- No visual redesign outside the existing `DESIGN.md` system; no gradients, glass effects, oversized rounded cards, or decorative UI that competes with the canvas.
- No deletion, movement, formatting, or regeneration of the user's existing `outputs/` artifacts. Exclude generated artifacts from source checks instead of modifying them.
- No broad rewrite of working history, export, project-domain, or Fabric code when an adapter or narrow extension is sufficient.
- No `npm` or `yarn`; all dependency and verification commands use `pnpm`.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: hybrid. Use TDD with Vitest for pure placement geometry, layer-order mapping, schema migration, and persistence error mapping; use tests-after with Playwright for dnd-kit/Fabric wiring, responsive styling, accessibility, and visual behavior.
- Targeted-first rule: each todo runs only the smallest directly relevant Vitest or Playwright slice. Do not repeat the whole suite after every change.
- One full release gate, after all implementation todos: `pnpm typecheck`, `pnpm test`, `pnpm check`, `pnpm build`, then `pnpm test:e2e`.
- Browser matrix: Chromium at 1280 x 800, 768 x 1024, and 375 x 812 for every critical workflow; one final Firefox and WebKit smoke for import, drag, reload, and export.
- Accessibility: keyboard-only asset placement and layer sorting, visible focus, screen-reader instructions/announcements, 44 px coarse-pointer targets, and no critical or serious Axe findings.
- Data-safety rule: every migration test starts from a separately seeded legacy database and compares project JSON plus local-asset blob hashes before and after migration. Never exercise migration against a user's live browser profile.
- Visual evidence: capture the canvas before and after drop, layer-order state, phone panel destinations, save status, reload state, and exported PNG dimensions.
- Evidence: .omo/evidence/task-<N>-qingshe-mvp-roadmap.<ext>

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

- Wave 1 - safe reuse foundation: todos 1-3. Establish the repository boundary, verify zero-cost licenses, pin the selected modules, and create the pure geometry/order contracts that UI work will consume.
- Wave 2 - drag-first editor: todos 4-7. Wire asset drag, exact Fabric placement, pointer/touch/keyboard behavior, and deterministic layer sorting. Todos that touch `App.tsx`, the controller, or Fabric runtime are serialized even when their research can overlap.
- Wave 3 - local data and responsive reliability: todos 8-12. Replace raw IndexedDB plumbing behind the existing interface, migrate legacy records, complete layer state, surface durability and failures honestly, harden image import, and correct phone/tablet panel routing.
- Wave 4 - product acceptance and release baseline: todos 13-15. Curate the owned wedding demo flow, run visual/performance/cross-browser acceptance, then add documentation and local static-build readiness.
- Final verification wave: F1-F4 run after todo 15. Because this plan changes persistence and crosses editor/UI/data boundaries, a read-only reviewer is mandatory even if all commands pass.
- Writer constraint: only one executor may modify an overlapping file set at a time. Read-only investigation may run concurrently; no recursive subagent delegation.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 2, 3, 15 | - |
| 2 | 1 | 4, 7, 8 | 3 research only |
| 3 | 1 | 5, 7 | 2 research only |
| 4 | 2 | 5, 6, 12 | 8 |
| 5 | 3, 4 | 6, 13 | 8 |
| 6 | 5 | 13, 14 | 8, 11 |
| 7 | 2, 3 | 9, 13 | 8, 11 |
| 8 | 2 | 9, 10, 13 | 4-7, 11 |
| 9 | 7, 8 | 12, 13 | 10, 11 |
| 10 | 8 | 13 | 9, 11, 12 |
| 11 | 1 | 13 | 6-10, 12 |
| 12 | 4, 9 | 13, 14 | 10, 11 |
| 13 | 5-12 | 14, 15 | - |
| 14 | 6, 12, 13 | 15 | - |
| 15 | 1-14 | F1-F4 | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. Establish a safe repository baseline without touching user artifacts
  - What to do: inventory all current untracked and modified files; preserve them; make source checks ignore generated moodboards, slide output, Playwright reports, build output, and `.omo/evidence`; keep application source, tests, configs, and documentation inside the checks. Add a single `pnpm verify` script only after its constituent commands are known to pass individually. Capture the pre-change inventory before the first implementation commit.
  - Must NOT do: do not delete, move, reformat, regenerate, or stage unrelated files under `outputs/`; do not use a blanket ignore that hides `src/`, `tests/`, `docs/`, or configuration errors; do not run the full five-command gate more than once in this todo.
  - Parallelization: Wave 1 | Blocked by: none | Blocks: 2, 3, 15
  - References: `package.json:7-21` (existing pnpm gates); `biome.json:1-32` (source check boundary); `.gitignore` (artifact policy); `outputs/` (user-owned generated artifacts, preserve only); project `AGENTS.md` (pnpm, preservation, and validation rules).
  - Acceptance criteria:
    - A before/after file inventory proves every pre-existing file still exists and unrelated content is unchanged.
    - `pnpm check` exits 0 while generated files remain on disk.
    - `pnpm typecheck` and the smallest existing smoke test exit 0; the complete suite is deferred to todo 15.
    - `git status --short` shows only intentional baseline/config/documentation changes plus preserved pre-existing files.
  - QA scenarios: PowerShell via `omo sparkshell` — happy: run `pnpm check` with the existing generated moodboard directory present and save stdout; failure: verify a deliberately malformed temporary file under `src/` is still detected, then remove only that task-created file. Evidence: `.omo/evidence/task-1-qingshe-mvp-roadmap.txt`.
  - Commit: Y | `chore(repo): establish safe validation boundary`

- [ ] 2. Pin the approved zero-paid reuse stack and create a license gate
  - What to do: install exact production versions with `pnpm add -E @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities dexie`; update only `package.json` and `pnpm-lock.yaml`; create `docs/open-source-reuse.md` and `THIRD_PARTY_NOTICES.md` with package, resolved version, upstream URL, SPDX license, production-use conclusion, data/network behavior, replacement boundary, and transitive-license review. Add a dependency-free `scripts/check-production-licenses.mjs` plus `pnpm licenses:check` to parse `pnpm licenses list --prod --json` and fail on missing, paid, source-available, unapproved copyleft, or unknown licenses. The default direct-dependency allowlist is MIT, BSD-2-Clause, BSD-3-Clause, and Apache-2.0; an equivalent permissive transitive license such as ISC or 0BSD must be listed and justified individually rather than silently accepted.
  - Must NOT do: do not install Dexie Cloud, a paid editor SDK, a UI kit, another canvas engine, an unlicensed fork, or an unrelated convenience package; do not use a caret/tilde range; do not infer licensing from a package name alone.
  - Parallelization: Wave 1 | Blocked by: 1 | Blocks: 4, 7, 8
  - References: `package.json:1-28`; `pnpm-lock.yaml`; Fabric upstream/license `https://github.com/fabricjs/fabric.js`; dnd-kit upstream/license `https://github.com/clauderic/dnd-kit`; dnd-kit sensors `https://dndkit.com/react/guides/sensors/`; Dexie upstream/license `https://github.com/dexie/Dexie.js/`; Dexie core API `https://dexie.org/docs/API-Reference`; `DESIGN.md:5-9` (local focused editor boundary).
  - Acceptance criteria:
    - `pnpm list @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities dexie --depth 0` lists one exact resolved version for each package.
    - `pnpm licenses:check` exits 0 against `pnpm licenses list --prod --json`; every non-default permissive transitive license has a written conclusion.
    - `rg -n "dexie-cloud|polotno|creative-editor-sdk|cesdk" package.json pnpm-lock.yaml src` returns no production integration.
    - The ledger states explicitly that all application data remains in-browser and that no adopted package requires an account, key, server, watermark, or fee.
  - QA scenarios: `pnpm` and `rg` — happy: resolve the four packages from the lockfile and reconcile their SPDX data with upstream license files; failure: run the license-classifier fixture containing `UNLICENSED` and assert the gate exits nonzero. Evidence: `.omo/evidence/task-2-qingshe-mvp-roadmap.txt` and `.omo/evidence/task-2-qingshe-mvp-roadmap.json`.
  - Commit: Y | `build(deps): pin free editor infrastructure`

- [ ] 3. Define and test pure drag-placement and layer-order contracts
  - What to do: add a small dependency-free editor domain module for typed drag payloads, client-rectangle-to-logical-canvas coordinate conversion, center clamping after asset scaling, and mapping between the document's back-to-front array and the layer panel's top-to-bottom display order. Keep geometry pure so it can be tested without Fabric or React. Use TDD before UI wiring.
  - Must NOT do: do not put DOM reads, Fabric objects, dnd-kit events, React state, or persistence calls in the pure module; do not change existing click-to-add behavior yet.
  - Parallelization: Wave 1 | Blocked by: 1 | Blocks: 5, 7
  - References: `src/features/editor/editor-model.ts:9-84` (canvas, layer, and transform types); `src/features/editor/fabric-runtime.ts:85-113` (current centered insertion); `src/features/editor/fabric-runtime.ts:255-268` (CSS-only display scaling); `src/features/editor/LayerPanel.tsx:12-60` (reversed display order); `src/features/editor/fabric-runtime.ts:184-202` (current relative ordering API).
  - Acceptance criteria:
    - Vitest covers 1:1, CSS-downscaled, landscape, portrait, and edge/outside coordinate cases; logical coordinates are independent of CSS scale.
    - Clamping keeps the scaled object's center within the logical canvas while allowing an object larger than the canvas to remain centered rather than producing invalid coordinates.
    - Layer-order tests cover first, last, adjacent, no-op, unknown-id, and reversed-display mappings without mutating the input array.
    - `pnpm test -- drag-placement layer-order` and `pnpm typecheck` exit 0.
  - QA scenarios: Vitest — happy: map a drop at the visible center of a 1200 x 800 canvas rendered at 600 x 400 to logical `(600, 400)`; failure: pass a zero-sized rectangle or non-finite coordinate and assert a typed invalid-placement result with no layer mutation. Evidence: `.omo/evidence/task-3-qingshe-mvp-roadmap.txt`.
  - Commit: Y | `feat(editor): define drag placement contracts`

- [ ] 4. Reuse dnd-kit for draggable wedding assets while preserving click insertion
  - What to do: introduce a narrow editor drag context around the workspace; make each existing built-in asset card draggable with stable ids and a discriminated payload containing only the built-in asset id; render one thumbnail in `DragOverlay`; register the canvas stage as the only asset droppable. Preserve search, file import, card click insertion, focus order, and panel scrolling. Keep dnd-kit types behind a local adapter so product components do not exchange raw library events.
  - Must NOT do: do not make the entire asset panel draggable; do not duplicate asset data in global state; do not add a second asset catalog; do not remove the click fallback; do not create a mini moodboard overlay.
  - Parallelization: Wave 2 | Blocked by: 2 | Blocks: 5, 6
  - References: `src/App.tsx:35-43` (editor/app state); `src/App.tsx:93-140` (current add callbacks and workspace); `src/features/assets/AssetPanel.tsx:9-22` (asset contract and filtering); `src/features/assets/AssetPanel.tsx:35-82` (cards and import control); `src/features/editor/EditorCanvas.tsx:42-63` (stage droppable target); `src/features/assets/demo-assets.ts` (canonical asset ids and thumbnails).
  - Acceptance criteria:
    - Every visible built-in asset card exposes draggable semantics and a single-source payload; filtering never changes its stable id.
    - A drag overlay appears only during drag, matches the source thumbnail, and is removed on drop, Escape, unmount, or error.
    - Existing click-to-add and local-file import browser tests remain green.
    - No raw `DragEndEvent` or package-specific payload type escapes the local drag adapter.
  - QA scenarios: Playwright Chromium — happy: start dragging `data-testid="asset-card-floral-arch"`, assert one overlay and an active canvas drop state; failure: press Escape and assert no new layer, no stuck overlay, and no busy state. Evidence: `.omo/evidence/task-4-qingshe-mvp-roadmap.png` and `.omo/evidence/task-4-qingshe-mvp-roadmap.txt`.
  - Commit: Y | `feat(assets): make wedding assets draggable`

- [ ] 5. Place dropped assets at the exact logical Fabric canvas position
  - What to do: extend `EditorController.addBuiltInAsset`, `addLocalAssets`, the internal record insertion, and `FabricRuntime.addLayer` with an optional logical placement. On an internal catalog drop, use the translated drag-overlay center, the actual Fabric upper-canvas bounding rectangle, and the logical canvas size to compute a point; apply the existing fit scale, clamp the final center, select the inserted object, and commit exactly one history entry. Also accept native image files dragged from Windows Explorer: on an empty canvas, the first valid file becomes the venue background; after a background exists, valid files become layers at the drop point, with additional files cascaded by 24 logical pixels and clamped. When no placement is supplied, retain center insertion for click/file-picker fallback. While `backgroundAssetId` is null, catalog click/drop creates no hidden layer and instead invokes or points to the existing background-import action with the message `先导入现场照片`.
  - Must NOT do: do not derive coordinates from the outer workspace or assume CSS pixels equal image pixels; do not store client coordinates in the document; do not commit while the image is still loading; do not insert when the drop is outside the canvas or the payload is invalid; do not let the browser navigate to a dropped local file.
  - Parallelization: Wave 2 | Blocked by: 3, 4 | Blocks: 6, 13
  - References: `src/features/editor/EditorCanvas.tsx:17-40` (controller lifetime and resize); `src/features/editor/fabric-runtime.ts:37-50` (Fabric canvas instance); `src/features/editor/fabric-runtime.ts:85-113` (image scaling and centered insertion); `src/features/editor/fabric-runtime.ts:255-268` (logical versus CSS dimensions); `src/features/editor/editor-controller.ts:112-127` and `:200-208` (asset insertion and history commit); `src/features/editor/history.ts` (one-operation history contract).
  - Acceptance criteria:
    - Dropping at three known visible points on both 1:1 and CSS-scaled canvases produces transforms within 1 logical pixel of the expected positions.
    - Edge drops keep the complete scaled asset center inside the canvas according to the contract from todo 3.
    - A successful catalog or native-file layer drop creates one layer, selects it, and adds one undo entry; one Undo removes it and one Redo restores the same transform.
    - Native file drop on the empty canvas imports the first valid image as background; the same operation after background import inserts layers at deterministic cascaded positions.
    - Dropping outside, using an unknown asset id, failing image decode, attempting catalog insertion before a venue photo exists, or dropping a non-image file creates no layer/history and leaves a clear error/cancel/import-background state.
  - QA scenarios: Playwright + Vitest — happy: drag a native 1200 x 800 venue file onto the empty canvas, then drop the floral arch and a local transparent PNG near the upper-left, read their transforms, undo, and redo; failure: end the same catalog drag over the header and drop a text file on the canvas, asserting no navigation and unchanged layer/history counts. Evidence: `.omo/evidence/task-5-qingshe-mvp-roadmap.png` and `.omo/evidence/task-5-qingshe-mvp-roadmap.json`.
  - Commit: Y | `feat(editor): place dropped assets precisely`

- [ ] 6. Complete pointer, touch, keyboard, and cancellation behavior
  - What to do: configure pointer, touch, and keyboard sensors through the local adapter. Use an 8 px pointer activation distance and a 180 ms touch delay with 8 px tolerance so clicks and panel scrolling remain usable. Add Chinese screen-reader instructions and announcements for pick-up, valid target, drop, cancel, and result. Escape cancels; reduced-motion disables nonessential overlay motion; keyboard placement uses the canvas center first and arrow-key movement before Space/Enter drop. Ensure pen input follows pointer behavior.
  - Must NOT do: do not globally disable touch scrolling or text input; do not rely on hover; do not fire click insertion after a completed drag; do not trap focus or announce raw ids.
  - Parallelization: Wave 2 | Blocked by: 5 | Blocks: 13, 14
  - References: dnd-kit sensor guide `https://dndkit.com/react/guides/sensors/`; dnd-kit accessibility implementation in `@dnd-kit/core`; `src/features/assets/AssetPanel.tsx:35-82`; `src/styles/responsive.css:45-56` (coarse-pointer targets); `DESIGN.md:136-152` (interaction, drag, and keyboard requirements); `tests/e2e/editor.spec.ts:245-260` (existing Axe gate).
  - Acceptance criteria:
    - Mouse, touch, pen-compatible pointer, and keyboard each complete one asset insertion without duplicate clicks or page-scroll lock after completion.
    - A normal click still center-inserts; a scroll gesture does not start a drag; Escape/outside drop produces no layer.
    - Keyboard announcements name the asset and canvas in Chinese, focus returns to the originating asset after cancel, and no critical/serious Axe violation is introduced.
    - Playwright passes at 1280 x 800, 768 x 1024, and a touch-enabled 375 x 812 context.
  - QA scenarios: Playwright — happy: keyboard-focus the floral arch, press Space, move to canvas, drop, and assert the new selected layer; failure: touch-scroll the asset list less than 180 ms and assert there is no overlay or insertion. Evidence: `.omo/evidence/task-6-qingshe-mvp-roadmap.webm`, `.omo/evidence/task-6-qingshe-mvp-roadmap.txt`.
  - Commit: Y | `feat(editor): support accessible cross-input dragging`

- [ ] 7. Reuse dnd-kit sortable for deterministic layer ordering
  - What to do: wrap the displayed top-to-bottom layer rows in `SortableContext`; provide a dedicated drag handle; translate the displayed order through the pure mapping from todo 3; add an id-based absolute reorder method to the controller/runtime; preserve selection; update Fabric stack order; commit one history entry only when the order changes. Keep the existing Up/Down/Front/Back toolbar and shortcuts as alternative controls.
  - Must NOT do: do not reorder by array mutation in the component; do not use a DOM index directly against Fabric's back-to-front array; do not commit on hover; do not remove keyboard or toolbar alternatives.
  - Parallelization: Wave 2 | Blocked by: 2, 3 | Blocks: 9, 13
  - References: `src/features/editor/LayerPanel.tsx:5-13` (current props); `src/features/editor/LayerPanel.tsx:30-60` (displayed reversed list); `src/features/editor/fabric-runtime.ts:184-202` (relative stack operations); `src/features/editor/editor-controller.ts:142-143` (history bridge); `src/App.tsx:151-156` (panel wiring); `src/App.tsx:216-240` (shortcut alternatives).
  - Acceptance criteria:
    - Pointer and keyboard sorting move a selected row to top, middle, and bottom while Fabric rendering and the persisted document agree.
    - A no-op drop produces no history entry; Undo/Redo round-trips one reorder exactly.
    - Toolbar and keyboard layer-direction commands still work after sortable integration.
    - The row handle has an accessible name, reports position changes, and preserves panel scroll/focus.
  - QA scenarios: Playwright + Vitest — happy: create three named layers, drag the bottom displayed row to the top, export or inspect the canvas stack, then reload and assert the same order; failure: drop a row back at its original index and assert Undo availability is unchanged. Evidence: `.omo/evidence/task-7-qingshe-mvp-roadmap.png` and `.omo/evidence/task-7-qingshe-mvp-roadmap.txt`.
  - Commit: Y | `feat(layers): add sortable layer ordering`

- [ ] 8. Replace raw IndexedDB plumbing with Dexie and migrate legacy projects atomically
  - What to do: keep the `ProjectStore` interface and database name `qingshe-projects-v1`; implement a typed Dexie-backed store. Declare the existing native IndexedDB version 1 as Dexie `version(0.1)` with outbound primary keys (`projects: ""`, `assets: ""`), then introduce Dexie `version(0.2)` for the data upgrade. Add explicit v1 and v2 project parsers; migrate project and asset records to schema v2 in one upgrade transaction, including defaults `visible: true` and `locked: false` for every legacy layer. Keep project and referenced-asset writes/deletes in one strict transaction and map Dexie/DOM quota errors back to the existing result union.
  - Must NOT do: do not rename or delete the database; do not switch outbound keys to inbound keys; do not clear corrupt data automatically; do not import Dexie Cloud; do not expose Dexie tables outside the store adapter; do not leave the raw implementation active in parallel after cutover.
  - Parallelization: Wave 3 | Blocked by: 2 | Blocks: 9, 10, 13
  - References: `src/features/projects/project-store.ts:3-17` (stable boundary); `src/features/projects/indexeddb-project-store.ts:13-20` (name/version/stores); `src/features/projects/indexeddb-project-store.ts:29-79` (load/save semantics); `src/features/projects/indexeddb-project-store.ts:91-111` (atomic snapshot write); `src/features/projects/indexeddb-project-store.ts:114-127` (legacy physical schema); `src/features/projects/project-format.ts:10-71` (schema v1); Dexie outbound keys `https://dexie.org/docs/inbound`; Dexie existing-DB migration `https://dexie.org/docs/Tutorial/Migrating-existing-DB-to-Dexie`; Dexie versioning/rollback `https://dexie.org/docs/Tutorial/Design`.
  - Acceptance criteria:
    - A real-browser fixture seeds native database version 1 with one background, two layers, a transformed local PNG blob, and outbound keys; opening the new app returns the identical document/assets with only v2 defaults added.
    - Before/after SHA-256 hashes of every local blob match; project layer transforms and order match exactly.
    - A forced migration exception rolls the whole upgrade back; reopening the seeded legacy database proves no partially migrated record exists.
    - New saves atomically replace the active project and referenced local assets, remove orphan local assets, preserve built-ins, and return `quota_exceeded` for both Dexie and DOM quota exceptions.
    - Targeted migration tests, `pnpm typecheck`, and `rg -n "dexie-cloud" src package.json pnpm-lock.yaml` all pass.
  - QA scenarios: Playwright real IndexedDB + Vitest pure migration — happy: seed legacy data, reload into the new store, compare normalized project JSON and blob hashes, edit, save, and reload; failure: inject a throwing v2 upgrader in the test fixture and prove atomic rollback plus an honest restore error. Evidence: `.omo/evidence/task-8-qingshe-mvp-roadmap.json` and `.omo/evidence/task-8-qingshe-mvp-roadmap.txt`.
  - Commit: Y | `refactor(storage): adopt Dexie with legacy migration`

- [ ] 9. Complete visible, locked, and thumbnail layer states on schema v2
  - What to do: use the v2 `visible` and `locked` fields established by todo 8 throughout the model, Fabric object configuration, controller, history, inspector, and layer list. Add a real thumbnail derived from the existing asset registry, an Eye toggle, and a Lock toggle with accessible names and pressed state. Hiding a selected layer clears canvas selection; locking keeps its row selectable for unlocking but blocks canvas selection, transform, delete, and dragging that row. Other unlocked layers may move around a locked layer. Each state change is one undoable/persisted operation.
  - Must NOT do: do not persist object URLs or duplicate image blobs for thumbnails; do not remove hidden/locked rows; do not make visibility/lock UI icon-only without labels; do not let the inspector silently edit a locked layer.
  - Parallelization: Wave 3 | Blocked by: 7, 8 | Blocks: 12, 13
  - References: `src/features/editor/editor-model.ts:25-67` (layer schema); `src/features/editor/fabric-image.ts:10-34` (Fabric object configuration); `src/features/editor/fabric-runtime.ts:115-168` (restore/capture); `src/features/editor/LayerPanel.tsx:30-60` (row UI); `src/features/editor/InspectorPanel.tsx` (selected transform controls); `src/features/editor/asset-registry.ts` (existing source URLs); `DESIGN.md:136-152` (required thumbnail, visible, lock, and drag states).
  - Acceptance criteria:
    - Every row has a nonduplicated thumbnail and accessible visibility/lock controls; local blob thumbnails survive reload without storing an object URL.
    - Hidden layers are absent from canvas/export but remain in the layer panel and document; Undo restores visibility.
    - Locked layers cannot be transformed, deleted, directly canvas-selected, or dragged by their own row; the row can still be selected and unlocked.
    - Reload preserves visibility, lock, order, and transforms for both built-in and local assets.
    - Existing v1 projects show all layers visible and unlocked after migration.
  - QA scenarios: Playwright — happy: hide layer A, lock layer B, reload, export, and verify the row states plus absence of A from the exported pixels; failure: select locked B from the row and attempt Delete, property input, keyboard nudge, and row drag, asserting zero document mutation. Evidence: `.omo/evidence/task-9-qingshe-mvp-roadmap.png` and `.omo/evidence/task-9-qingshe-mvp-roadmap.json`.
  - Commit: Y | `feat(layers): add visibility lock and thumbnails`

- [ ] 10. Report local-save durability and storage failures honestly
  - What to do: extend the saved result with `durability: "persistent" | "best_effort" | "unsupported"`; after the first successful transaction, query/request browser persistence once and propagate the result through the autosave coordinator and project session. Show saved state separately from durability: denied/unsupported persistence remains a successful save with a quiet warning that the browser may reclaim data. Map quota, blocked upgrade, corrupt restore, version change, and generic failures to distinct user-facing states. On Dexie `versionchange`, close the connection and present a reload-required recovery state rather than continuing against a stale schema. Flush queued autosave on `visibilitychange` and before export when feasible.
  - Must NOT do: do not claim data is permanent when `persist()` is denied; do not turn a persistence-permission denial into save failure; do not auto-delete data, auto-reload with pending unsaved changes, or add cloud backup as a workaround.
  - Parallelization: Wave 3 | Blocked by: 8 | Blocks: 13
  - References: `src/features/projects/project-store.ts:3-17` (result union); `src/features/projects/indexeddb-project-store.ts:62-79` and `:82-89` (save and ignored persistence request); `src/features/projects/autosave-coordinator.ts:1-84` (save-state machine); `src/features/projects/use-project-session.ts:1-94` (restore/autosave UI bridge); `src/App.tsx:162-181` (status surface); Dexie version change `https://dexie.org/docs/Dexie/Dexie.on.versionchange`; MDN StorageManager persistence behavior `https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist`.
  - Acceptance criteria:
    - Saved/persistent, saved/best-effort, quota, corrupt restore, blocked upgrade, and version-change cases each produce a unique typed state and accurate Chinese message.
    - `navigator.storage.persist()` is requested at most once per store/session and only after a successful write; denied/unsupported still reports `saved`.
    - A queued edit is flushed when the page becomes hidden and before export; failed flush prevents a misleading "已自动保存" state but does not destroy the editable document.
    - The app never references a remote backup, account, or sync service.
  - QA scenarios: Vitest fake store + Playwright browser stubs — happy: stub `persist()` true, edit, wait for save, reload, and assert persistent status; failure: stub quota and then versionchange, asserting retry/reload guidance, no false success, and no cleared canvas. Evidence: `.omo/evidence/task-10-qingshe-mvp-roadmap.txt` and `.omo/evidence/task-10-qingshe-mvp-roadmap.png`.
  - Commit: Y | `feat(storage): expose honest local durability states`

- [ ] 11. Harden wedding-photo and asset import without adding an image SDK
  - What to do: keep PNG/JPEG/WebP only; extend validation from MIME/empty checks to successful browser decode, finite positive dimensions, a 25 MiB encoded-file cap, a 32-megapixel decoded-image cap, and a maximum side of 10,000 px. Reject unsupported, corrupt, oversized, or dimension-bomb inputs before registering an asset. Revoke every task-created object URL on failure/dispose. Preserve the previous project if background replacement fails and process multi-asset imports independently so one bad file does not discard valid siblings.
  - Must NOT do: do not add HEIC/cloud conversion, compression SaaS, EXIF upload, a photo editor, or another decoding dependency; do not silently downscale or change image quality in this phase; do not clear the existing background before the replacement has decoded.
  - Parallelization: Wave 3 | Blocked by: 1 | Blocks: 13
  - References: `src/features/editor/image-import.ts:3-55` (current MIME/empty validation); `src/features/editor/fabric-image.ts:6-8` (decode boundary); `src/features/editor/editor-controller.ts:93-127` (background and multi-asset import); `src/features/editor/asset-registry.ts` (object URL ownership); `src/features/projects/project-format.ts:13-24` (stored MIME contract).
  - Acceptance criteria:
    - Valid PNG, JPEG, and WebP fixtures at the limit import; zero-byte, forged MIME, corrupt bytes, >25 MiB, >32 MP, and >10,000 px-side fixtures are rejected with specific messages.
    - A failed background replacement leaves the previous background, layers, history, and saved project unchanged.
    - In a three-file asset selection with one corrupt file, the two valid files are inserted once and the bad file is reported once.
    - Object URL creation/revocation counts balance after success, failure, reload, and controller disposal.
  - QA scenarios: Vitest + Playwright file chooser — happy: import a supported venue photo and two transparent wedding assets, then save/reload; failure: attempt a corrupt replacement and an over-limit asset, asserting typed messages and byte-for-byte unchanged prior snapshot. Evidence: `.omo/evidence/task-11-qingshe-mvp-roadmap.txt` and `.omo/evidence/task-11-qingshe-mvp-roadmap.json`.
  - Commit: Y | `fix(import): validate local images before mutation`

- [ ] 12. Make the same editor operations reachable on desktop, tablet, and phone
  - What to do: replace the single right-panel boolean with explicit responsive panel state so the phone's Layers tab opens only layers and Properties opens only properties. At 900-1279 px retain drawer behavior without covering required controls; at >=1280 px show the three-column workspace; below 700 px use the bottom bar. During a phone asset drag, capture the overlay then temporarily close the asset drawer so the canvas is visible as a drop target; on click insertion, close the drawer after insertion. Implement Tab to hide both side panels and restore their exact previous states. Keep focus restoration, scroll containment, safe-area padding, and 44 px coarse-pointer targets.
  - Must NOT do: do not fork separate mobile editor logic; do not hide export, undo/redo, layers, properties, or background import at any width; do not close a panel before the drag overlay has captured the source; do not let Layers and Properties route to the same combined drawer state.
  - Parallelization: Wave 3 | Blocked by: 4, 9 | Blocks: 13, 14
  - References: `DESIGN.md:81-96` (responsive bands); `DESIGN.md:136-152` (Tab and panel behavior); `src/App.tsx:35-43` (current booleans); `src/App.tsx:122-157` (panel composition); `src/App.tsx:182-186` (mobile tabs currently sharing one state); `src/styles/responsive.css:1-43` and `:45-104` (drawer, coarse pointer, bottom bar); `tests/e2e/editor.spec.ts:174-242` (existing reachability and panel test patterns).
  - Acceptance criteria:
    - At 1280 x 800, 768 x 1024, and 375 x 812, import, assets, canvas, layers, properties, undo/redo, save status, and export are reachable without overlap or horizontal page scroll.
    - Phone Layers displays only the layer panel; phone Properties displays only the inspector; close/focus behavior returns to the invoking tab.
    - A 375 px touch drag exposes the canvas and completes a drop; a normal tap center-inserts and closes the asset drawer.
    - Tab hides panels and expands the canvas; the next Tab restores the exact prior open/closed destinations.
  - QA scenarios: Playwright screenshots and touch context — happy: complete one import/drop/property/layer/export flow at all three widths; failure: rotate from 375 x 812 to 812 x 375 during an active/cancelled drag and assert no orphan overlay, trapped focus, or hidden critical control. Evidence: `.omo/evidence/task-12-qingshe-mvp-roadmap-1280.png`, `.omo/evidence/task-12-qingshe-mvp-roadmap-768.png`, `.omo/evidence/task-12-qingshe-mvp-roadmap-375.png`.
  - Commit: Y | `fix(responsive): route editor panels correctly`

- [ ] 13. Lock the complete wedding-proposal workflow with owned fixtures
  - What to do: audit the existing built-in wedding assets and record provenance; keep only assets the project owns or may redistribute at zero cost. Add no stock imagery without a license record. Create one deterministic project-owned venue-photo test fixture and a focused end-to-end scenario: import venue, drag three wedding assets to distinct positions, transform one, reorder layers, lock one, hide/unhide one, undo/redo, wait for autosave, reload, and export PNG. Treat this as the product acceptance path, not a generic editor demo.
  - Must NOT do: do not add a template picker, remote asset API, copyrighted stock scrape, moodboard UI, or generic design-suite sample; do not make the test depend on network access or random image generation.
  - Parallelization: Wave 4 | Blocked by: 5-12 | Blocks: 14, 15
  - References: `src/features/assets/demo-assets.ts` and its referenced local files (current built-ins); `src/features/assets/AssetPanel.tsx:14-82` (catalog presentation); `tests/e2e/editor.spec.ts:80-170` (current editor flow); `tests/e2e/editor-persistence.spec.ts:7-39` (current reload/export flow); `DESIGN.md:5-9` (product identity); `THIRD_PARTY_NOTICES.md` and `docs/open-source-reuse.md` from todo 2.
  - Acceptance criteria:
    - Every shipped visual asset has an owner/source/license record and is locally bundled; zero runtime network requests occur during the flow.
    - The single Playwright acceptance scenario completes all listed steps, reloads the exact v2 document, and downloads a nonempty PNG whose dimensions equal the venue background.
    - Exported pixels reflect final visibility and stack order; the locked layer retains its transform.
    - The flow passes at desktop, tablet, and phone widths using the same controller/domain implementation.
  - QA scenarios: Playwright offline mode — happy: run the complete wedding proposal flow with network disabled and compare the exported PNG metadata plus persisted JSON; failure: cancel one asset drag and import one corrupt file mid-flow, proving no phantom layer/history/save corruption. Evidence: `.omo/evidence/task-13-qingshe-mvp-roadmap.webm`, `.omo/evidence/task-13-qingshe-mvp-roadmap.png`, `.omo/evidence/task-13-qingshe-mvp-roadmap.json`.
  - Commit: Y | `test(product): cover the wedding proposal workflow`

- [ ] 14. Perform visual, accessibility, cross-browser, and performance acceptance
  - What to do: add stable screenshot assertions for the loaded editor, active asset drag, three-layer state, phone panel destinations, and save warning at the three canonical widths. Run Axe after the complete flow. Add Firefox and WebKit smoke coverage for import, pointer/click insertion, restore, and export; keyboard/touch remain Chromium where Playwright input support is deterministic. Measure the production build without adding a size service: total initial JavaScript must stay at or below 225 kB gzip and no emitted JavaScript chunk may exceed Vite's 500 kB uncompressed warning threshold. If needed, use narrow Vite chunk boundaries or lazy-load the Fabric runtime; do not merely raise the warning limit. Record drag-start-to-overlay and drop-to-render timing and investigate repeatable regressions above 100 ms on the reference machine.
  - Must NOT do: do not update screenshots to bless a regression; do not hide build warnings; do not add analytics, a paid performance service, or a second test runner; do not claim cross-browser success from Chromium alone.
  - Parallelization: Wave 4 | Blocked by: 6, 12, 13 | Blocks: 15
  - References: `playwright.config.ts:1-30` (browser/test setup); `tests/e2e/editor.spec.ts:174-260` (responsive/Axe patterns); `vite.config.ts:1-13` (build config); `src/features/editor/fabric-runtime.ts:255-268` (display performance boundary); Playwright screenshots `https://playwright.dev/docs/test-snapshots`; Vite build output from the current baseline (620.69 kB raw / 186.77 kB gzip before new dependencies).
  - Acceptance criteria:
    - Canonical screenshots pass at 1280, 768, and 375 widths and have been visually inspected against `DESIGN.md`; intentional diffs are documented.
    - Axe reports zero critical or serious violations after drag, sort, lock, hide, and mobile-panel interactions.
    - Chromium full flow and Firefox/WebKit smoke flows pass with no page errors, failed downloads, or unexpected network calls.
    - Production output meets the stated gzip/chunk budgets without suppressing Vite warnings; timing evidence contains no repeatable >100 ms drag/drop regression on the reference machine.
  - QA scenarios: Playwright projects + `pnpm build` — happy: run screenshot/Axe/cross-browser/performance checks against the production preview; failure: run the visual fixture with a known 8 px panel-offset injection and prove screenshot comparison fails before reverting only that task-created injection. Evidence: `.omo/evidence/task-14-qingshe-mvp-roadmap.txt`, `.omo/evidence/task-14-qingshe-mvp-roadmap-performance.json`, and canonical PNGs.
  - Commit: Y | `test(ui): add release visual and browser gates`

- [ ] 15. Produce an auditable zero-cost local release candidate
  - What to do: update `README.md` with the exact product boundary, local setup, wedding workflow, storage behavior, supported formats/limits, and pnpm commands. Add `docs/architecture/editor-reuse.md` describing Fabric/dnd-kit/Dexie adapter ownership and replacement seams, plus `docs/release-checklist.md` with data migration, license, browser, and artifact checks. Keep release local and static: build `dist/`, validate it with a loopback production preview, and archive evidence, not generated output. Run `pnpm verify` exactly once as the full gate. Remote hosting, CI billing, PWA installation, and desktop packaging remain separate owner decisions.
  - Must NOT do: do not publish, deploy, create an account, enable a paid CI runner, add telemetry, commit `dist/`, or claim an installer/PWA exists; do not rerun the full suite if the captured gate is already complete and unchanged.
  - Parallelization: Wave 4 | Blocked by: 1-14 | Blocks: F1-F4
  - References: `package.json:7-21` (gate scripts); `vite.config.ts:1-13` (static build); `DESIGN.md:5-9` (scope); `docs/open-source-reuse.md` and `THIRD_PARTY_NOTICES.md` from todo 2; all `.omo/evidence/task-*` artifacts; Vite static deployment guide `https://vite.dev/guide/static-deploy.html` (build semantics only, no deployment authorization).
  - Acceptance criteria:
    - `README.md`, architecture, release checklist, and notices agree on zero paid dependencies, local-only data, and explicit non-goals.
    - One captured `pnpm verify` run executes `pnpm typecheck`, `pnpm test`, `pnpm check`, `pnpm build`, and `pnpm test:e2e`; all exit 0.
    - A loopback production preview loads with network blocked and completes import, drag, reload, and PNG export.
    - `git diff --check` is clean; `git status --short` contains no `dist/`, report, video, evidence, or unrelated user artifact staged for commit.
  - QA scenarios: `pnpm verify` + Playwright production preview — happy: execute the complete local release gate once and save timestamps/exit codes; failure: start the preview with an empty/corrupt built asset fixture in a task-created copy and prove the release smoke fails without changing the real build. Evidence: `.omo/evidence/task-15-qingshe-mvp-roadmap.txt` and `.omo/evidence/task-15-qingshe-mvp-roadmap.json`.
  - Commit: Y | `docs(release): define the zero-cost local MVP`

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
  - Mandatory read-only reviewer compares every Must have, Must NOT have, todo acceptance criterion, evidence path, and commit against the final diff and evidence ledger.
  - Confirm all 15 todos have either an approved evidence artifact or an explicit unresolved blocker; spot-check command outputs rather than rerunning the full gate.
  - Output `.omo/evidence/final-f1-qingshe-mvp-roadmap.md` with `APPROVE` or precise blocking findings.

- [ ] F2. Code quality review
  - Mandatory read-only reviewer inspects the complete diff for strict TypeScript boundaries, dnd-kit adapter leakage, Fabric lifecycle/disposal, object-URL leaks, history duplication, unsafe schema assumptions, Dexie transaction/versionchange handling, license drift, and silent error swallowing.
  - Review targeted unit/E2E coverage for geometry, ordering, migration rollback, quota/durability, cross-input behavior, and responsive state. Run only a missing targeted check if evidence is insufficient.
  - Output `.omo/evidence/final-f2-qingshe-mvp-roadmap.md` with `APPROVE` or file-and-line blocking findings. Any blocker returns to the single executor, then this review repeats.

- [ ] F3. Real manual QA
  - Agent starts the production preview and visibly executes the complete wedding-proposal workflow with network disabled at 1280 x 800, 768 x 1024, and 375 x 812, including touch/keyboard alternatives, cancel, save/reload, visibility/lock, and PNG download.
  - Inspect canvas placement, overlay, panel transitions, focus, status text, layer order, and exported image rather than relying only on DOM assertions.
  - Output `.omo/evidence/final-f3-qingshe-mvp-roadmap.md`, three final screenshots, one short recording, and `APPROVE` or precise reproduction steps.

- [ ] F4. Scope fidelity
  - Independent read-only review verifies the product still presents as focused wedding-planning design software and that the diff adds no paid SDK, remote service, account, cloud sync, AI, templates, generic editor expansion, telemetry, or unlicensed visual asset.
  - Reconcile `package.json`, lockfile, notices, runtime network log, UI text, and `DESIGN.md`; verify user `outputs/` artifacts and unrelated changes were preserved.
  - Output `.omo/evidence/final-f4-qingshe-mvp-roadmap.md` with `APPROVE` or exact scope violation.

## Commit strategy
- No commit is created during planning. Implementation begins only after the user explicitly chooses Start Work.
- Todo 1 creates the first auditable baseline after preserving the full pre-change inventory. Todos 2-15 use the atomic commit messages listed in each todo; implementation and its directly related tests stay in the same commit.
- Never stage `outputs/`, `dist/`, Playwright reports/videos, `.omo/evidence`, local databases, or unrelated user files. Review `git diff --cached --name-only` before every commit.
- A todo with failing targeted verification is not committed. Fix the same todo, rerun only its affected checks, and record the replacement evidence.
- Do not squash or rewrite history before F1-F4 approval. If a reviewer finds a blocker, add a narrowly scoped fix commit or amend only the unshared todo commit after verifying no unrelated changes are included.

## Success criteria
- A wedding planner can import a venue photo, drag a wedding asset to the intended position, adjust it, control its layer, reload the same local project, and export the final PNG without an account, network, watermark, or fee.
- Fabric remains the only canvas/rendering engine; dnd-kit is isolated to drag/sort adapters; Dexie core is isolated behind `ProjectStore`; no paid or cloud addon exists in production dependencies.
- Existing native IndexedDB v1 projects and local blobs migrate in place to v2 with hash-preserved assets, reversible error behavior, and no partial writes.
- Pointer, touch, pen-compatible pointer, keyboard, click fallback, responsive panels, layer order, visibility, lock, undo/redo, autosave, reload, and export meet their stated acceptance criteria.
- The owned wedding workflow passes offline at 1280, 768, and 375 widths; Firefox/WebKit smoke, Axe, screenshot, build-size, and full pnpm gates pass with captured evidence.
- All four final verification reviews return `APPROVE`, their results are shown to the user, and the user explicitly accepts completion.
- Accepted residual risks are documented rather than hidden: browser best-effort storage may still be reclaimed when persistence is denied; device-specific touch behavior requires later field feedback; packaging/PWA/hosting remain deliberately unimplemented.
