# TEA AMO 3D floor implementation

## Implementation plan

1. Read the existing table catalog and the Admin and Server floor handlers.
2. Build a Blender scene from the catalog coordinates and preserve the landmark layout.
3. Export a GLB with table metadata, neutral status rings, and generous hitboxes.
4. Load the GLB in a reusable Three.js floor view, map application snapshots to status colors, and send table selections to the existing handlers.
5. Keep the original functional floor as a fallback and verify desktop and narrow layouts.

## Assets and scene

- Blender source: `assets/3d/tea-amo-floor.blend`; reproducible builder: `scripts/build-floor3d.py`.
- Browser asset: `public/assets/3d/tea-amo-floor.glb`, 2,566,232 bytes (2.45 MiB).
- GLB: 39,032 triangles, 166 mesh primitives, 23 materials, and 2 embedded textures.
- Scene collections: environment, tables, chairs, decor, floor seating, bar, stairs, aquarium, plants, and interaction helpers.
- Each `TABLE_*` group carries `entityType`, `tableId`, and the existing lowercase `tableKey`. It has a `STATUS_*` ring and `HITBOX_*` mesh.
- Mapping: `t1`–`t11` → `TABLE_T1`–`TABLE_T11`; `a`–`d` → `TABLE_A`–`TABLE_D`. All fifteen mappings, rings, and hitboxes were checked in the exported GLB.

## Files changed

- Scene and verification: `scripts/build-floor3d.py`, `scripts/verify-floor3d.mjs`, `assets/3d/tea-amo-floor.blend`, and `public/assets/3d/tea-amo-floor.glb`.
- Browser integration: `public/js/floor3d/`, `public/styles/floor3d.css`, `public/vendor/three/`, `public/owner/shell.html`, `public/server/index.html`, `public/js/owner/app.js`, and `public/js/server/app.js`.
- Asset serving and dependency: `src/node-adapter.js`, `server/dev.mjs`, `vercel.json`, `package.json`, and `package-lock.json`.

## Application integration

- `public/js/floor3d/floor3d.js` loads the model once, fits a fixed orthographic camera, raycasts hitboxes, projects accessible HTML table labels, and renders when state or viewport changes. It owns no order or payment data.
- Admin supplies snapshots from `tableVisualStatus` and selects through the existing `openTable(id)` function. Existing order, reservation, attention, payment, and receipt UI remains in HTML.
- Server supplies snapshots from `tableState` and selects through the existing `openTableSheet(id)` function. Its existing action sheet continues to enforce allowed actions and payment flow.
- The current realtime subscriptions and fallback polling call the existing floor render functions, which now pass updated snapshots into the 3D view. The 3D module has no independent polling or mutation endpoints.
- The original image floor and table buttons remain functional if modules, WebGL, or the GLB fail. `window.ENABLE_3D_FLOOR = false` before the module loads forces that fallback.
- The GLB and vendored Three.js files receive a one-hour browser cache header in local development and Vercel configuration.

## Verification

- Blender camera preview reviewed after modeling and batching.
- Headless Edge with software WebGL loaded the GLB and rendered all fifteen labels at desktop width and a 360 px floor width. The T4 label click reached the selection callback.
- `npm run test:floor3d` passed all fifteen table IDs, parent names, status rings, and hitboxes.
- JavaScript syntax checks and `git diff --check` passed.
- Desktop preview: `reports/floor3d-desktop.png`; narrow preview: `reports/floor3d-small.png`.

## Remaining live checks

- A signed-in Admin and two Server sessions were not available in this automated preview. The three-client realtime payment scenario has not been run end to end.
- Hardware mobile FPS, memory, and initial load timing have not been measured. The 3D view renders on demand and pauses while the tab is hidden; the GLB geometry and size are recorded above.
- The procedural model uses a stylized miniature interpretation of the supplied visual reference. A final art review against the actual café can refine furniture and decorative detail without changing table IDs or the application adapter.

## Admin payment follow-up

- Removed the bill-print gate from direct checkout, split bills, mixed payments, and non-chargeable orders. The Print Bill action remains optional. The existing closed-POS and payment validations remain active.
- Removed the obsolete Skip Bill action and gate message from the Admin POS UI. `npm run test:admin-payment` checks unprinted checkout, the payment dialogs, and the closed-POS rejection.
- Local SQL and gateway checks passed. The cloud integration test could not connect to its remote service in this sandbox, so live multi-client payment and floor synchronization remain unverified.
