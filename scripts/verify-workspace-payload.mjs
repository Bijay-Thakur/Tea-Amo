import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ops = readFileSync('src/ops.js', 'utf8');
const slim = readFileSync('src/slim.js', 'utf8');
const server = readFileSync('public/js/server/app.js', 'utf8');

assert.match(ops, /loadWorkspaceBusiness/);
assert.doesNotMatch(ops, /workspaceForServer[\s\S]{0,800}select=data['"]/);
assert.match(slim, /workspace_business_config/);
assert.match(slim, /payment_qr:\s*\{\}/);
assert.match(slim, /export function menuImageUrl/);
assert.match(ops, /loadServerMenu\(env\)/);
assert.doesNotMatch(ops, /loadServerMenu\(env, token\)/);
assert.match(ops, /menuImageUrl/);
assert.match(server, /TEA_AMO_WORKSPACE/);
assert.match(server, /\/api\/server\/payment-qr\//);
assert.match(server, /menuPhotoUrl/);
assert.match(ops, /limit=250/);
console.log('PASS workspace payload: staff boot no longer pulls the full master document or QR blobs');
