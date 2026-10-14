import { TeaAmo3DFloor } from './floor3d.js';

if (window.ENABLE_3D_FLOOR !== false) {
  const admin = document.getElementById('tableFloor');
  const server = document.getElementById('floor');
  const host = admin || server;
  if (host) {
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
}
