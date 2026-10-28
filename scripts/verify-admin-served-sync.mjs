import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('public/js/admin/cloud-bridge.js', 'utf8');
const start = source.indexOf('function applyRemoteOrders(');
const end = source.indexOf('async function refreshOrders()', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({
  state: { tables: [{ id: 't4', attention: false, seated: true }], tableOrders: { t4: { cart: [{ id: 12, qty: 1, served: 1 }], _lan_version: 2 } } },
  pendingOrders: new Set(['t4']), lanPushTimers: {}, lanApplyingRemote: false,
  activeSection: 'pos', activeTableId: 't4', renderPOSWorkspace() {}, renderTableFloor() {}, renderDashboard() {}, renderCart() {},
});
vm.runInContext(source.slice(start, end), context);
const remote = { t4: { version: 3, order: { cart: [{ id: 12, qty: 1, served: 0 }] } } };
context.remote = remote;
vm.runInContext('applyRemoteOrders(remote, [])', context);
assert.equal(context.state.tableOrders.t4.cart[0].served, 1, 'pending served edit must not be replaced by a remote refresh');
context.pendingOrders.delete('t4');
vm.runInContext('applyRemoteOrders(remote, [])', context);
assert.equal(context.state.tableOrders.t4.cart[0].served, 0, 'new remote version applies once local save is finished');
console.log('Admin served sync OK: pending served edit survives refresh');
