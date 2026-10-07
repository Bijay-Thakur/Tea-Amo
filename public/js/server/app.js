let cfg = null, activeTable = null, version = 0, dirty = false, order = blankOrder(), accessToken = '', saving = false, paying = false, attention = false, payMethod = 'Cash', tableFilter = 'all', view = 'tables', saveTimer = 0, saveQueued = false, toastTimer = 0;
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

function blankOrder() {
  return { cart: [], openedAt: null, customerId: null, discountType: 'percent', discountValue: 0, orderRef: '', orderType: 'Dine-in', guestCount: 1 };
}
function currency() { return cfg?.business?.currency || 'Rs'; }
function money(value) { return `${currency()} ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
function setNet(ok) {
  $('offlineBanner')?.classList.toggle('hidden', !!ok);
  $('navToggle')?.classList.toggle('offline', !ok);
}
function status(message, kind) {
  const text = message || 'Synced';
  if ($('orderStatus')) $('orderStatus').innerHTML = `<span class="${kind || ''}">${esc(text)}</span>`;
  if ($('paySync')) $('paySync').innerHTML = `<span class="${kind || ''}">${esc(text)}</span>`;
}

async function api(path, opt = {}) {
  const headers = { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}), ...(opt.headers || {}) };
  let response;
  try {
    response = await fetch(path, { ...opt, headers, credentials: 'include', cache: 'no-store' });
  } catch {
    setNet(false);
    throw new Error('Offline. Nothing was saved.');
  }
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (response.status === 401) {
    setNet(false);
    location.assign('/');
    throw new Error('Authentication expired');
  }
  if (!response.ok) {
    const error = new Error(data.error || ('HTTP ' + response.status));
    error.status = response.status;
    error.data = data;
    if (response.status !== 409) setNet(false);
    throw error;
  }
  setNet(true);
  return data;
}

function tableState(table) {
  const remote = cfg.orders?.[table.id];
  if (remote?.attention || table.attention) return 'attention';
  if (remote?.order?.cart?.some((item) => Number(item.qty) > 0) || table.seated) return 'occupied';
  if (table.reservation) return 'reserved';
  return 'available';
}
function sortedTables() {
  return [...(cfg.tables || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
}
function orderMoney(source) {
  const cart = source?.cart || [];
  let subtotal = 0;
  for (const line of cart) {
    const item = cfg.menu.find((row) => String(row.id) === String(line.id));
    subtotal += Number(item?.price || 0) * Number(line.qty || 0);
  }
  const type = source?.discountType || 'percent';
  const value = Math.max(0, Number(source?.discountValue || 0));
  const discount = type === 'amount' ? Math.min(value, subtotal) : subtotal * Math.min(value, 100) / 100;
  const tax = (subtotal - discount) * Number(cfg.business?.taxRate || 0) / 100;
  const count = cart.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  return { count, subtotal, discount, tax, total: subtotal - discount + tax };
}
function elapsedText(ts) {
  if (!ts) return '';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(ts)) / 60000));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
function tableDetail(table) {
  const state = tableState(table);
  const remote = cfg.orders?.[table.id]?.order;
  const totals = orderMoney(remote);
  if (state === 'reserved') return table.reservation?.guest || 'No guest name';
  if (state === 'occupied' || state === 'attention') {
    if (!totals.count) return 'Customer';
    const time = elapsedText(remote?.openedAt);
    return `${totals.count} item${totals.count === 1 ? '' : 's'} · ${money(totals.total)}${time ? ' · ' + time : ''}`;
  }
  return 'No customer';
}

function renderTables() {
  const label = { available: 'Available', occupied: 'Occupied', attention: 'Attention', reserved: 'Reserved' };
  $('floor').innerHTML = sortedTables().map((table) => {
    const state = tableState(table);
    return `<button type="button" class="floor-table ${state}" style="left:${Number(table.x)}%;top:${Number(table.y)}%;width:${Number(table.w)}%;height:${Number(table.h)}%" data-table="${esc(table.id)}" aria-label="${esc(table.name)} ${label[state]}"><span class="state">${label[state]}</span></button>`;
  }).join('');
  const counts = { all: sortedTables().length, available: 0, occupied: 0, reserved: 0, attention: 0 };
  sortedTables().forEach((table) => { counts[tableState(table)] += 1; });
  const filters = [['all', 'All'], ['available', 'Available'], ['occupied', 'Occupied'], ['reserved', 'Reserved']];
  $('tableFilters').innerHTML = filters.map(([key, name]) => {
    const count = key === 'all' ? counts.all : key === 'occupied' ? counts.occupied + counts.attention : counts[key];
    return `<button type="button" class="${tableFilter === key ? 'on' : ''}" data-filter="${key}">${name} (${count})</button>`;
  }).join('');
  const rows = sortedTables().filter((table) => tableFilter === 'all' || (tableFilter === 'occupied' ? ['occupied', 'attention'].includes(tableState(table)) : tableState(table) === tableFilter));
  $('tables').innerHTML = rows.map((table) => {
    const state = tableState(table);
    return `<button type="button" class="sv-table ${state}" data-table="${esc(table.id)}"><span class="sv-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 3h12a1 1 0 0 1 1 1v7H5V4a1 1 0 0 1 1-1zm-1 10h14v2H5v-2zm1.5 3h2v5h-2v-5zm9 0h2v5h-2v-5z"/></svg></span><span><b>${esc(table.name)}</b><span class="sv-state">${label[state]}</span><span class="sv-meta">${esc(tableDetail(table))}</span></span></button>`;
  }).join('') || '<div class="sv-empty">No tables in this view.</div>';
}

async function loadWorkspace() {
  cfg = await api('/api/server/workspace');
  $('business').textContent = (cfg.business?.name || 'TEA AMO') + (cfg.business?.branch ? ' · ' + cfg.business.branch : '');
  $('who').textContent = cfg.staff?.name || 'Server';
  if ($('profileName')) $('profileName').textContent = cfg.staff?.name || 'Server';
  if ($('profileBranch')) $('profileBranch').textContent = cfg.business?.branch || '';
  const methods = cfg.business?.payment_methods || ['Cash'];
  $('payment').innerHTML = methods.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  if (!methods.includes(payMethod)) payMethod = methods[0] || 'Cash';
  const categories = [...new Set((cfg.menu || []).map((item) => item.category || 'Menu'))];
  $('category').innerHTML = '<option value="">All</option>' + categories.map((category) => `<option>${esc(category)}</option>`).join('');
  renderCategoryChips();
  renderTables();
  renderMenu();
  renderPay();
  if (activeTable) {
    const latest = cfg.orders?.[activeTable.id];
    const fresh = cfg.tables.find((table) => String(table.id) === String(activeTable.id));
    if (fresh) activeTable = fresh;
    if (latest && !dirty && Number(latest.version) !== version) await refreshOrder();
    else if (!dirty && !latest && version) await refreshOrder();
  }
  updateBar();
}

function renderCategoryChips() {
  const categories = [...new Set((cfg?.menu || []).map((item) => item.category || 'Menu'))];
  const current = $('category').value;
  $('categoryChips').innerHTML = `<button type="button" class="${current ? '' : 'on'}" data-cat="">All</button>` + categories.map((category) => `<button type="button" class="${current === category ? 'on' : ''}" data-cat="${esc(category)}">${esc(category)}</button>`).join('');
}
function renderMenu() {
  if (!cfg) return;
  const query = $('menuSearch').value.trim().toLowerCase();
  const category = $('category').value;
  const rows = cfg.menu.filter((item) => (!query || item.name.toLowerCase().includes(query)) && (!category || item.category === category));
  $('menu').innerHTML = rows.map((item) => {
    const photo = item.image || item.photo || item.image_url || '';
    const visual = photo ? `<img alt="" src="${esc(photo)}">` : `<div class="sv-photo" aria-hidden="true">${esc(String(item.name || 'M').trim().charAt(0) || 'M')}</div>`;
    return `<article>${visual}<b>${esc(item.name)}</b><div class="muted">${esc(item.category || 'Menu')}</div><div>${money(item.price)}</div><button type="button" data-add="${esc(item.id)}">Add</button></article>`;
  }).join('') || '<div class="sv-empty">No menu items found.</div>';
}

function showView(next) {
  view = next;
  $('tableView').classList.toggle('hidden', next !== 'tables');
  $('orderView').classList.toggle('hidden', next !== 'order');
  $('payView').classList.toggle('hidden', next !== 'pay');
  $('profileView').classList.toggle('hidden', next !== 'profile');
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('on', button.dataset.tab === (next === 'pay' ? 'order' : next)));
  updateBar();
  if (next === 'pay') renderPay();
}
function updateBar() {
  const count = order.cart.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  const badge = $('tabBadge');
  if (badge) {
    badge.textContent = String(count);
    badge.classList.toggle('hidden', !activeTable || !count);
  }
  $('tabOrder')?.classList.toggle('is-empty', !activeTable);
  if ($('barCount')) $('barCount').textContent = count + ' item' + (count === 1 ? '' : 's');
  if ($('barTotal')) $('barTotal').textContent = money(calc().total);
  $('orderBar')?.classList.toggle('hidden', view !== 'order' || !count);
  if ($('orderHeading')) $('orderHeading').textContent = 'Current Order' + (count ? ` (${count} item${count === 1 ? '' : 's'})` : '');
  if ($('guestLabel')) $('guestLabel').textContent = Math.max(1, Number(order.guestCount || 1)) + ' guest' + (Number(order.guestCount || 1) === 1 ? '' : 's');
}

window.openTable = async (id, mode) => {
  activeTable = cfg.tables.find((table) => String(table.id) === String(id));
  if (!activeTable) return;
  closeSheet();
  $('tableTitle').textContent = activeTable.name;
  $('payTitle').textContent = activeTable.name;
  resetPayButton();
  await refreshOrder();
  showView(mode === 'pay' ? 'pay' : 'order');
};

async function leaveOrder() {
  if (dirty && !confirm('This order has unsaved changes. Leave the table without saving?')) return false;
  activeTable = null;
  showView('tables');
  await loadWorkspace().catch(() => {});
  return true;
}

async function refreshOrder() {
  if (!activeTable) return;
  const data = await api('/api/server/orders/' + encodeURIComponent(activeTable.id));
  version = Number(data.version || 0);
  order = data.order || blankOrder();
  if (!Array.isArray(order.cart)) order.cart = [];
  order.guestCount = Math.max(1, Number(order.guestCount || 1));
  order.discountType = order.discountType || 'percent';
  order.discountValue = Number(order.discountValue || 0);
  attention = !!data.attention || !!activeTable.attention;
  $('guestCount').value = order.guestCount;
  $('guestCountLabel').textContent = order.guestCount;
  $('discountType').value = order.discountType;
  $('discountValue').value = order.discountValue;
  dirty = false;
  status('Synced', 'good');
  renderCart();
  renderPay();
}

window.addItem = (id) => {
  const item = cfg.menu.find((row) => String(row.id) === String(id));
  if (!item || !activeTable) return;
  let line = order.cart.find((row) => String(row.id) === String(id));
  if (line) line.qty = Number(line.qty || 0) + 1;
  else order.cart.push({ id: item.id, qty: 1, served: 0 });
  if (!order.openedAt) order.openedAt = new Date().toISOString();
  scheduleSave();
  renderCart();
};
window.qty = (id, delta) => {
  const line = order.cart.find((row) => String(row.id) === String(id));
  if (!line) return;
  line.qty = Math.max(0, Number(line.qty || 0) + delta);
  line.served = Math.min(Number(line.served || 0), line.qty);
  if (!line.qty) order.cart = order.cart.filter((row) => row !== line);
  scheduleSave();
  renderCart();
};
function lineServed(line) { return Number(line.served || 0) >= Number(line.qty || 0) && Number(line.qty || 0) > 0; }
function serveLabel(line) {
  const qty = Number(line.qty || 0), served = Number(line.served || 0);
  if (served >= qty && qty > 0) return ['Served', 'served'];
  if (served > 0) return [`${served}/${qty} served`, 'partial'];
  return ['Waiting', 'waiting'];
}
function renderCart() {
  $('cart').innerHTML = order.cart.map((line) => {
    const item = cfg.menu.find((row) => String(row.id) === String(line.id));
    const [label, kind] = serveLabel(line);
    const id = esc(line.id);
    return `<div class="sv-line"><div><b>${esc(item?.name || 'Item')}</b><div class="muted">${line.qty} × ${money(item?.price || 0)}</div><button type="button" class="sv-status ${kind}" data-serve="${id}">${label}</button></div><div class="sv-qty"><button type="button" data-qty="${id}" data-delta="-1" aria-label="Decrease">−</button><b>${line.qty}</b><button type="button" data-qty="${id}" data-delta="1" aria-label="Increase">+</button></div></div>`;
  }).join('') || '<div class="sv-empty">No items yet.</div>';
  renderTotals();
  updateBillGate();
  updateBar();
}
function setServed(id, next) {
  const line = order.cart.find((row) => String(row.id) === String(id));
  if (!line) return;
  line.served = Math.max(0, Math.min(Number(line.qty || 0), Number(next)));
  closeSheet();
  renderCart();
  saveOrder();
}

function calc() { return orderMoney(order); }
function renderTotals() {
  const totals = calc();
  $('subtotal').textContent = money(totals.subtotal);
  $('discountAmount').textContent = '- ' + money(totals.discount);
  $('taxAmount').textContent = money(totals.tax);
  $('grandTotal').textContent = money(totals.total);
  const count = order.cart.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  if ($('payMeta')) $('payMeta').textContent = `${count} item${count === 1 ? '' : 's'} · ${Math.max(1, Number(order.guestCount || 1))} guest${Number(order.guestCount || 1) === 1 ? '' : 's'}`;
  updateCashPreview();
}
function scheduleSave() {
  dirty = true;
  status('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveOrder(), 650);
}
function applyForm() {
  order.guestCount = Math.max(1, Number($('guestCount').value || 1));
  order.discountType = $('discountType').value;
  order.discountValue = Math.max(0, Number($('discountValue').value || 0));
  $('guestCountLabel').textContent = order.guestCount;
  renderTotals();
  scheduleSave();
}

async function saveOrder() {
  if (!activeTable) return false;
  const hasItems = order.cart.some((line) => Number(line.qty) > 0);
  if (!hasItems && !version) {
    dirty = false;
    status('Synced', 'good');
    return true;
  }
  if (saving) { saveQueued = true; return false; }
  saving = true;
  $('saveOrder').disabled = true;
  order.guestCount = Math.max(1, Number($('guestCount').value || 1));
  order.discountType = $('discountType').value;
  order.discountValue = Math.max(0, Number($('discountValue').value || 0));
  status('Saving…');
  try {
    const data = await api('/api/ops/orders/' + encodeURIComponent(activeTable.id), {
      method: 'PUT',
      body: JSON.stringify({
        expected_version: version,
        attention: !!attention,
        guest_count: order.guestCount,
        discount_type: order.discountType,
        discount_value: order.discountValue,
        opened_at: order.openedAt,
        order_ref: activeTable.name,
        items: order.cart.map((line) => ({ menu_item_id: String(line.id), qty: Number(line.qty), served_qty: Number(line.served || 0) }))
      })
    });
    version = Number(data.version || 0);
    dirty = false;
    status(data.deleted ? 'Synced' : 'Synced', 'good');
    if (!cfg.orders) cfg.orders = {};
    if (data.deleted) delete cfg.orders[activeTable.id];
    else cfg.orders[activeTable.id] = { version, attention: !!attention, order };
    if (activeTable) activeTable.attention = !!attention && !data.deleted;
    return true;
  } catch (error) {
    saveQueued = false;
    if (error.status === 409) {
      status('This order changed on another device. Updating…', 'warn');
      await refreshOrder();
    } else status(error.message, 'bad');
    return false;
  } finally {
    saving = false;
    $('saveOrder').disabled = false;
    if (saveQueued) { saveQueued = false; return saveOrder(); }
  }
}

let billPass = { sig: '', ok: false, skipped: false };
function billSignature() { return (activeTable?.id || '') + '|' + order.cart.map((line) => `${line.id}:${line.qty}`).join(','); }
function billAccepted() { return billPass.ok && billPass.sig === billSignature(); }
function updateBillGate() {
  const note = $('billGateNote');
  const ready = billAccepted();
  if (note) note.textContent = !order.cart.length
    ? 'Add items, then print the bill or skip it.'
    : ready
      ? (billPass.skipped ? 'Bill skipped. You can take payment.' : 'Bill printed. You can take payment.')
      : 'Print the bill before payment, or skip the bill and pay directly.';
  const button = $('completePay');
  if (button && !button.classList.contains('pay-done')) button.disabled = !ready || paying;
}
function markBill(skipped) { billPass = { sig: billSignature(), ok: true, skipped }; updateBillGate(); }
function staffBillHtml() {
  const totals = calc();
  const lines = order.cart.map((line) => {
    const item = cfg.menu.find((row) => String(row.id) === String(line.id));
    const price = Number(item?.price || 0);
    return `<tr><td>${esc(item?.name || 'Item')}<div>${line.qty} × ${money(price)}</div></td><td class="num">${money(price * Number(line.qty || 0))}</td></tr>`;
  }).join('');
  return `<div class="print-logo">${esc(cfg.business?.name || 'TEA AMO')}</div><div class="print-subtitle">${esc(cfg.business?.branch || '')}</div><div class="print-title">CUSTOMER BILL</div><div class="print-meta"><div class="print-meta-row"><span>Table</span><b>${esc(activeTable?.name || '')}</b></div><div class="print-meta-row"><span>Status</span><b>UNPAID</b></div></div><table class="print-table"><thead><tr><th>Item</th><th class="num">Amount</th></tr></thead><tbody>${lines}</tbody></table><div class="print-summary"><div class="print-summary-row"><span>Subtotal</span><b>${money(totals.subtotal)}</b></div><div class="print-summary-row"><span>Discount</span><b>- ${money(totals.discount)}</b></div><div class="print-summary-row"><span>Tax</span><b>${money(totals.tax)}</b></div><div class="print-summary-row total"><span>TOTAL</span><b>${money(totals.total)}</b></div></div><div class="print-footer">Please keep this bill. Payment is collected after printing.</div>`;
}
function printStaffBill() {
  if (!order.cart.length) return toast('Add items before printing the bill.');
  $('staffBill').innerHTML = staffBillHtml();
  document.body.classList.add('printing-bill');
  markBill(false);
  window.print();
  setTimeout(() => document.body.classList.remove('printing-bill'), 400);
}
function resetPayButton() {
  const button = $('completePay');
  if (!button) return;
  button.textContent = 'Complete Payment';
  button.classList.remove('pay-done');
  billPass = { sig: '', ok: false, skipped: false };
  updateBillGate();
}
function markPaid() {
  const button = $('completePay');
  button.textContent = 'Completed';
  button.classList.add('pay-done');
  button.disabled = true;
}
function updateCashPreview() {
  const box = $('changeBox');
  if (!box) return;
  const total = calc().total;
  const raw = $('cashReceived')?.value;
  const received = raw === '' || raw == null ? 0 : Number(raw);
  const short = payMethod === 'Cash' && raw !== '' && received + 0.009 < total;
  box.classList.toggle('short', short);
  $('changeDue').textContent = short ? 'Short ' + money(total - received) : money(Math.max(0, received - total));
}
function renderPay() {
  if (!cfg) return;
  const methods = cfg.business?.payment_methods || ['Cash'];
  if (!methods.includes(payMethod)) payMethod = methods[0] || 'Cash';
  $('payMethods').innerHTML = methods.map((name) => `<button type="button" class="${name === payMethod ? 'on' : ''}" data-method="${esc(name)}" role="radio" aria-checked="${name === payMethod ? 'true' : 'false'}">${esc(name)}</button>`).join('');
  $('payment').value = payMethod;
  const cash = String(payMethod).toLowerCase() === 'cash';
  $('cashBox').classList.toggle('hidden', !cash);
  const qr = cfg.business?.payment_qr?.[payMethod] || '';
  $('qrBox').classList.toggle('hidden', cash || !qr);
  if (qr && !cash) {
    $('payQr').src = qr;
    $('qrNote').textContent = 'Ask the guest to scan this ' + payMethod + ' QR.';
  }
  updateCashPreview();
  updateBillGate();
}
function cashPayload() {
  const total = calc().total;
  if (String(payMethod).toLowerCase() !== 'cash') return { cash_received: 0, change_due: 0 };
  const raw = $('cashReceived').value;
  const received = raw === '' ? total : Number(raw);
  if (!Number.isFinite(received) || received < total - 0.009) throw new Error('Cash received is less than the amount due.');
  return { cash_received: received, change_due: Math.max(0, received - total) };
}
async function takePayment() {
  if (paying || !activeTable || !order.cart.length) return toast('Add items first.');
  if (!billAccepted()) return toast('Print the bill first, or choose Skip Bill.');
  if (!navigator.onLine) return toast('Offline. Payment was not taken.');
  let cash;
  try { cash = cashPayload(); } catch (error) { return toast(error.message); }
  paying = true;
  const button = $('completePay');
  button.disabled = true;
  button.textContent = 'Processing Payment…';
  const key = crypto.randomUUID();
  try {
    const saved = await saveOrder();
    if (!saved) { resetPayButton(); return; }
    status('Confirming payment…');
    const data = await api('/api/ops/payments', {
      method: 'POST',
      body: JSON.stringify({
        idempotency_key: key,
        table_id: activeTable.id,
        expected_version: version,
        items: order.cart.map((line) => ({ menu_item_id: String(line.id), qty: Number(line.qty) })),
        payment: payMethod,
        payments: { [payMethod]: calc().total },
        cash_received: cash.cash_received,
        change_due: cash.change_due
      })
    });
    if (!data.bill?.id) throw new Error('Payment was not confirmed.');
    status('Payment completed', 'good');
    markPaid();
    toast('Payment complete');
    dirty = false;
    if (cfg.orders) delete cfg.orders[activeTable.id];
    const table = activeTable;
    if (table) { table.seated = false; table.attention = false; }
    await loadWorkspace();
    setTimeout(() => {
      if (activeTable !== table) return;
      activeTable = null;
      order = blankOrder();
      showView('tables');
      resetPayButton();
      if ($('cashReceived')) $('cashReceived').value = '';
    }, 700);
  } catch (error) {
    status(error.status === 409 ? 'This order changed on another device. Updating…' : error.message, 'bad');
    toast(error.status === 409 ? 'This order changed on another device. Updating…' : 'Payment failed. ' + error.message);
    resetPayButton();
    if (error.status === 409) await refreshOrder().catch(() => {});
  } finally {
    paying = false;
  }
}

function closeSheet() {
  $('actionSheet').classList.add('hidden');
  document.body.style.overflow = '';
}
function openSheet(title, meta, actions) {
  $('sheetTitle').textContent = title;
  $('sheetMeta').textContent = meta;
  $('sheetActions').innerHTML = actions.map((action) => `<button type="button" class="${action.danger ? 'danger' : ''}" data-action="${esc(action.id)}"><span><b>${esc(action.label)}</b>${action.hint ? `<small>${esc(action.hint)}</small>` : ''}</span><span aria-hidden="true">›</span></button>`).join('');
  $('sheetActions').dataset.serve = '';
  $('actionSheet').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function openTableSheet(id) {
  const table = cfg.tables.find((row) => String(row.id) === String(id));
  if (!table) return;
  const state = tableState(table);
  const remote = cfg.orders?.[table.id]?.order;
  const totals = orderMoney(remote);
  const labels = { available: 'Available', occupied: 'Occupied', attention: 'Attention', reserved: 'Reserved' };
  const meta = [labels[state], tableDetail(table)].filter(Boolean).join(' · ');
  const actions = [];
  if (state === 'available') {
    actions.push({ id: 'start', label: 'Start Order', hint: 'Open an order and mark the table occupied' });
    actions.push({ id: 'reserve', label: 'Reservation', hint: 'Hold this table for a guest' });
  } else if (state === 'reserved') {
    actions.push({ id: 'reserve', label: 'View Reservation', hint: table.reservation?.guest || 'Reservation details' });
    actions.push({ id: 'seat', label: 'Seat Guests', hint: 'Start the order for this reservation' });
    actions.push({ id: 'cancel-reserve', label: 'Cancel Reservation', hint: 'Clear this reservation', danger: true });
  } else if (state === 'attention') {
    actions.push({ id: 'open', label: 'Open Order', hint: 'View and add items' });
    if (totals.count) actions.push({ id: 'pay', label: 'Take Payment', hint: money(totals.total) });
    actions.push({ id: 'resolve', label: 'Resolve Attention', hint: 'Clear the attention flag' });
  } else {
    actions.push({ id: 'open', label: 'Open Order', hint: 'View and add items' });
    if (totals.count) actions.push({ id: 'pay', label: 'Take Payment', hint: money(totals.total) });
    actions.push({ id: 'reserve', label: 'Reservation', hint: 'Add or manage a reservation' });
    actions.push({ id: 'attention', label: 'Mark Attention', hint: 'Flag this table for staff' });
    actions.push({ id: 'release', label: 'Release Table', hint: totals.count ? 'Blocked while an order is unpaid' : 'Mark the table available', danger: true });
  }
  openSheet(table.name, meta, actions);
  $('sheetActions').dataset.table = table.id;
}

let reserveTableId = '';
function openReserve(id) {
  const table = cfg.tables.find((row) => String(row.id) === String(id));
  if (!table) return;
  closeSheet();
  reserveTableId = table.id;
  const current = table.reservation || {};
  $('reserveTitle').textContent = 'Reservation · ' + table.name;
  $('reserveGuest').value = current.guest || '';
  $('reservePhone').value = current.phone || '';
  $('reserveTime').value = current.time || '';
  $('reserveParty').value = current.party || table.seats || 1;
  $('reserveNote').value = current.note || '';
  $('reserveSheet').classList.remove('hidden');
}
async function postTable(id, action, extra = {}) {
  const data = await api('/api/server/tables/' + encodeURIComponent(id), {
    method: 'POST',
    body: JSON.stringify({ action, ...extra })
  });
  await loadWorkspace();
  return data;
}
async function runSheetAction(id, action) {
  const table = cfg.tables.find((row) => String(row.id) === String(id));
  if (!table) return;
  const totals = orderMoney(cfg.orders?.[id]?.order);
  if (action === 'start' || action === 'seat') {
    await postTable(id, 'occupy');
    await openTable(id);
    return;
  }
  if (action === 'open') return openTable(id);
  if (action === 'pay') return openTable(id, 'pay');
  if (action === 'reserve') return openReserve(id);
  if (action === 'cancel-reserve') {
    if (!confirm('Cancel this reservation?')) return;
    await postTable(id, 'reserve', { reservation: null });
    closeSheet();
    toast('Reservation cancelled');
    return;
  }
  if (action === 'attention' || action === 'resolve') {
    const on = action === 'attention';
    await postTable(id, 'attention', { attention: on });
    if (activeTable && String(activeTable.id) === String(id)) {
      attention = on;
      if (order.cart.some((line) => Number(line.qty) > 0)) await saveOrder();
    }
    closeSheet();
    toast(on ? 'Table marked for attention' : 'Attention cleared');
    return;
  }
  if (action === 'release') {
    if (totals.count) {
      closeSheet();
      toast('This table has an unpaid order. Take payment before releasing it.');
      return;
    }
    if (!confirm('Release this table and mark it available?')) return;
    try {
      await postTable(id, 'leave');
      closeSheet();
      toast('Table released');
    } catch (error) {
      toast(error.message);
    }
  }
}

function openServeSheet(id) {
  const line = order.cart.find((row) => String(row.id) === String(id));
  const item = cfg.menu.find((row) => String(row.id) === String(id));
  if (!line) return;
  openSheet(item?.name || 'Item', serveLabel(line)[0], [
    { id: 'one', label: 'Mark one served', hint: 'Serve a single unit' },
    { id: 'all', label: 'Mark all served', hint: 'Serve the full quantity' },
    { id: 'undo', label: 'Undo served', hint: 'Mark this item as waiting' }
  ]);
  $('sheetActions').dataset.serve = id;
  $('sheetActions').dataset.table = '';
}

$('floor').onclick = (event) => {
  const id = event.target.closest('[data-table]')?.dataset.table;
  if (id) openTableSheet(id);
};
$('tables').onclick = (event) => {
  const id = event.target.closest('[data-table]')?.dataset.table;
  if (id) openTableSheet(id);
};
$('tableFilters').onclick = (event) => {
  const key = event.target.closest('[data-filter]')?.dataset.filter;
  if (!key) return;
  tableFilter = key;
  renderTables();
};
$('sheetActions').onclick = async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const serveId = $('sheetActions').dataset.serve;
  if (serveId) {
    const line = order.cart.find((row) => String(row.id) === String(serveId));
    if (!line) return closeSheet();
    if (button.dataset.action === 'one') setServed(serveId, Number(line.served || 0) + 1);
    else if (button.dataset.action === 'all') setServed(serveId, Number(line.qty || 0));
    else setServed(serveId, 0);
    $('sheetActions').dataset.serve = '';
    return;
  }
  const id = $('sheetActions').dataset.table;
  try { await runSheetAction(id, button.dataset.action); }
  catch (error) { toast(error.message); }
};
$('sheetClose').onclick = closeSheet;
$('sheetBackdrop').onclick = closeSheet;
$('cart').onclick = (event) => {
  const serve = event.target.closest('[data-serve]')?.dataset.serve;
  if (serve) return openServeSheet(serve);
  const qtyButton = event.target.closest('[data-qty]');
  if (qtyButton) qty(qtyButton.dataset.qty, Number(qtyButton.dataset.delta));
};
$('menu').onclick = (event) => {
  const id = event.target.closest('[data-add]')?.dataset.add;
  if (id) addItem(id);
};
$('categoryChips').onclick = (event) => {
  const chip = event.target.closest('[data-cat]');
  if (!chip) return;
  $('category').value = chip.dataset.cat || '';
  renderCategoryChips();
  renderMenu();
};
$('menuSearch').oninput = renderMenu;
$('backTables').onclick = () => leaveOrder();
$('payBack').onclick = () => showView('order');
$('barCheckout').onclick = () => { if (order.cart.length) showView('pay'); };
$('guestMinus').onclick = () => { $('guestCount').value = Math.max(1, Number($('guestCount').value || 1) - 1); applyForm(); };
$('guestPlus').onclick = () => { $('guestCount').value = Math.max(1, Number($('guestCount').value || 1) + 1); applyForm(); };
$('discountType').onchange = applyForm;
$('discountValue').oninput = applyForm;
$('cashReceived').oninput = updateCashPreview;
$('payMethods').onclick = (event) => {
  const method = event.target.closest('[data-method]')?.dataset.method;
  if (!method) return;
  payMethod = method;
  renderPay();
};
$('saveOrder').onclick = () => saveOrder().then((ok) => { if (ok) toast('Order saved'); });
$('printBill').onclick = printStaffBill;
$('skipBill').onclick = () => { if (!order.cart.length) return toast('Add items first.'); markBill(true); toast('Bill skipped'); };
$('completePay').onclick = takePayment;
$('reloadConfig').onclick = () => { closeMenu(); loadWorkspace().then(() => toast('Refreshed')).catch((error) => toast(error.message)); };
$('profileRefresh').onclick = () => loadWorkspace().then(() => toast('Refreshed')).catch((error) => toast(error.message));
async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  location.assign('/');
}
$('logout').onclick = logout;
$('profileLogout').onclick = logout;
function closeMenu() { $('navSheet').classList.add('hidden'); $('navToggle').setAttribute('aria-expanded', 'false'); }
$('navToggle').onclick = (event) => {
  event.stopPropagation();
  const hidden = $('navSheet').classList.toggle('hidden');
  $('navToggle').setAttribute('aria-expanded', String(!hidden));
};
$('navSheet').onclick = (event) => {
  if (event.target.closest('[data-go="profile"]')) { closeMenu(); showView('profile'); }
};
document.addEventListener('click', (event) => { if (!event.target.closest('#navSheet') && event.target !== $('navToggle')) closeMenu(); });
document.querySelectorAll('[data-tab]').forEach((button) => {
  button.onclick = () => {
    const tab = button.dataset.tab;
    if (tab === 'order') {
      if (!activeTable) return toast('Open a table to see the current order.');
      showView(view === 'pay' ? 'pay' : 'order');
      return;
    }
    showView(tab);
  };
});
$('reserveClose').onclick = () => $('reserveSheet').classList.add('hidden');
$('reserveBackdrop').onclick = () => $('reserveSheet').classList.add('hidden');
$('reserveClear').onclick = async () => {
  if (!reserveTableId) return;
  try {
    await postTable(reserveTableId, 'reserve', { reservation: null });
    $('reserveSheet').classList.add('hidden');
    toast('Reservation cancelled');
  } catch (error) { toast(error.message); }
};
$('reserveForm').onsubmit = async (event) => {
  event.preventDefault();
  if (!reserveTableId) return;
  try {
    await postTable(reserveTableId, 'reserve', {
      reservation: {
        guest: $('reserveGuest').value,
        phone: $('reservePhone').value,
        time: $('reserveTime').value,
        party: $('reserveParty').value,
        note: $('reserveNote').value
      }
    });
    $('reserveSheet').classList.add('hidden');
    toast('Reservation saved');
  } catch (error) { toast(error.message); }
};
if (window.visualViewport) {
  const syncInset = () => {
    const inset = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
    document.documentElement.style.setProperty('--kb', inset + 'px');
  };
  window.visualViewport.addEventListener('resize', syncInset);
  window.visualViewport.addEventListener('scroll', syncInset);
}
window.addEventListener('online', () => setNet(true));
window.addEventListener('offline', () => setNet(false));

async function boot() {
  const session = await api('/api/auth/session');
  if (session.role !== 'server_staff') {
    location.assign(session.home || '/');
    return;
  }
  accessToken = session.access_token || '';
  await loadWorkspace();
  showView('tables');
  setInterval(() => api('/api/server/presence', { method: 'POST', body: '{}' }).catch(() => {}), 30000);
  api('/api/server/presence', { method: 'POST', body: '{}' }).catch(() => {});
  let realtime = false;
  function startFallbackPoll() {
    if (realtime || window.__teaServerPoll) return;
    window.__teaServerPoll = setInterval(() => {
      if (document.visibilityState !== 'visible' || dirty) return;
      loadWorkspace().catch(() => setNet(false));
    }, 4000);
  }
  try {
    const config = await api('/api/auth/config');
    if (window.supabase && accessToken && session.refresh_token) {
      const client = window.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: false } });
      await client.auth.setSession({ access_token: accessToken, refresh_token: session.refresh_token });
      client.channel('tea-amo-server')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'live_orders' }, () => { if (!dirty) loadWorkspace().catch(() => setNet(false)); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => { if (!dirty && activeTable) refreshOrder().catch(() => {}); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cafe_tables' }, () => { if (!dirty) loadWorkspace().catch(() => {}); })
        .subscribe((state) => {
          if (state === 'SUBSCRIBED') { realtime = true; setNet(true); }
          if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') { setNet(false); startFallbackPoll(); }
        });
    } else startFallbackPoll();
  } catch (error) {
    console.error(error);
    setNet(false);
    startFallbackPoll();
  }
}

boot().catch((error) => {
  setNet(false);
  $('business').textContent = error.message || 'Could not open the Server workspace';
});
