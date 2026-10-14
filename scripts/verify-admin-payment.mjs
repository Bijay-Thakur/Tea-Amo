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
    disabled: false, classes: new Set(), style: {}, options: [],
    classList: {
      add(name) { elements.get(id).classes.add(name); },
      toggle(name, force) { if (force) elements.get(id).classes.add(name); else elements.get(id).classes.delete(name); },
    },
  });
  return elements.get(id);
};
element('payment').value = 'Cash';
element('payment').options = [{ value: 'Cash' }, { value: 'eSewa' }];
const cart = [{ id: 12, qty: 2 }];
const payments = [];
const alerts = [];
let open = true;
let total = 250;
const context = vm.createContext({
  $: element, checkoutBusy: false, posAllowed: () => open,
  currentCart: () => cart, calcCart: () => ({ total }), unservedCountForOrder: () => 0,
  selectedTotals: () => ({ total }),
  completeSelection: async (selection, info) => payments.push({ selection, info }),
  updateChangeDue() {}, alert: (message) => alerts.push(message),
  console: { error() {} },
});
vm.runInContext(line('function normalPaymentInfo('), context);
vm.runInContext(line('function updateCheckoutAvailability()'), context);
vm.runInContext(line('checkout=async function()'), context);
context.updateCheckoutAvailability();
assert.equal(element('checkout').disabled, true, 'Blank cash amount must disable checkout');
await context.checkout();
assert.equal(payments.length, 0, 'Blank cash amount must not create payment');
assert.match(alerts.at(-1), /Enter the cash received amount/);

element('cashReceived').value = '249';
context.updateCheckoutAvailability();
assert.equal(element('checkout').disabled, true, 'Insufficient cash must disable checkout');
element('cashReceived').value = '250';
context.updateCheckoutAvailability();
assert.equal(element('checkout').disabled, false, 'Sufficient entered cash enables checkout');
const alertCount = alerts.length;
await context.checkout();
assert.equal(payments.length, 1, 'Unprinted order must be payable');
assert.equal(payments[0].info.payment, 'Cash');
assert.equal(payments[0].info.cash_received, 250);
assert.equal(element('checkout').disabled, true, 'Cash input clears after payment');
assert.equal(alerts.length, alertCount);

element('payment').value = 'eSewa';
context.updateCheckoutAvailability();
assert.equal(element('checkout').disabled, false, 'Selected noncash method needs no cash input');
await context.checkout();
assert.equal(payments.length, 2);
assert.equal(payments[1].info.payment, 'eSewa');

open = false;
context.updateCheckoutAvailability();
assert.equal(element('checkout').disabled, true);
await context.checkout();
assert.equal(payments.length, 2, 'Closed POS must reject payment');
assert.match(alerts.at(-1), /POS is closed/);

const dialogContext = vm.createContext({
  $: element, currentCart: () => cart,
  menuItem: () => ({ name: 'Tea', price: 125 }),
  esc: (value) => value, rs: (value) => String(value),
  updateSplitTotal() {}, alert: (message) => alerts.push(message),
  paymentMethods: () => [{ name: 'Cash' }, { name: 'eSewa' }],
  selectedTotals: () => ({ total: 250 }),
  getSplitSelection: () => [{ id: 12, qty: 2 }],
  updateMixedPaymentPreview() {}, mixedPaymentContext: null,
});
let mixedAmounts = { Cash: 0, eSewa: 0 };
dialogContext.mixedValues = () => mixedAmounts;
element('splitPaymentMethod').value = 'Cash';
vm.runInContext(line('function openSplitBill()'), dialogContext);
vm.runInContext(line('function updateSplitTotal()'), dialogContext);
vm.runInContext(line('function openNonChargeable()'), dialogContext);
const mixedStart = source.indexOf('openMixedPayment=function(selection=null,opts={})');
const mixedEnd = source.indexOf('\nmixedValues=function()', mixedStart);
assert.ok(mixedStart >= 0 && mixedEnd > mixedStart);
vm.runInContext(source.slice(mixedStart, mixedEnd), dialogContext);
vm.runInContext(line('updateMixedPaymentPreview=function()'), dialogContext);
dialogContext.openSplitBill();
assert.equal(element('paySplitSelected').disabled, true, 'Split cash needs an amount');
element('splitCashReceived').value = '250';
dialogContext.updateSplitTotal();
assert.equal(element('paySplitSelected').disabled, false);
element('splitCashReceived').value = '249';
dialogContext.updateSplitTotal();
assert.equal(element('paySplitSelected').disabled, true);
element('splitPaymentMethod').value = 'eSewa';
dialogContext.updateSplitTotal();
assert.equal(element('paySplitSelected').disabled, false);
dialogContext.openMixedPayment();
assert.equal(element('confirmMixedPayment').disabled, true, 'Mixed payment needs the full amount');
mixedAmounts = { Cash: 100, eSewa: 150 };
dialogContext.updateMixedPaymentPreview();
assert.equal(element('confirmMixedPayment').disabled, true, 'Mixed cash needs received amount');
element('mixCashReceived').value = '99';
dialogContext.updateMixedPaymentPreview();
assert.equal(element('confirmMixedPayment').disabled, true, 'Mixed cash cannot be short');
element('mixCashReceived').value = '100';
dialogContext.updateMixedPaymentPreview();
assert.equal(element('confirmMixedPayment').disabled, false);
mixedAmounts = { Cash: 0, eSewa: 250 };
element('mixCashReceived').value = '';
dialogContext.updateMixedPaymentPreview();
assert.equal(element('confirmMixedPayment').disabled, false, 'Digital-only mix needs no cash input');
dialogContext.openNonChargeable();
for (const id of ['splitBillModal', 'mixedPaymentModal', 'nonChargeModal']) {
  assert.ok(element(id).classes.has('show'), `${id} must open without printing`);
}
assert.equal(alerts.length, alertCount + 1, 'Dialogs should not trigger new alerts');

console.log('Admin payment OK: cash amount required for checkout and split payment; digital payment and closed-POS rules hold');
