import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = readFileSync(resolve('public/assets/3d/tea-amo-floor.glb'));
if (file.toString('ascii', 0, 4) !== 'glTF') throw new Error('Invalid GLB header');
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.toString('utf8', 20, 20 + jsonLength));
const nodes = new Map(gltf.nodes.map((node) => [node.name, node]));
const ids = Array.from({ length: 11 }, (_, index) => `T${index + 1}`).concat(['A', 'B', 'C', 'D']);
const tableNodes = gltf.nodes.filter((node) => node.extras?.entityType === 'table');
if (tableNodes.length !== ids.length) throw new Error(`Expected 15 table groups, found ${tableNodes.length}`);
for (const id of ids) {
  const node = nodes.get(`TABLE_${id}`);
  if (!node || node.extras?.tableId !== id || node.extras.tableKey !== id.toLowerCase()) {
    throw new Error(`Table metadata mismatch for ${id}`);
  }
  if (!nodes.has(`HITBOX_${id}`) || !nodes.has(`STATUS_${id}`)) {
    throw new Error(`Missing interaction geometry for ${id}`);
  }
}
const triangles = gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((count, primitive) => {
  const vertices = primitive.indices == null
    ? gltf.accessors[primitive.attributes.POSITION].count
    : gltf.accessors[primitive.indices].count;
  return count + vertices / 3;
}, 0), 0);
console.log(`3D floor OK: ${ids.length} tables, ${triangles} triangles, ${file.length} bytes`);
