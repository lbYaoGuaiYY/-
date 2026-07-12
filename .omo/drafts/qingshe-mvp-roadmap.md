---
slug: qingshe-mvp-roadmap
status: planned
intent: clear
pending-action: user chooses Start Work or a high-accuracy plan review
approach: Keep the working React 19 and Fabric 7 editor as the product base, prohibit paid SDKs, and replace remaining commodity infrastructure with mature permissively licensed modules: dnd-kit for pointer, touch, keyboard drag-and-drop and layer sorting; Dexie for IndexedDB persistence and migrations; existing Fabric for canvas transforms, rendering, history integration, and export.
---

# Draft: qingshe-mvp-roadmap

## Components (topology ledger)

| id | outcome | status | evidence path |
| --- | --- | --- | --- |
| C1 | Product scope is a focused wedding-planning design application with fast drag-and-drop composition and explicit non-goals | active | DESIGN.md:5-9; owner clarification in current planning intake |
| C2 | Canvas editing loop is complete, deterministic, and covered by behavior tests | active | src/features/editor/editor-controller.ts:34-280; src/features/editor/fabric-runtime.ts:28-270 |
| C3 | One active local project saves, restores, migrates, and reports durability honestly | active | src/features/projects/indexeddb-project-store.ts:26-153; src/features/projects/project-format.ts:10-106 |
| C4 | Desktop, tablet, and mobile expose every required operation accessibly | active | DESIGN.md:81-96; src/App.tsx:122-187; src/styles/responsive.css:1-120 |
| C5 | Type, unit, E2E, visual, performance, and local release gates produce reviewable evidence | active | package.json:12-21; tests/e2e/editor.spec.ts:28-31; playwright.config.ts:5-30 |
| C6 | A defined first-release distribution target can be built, installed or hosted, and supported | active | package.json:3-6; vite.config.ts:1-13; no current release configuration |
| C7 | A zero-paid permissive reuse stack is selected through license, compatibility, local-data, touch, export, and maintenance gates | active | package.json; Fabric.js, dnd-kit, and Dexie official repositories and licenses |

## Open assumptions (announced defaults)

| assumption | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| Test strategy | TDD for domain and behavior; Playwright assertions and visual baselines before UI fixes | Existing Vitest and Playwright suites make regressions cheap to lock before implementation | yes |
| Scope discipline | No AI, templates, accounts, backend, or multi-project workspace in this plan | DESIGN.md explicitly excludes the first four; current persistence is intentionally single-active-project | yes, by a later product decision |
| Delivery sequencing | Stabilize responsive access and repository baseline before adding missing layer capabilities | Current manual QA found unreachable or misleading panel controls | yes |
| Performance response | Split or defer Fabric/editor code instead of raising Vite's chunk warning limit | The warning reflects parse/execution cost; suppressing it would hide the risk | yes |

## Findings (cited - path:lines)

- DESIGN.md:5-9 defines a quiet, canvas-first local compositor and excludes Photoshop-scale complexity, templates, AI, login, and backend entry points.
- DESIGN.md:83-89 defines four responsive layout bands; current src/App.tsx:183-185 only exposes mobile panel entries below 700px and routes both Layers and Properties to the same drawer state.
- DESIGN.md:136-152 requires layer visibility, thumbnails, lock/drag states, and Tab panel hiding; current LayerPanel and shortcut model do not implement them.
- src/features/editor/editor-controller.ts:34-280 and FabricRuntime already provide the functional import-transform-history-export core, so the plan should extend rather than rewrite it.
- src/features/projects/project-format.ts:10-106 and indexeddb-project-store.ts:26-153 implement one schema-versioned active project; persistence permission is requested but the result is ignored.
- tests/e2e/editor.spec.ts:28-31 covers 1280 and 768 only; no 375 mobile flow or committed visual baseline exists.
- package.json:12-21 already defines all five required project gates; the last app-focused run passed typecheck, 24 unit tests, build, and 13 E2E tests, while the current repo-wide check is polluted by generated moodboard output that todo 1 will exclude without deleting it.
- The production bundle last measured 620.69 kB JavaScript (186.77 kB gzip), above Vite's default warning threshold.
- Git has no first commit; README, CI, roadmap, and release configuration are absent, so current progress is not yet auditable as a development process.
- Fabric.js 7.4 is MIT-licensed and already provides the canvas interaction, image IO, JSON, and export primitives the product needs; the installed version matches the current upstream release line.
- dnd-kit is MIT-licensed and provides pointer, mouse, touch, keyboard, accessibility, and sortable primitives, covering both asset placement and layer reordering without a custom gesture framework.
- Dexie.js core is a mature IndexedDB wrapper with typed React examples, schema versions, transactions, blob-compatible storage, and active releases; Dexie Cloud is separate and remains out of scope.
- Excalidraw is MIT and mature but its infinite whiteboard and hand-drawn document model do not match venue-photo composition, so replacing Fabric with it would increase adaptation work.
- Vite static deployment is directly supported: https://vite.dev/guide/static-deploy.html
- Installable PWA delivery requires a manifest and secure origin, with offline behavior typically supplied by a service worker: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
- Playwright supports committed screenshot comparisons for visual regression evidence: https://playwright.dev/docs/test-snapshots

## Decisions (with rationale)

- Product positioning precedes feature sequencing, technical hardening, and distribution decisions.
- Approved positioning core: wedding-planning design software. Approved functional core: simple drag-and-drop editing and rapid wedding design-image output.
- Preserve the React + TypeScript + Fabric 7 product base, design constraints, local-first behavior, and test contract; paid editor replacement is prohibited.
- Keep a single active project for the MVP; multi-project management would expand the product beyond the current contract.
- Treat responsive reachability, persistence truthfulness, large-image safeguards, and repository/CI baseline as release blockers.
- Complete DESIGN.md layer and keyboard requirements only after the responsive shell is reliable.
- Require all verification to be agent-executed and saved under .omo/evidence during implementation.

## Scope IN

- License and source-availability audit for every reused editor or component.
- dnd-kit integration for asset placement and layer sorting across pointer, touch, and keyboard input.
- Dexie integration behind the existing ProjectStore boundary for local project and blob persistence; no cloud addon.
- Adapter boundaries that keep dnd-kit and Dexie replaceable and preserve the existing domain model.
- Repository baseline, development documentation, and local release gates; no paid remote CI dependency.
- Responsive panel state model and 375/768/1280 behavior.
- Remaining DESIGN.md layer, shortcut, accessibility, and error-state requirements.
- Image validation, persistence durability, schema migration path, and failure handling.
- Bundle splitting, production-browser audit, cross-browser smoke coverage, and first-release configuration.

## Scope OUT (Must NOT have)

- AI generation or editing.
- Templates, account/login, cloud sync, backend, analytics, or collaboration.
- Photoshop-style tool expansion, freehand drawing, text editing, filters, or plugin architecture.
- Multi-project dashboard unless separately approved later.
- Product-code implementation during planning.

## Open questions

- No blocking owner decision remains. The owner explicitly rejected all paid SDKs and recurring license fees. The plan will allow only dependencies whose production use is free and whose licenses have been verified before integration; the default allowlist is MIT, BSD-2-Clause, BSD-3-Clause, and Apache-2.0.

## Current recommendation

- Commercial SDK and paid-license routes are closed.
- Treat the current 轻设 application as the primary finished base instead of discarding it: Fabric 7.4 already supplies mature move, scale, rotate, grouping, image IO, and export primitives under MIT.
- Adopt dnd-kit as the finished drag-and-drop layer for asset-to-canvas placement and layer sorting because it provides pointer, mouse, touch, and keyboard sensors plus accessibility under MIT.
- Adopt Dexie as the finished local database layer for project and blob persistence, schema upgrades, and IndexedDB edge-case handling under its verified open-source license; do not add Dexie Cloud.
- Preserve the existing tested history and project-domain logic where it is already simpler than a replacement. Reuse is chosen by net reduction in owned code and maintenance, not by dependency count.
- Use TUI Image Editor and Filerobot only as implementation references or isolated future modules; do not transplant their complete editor shells because they use incompatible canvas or React generations and add out-of-scope photo features.
- Require a dependency license ledger and exact version pins before code adoption. Reject packages with missing licenses, paid production clauses, source-available restrictions, copyleft obligations not explicitly approved, abandoned forks, or unreviewed transitive dependencies.
- The first implementation wave remains the full wedding proposal loop, but commodity behavior comes from Fabric, dnd-kit, and Dexie rather than custom drag and storage frameworks.

## Adopted defaults for approval

| decision | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| Product base | Current React 19 + Fabric 7 application | It is already working, aligned to the product, MIT-based, and more mature than the free editor forks reviewed | yes |
| Drag-and-drop | dnd-kit | MIT, actively maintained, accessible, and supplies pointer, touch, mouse, keyboard, and sortable primitives | yes |
| Local database | Dexie core only | Mature IndexedDB wrapper with schema/version support; cloud, auth, and sync addons remain prohibited | yes |
| License policy | MIT, BSD-2-Clause, BSD-3-Clause, or Apache-2.0 by default | Enables free commercial distribution while minimizing legal and operational constraints | yes, by explicit owner decision |
| Reuse threshold | Add a dependency only when it removes more owned code and edge cases than it introduces | Prevents dependency accumulation disguised as reuse | yes |
| Deferred work | Multi-project, packaging, PWA, collaboration, 3D, AI, and generic design-suite features | They do not determine whether an existing editor can power the focused wedding workflow | yes |

## Reuse candidate assessment

| candidate | reuse value | blocking risk | disposition |
| --- | --- | --- | --- |
| Fabric.js 7.4 | Mature canvas transforms, selection, grouping, image IO, serialization, and export | Low-level API still needs product orchestration | Keep as core |
| dnd-kit | Accessible cross-input drag-and-drop and sortable behavior | Must map DOM drop coordinates into Fabric canvas coordinates and be verified in real browser tests | Adopt for drag and layers |
| Dexie.js core | Mature IndexedDB transactions, schema upgrades, typed tables, and blob storage | Migration must preserve the current stored project and must not introduce Dexie Cloud | Adopt behind ProjectStore |
| Excalidraw | Mature MIT embeddable canvas with local-first behavior and export | Whiteboard interaction and data model do not fit photo-based wedding composition | Do not use as core; reference local-first patterns only |
| TUI Image Editor | MIT, Fabric-based, many editing primitives | Depends on Fabric 4.2, last release 2022, centered on filters/crop/drawing | Do not use as the core; reference isolated patterns only |
| Filerobot Image Editor | MIT, mobile-friendly, history and state export | React 18/Konva and single-image photo editing, not a focused composition workspace | Possible future background-edit modal only |
| LidoJS and small Canva clones | Large visible feature surfaces and reusable UI ideas | No stable releases, unclear or missing license coverage, limited maintenance evidence | Do not fork into production |

## Approval gate

status: planned
pending action: the decision-complete zero-paid open-source reuse plan is written at `.omo/plans/qingshe-mvp-roadmap.md`. The user must now choose Start Work or request a high-accuracy review; no product implementation has been authorized yet.
