import { TeaAmo3DFloor } from './floor3d.js?v=20261014-seating';

function startFloor() {
  if (window.ENABLE_3D_FLOOR === false) return;
  const admin = document.getElementById('tableFloor');
  const server = document.getElementById('floor');
  const host = admin || server;
  if (!host) return;
  const floor = new TeaAmo3DFloor(host, (id) => {
    if (admin) window.openTable(id);
    else window.teaServerFloorSelect(id);
  });
  if (admin) window.teaAdminFloor3D = floor;
  else window.teaServerFloor3D = floor;
  floor.init().then(() => {
    const snapshot = admin ? window.teaAdminFloorSnapshot?.() : window.teaServerFloorSnapshot?.();
    if (snapshot) floor.setTables(snapshot);
  }).catch(() => {
    if (admin) window.teaAdminFloor3D = null;
    else window.teaServerFloor3D = null;
  });
}

if (window.requestIdleCallback) window.requestIdleCallback(startFloor, { timeout: 1200 });
else setTimeout(startFloor, 0);
