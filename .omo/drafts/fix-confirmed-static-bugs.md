---
slug: fix-confirmed-static-bugs
status: approved
intent: clear
pending-action: hand off .omo/plans/fix-confirmed-static-bugs.md for execution
approach: TDD-fix the seven confirmed defects with explicit resource ownership, atomic persistence, typed error boundaries, bounded history, and input-boundary clamping; preserve current product design and dependencies.
---

# Draft: fix-confirmed-static-bugs

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
1 | GPU resources released with Fabric image/canvas lifecycle | active | src/features/editor/perspective-warp.ts; src/features/editor/fabric-perspective.ts; src/features/editor/fabric-runtime.ts; src/features/editor/fabric-document-reconcile.ts
2 | Malformed SSE and admin failures contained at UI/service boundaries | active | src/features/assets/asset-service-client.ts; src/features/asset-admin/AssetAdminApp.tsx
3 | History bounded and pending autosave durable during cleanup | active | src/features/editor/history-store.ts; src/features/projects/autosave-coordinator.ts; src/features/projects/use-project-session.ts
4 | IndexedDB project deletion atomic under corrupt records | active | src/features/projects/indexeddb-project-catalog.ts
5 | Numeric inputs cannot write values outside declared min/max | active | src/features/editor/InspectorPanel.tsx
6 | Targeted tests, full gates, and browser-visible acceptance | active | tests; tests/e2e; package.json

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
history depth | 100 snapshots | matches the source report and adds no configuration surface | yes
malformed SSE | skip only the malformed message | keeps the EventSource alive and isolates external input | yes
corrupt catalog deletion | throw and roll back the whole transaction | deleting assets while references are unknowable is unsafe | yes
UI design | behavior-only change with no visual redesign | DESIGN.md and user scope require preservation | yes

## Findings (cited - path:lines)

- Three.js allocations are created without a disposal path: src/features/editor/perspective-warp.ts:142-213.
- SSE JSON.parse and schema parse are unguarded: src/features/assets/asset-service-client.ts:243-261.
- History appends full snapshots without a cap: src/features/editor/history-store.ts:11-16.
- Autosave dispose clears pending data and the React cleanup calls it directly: src/features/projects/autosave-coordinator.ts:64-67; src/features/projects/use-project-session.ts:120-127.
- Four AssetAdmin actions lack catch boundaries while click handlers discard promises: src/features/asset-admin/AssetAdminApp.tsx:131-208,273-277,387-423.
- Corrupt remaining projects return from the transaction after the target has already been deleted: src/features/projects/indexeddb-project-catalog.ts:136-156.
- NumberField forwards finite but out-of-range values: src/features/editor/InspectorPanel.tsx:224-252.

## Decisions (with rationale)

- Add explicit perspective-renderer release APIs and call them from every layer-removal and canvas-disposal path; WeakMap garbage collection is not a GPU lifecycle contract.
- Parse SSE data into a nullable typed result; SyntaxError/schema failures return null, unknown exceptions rethrow.
- Cap both commit and redo-derived past history to the same 100-entry invariant.
- Make autosave dispose asynchronous and self-flushing; React cleanup launches it without awaiting while the existing cancelled guard prevents stale status updates.
- Convert expected admin network failures into visible messages and always restore busy state; unknown non-Error throws continue propagating.
- Throw a typed catalog-corruption error inside the Dexie transaction so deletion and metadata removal roll back together.
- Clamp NumberField at the input boundary before onValue; retain native min/max attributes for semantics.

## Scope IN

- Seven confirmed defects and their regression tests.
- Relevant unit tests, project gates, targeted Playwright flows, and visual QA for the numeric input behavior.

## Scope OUT (Must NOT have)

- No fixes for report items previously classified as nonexistent or unconfirmed.
- No dependency additions, schema migrations, UI redesign, formatting sweep, or unrelated cleanup.
- No rollback or overwrite of the existing dirty worktree.

## Open questions

None. User approved the approach.

## Approval gate
status: approved
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
