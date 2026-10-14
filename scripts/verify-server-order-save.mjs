import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('public/js/server/app.js', 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const calls = [];
let finishFirst;
const fields = new Map();
const element = (id) => {
  if (!fields.has(id)) fields.set(id, { value: id === 'guestCount' ? '1' : id === 'discountType' ? 'percent' : '0', disabled: false });
  return fields.get(id);
};
const context = vm.createContext({
  $: element, clearTimeout() {}, setTimeout() { return 1; },
  status() {}, closeSheet() {}, renderCart() {},
  api: async (_path, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (calls.length === 1) return new Promise((resolve) => { finishFirst = resolve; });
    return { version: 2 };
  },
});
vm.runInContext(`let activeTable = { id: 't4', name: 'T4' }, order = { cart: [{ id: 12, qty: 1, served: 0 }], openedAt: null }, version = 0, dirty = true, saving = false, savePromise = null, editRevision = 0, servedEdits = new Map(), otherEdits = false, attention = false, cfg = { orders: {} }, saveTimer = 0;`, context);
vm.runInContext(between('function setServed(', 'function calc()'), context);
vm.runInContext(between('function scheduleSave(', 'function updatePaymentAvailability()'), context);

const save = vm.runInContext('saveOrder()', context);
assert.equal(calls.length, 1);
vm.runInContext('setServed(12, 1)', context);
finishFirst({ version: 1 });
assert.equal(await save, true);
assert.equal(calls.length, 2, 'edit during in-flight save must be written again');
assert.equal(calls[0].items[0].served_qty, 0);
assert.equal(calls[1].items[0].served_qty, 1);
assert.equal(vm.runInContext('dirty', context), false);
assert.equal(vm.runInContext('version', context), 2);

const retryCalls = [];
const retry = vm.createContext({
  $: element, clearTimeout() {}, setTimeout() { return 1; },
  status() {}, closeSheet() {}, renderCart() {},
  api: async (path, options) => {
    if (!options) return { version: 2, attention: false, order: { cart: [{ id: 12, qty: 1, served: 0 }], guestCount: 1, discountType: 'percent', discountValue: 0 } };
    retryCalls.push({ path, body: JSON.parse(options.body) });
    if (retryCalls.length === 1) throw Object.assign(new Error('conflict'), { status: 409 });
    return { version: 3 };
  },
});
vm.runInContext(`let activeTable = { id: 't4', name: 'T4' }, order = { cart: [{ id: 12, qty: 1, served: 0 }], guestCount: 1, discountType: 'percent', discountValue: 0 }, version = 1, dirty = false, saving = false, savePromise = null, editRevision = 0, servedEdits = new Map(), otherEdits = false, attention = false, cfg = { orders: {} }, saveTimer = 0;`, retry);
vm.runInContext(between('function setServed(', 'function calc()'), retry);
vm.runInContext(between('function scheduleSave(', 'function updatePaymentAvailability()'), retry);
vm.runInContext('setServed(12, 1)', retry);
assert.equal(await vm.runInContext('saveOrder()', retry), true);
assert.equal(retryCalls.length, 2);
assert.equal(retryCalls[1].body.expected_version, 2);
assert.equal(retryCalls[1].body.items[0].served_qty, 1);
console.log('Server order save OK: served edit survives in-flight save and version conflict');
