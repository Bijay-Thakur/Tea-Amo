let cfg = null, activeTable = null, version = 0, dirty = false, order = blankOrder(), accessToken = '', saving = false, paying = false;
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

function blankOrder() {
  return { cart: [], openedAt: null, customerId: null, discountType: 'percent', discountValue: 0, orderRef: '', orderType: 'Dine-in', guestCount: 1 };
}
function currency() { return cfg?.business?.currency || 'Rs'; }
function money(value) { return `${currency()} ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
function setNet(ok) {
  $('navToggle')?.classList.toggle('offline', !ok);
}
function status(message, kind) {
  $('drawerStatus').innerHTML = `<span class="${kind || ''}">${esc(message)}</span>`;
  $('orderStatus').textContent = message;
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
  setNet(true, 'Online');
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
function renderTables() {
  const label = { available: 'Available', occupied: 'Occupied', attention: 'Attention', reserved: 'Reserved' };
  $('floor').innerHTML = sortedTables().map((table) => {
    const state = tableState(table);
    return `<button type="button" class="floor-table ${state}" style="left:${Number(table.x)}%;top:${Number(table.y)}%;width:${Number(table.w)}%;height:${Number(table.h)}%" onclick="openTable('${esc(table.id)}')"><span class="state">${label[state]}</span></button>`;
  }).join('');
  $('tables').innerHTML = sortedTables().map((table) => tableButton(table, `openTable('${esc(table.id)}')`)).join('') || '<div class="muted">No active tables.</div>';
}
function tableButton(table, handler) {
  const state = tableState(table);
  const label = { available: 'Available', occupied: 'Occupied', attention: 'Needs attention', reserved: 'Reserved' };
  const remote = cfg.orders?.[table.id];
  const count = (remote?.order?.cart || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const detail = state === 'occupied' && count ? `${label[state]} · ${count} item${count === 1 ? '' : 's'}` : label[state];
  return `<button type="button" class="table-chip ${state}" onclick="${handler}"><b>${esc(table.name)}</b><span>${esc(detail)}</span></button>`;
}

async function loadWorkspace() {
  cfg = await api('/api/server/workspace');
  $('business').textContent = (cfg.business?.name || 'TEA AMO') + (cfg.business?.branch ? ' · ' + cfg.business.branch : '');
  $('who').textContent = cfg.staff?.name || 'Server';
  const methods = cfg.business?.payment_methods || ['Cash'];
  $('payment').innerHTML = methods.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  const categories = [...new Set((cfg.menu || []).map((item) => item.category || 'Menu'))];
  $('category').innerHTML = '<option value="">All categories</option>' + categories.map((category) => `<option>${esc(category)}</option>`).join('');
  renderTables();
  renderMenu();
  renderPaymentQr();
  if (activeTable) {
    const latest = cfg.orders?.[activeTable.id];
    if (latest && !dirty && Number(latest.version) !== version) await refreshOrder();
  }
}

function renderMenu() {
  if (!cfg) return;
  const query = $('menuSearch').value.trim().toLowerCase();
  const category = $('category').value;
  const rows = cfg.menu.filter((item) => (!query || item.name.toLowerCase().includes(query)) && (!category || item.category === category));
  $('menu').innerHTML = rows.map((item) => `<div class="item"><div class="item-name">${esc(item.name)}</div><div class="item-cat">${esc(item.category || 'Menu')}</div><div class="item-price">${money(item.price)}</div><button type="button" onclick="addItem('${esc(item.id)}')">Add</button></div>`).join('') || '<div class="empty">No menu items match your search.</div>';
}

window.openTable = async (id, mode) => {
  activeTable = cfg.tables.find((table) => String(table.id) === String(id));
  if (!activeTable) return;
  $('tableView').classList.add('hidden');
  $('orderView').classList.remove('hidden');
  resetPayButton();
  $('tableTitle').textContent = activeTable.name + ' Order';
  $('drawerTable').textContent = activeTable.name + ' · Current Order';
  $('drawerTitle').textContent = activeTable.name + ' · Current Order';
  $('drawerBar').classList.remove('hidden');
  await refreshOrder();
  if (mode === 'pay') openDrawer();
};

$('backTables').onclick = async () => {
  if (dirty && !confirm('This order has unsaved changes. Leave the table without saving?')) return;
  closeDrawer();
  activeTable = null;
  $('orderView').classList.add('hidden');
  $('tableView').classList.remove('hidden');
  $('drawerBar').classList.add('hidden');
  await loadWorkspace().catch(() => {});
};

async function refreshOrder() {
  if (!activeTable) return;
  setNet(true, 'Syncing');
  const data = await api('/api/server/orders/' + encodeURIComponent(activeTable.id));
  version = Number(data.version || 0);
  order = data.order || blankOrder();
  if (!Array.isArray(order.cart)) order.cart = [];
  order.guestCount = Math.max(1, Number(order.guestCount || 1));
  order.discountType = order.discountType || 'percent';
  order.discountValue = Number(order.discountValue || 0);
  $('guestCount').value = order.guestCount;
  $('discountType').value = order.discountType;
  $('discountValue').value = order.discountValue;
  dirty = false;
  $('drawerUnsaved').textContent = 'Synced';
  $('drawerVersion').textContent = 'Synced · version ' + version;
  status('Synced', 'good');
  renderCart();
  setNet(true, 'Online');
}

window.addItem = (id) => {
  const item = cfg.menu.find((row) => String(row.id) === String(id));
  if (!item) return;
  let line = order.cart.find((row) => String(row.id) === String(id));
  if (line) line.qty = Number(line.qty || 0) + 1;
  else order.cart.push({ id: item.id, qty: 1, served: 0 });
  if (!order.openedAt) order.openedAt = new Date().toISOString();
  markDirty();
  renderCart();
};
window.qty = (id, delta) => {
  const line = order.cart.find((row) => String(row.id) === String(id));
  if (!line) return;
  line.qty = Math.max(0, Number(line.qty || 0) + delta);
  line.served = Math.min(Number(line.served || 0), line.qty);
  if (!line.qty) order.cart = order.cart.filter((row) => row !== line);
  markDirty();
  renderCart();
};
function renderCart() {
  const rows = order.cart.map((line) => {
    const item = cfg.menu.find((row) => String(row.id) === String(line.id));
    return `<div class="cartline"><div><b>${esc(item?.name || 'Item')}</b><div class="muted">${money(item?.price || 0)} each</div></div><div class="cart-actions"><button class="alt" type="button" onclick="qty('${esc(line.id)}',-1)">−</button><span class="pill">${line.qty}</span><button type="button" onclick="qty('${esc(line.id)}',1)">+</button></div></div>`;
  }).join('');
  $('cart').innerHTML = rows || '<div class="empty">No items yet. Close this drawer and add items from the menu.</div>';
  renderTotals();
}

function calc() {
  let subtotal = 0;
  for (const line of order.cart) {
    const item = cfg.menu.find((row) => String(row.id) === String(line.id));
    subtotal += Number(item?.price || 0) * Number(line.qty || 0);
  }
  const value = Math.max(0, Number(order.discountValue || 0));
  const discount = order.discountType === 'amount' ? Math.min(value, subtotal) : subtotal * Math.min(value, 100) / 100;
  const tax = (subtotal - discount) * Number(cfg.business?.taxRate || 0) / 100;
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}
function renderTotals() {
  const totals = calc();
  const count = order.cart.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  $('drawerCount').textContent = count + ' item' + (count === 1 ? '' : 's');
  $('drawerTotal').textContent = money(totals.total);
  $('subtotal').textContent = money(totals.subtotal);
  $('discountAmount').textContent = '- ' + money(totals.discount);
  $('taxAmount').textContent = money(totals.tax);
  $('grandTotal').textContent = money(totals.total);
}
function markDirty() {
  dirty = true;
  $('drawerUnsaved').textContent = 'Unsaved';
  status('Unsaved changes — tap Save Order.', 'warn');
}
function applyForm() {
  order.guestCount = Math.max(1, Number($('guestCount').value || 1));
  order.discountType = $('discountType').value;
  order.discountValue = Math.max(0, Number($('discountValue').value || 0));
  renderPaymentQr();
  markDirty();
  renderTotals();
}
function renderPaymentQr() {
  if (!cfg) return;
  const method = $('payment').value;
  const qr = cfg.business?.payment_qr?.[method] || '';
  if (qr) {
    $('paymentQrImage').src = qr;
    $('paymentQrTitle').textContent = method + ' · Scan to Pay';
    $('paymentQr').classList.remove('hidden');
  } else $('paymentQr').classList.add('hidden');
}

async function saveOrder() {
  if (!activeTable || saving) return false;
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
        attention: false,
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
    $('drawerUnsaved').textContent = 'Saved';
    $('drawerVersion').textContent = 'Saved · version ' + version;
    status('Saved', 'good');
    if (!cfg.orders) cfg.orders = {};
    if (data.deleted) delete cfg.orders[activeTable.id];
    else cfg.orders[activeTable.id] = { version, attention: false, order };
    return true;
  } catch (error) {
    if (error.status === 409) {
      status('Conflict. Loading the latest order…', 'bad');
      await refreshOrder();
    } else status(error.message, 'bad');
    return false;
  } finally {
    saving = false;
    $('saveOrder').disabled = false;
  }
}

$('saveOrder').onclick = () => saveOrder();
$('refreshOrder').onclick = () => {
  if (dirty && !confirm('Discard unsaved changes and reload this table?')) return;
  refreshOrder().catch((error) => status(error.message, 'bad'));
};
function resetPayButton() {
  const button = $('payOrder');
  button.textContent = 'Payment';
  button.className = 'pay-pending';
  button.disabled = false;
}
function markPaid() {
  const button = $('payOrder');
  button.textContent = 'Completed';
  button.className = 'pay-done';
  button.disabled = true;
}
$('payOrder').onclick = async () => {
  if (paying || !activeTable || !order.cart.length) return alert('Add items first.');
  if (!confirm(`Take ${$('payment').value} payment for ${activeTable.name}?`)) return;
  paying = true;
  $('payOrder').disabled = true;
  const key = crypto.randomUUID();
  try {
    const saved = await saveOrder();
    if (!saved) return;
    status('Confirming payment…');
    const data = await api('/api/ops/payments', {
      method: 'POST',
      body: JSON.stringify({
        idempotency_key: key,
        table_id: activeTable.id,
        expected_version: version,
        items: order.cart.map((line) => ({ menu_item_id: String(line.id), qty: Number(line.qty) })),
        payment: $('payment').value || 'Cash',
        payments: { [$('payment').value || 'Cash']: calc().total }
      })
    });
    if (!data.bill?.id) throw new Error('Payment was not confirmed.');
    status('Payment completed', 'good');
    markPaid();
    dirty = false;
    if (cfg.orders) delete cfg.orders[activeTable.id];
    const table = activeTable;
    if (table) table.seated = false;
    await loadWorkspace();
    setTimeout(() => {
      if (activeTable !== table) return;
      closeDrawer();
      activeTable = null;
      $('orderView').classList.add('hidden');
      $('tableView').classList.remove('hidden');
      $('drawerBar').classList.add('hidden');
      resetPayButton();
    }, 900);
  } catch (error) {
    status(error.status === 409 ? 'Payment failed. Another payment or edit won. The table was refreshed.' : 'Payment failed. ' + error.message, 'bad');
    resetPayButton();
    if (error.status === 409) await refreshOrder().catch(() => {});
  } finally {
    paying = false;
  }
};

function openDrawer() { $('orderDrawer').classList.remove('hidden'); $('drawerBar').classList.add('hidden'); document.body.style.overflow = 'hidden'; }
function closeDrawer() { $('orderDrawer').classList.add('hidden'); if (activeTable) $('drawerBar').classList.remove('hidden'); document.body.style.overflow = ''; }
$('openDrawer').onclick = openDrawer;
$('closeDrawer').onclick = closeDrawer;
$('guestCount').oninput = applyForm;
$('discountType').onchange = applyForm;
$('discountValue').oninput = applyForm;
$('payment').onchange = renderPaymentQr;
$('menuSearch').oninput = renderMenu;
$('category').onchange = renderMenu;
$('reloadConfig').onclick = () => loadWorkspace().catch((error) => alert(error.message));
$('logout').onclick = async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  location.assign('/');
};
let pickerAction = '';
let reserveTableId = '';
function closePicker() { $('picker').classList.add('hidden'); }
function openPicker(action) {
  pickerAction = action;
  const titles = {
    occupy: 'Which table is occupied?',
    leave: 'Which table was left?',
    reserve: 'Reserve which table?',
    add: 'Add an item to which table?',
    pay: 'Take payment for which table?'
  };
  $('pickerTitle').textContent = titles[action] || 'Choose a table';
  const tables = sortedTables().filter((table) => {
    const state = tableState(table);
    const count = (cfg.orders?.[table.id]?.order?.cart || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
    if (action === 'occupy') return state === 'available' || state === 'reserved';
    if (action === 'leave') return state === 'occupied' || state === 'attention';
    if (action === 'pay') return count > 0;
    return true;
  });
  $('pickerList').innerHTML = tables.length
    ? tables.map((table) => {
        const state = tableState(table);
        const label = { available: 'Available', occupied: 'Occupied', attention: 'Needs attention', reserved: 'Reserved' };
        const count = (cfg.orders?.[table.id]?.order?.cart || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
        const detail = state === 'occupied' && count ? `${label[state]} · ${count} item${count === 1 ? '' : 's'}` : label[state];
        return `<button type="button" class="table-chip ${state}" data-pick="${esc(table.id)}"><b>${esc(table.name)}</b><span>${esc(detail)}</span></button>`;
      }).join('')
    : '<div class="muted">No tables match this action.</div>';
  $('picker').classList.remove('hidden');
}
function openReserve(id) {
  const table = cfg.tables.find((row) => String(row.id) === String(id));
  if (!table) return;
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
async function postTable(id, action, reservation) {
  const data = await api('/api/server/tables/' + encodeURIComponent(id), {
    method: 'POST',
    body: JSON.stringify({ action, reservation: reservation === undefined ? null : reservation })
  });
  await loadWorkspace();
  return data;
}
$('navToggle').onclick = () => {
  const hidden = $('navSheet').classList.toggle('hidden');
  $('navToggle').setAttribute('aria-expanded', String(!hidden));
};
$('navSheet').onclick = (event) => {
  const action = event.target.closest('[data-nav]')?.dataset.nav;
  if (!action) return;
  $('navSheet').classList.add('hidden');
  $('navToggle').setAttribute('aria-expanded', 'false');
  openPicker(action);
};
$('pickerClose').onclick = closePicker;
$('pickerList').onclick = async (event) => {
  const id = event.target.closest('[data-pick]')?.dataset.pick;
  if (!id) return;
  closePicker();
  try {
    if (pickerAction === 'occupy') await postTable(id, 'occupy');
    else if (pickerAction === 'leave') await postTable(id, 'leave');
    else if (pickerAction === 'reserve') openReserve(id);
    else if (pickerAction === 'add') await openTable(id);
    else if (pickerAction === 'pay') await openTable(id, 'pay');
  } catch (error) {
    alert(error.message);
  }
};
$('reserveClose').onclick = () => $('reserveSheet').classList.add('hidden');
$('reserveClear').onclick = async () => {
  if (!reserveTableId) return;
  try {
    await postTable(reserveTableId, 'reserve', null);
    $('reserveSheet').classList.add('hidden');
  } catch (error) {
    alert(error.message);
  }
};
$('reserveForm').onsubmit = async (event) => {
  event.preventDefault();
  if (!reserveTableId) return;
  try {
    await postTable(reserveTableId, 'reserve', {
      guest: $('reserveGuest').value,
      phone: $('reservePhone').value,
      time: $('reserveTime').value,
      party: $('reserveParty').value,
      note: $('reserveNote').value
    });
    $('reserveSheet').classList.add('hidden');
  } catch (error) {
    alert(error.message);
  }
};
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
  setInterval(() => api('/api/server/presence', { method: 'POST', body: '{}' }).catch(() => {}), 30000);
  api('/api/server/presence', { method: 'POST', body: '{}' }).catch(() => {});
  let realtime = false;
  function startFallbackPoll() {
    if (realtime || window.__teaServerPoll) return;
    window.__teaServerPoll = setInterval(() => {
      if (document.visibilityState !== 'visible' || dirty) return;
      loadWorkspace().catch(() => setNet(false, 'Syncing'));
    }, 4000);
  }
  try {
    const config = await api('/api/auth/config');
    if (window.supabase && accessToken && session.refresh_token) {
      const client = window.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: false } });
      await client.auth.setSession({ access_token: accessToken, refresh_token: session.refresh_token });
      client.channel('tea-amo-server')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'live_orders' }, () => { if (!dirty) loadWorkspace().catch(() => setNet(false, 'Syncing')); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => { if (!dirty && activeTable) refreshOrder().catch(() => {}); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cafe_tables' }, () => { if (!dirty) loadWorkspace().catch(() => {}); })
        .subscribe((state) => {
          if (state === 'SUBSCRIBED') {
            realtime = true;
            setNet(true, 'Online');
          }
          if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
            setNet(false, 'Syncing');
            startFallbackPoll();
          }
        });
    } else startFallbackPoll();
  } catch (error) {
    console.error(error);
    setNet(false, 'Syncing');
    startFallbackPoll();
  }
}

boot().catch((error) => {
  setNet(false, 'Offline');
  $('business').textContent = error.message || 'Could not open the Server workspace';
});
