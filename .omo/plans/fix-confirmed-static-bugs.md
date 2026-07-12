# fix-confirmed-static-bugs - Work Plan

## TL;DR (For humans)
**What you'll get:** The seven confirmed defects will receive focused regression tests and minimal fixes: deterministic GPU cleanup, resilient event/error boundaries, bounded history, durable autosave cleanup, atomic project deletion, and clamped numeric input.

**Why this approach:** Each defect is fixed at its ownership or trust boundary so the behavior stays local, testable, and compatible with the existing product. Corrupt storage is handled conservatively by rolling back rather than guessing which assets are safe to delete.

**What it will NOT do:** It will not redesign the interface, add dependencies or migrations, modify rejected report findings, or clean unrelated dirty-worktree files.

**Effort:** Medium
**Risk:** Medium - the main risk is coordinating WebGL/Fabric cleanup and asynchronous persistence without double disposal or lost writes.
**Decisions to sanity-check:** History is capped at 100; malformed SSE is skipped per message; corrupt catalogs block and roll back deletion.

Your next move: start execution now, or request the optional high-accuracy plan review. Full execution detail follows below.

---

> TL;DR (machine): Medium effort/risk; TDD-fix seven confirmed defects, validate all pnpm gates, and complete browser plus visual QA without scope expansion.

## Scope
### Must have
- Explicit GPU cleanup for renderer, texture, geometry, front material, side material, and renderer-owned resources when a perspective image leaves the canvas or the canvas is disposed.
- Malformed SSE messages must not throw out of the EventSource callback or invoke the consumer.
- History retains at most 100 past snapshots through commit, undo, redo, and branch replacement.
- Autosave cleanup persists the last pending snapshot before becoming inert.
- Asset-admin async failures restore busy state and show a readable failure message without unhandled rejections.
- A corrupt remaining IndexedDB project rolls back target deletion instead of committing partial cleanup.
- NumberField clamps finite input to declared min/max before updating editor state.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Do not alter visual styling, DESIGN.md, dependencies, storage schemas, or public product scope.
- Do not fix the report's rejected/unconfirmed items, reformat unrelated files, or overwrite existing dirty-worktree changes.
- Do not use `any`, type assertions to suppress errors, ignored promises without a contained error path, empty catch blocks, or weakened tests.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD with Vitest for unit/integration behavior and Playwright for the numeric-input user flow; every production change begins with a targeted failing test.
- Evidence: `.omo/evidence/task-{todo-number}-fix-confirmed-static-bugs.txt`, browser screenshots under `.omo/evidence/visual-qa/`, and final command logs under `.omo/evidence/final/`.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

- Wave 0 (sequential prerequisite): capture current numeric-field screenshots at 375, 768, and 1280 px before edits; record `git status --short` to protect the dirty worktree.
- Wave 1 (independent TDD fixes, one writer per touched file): Todos 1-7. They may be investigated in parallel, but edits to overlapping test files must remain serialized.
- Wave 2 (integration): Todo 8 after all seven fixes are green.
- Final wave: F1-F4 only after Todo 8 completes.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | Wave 0 | 8 | 2-7 |
| 2 | Wave 0 | 8 | 1,3-7 |
| 3 | Wave 0 | 8 | 1-2,4-7 |
| 4 | Wave 0 | 8 | 1-3,5-7 |
| 5 | Wave 0 | 8 | 1-4,6-7 |
| 6 | Wave 0 | 8 | 1-5,7 |
| 7 | Wave 0 | 8 | 1-6 |
| 8 | 1-7 | F1-F4 | none |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Bound editor history to 100 snapshots
  What to do / Must NOT do: Add a named history-depth constant and enforce it whenever `past` grows in commit and redo. Add red tests for the 101st commit and redo after a full history. Preserve undo/redo branch semantics; do not truncate `future` except where existing behavior already does.
  Parallelization: Wave 1 | Blocked by: Wave 0 | Blocks: 8
  References: `src/features/editor/history-store.ts:1-51`; `tests/editor-domain.test.ts:47-98`; callers in `src/features/editor/editor-controller.ts:293-303,382-389`.
  Acceptance criteria: `pnpm test -- tests/editor-domain.test.ts` passes; assertions prove `past.length === 100`, the newest 100 snapshots remain, and normal undo/redo tests stay green.
  QA scenarios: happy = 101 sequential commits retain revisions 1..100; failure = branch-after-undo still clears future without exceeding the cap. Evidence `.omo/evidence/task-1-fix-confirmed-static-bugs.txt`.
  Commit: N | included in user-requested working-tree fix

- [x] 2. Flush pending autosave during disposal
  What to do / Must NOT do: Write a failing test where a scheduled snapshot is disposed before the debounce fires. Change disposal to an idempotent async operation that clears the timer, drains the latest pending snapshot, and prevents later scheduling. Update the React cleanup caller to launch the contained disposal promise without stale UI updates. Do not add unload-only APIs or block React cleanup.
  Parallelization: Wave 1 | Blocked by: Wave 0 | Blocks: 8
  References: `src/features/projects/autosave-coordinator.ts:17-104`; `src/features/projects/use-project-session.ts:34-128`; `tests/autosave-coordinator.test.ts:11-99`.
  Acceptance criteria: `pnpm test -- tests/autosave-coordinator.test.ts` passes; dispose persists a pending snapshot exactly once, repeated dispose is safe, and schedule-after-dispose is inert.
  QA scenarios: happy = pending revision is saved before dispose resolves; failure = save result error is mapped to failed status without an unhandled rejection. Evidence `.omo/evidence/task-2-fix-confirmed-static-bugs.txt`.
  Commit: N | included in user-requested working-tree fix

- [x] 3. Isolate malformed SSE asset events
  What to do / Must NOT do: Add a typed parser for event payload strings using JSON parse plus Zod safe parsing. The listener skips invalid JSON and schema-invalid messages, clears caches and invokes the consumer only for valid payloads, and rethrows unexpected non-parse failures. Do not close or recreate EventSource for one bad message.
  Parallelization: Wave 1 | Blocked by: Wave 0 | Blocks: 8
  References: `src/features/assets/asset-service-client.ts:42,243-261`; consumers `src/features/assets/use-managed-assets.ts:165` and `src/features/asset-admin/AssetAdminApp.tsx:96`.
  Acceptance criteria: targeted Vitest tests dispatch valid JSON, malformed JSON, and invalid UUID payloads; only the valid event reaches the callback and no invalid dispatch throws.
  QA scenarios: happy = valid `asset.ready` clears cache and invokes once; failure = malformed JSON and schema mismatch invoke zero times while a later valid event still succeeds. Evidence `.omo/evidence/task-3-fix-confirmed-static-bugs.txt`.
  Commit: N | included in user-requested working-tree fix

- [x] 4. Release all perspective WebGL resources
  What to do / Must NOT do: Add explicit ownership fields for canvas texture, geometry, front/side materials, and renderer; add idempotent renderer disposal; expose image/source release functions through `fabric-perspective.ts`; call them before every layer removal, full rebuild, and runtime disposal. Cover all `canvas.remove` paths found by `rg -n "canvas\\.remove|canvas\\.dispose" src/features/editor`. Do not rely on WeakMap GC or dispose shared resources more than once.
  Parallelization: Wave 1 | Blocked by: Wave 0 | Blocks: 8
  References: `src/features/editor/perspective-warp.ts:39,85-213`; `src/features/editor/fabric-perspective.ts:5-42`; `src/features/editor/fabric-document-reconcile.ts:50-67,69-127`; `src/features/editor/fabric-runtime.ts:241-254,450-465`; Three.js disposal contract: https://threejs.org/manual/en/how-to-dispose-of-objects.html.
  Acceptance criteria: unit tests with controlled Three.js disposables prove renderer, texture, geometry, both materials, and render lists are released exactly once; existing `tests/perspective-warp.test.ts` passes.
  QA scenarios: happy = removing a perspective layer releases every resource once; failure = repeated release and canvas disposal after removal do not throw or double-dispose. Evidence `.omo/evidence/task-4-fix-confirmed-static-bugs.txt`.
  Commit: N | included in user-requested working-tree fix

- [x] 5. Add asset-admin async error boundaries
  What to do / Must NOT do: Add red interaction tests for `applyCategory`, `restoreSelected`, `backupCatalog`, and `repairCatalog`. Catch expected `Error` failures at the UI boundary, show an operation-specific message, and restore busy state in finally where applicable; rethrow non-Error values. Include the existing retry action if the same discarded-promise defect is proven while writing the tests, but do not broaden into a component refactor.
  Parallelization: Wave 1 | Blocked by: Wave 0 | Blocks: 8
  References: `src/features/asset-admin/AssetAdminApp.tsx:131-208,250-304,368-423`; existing patterns at `src/features/asset-admin/AssetAdminApp.tsx:147-161`; E2E surface `tests/e2e/asset-admin-preview.spec.ts`.
  Acceptance criteria: targeted component or Playwright tests reject each service call and assert the status message changes, busy controls re-enable, and no `unhandledrejection` event fires.
  QA scenarios: happy = each operation keeps its current success message; failure = each rejected network call produces the matching visible failure message. Evidence `.omo/evidence/task-5-fix-confirmed-static-bugs.txt`.
  Commit: N | included in user-requested working-tree fix

- [x] 6. Roll back IndexedDB deletion when remaining projects are corrupt
  What to do / Must NOT do: Add a typed corruption error and make the transaction throw when any remaining project cannot be parsed. Add a regression test proving project row, metadata, and assets remain after the failed deletion. Do not skip corrupt records and continue orphan deletion because their asset references are unknowable.
  Parallelization: Wave 1 | Blocked by: Wave 0 | Blocks: 8
  References: `src/features/projects/indexeddb-project-catalog.ts:136-175`; schemas `src/features/projects/project-format.ts:70-98`; database tables `src/features/projects/project-database.ts`; UI caller `src/features/projects/ProjectHome.tsx:59-70`.
  Acceptance criteria: targeted test seeds one target and one corrupt remaining project, calls delete, receives `{ kind: "error" }`, and verifies the target project/metadata/assets were not committed as deleted.
  QA scenarios: happy = valid catalog deletes target and true orphans; failure = corrupt catalog rolls back all target deletion effects. Evidence `.omo/evidence/task-6-fix-confirmed-static-bugs.txt`.
  Commit: N | included in user-requested working-tree fix

- [x] 7. Clamp numeric inspector input at its boundary
  What to do / Must NOT do: Capture pre-edit reference screenshots at 375, 768, and 1280 px. Add a small pure clamp helper or equivalent testable boundary, then make NumberField clamp finite values before `onValue`; preserve native min/max and unchanged-value rendering. Add unit and browser tests for scale and opacity above/below bounds. Do not change CSS, labels, layout, or model-wide transform behavior.
  Parallelization: Wave 1 | Blocked by: Wave 0 | Blocks: 8
  References: `src/features/editor/InspectorPanel.tsx:119-160,224-252`; domain bounds `src/features/editor/editor-model.ts:50-62`; App bridge `src/App.tsx:182-192,376-386`; relevant Playwright editor flow `tests/e2e/editor.spec.ts`.
  Acceptance criteria: unit tests prove optional min-only, max-only, both, and no-bound behavior; Playwright enters 600% scale and 200% opacity and observes 500% and 100%, then enters negative values and observes 1% and 0%.
  QA scenarios: happy = in-range number passes unchanged; failure = below-min/above-max values clamp before editor state and autosave. Evidence `.omo/evidence/task-7-fix-confirmed-static-bugs.txt` plus `.omo/evidence/visual-qa/reference-*.png`.
  Commit: N | included in user-requested working-tree fix

- [x] 8. Integrate, validate, and drive the changed UI through the real page
  What to do / Must NOT do: Run each affected test once after its implementation, then run the full project gates once. Start the actual Vite E2E surface and execute the numeric-input and asset-admin flows. Capture post-fix screenshots at the same three reference viewports and run the visual-qa image diff; investigate any unexpected pixel difference. Do not rerun passing suites without a code change or use full E2E as a substitute for targeted failures.
  Parallelization: Wave 2 | Blocked by: 1-7 | Blocks: F1-F4
  References: `package.json:scripts`; `playwright.config.ts`; `DESIGN.md`; Todo evidence above.
  Acceptance criteria: `pnpm typecheck`, `pnpm test`, `pnpm check`, `pnpm build`, and relevant `pnpm test:e2e -- <spec>` all exit 0; visual QA shows no unintended appearance change and the numeric bounds work in the actual browser.
  QA scenarios: happy = all seven regressions pass through their matching surfaces; failure = malformed SSE/admin rejection/out-of-range input paths remain contained and visible as designed. Evidence `.omo/evidence/task-8-fix-confirmed-static-bugs.txt`, `.omo/evidence/final/`, `.omo/evidence/visual-qa/`.
  Commit: N | user did not request a commit

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Verify every confirmed Bug 1/2/6/7/8/11/17 maps to one green regression and no rejected report item was modified. Evidence `.omo/evidence/final/F1-plan-compliance.txt`.
- [x] F2. Code quality review
  Review strict TypeScript, resource idempotence, async rejection containment, transaction atomicity, and dirty-worktree preservation. Evidence `.omo/evidence/final/F2-code-quality.txt`.
- [x] F3. Real manual QA
  Drive the editor numeric fields, asset-admin error feedback, and perspective-layer add/remove in Chromium; inspect console for unhandled rejection/WebGL warnings. Evidence `.omo/evidence/final/F3-manual-qa.txt` and screenshots.
- [x] F4. Scope fidelity
  Compare `git diff --` limited to planned files/tests and reject dependency, design, schema, or unrelated formatting changes. Evidence `.omo/evidence/final/F4-scope-fidelity.txt`.

## Commit strategy

- Do not commit unless the user explicitly asks. Keep changes atomic by todo in the working tree and report the exact modified-file set.
- Preserve all pre-existing modified and untracked files; never reset, checkout, or format the repository globally.

## Success criteria

- All seven confirmed defects have a failing-before/green-after regression test.
- GPU resources are disposed exactly once at every applicable ownership boundary.
- No malformed external message or expected admin network failure creates an unhandled exception/rejection.
- History and autosave invariants hold under boundary and cleanup tests.
- Corrupt-catalog deletion is atomic and conservative.
- Numeric inputs clamp through the actual browser without visual regression.
- Required pnpm gates and four final verification passes approve on the same revision.
