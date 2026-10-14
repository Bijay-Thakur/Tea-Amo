import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('public/js/server/app.js', 'utf8');
const html = readFileSync('public/server/index.html', 'utf8');
const between = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing ${start}`);
  return source.slice(from, to);
};
assert.match(html, /id="cashReceived"[^>]*placeholder="Enter cash received"/);

const elements = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, {
    value: '', disabled: false, textContent: '', classes: new Set(),
    classList: {
      contains(name) { return elements.get(id).classes.has(name); },
      toggle(name, force) { if (force) elements.get(id).classes.add(name); else elements.get(id).classes.delete(name); },
    },
  });
  return elements.get(id);
};
const context = vm.createContext({
  $: element, activeTable: { id: 't4' }, order: { cart: [{ id: 12, qty: 2 }] },
  paying: false, payMethod: 'Cash', calc: () => ({ total: 250 }), money: (value) => String(value),
});
vm.runInContext(between('function updatePaymentAvailability()', 'function staffBillHtml()'), context);
vm.runInContext(between('function updateCashPreview()', 'function renderPay()'), context);
vm.runInContext(between('function cashPayload()', 'async function takePayment()'), context);

context.updateCashPreview();
assert.equal(element('completePay').disabled, true, 'Blank cash must disable payment');
assert.throws(() => context.cashPayload(), /Enter the cash received amount/);

element('cashReceived').value = '249';
context.updateCashPreview();
assert.equal(element('completePay').disabled, true, 'Insufficient cash must disable payment');
assert.throws(() => context.cashPayload(), /less than the amount due/);

element('cashReceived').value = '300';
context.updateCashPreview();
assert.equal(element('completePay').disabled, false, 'Sufficient entered cash enables payment');
assert.equal(context.cashPayload().cash_received, 300);
assert.equal(context.cashPayload().change_due, 50);

context.payMethod = 'eSewa';
element('cashReceived').value = '';
context.updatePaymentAvailability();
assert.equal(element('completePay').disabled, false, 'Selected digital method needs no cash input');
context.activeTable = null;
context.updatePaymentAvailability();
assert.equal(element('completePay').disabled, true, 'No active table must disable payment');

console.log('Server payment OK: cash amount required; digital payment and table guards hold');
