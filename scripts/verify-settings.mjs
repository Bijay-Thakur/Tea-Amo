import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('public/owner/sections/settings.html', 'utf8');
const source = readFileSync('public/js/owner/app.js', 'utf8');
const css = readFileSync('public/styles/payment-settings.css', 'utf8');
const part = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
};

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'Settings IDs must be unique');
for (const id of [
  'businessName', 'branchName', 'currency', 'taxRate', 'saveBusiness',
  'oldPass', 'newPass', 'confirmPass', 'changePass',
  'quickQrMethods', 'qrUploadESewa', 'qrPreviewESewa', 'qrUploadKhalti',
  'qrPreviewKhalti', 'qrUploadFonepay', 'qrPreviewFonepay',
  'paymentMethodBody', 'newPaymentMethodName', 'newPaymentMethodKind', 'addPaymentMethodBtn',
  'backupBtn', 'restoreFile', 'lanSyncStatus', 'lanSyncDetail', 'lanStaffUrl',
  'lanSyncNow', 'lanRefreshNetwork', 'lanCopyStaffUrl', 'lanOpenStaffTest',
  'resetPassword', 'resetAll', 'restoreDashboard', 'fullResetPassword',
  'fullResetConfirm', 'fullSystemReset',
]) assert.ok(ids.includes(id), `Missing Settings control ${id}`);
assert.match(html, /class="settings-layout"/);
assert.match(css, /\.settings-layout \{ display: grid; grid-template-columns:/);
assert.match(css, /@media \(max-width: 700px\)/);
assert.match(html, /class="settings-disclosure settings-payments" open/);
assert.match(html, /id="operationalResetModal"/);
assert.match(source, /\$\('restoreFile'\)\.onchange=.*verifyOwnerPassword/);
assert.match(source, /\$\('lanCopyStaffUrl'\)\.onclick/);
assert.match(source, /\$\('newPass'\)\.value!==\$\('confirmPass'\)\.value/);

const fields = new Map([
  ['businessName', { value: 'TEA AMO' }], ['branchName', { value: 'Main Branch' }],
  ['currency', { value: 'Rs' }], ['taxRate', { value: '0' }],
  ['saveBusiness', { disabled: false }],
]);
const businessState = { business: { name: 'TEA AMO', branch: 'Main Branch', currency: 'Rs', taxRate: 0 } };
const business = vm.createContext({ $: id => fields.get(id), state: businessState });
vm.runInContext(part('function updateBusinessSaveState()', 'function closeSettingsModal('), business);
business.updateBusinessSaveState();
assert.equal(fields.get('saveBusiness').disabled, true);
fields.get('branchName').value = 'Garden Branch';
business.updateBusinessSaveState();
assert.equal(fields.get('saveBusiness').disabled, false);
console.log('PASS business settings: save activates only after a change');

const backup = vm.createContext({});
vm.runInContext(part('function validateBackupPayload(', 'function downloadSafetyBackup('), backup);
const valid = { business: {}, menu: [], ingredients: [], staff: [], bills: [], businessDays: [] };
assert.equal(backup.validateBackupPayload(valid), true);
assert.throws(() => backup.validateBackupPayload({ ...valid, bills: null }), /required field/);
assert.throws(() => backup.validateBackupPayload({ ...valid, menu: {} }), /collection types/);
console.log('PASS backup restore: payload validation rejects missing or invalid collections');

const paymentFields = new Map([
  ['newPaymentMethodName', { value: 'IME Pay' }],
  ['newPaymentMethodKind', { value: 'digital' }],
  ['addPaymentMethodModal', { id: 'addPaymentMethodModal' }],
]);
const paymentState = { business: { payment_methods: [{ name: 'Cash', kind: 'cash' }] } };
let paymentSaved = 0, paymentRendered = 0, modalClosed = 0;
const payments = vm.createContext({
  $: id => paymentFields.get(id), state: paymentState,
  paymentMethods: () => paymentState.business.payment_methods,
  saveSoon: () => { paymentSaved++; },
  renderPaymentMethodSettings: () => { paymentRendered++; },
  closeSettingsModal: () => { modalClosed++; },
  setActionStatus() {}, alert() {},
});
vm.runInContext(part('function addPaymentMethodFromSettings()', 'async function removePaymentMethod('), payments);
payments.addPaymentMethodFromSettings();
assert.equal(paymentState.business.payment_methods[1].name, 'IME Pay');
assert.equal(paymentState.business.payment_methods[1].kind, 'digital');
assert.equal(paymentSaved, 1);
assert.equal(paymentRendered, 1);
assert.equal(modalClosed, 1);
console.log('PASS payment methods: add action saves, rerenders and closes its dialog');

const elements = new Map([
  ['fullResetPassword', { value: 'wrong' }], ['fullResetConfirm', { value: 'RESET TEA AMO' }],
  ['operationalResetModal', { classList: { remove() {} }, id: 'operationalResetModal' }],
]);
const originalBusiness = { name: 'TEA AMO', payment_methods: [{ name: 'Cash', kind: 'cash' }], payment_qr: { eSewa: 'qr' } };
const operationalState = {
  business: originalBusiness, menu: [{ name: 'Tea' }], recipes: [{ name: 'Tea recipe' }],
  bills: [1], attendance: [1], purchases: [1], waste: [1], expenses: [1],
  customers: [1], inventoryLog: [1], businessDays: [1], auditLog: [1],
  ownerCapital: [1], dailyBusinessReports: [1], cart: [1], tableOrders: { 1: [1] },
  dashboardBaseline: { sales: 10 }, ingredients: [{ stock: 8, avg_cost: 5 }],
  staff: [{ clockIn: 'now' }], tables: [{ id: 1, attention: true, reservation: 'a' }],
};
let safetyBackups = 0, persisted = 0;
const reset = vm.createContext({
  $: id => elements.get(id), state: operationalState, verifyOwnerPassword: async password => password === 'valid',
  confirm: () => true, downloadSafetyBackup: () => { safetyBackups++; },
  rebuildIndex() {}, deleteLanOrder: async () => {}, persistNow: async () => { persisted++; return true; },
  renderActive() {}, updateTop() {}, setActionStatus() {}, alert() {},
  activeTableId: 1, lastPaidBill: 1,
});
vm.runInContext(part('function closeSettingsModal(', 'function openSettingsModal('), reset);
vm.runInContext(part('async function completeOperationalReset()', '// ===== END OPERATIONS PATCH ====='), reset);
await reset.completeOperationalReset();
assert.equal(safetyBackups, 0, 'Wrong password must block reset');
elements.get('fullResetPassword').value = 'valid';
elements.get('fullResetConfirm').value = 'WRONG';
await reset.completeOperationalReset();
assert.equal(safetyBackups, 0, 'Wrong phrase must block reset');
elements.get('fullResetConfirm').value = 'RESET TEA AMO';
await reset.completeOperationalReset();
assert.equal(safetyBackups, 1);
assert.equal(persisted, 1);
assert.equal(operationalState.bills.length, 0);
assert.equal(operationalState.ingredients[0].stock, 0);
assert.equal(operationalState.business, originalBusiness);
assert.equal(operationalState.business.payment_qr.eSewa, 'qr');
assert.equal(operationalState.menu.length, 1);
console.log('PASS operational reset: password and phrase guard, safety backup, configuration preserved');
console.log('Settings layout and controls OK');
