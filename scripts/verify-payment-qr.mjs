import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('public/js/owner/app.js', 'utf8');
const settings = readFileSync('public/owner/sections/settings.html', 'utf8');
const pos = readFileSync('public/owner/sections/pos.html', 'utf8');
for (const name of ['ESewa', 'Fonepay']) {
  assert.match(settings, new RegExp(`id="qrUpload${name}"`));
  assert.match(settings, new RegExp(`id="qrPreview${name}"`));
}
assert.match(settings, /Manage QR Codes/);
assert.match(pos, /id="mainPaymentQrUpload"/);
assert.match(pos, /id="mainPaymentQrFile"/);

const parts = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};
const classes = () => ({ toggle() {} });
const cards = new Map();
const elements = new Map();
for (const [method, id] of [['eSewa', 'qrPreviewESewa'], ['Khalti', 'qrPreviewKhalti'], ['Fonepay', 'qrPreviewFonepay']]) {
  const card = {
    empty: { classList: classes() }, status: { textContent: '', classList: classes() },
    upload: { textContent: '' }, clear: { disabled: false }, remove: { disabled: false },
    querySelector(selector) {
      return selector === '.qr-method-empty' ? this.empty
        : selector === '.qr-method-status' ? this.status
        : selector === '.qr-upload-btn' ? this.upload
        : selector === '.qr-more-actions button' ? this.clear
        : selector === '.qr-more-actions button:last-child' ? this.remove : null;
    },
  };
  cards.set(method, card);
  elements.set(id, { classList: classes(), closest: () => card, removeAttribute() {} });
}
const state = { business: { payment_methods: [{ name: 'Cash', kind: 'cash' }], payment_qr: {} } };
const alerts = [];
const context = vm.createContext({
  $: (id) => elements.get(id), state,
  paymentMethods: () => state.business.payment_methods,
  paymentQrFor: (method) => state.business.payment_qr[method] || '',
  imageFileToQrData: async () => 'data:image/jpeg;base64,test',
  persistNow: async () => true, renderPaymentMethodSettings() { context.renderQrSettings(); },
  updateMainPaymentQr() {}, pushLanConfig: async () => true,
  setActionStatus() {}, alert: (message) => alerts.push(message),
});
vm.runInContext(parts('function renderQrSettings()', 'async function setPaymentQr('), context);
vm.runInContext(parts('async function setPaymentQr(', 'async function clearPaymentQr('), context);
context.renderQrSettings();
assert.equal(cards.get('eSewa').upload.textContent, 'Enable & Upload QR');
assert.equal(cards.get('Fonepay').upload.textContent, 'Enable & Upload QR');
await context.setPaymentQr('eSewa', { type: 'image/png' });
await context.setPaymentQr('Fonepay', { type: 'image/png' });
assert.deepEqual(state.business.payment_methods.map(({ name }) => name), ['Cash', 'eSewa', 'Fonepay']);
assert.equal(cards.get('eSewa').upload.textContent, 'Replace QR');
assert.equal(cards.get('Fonepay').upload.textContent, 'Replace QR');
assert.equal(alerts.length, 0);
console.log('Admin QR OK: eSewa and Fonepay uploads remain available and restore removed methods');
