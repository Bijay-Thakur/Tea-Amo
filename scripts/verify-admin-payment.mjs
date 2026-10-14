import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('public/js/owner/app.js', 'utf8');
const posHtml = readFileSync('public/owner/sections/pos.html', 'utf8');
const modalHtml = readFileSync('public/owner/partials/modals.html', 'utf8');
const line = (prefix) => {
  const match = source.split(/\r?\n/).find((value) => value.startsWith(prefix));
  assert.ok(match, `Missing ${prefix}`);
  return match;
};

assert.doesNotMatch(source, /ensureBillGate|billPass|updateBillGate/);
assert.doesNotMatch(posHtml, /billGate|skipOpenBill/);
assert.match(posHtml, /id="printOpenBill"/);
assert.match(modalHtml, /Printing is optional/);

const elements = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, {
    value: '', textContent: id === 'checkout' ? 'Complete Payment' : '',
    disabled: false, classes: new Set(),
    classList: { add(name) { elements.get(id).classes.add(name); } },
  });
  return elements.get(id);
};
element('payment').value = 'Cash';
const cart = [{ id: 12, qty: 2 }];
const payments = [];
const alerts = [];
let open = true;
const context = vm.createContext({
  $: element, checkoutBusy: false, posAllowed: () => open,
  currentCart: () => cart, unservedCountForOrder: () => 0,
  selectedTotals: () => ({ total: 250 }),
  normalPaymentInfo: (total, method) => ({ total, method }),
  completeSelection: async (selection, info) => payments.push({ selection, info }),
  updateChangeDue() {}, alert: (message) => alerts.push(message),
  console,
});
vm.runInContext(line('checkout=async function()'), context);
await context.checkout();
assert.equal(payments.length, 1, 'Unprinted order must be payable');
assert.equal(payments[0].info.method, 'Cash');
assert.equal(element('checkout').disabled, false);
assert.deepEqual(alerts, []);

open = false;
await context.checkout();
assert.equal(payments.length, 1, 'Closed POS must reject payment');
assert.match(alerts.at(-1), /POS is closed/);

const dialogContext = vm.createContext({
  $: element, currentCart: () => cart,
  menuItem: () => ({ name: 'Tea', price: 125 }),
  esc: (value) => value, rs: (value) => String(value),
  updateSplitTotal() {}, alert: (message) => alerts.push(message),
  paymentMethods: () => [{ name: 'Cash' }, { name: 'eSewa' }],
  selectedTotals: () => ({ total: 250 }),
  updateMixedPaymentPreview() {}, mixedPaymentContext: null,
});
vm.runInContext(line('function openSplitBill()'), dialogContext);
vm.runInContext(line('function openNonChargeable()'), dialogContext);
const mixedStart = source.indexOf('openMixedPayment=function(selection=null,opts={})');
const mixedEnd = source.indexOf('\nmixedValues=function()', mixedStart);
assert.ok(mixedStart >= 0 && mixedEnd > mixedStart);
vm.runInContext(source.slice(mixedStart, mixedEnd), dialogContext);
dialogContext.openSplitBill();
dialogContext.openMixedPayment();
dialogContext.openNonChargeable();
for (const id of ['splitBillModal', 'mixedPaymentModal', 'nonChargeModal']) {
  assert.ok(element(id).classes.has('show'), `${id} must open without printing`);
}
assert.equal(alerts.length, 1, 'Dialogs should not trigger new alerts');

console.log('Admin payment OK: direct checkout and payment dialogs work without printing; closed POS stays blocked');
