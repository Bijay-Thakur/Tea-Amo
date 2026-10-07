/* Calmer admin screens. Business calculations stay in app.js. */
let openingCashEditing = false;
let ownerMovementMode = 'investment';
let opsCustomerTab = 'customers';
let opsEditingCustomerId = null;
let opsComplaintId = null;
let recipeCategory = '';
let menuImageTarget = null;

function menuPhoto(item) {
  const url = String(item?.image_url || '').trim();
  if (/^https?:/i.test(url)) return url;
  const legacy = String(item?.image || item?.photo || '').trim();
  if (/^https?:/i.test(legacy) || legacy.startsWith('data:image/')) return legacy;
  return '';
}

function opsDay(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kathmandu', month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function opsClip(text, length = 72) {
  const value = String(text || '').trim();
  return value.length > length ? value.slice(0, length - 1) + '…' : value;
}

function opsChip(text, kind) {
  return `<span class="ops-chip ${kind || 'gray'}"><i></i>${esc(text)}</span>`;
}

function opsInitial(name) {
  return esc(String(name || '?').trim().charAt(0).toUpperCase() || '?');
}

function opsCloseMenus() {
  document.querySelectorAll('.ops-menu').forEach((menu) => menu.classList.add('hidden'));
}

function opsToggleMenu(event, button) {
  event.stopPropagation();
  const menu = button.parentElement.querySelector('.ops-menu');
  const open = menu.classList.contains('hidden');
  opsCloseMenus();
  menu.classList.toggle('hidden', !open);
}

function opsKebab(actions) {
  return `<div class="ops-kebab"><button type="button" class="ops-kebab-btn" aria-label="More actions" onclick="opsToggleMenu(event,this)">⋯</button><div class="ops-menu hidden" role="menu">${actions.map((action) => `<button type="button" class="${action.danger ? 'danger' : ''}" data-ops-action="${esc(action.action)}" data-ops-arg="${esc(action.arg)}">${esc(action.label)}</button>`).join('')}</div></div>`;
}

function opsRun(action, arg) {
  const id = arg;
  if (action === 'edit-customer') openCustomerForm(id);
  else if (action === 'edit-staff') openStaffProfile(Number(id));
  else if (action === 'add-shift') openAttendanceEditor(null, Number(id));
  else if (action === 'correct-clock') editCurrentClockIn(Number(id));
  else if (action === 'view-attendance') openAttendanceHistory(id);
  else if (action === 'emergency') opsEmergency(id);
  else if (action === 'delete-staff') { editingStaffId = Number(id); deleteStaffProfile(); }
  else if (action === 'open-complaint') openComplaintDetail(id);
  else if (action === 'delete-complaint') deleteComplaint(id);
}

document.addEventListener('click', (event) => {
  const item = event.target.closest('[data-ops-action]');
  if (item) {
    event.stopPropagation();
    opsCloseMenus();
    opsRun(item.dataset.opsAction, item.dataset.opsArg);
    return;
  }
  if (!event.target.closest('.ops-kebab')) opsCloseMenus();
});

document.addEventListener('error', (event) => {
  const img = event.target;
  if (!img || !img.classList || !img.classList.contains('menu-photo')) return;
  const fallback = document.createElement('div');
  fallback.className = img.classList.contains('admin-pos-photo') ? 'admin-pos-photo empty' : 'ops-thumb empty';
  const mark = document.createElement('span');
  mark.textContent = img.dataset.mark || '';
  fallback.appendChild(mark);
  img.replaceWith(fallback);
}, true);

function opsEditOpeningCash() {
  openingCashEditing = true;
  renderDayClose();
  $('openingCashInput')?.focus();
}

const saveOpeningCashChain = saveOpeningCashNow;
saveOpeningCashNow = async function () {
  if ($('openingCashInput') && $('openingCash')) $('openingCash').value = $('openingCashInput').value;
  const amount = Number($('openingCash').value);
  if (!Number.isFinite(amount) || amount < 0) return alert('Enter valid opening cash.');
  openingCashEditing = false;
  await saveOpeningCashChain();
  renderDayClose();
};

const finalizeChain = finalizeBusinessDay;
finalizeBusinessDay = async function () {
  const typed = $('finalizePassword')?.value || '';
  if ($('closePassword')) $('closePassword').value = typed || $('closePassword').value;
  await finalizeChain();
  if (dayRecord().finalized && $('finalizePassword')) $('finalizePassword').value = '';
};

renderDayClose = function () {
  const summary = daySummary();
  const record = summary.rec;
  const open = posAllowed();
  const notice = $('dayWorkNotice');
  if (notice) notice.innerHTML = typeof selectedWorkingDate === 'function' && selectedWorkingDate() ? `<div class="notice warn">Showing ${esc(businessDayKey())}. Finalized days stay locked.</div>` : '';
  if ($('dayControl')) {
    $('dayControl').innerHTML = `<div class="ops-stat"><small>Business Day</small><b>${esc(summary.key)}</b></div><div class="ops-stat ${open ? 'open' : 'shut'}"><small>POS Status</small><b>${opsChip(open ? 'OPEN' : 'CLOSED', open ? 'green' : 'gray')}</b></div><div class="ops-stat ${record.finalized ? 'shut' : 'wait'}"><small>Day Status</small><b>${opsChip(record.finalized ? 'FINALIZED' : 'OPEN', record.finalized ? 'gray' : 'orange')}</b></div>`;
  }
  const opening = $('openingCashView');
  if (opening) {
    const draft = $('openingCashInput')?.value;
    if (!record.finalized && (openingCashEditing || !record.openingCashSet)) {
      const value = draft != null ? draft : (record.openingCashSet ? record.openingCash : '');
      opening.innerHTML = `<div class="ops-inline"><label class="ops-field ops-grow">Amount<input id="openingCashInput" type="number" min="0" step="0.01" value="${esc(value)}" placeholder="0"></label><button class="btn" type="button" onclick="saveOpeningCashNow()">Save</button></div>`;
    } else {
      opening.innerHTML = `<div class="ops-inline"><div><b>${rs(record.openingCash || 0)}</b></div>${record.finalized ? '' : '<button class="btn alt" type="button" onclick="opsEditOpeningCash()">Edit</button>'}</div>`;
    }
  }
  const action = $('posAction');
  if (action) {
    if (record.finalized) action.innerHTML = opsChip('Day finalized', 'gray');
    else if (record.posClosed || !open) action.innerHTML = '<button class="btn" type="button" onclick="togglePosBilling(false)">Reopen POS</button>';
    else action.innerHTML = '<button class="btn danger" type="button" onclick="togglePosBilling(true)">Close POS</button>';
  }
  $('closePassword')?.closest('.ops-pass')?.classList.toggle('hidden', !!record.finalized);
  ['actualCash', 'closeNote', 'finalizePassword'].forEach((id) => { if ($(id)) $(id).disabled = !!record.finalized; });
  if (record.finalized) {
    if ($('actualCash') && document.activeElement !== $('actualCash')) $('actualCash').value = record.actualCash ?? '';
    if ($('closeNote') && document.activeElement !== $('closeNote')) $('closeNote').value = record.note || '';
  }
  if ($('finalizeDay')) $('finalizeDay').disabled = !!record.finalized;
  const actual = $('actualCash') && $('actualCash').value !== '' ? Number($('actualCash').value) : null;
  if ($('cashDiff')) $('cashDiff').textContent = actual == null || !Number.isFinite(actual) ? '' : `Difference ${rs(actual - summary.expectedCash)}`;
  if ($('zLive')) {
    const capital = Number(summary.capitalCash || 0);
    $('zLive').innerHTML = [
      ['Orders', summary.orders],
      ['Gross sales', rs(summary.gross)],
      ['Discount', '− ' + rs(summary.discount)],
      ['Tax', rs(summary.tax)],
      ['Net sales', rs(summary.sales), 'total'],
      ['Opening cash', rs(record.openingCash || 0), 'quiet'],
      ['Cash sales', rs(summary.cashSales)],
      ['Cash expenses', '− ' + rs(summary.cashExpenses)],
      ['Cash purchases', '− ' + rs(summary.cashPurchases)],
      capital ? ['Owner cash', (capital >= 0 ? '+ ' : '− ') + rs(Math.abs(capital))] : null,
      ['Expected cash', rs(summary.expectedCash), 'total']
    ].filter(Boolean).map((row) => `<div class="ops-sum ${row[2] || ''}"><span>${row[0]}</span><b>${row[1]}</b></div>`).join('');
  }
};

function customerBills(customer) {
  return state.bills.filter((bill) => String(bill.customer_id) === String(customer.id)).sort((a, b) => new Date(b.time) - new Date(a.time));
}

function setCustomerTab(tab) {
  opsCustomerTab = tab === 'complaints' ? 'complaints' : 'customers';
  document.querySelectorAll('#customerTabs button').forEach((button) => button.classList.toggle('on', button.dataset.tab === opsCustomerTab));
  $('customerWorkspace')?.classList.toggle('hidden', opsCustomerTab !== 'customers');
  $('complaintWorkspace')?.classList.toggle('hidden', opsCustomerTab !== 'complaints');
}

function openCustomerForm(id) {
  opsEditingCustomerId = id ? Number(id) : null;
  const customer = opsEditingCustomerId ? state.customers.find((item) => String(item.id) === String(id)) : null;
  $('customerModalTitle').textContent = customer ? customer.name : 'Add Customer';
  $('custName').value = customer?.name || '';
  $('custPhone').value = customer?.phone || '';
  $('custEmail').value = customer?.email || '';
  $('custNotes').value = customer?.notes || '';
  const extra = $('customerDetailExtra');
  if (extra) {
    if (!customer) extra.innerHTML = '';
    else {
      const bills = customerBills(customer).slice(0, 5);
      const complaints = (state.complaints || []).filter((item) => String(item.customer_id) === String(customer.id)).slice(0, 5);
      extra.innerHTML = `<div class="ops-lines"><div><span>Visits</span><b>${customer.visits || 0}</b></div><div><span>Total spend</span><b>${rs(customer.spend || 0)}</b></div><div><span>Last visit</span><b>${opsDay(customerBills(customer)[0]?.time)}</b></div></div>${bills.length ? `<ul class="ops-detail-list">${bills.map((bill) => `<li>${opsDay(bill.time)} · ${esc(bill.id)} · ${rs(bill.total)}</li>`).join('')}</ul>` : ''}${complaints.length ? `<ul class="ops-detail-list">${complaints.map((item) => `<li>${opsChip(complaintStatusLabel(item.status), complaintStatusKind(item.status))} ${esc(opsClip(item.text, 80))}</li>`).join('')}</ul>` : ''}`;
    }
  }
  $('customerModal').classList.add('show');
}

function saveCustomerForm() {
  const name = $('custName').value.trim();
  if (!name) return alert('Customer name is required.');
  const email = $('custEmail').value.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alert('Enter a valid email address.');
  const values = { name, phone: $('custPhone').value.trim(), email, notes: $('custNotes').value.trim() };
  if (opsEditingCustomerId) {
    const customer = state.customers.find((item) => String(item.id) === String(opsEditingCustomerId));
    if (!customer) return alert('Customer not found.');
    Object.assign(customer, values);
    audit('customer_updated', name);
  } else {
    state.customers.push({ id: Date.now(), ...values, visits: 0, spend: 0 });
    audit('customer_added', name);
  }
  rebuildIndex();
  saveSoon();
  closeModal('customerModal');
  renderCustomers();
}

function complaintStatusLabel(status) {
  return { open: 'Open', followup: 'In Progress', resolved: 'Resolved', closed: 'Closed' }[status] || 'Open';
}
function complaintStatusKind(status) {
  return { open: 'orange', followup: 'blue', resolved: 'green', closed: 'gray' }[status] || 'gray';
}
function complaintPriorityKind(priority) {
  return { high: 'rose', medium: 'orange', low: 'green' }[priority] || 'orange';
}

function fillComplaintCustomers() {
  const select = $('complaintCustomer');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Walk-in</option>' + state.customers.map((customer) => `<option value="${customer.id}">${esc(customer.name)}${customer.phone ? ' · ' + esc(customer.phone) : ''}</option>`).join('');
  if (current) select.value = current;
}

function openComplaintForm() {
  fillComplaintCustomers();
  $('complaintCustomer').value = '';
  $('complaintName').value = '';
  $('complaintPhone').value = '';
  $('complaintPriority').value = 'medium';
  $('complaintText').value = '';
  $('complaintModal').classList.add('show');
}

function saveComplaintForm() {
  const text = $('complaintText').value.trim();
  if (!text) return alert('Enter the complaint details.');
  const customerId = Number($('complaintCustomer').value) || null;
  const customer = customerId ? index.customers.get(customerId) : null;
  state.complaints = state.complaints || [];
  state.complaints.unshift({
    id: 'CMP-' + Date.now(),
    time: workingNowIso(),
    businessDay: businessDayKey(),
    customer_id: customerId,
    customer_name: $('complaintName').value.trim() || customer?.name || 'Walk-in',
    phone: $('complaintPhone').value.trim() || customer?.phone || '',
    text,
    priority: $('complaintPriority').value || 'medium',
    status: 'open',
    resolution: '',
    followups: []
  });
  audit('customer_complaint', text.slice(0, 80));
  saveSoon();
  closeModal('complaintModal');
  setCustomerTab('complaints');
  renderCustomers();
}

function openComplaintDetail(id) {
  const complaint = (state.complaints || []).find((item) => String(item.id) === String(id));
  if (!complaint) return;
  opsComplaintId = complaint.id;
  $('complaintDetailTitle').textContent = complaint.customer_name || 'Complaint';
  $('complaintDetailSummary').innerHTML = `<p>${esc(complaint.text || '')}</p><p>${opsDay(complaint.time)} · ${esc(complaint.phone || 'No phone')}</p>`;
  $('complaintDetailStatus').value = complaint.status || 'open';
  $('complaintFollowup').value = '';
  $('complaintDetailResolution').value = complaint.resolution || '';
  const notes = complaint.followups || [];
  $('complaintFollowupLog').innerHTML = notes.length ? `<ul class="ops-detail-list">${notes.map((note) => `<li>${opsDay(note.time)} · ${esc(note.note)}</li>`).join('')}</ul>` : '';
  $('complaintDetailModal').classList.add('show');
}

function saveComplaintDetail() {
  const complaint = (state.complaints || []).find((item) => String(item.id) === String(opsComplaintId));
  if (!complaint) return;
  const note = $('complaintFollowup').value.trim();
  if (note) {
    complaint.followups = complaint.followups || [];
    complaint.followups.push({ time: new Date().toISOString(), note });
  }
  complaint.status = $('complaintDetailStatus').value || 'open';
  complaint.resolution = $('complaintDetailResolution').value.trim();
  complaint.updatedAt = new Date().toISOString();
  audit('complaint_updated', `${complaint.id} ${complaint.status}`);
  saveSoon();
  closeModal('complaintDetailModal');
  renderCustomers();
}

function deleteComplaintFromDetail() {
  const before = (state.complaints || []).length;
  deleteComplaint(opsComplaintId);
  if ((state.complaints || []).length < before) closeModal('complaintDetailModal');
}

renderCustomers = function () {
  const query = ($('custSearch')?.value || '').trim().toLowerCase();
  const segment = $('custSegment')?.value || '';
  const customers = state.customers.filter((customer) => {
    const returning = Number(customer.visits || 0) > 1;
    if (segment === 'returning' && !returning) return false;
    if (segment === 'new' && returning) return false;
    if (!query) return true;
    return `${customer.name} ${customer.phone || ''} ${customer.email || ''}`.toLowerCase().includes(query);
  });
  const total = state.customers.length;
  const returning = state.customers.filter((customer) => Number(customer.visits || 0) > 1).length;
  const fresh = total - returning;
  const pct = (count) => (total ? Math.round((count / total) * 100) + '%' : '');
  if ($('custKpiTotal')) $('custKpiTotal').textContent = total;
  if ($('custKpiReturning')) $('custKpiReturning').textContent = returning;
  if ($('custKpiNew')) $('custKpiNew').textContent = fresh;
  if ($('custKpiReturningPct')) $('custKpiReturningPct').textContent = pct(returning);
  if ($('custKpiNewPct')) $('custKpiNewPct').textContent = pct(fresh);
  if ($('customerBody')) {
    $('customerBody').innerHTML = customers.map((customer) => {
      const last = customerBills(customer)[0]?.time;
      return `<tr><td><button type="button" class="ops-rowlink" onclick="openCustomerForm('${customer.id}')">${esc(customer.name)}</button></td><td>${esc(customer.phone || '—')}</td><td>${customer.visits || 0}</td><td>${rs(customer.spend || 0)}</td><td>${opsDay(last)}</td><td>${opsKebab([{ label: 'Edit', action: 'edit-customer', arg: customer.id }])}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">No customers yet.</td></tr>';
  }
  const complaints = (state.complaints || []).slice().sort((a, b) => new Date(b.time) - new Date(a.time));
  const openCount = complaints.filter((item) => item.status === 'open').length;
  const badge = $('complaintTabCount');
  if (badge) {
    badge.textContent = openCount;
    badge.classList.toggle('hidden', !openCount);
  }
  if ($('complaintOpenLabel')) $('complaintOpenLabel').textContent = `${openCount} open`;
  const complaintQuery = ($('complaintSearch')?.value || '').trim().toLowerCase();
  const statusFilter = $('complaintStatusFilter')?.value || '';
  const visibleComplaints = complaints.filter((item) => {
    if (statusFilter && item.status !== statusFilter) return false;
    if (!complaintQuery) return true;
    return `${item.customer_name} ${item.text} ${item.resolution || ''} ${item.phone || ''}`.toLowerCase().includes(complaintQuery);
  });
  if ($('complaintBody')) {
    $('complaintBody').innerHTML = visibleComplaints.map((item) => `<tr><td>${opsDay(item.time)}</td><td><button type="button" class="ops-rowlink" onclick="openComplaintDetail('${esc(item.id)}')">${esc(item.customer_name || 'Walk-in')}</button></td><td>${opsChip((item.priority || 'medium'), complaintPriorityKind(item.priority))}</td><td>${opsChip(complaintStatusLabel(item.status), complaintStatusKind(item.status))}</td><td>${esc(opsClip(item.text))}</td><td>${esc(item.resolution || '—')}</td><td>${opsKebab([{ label: 'Open', action: 'open-complaint', arg: item.id }, { label: 'Delete', action: 'delete-complaint', arg: item.id, danger: true }])}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No complaints.</td></tr>';
  }
  fillComplaintCustomers();
  setCustomerTab(opsCustomerTab);
};

function recipeConfigured(item) {
  return recipeFor(item).length > 0;
}

function recipeLineCost(line) {
  return Number(ingredient(line.ingredient_key)?.avg_cost || 0) * Number(line.qty || 0);
}

function opsClearRecipe() {
  const item = menuItem(selectedRecipeId);
  if (!item || !recipeConfigured(item)) return;
  if (!confirm(`Clear the recipe for ${item.name}? Inventory items stay. Only this menu link is removed.`)) return;
  state.recipes[item.name] = [];
  state.recipeCleared = state.recipeCleared || {};
  state.recipeCleared[item.name] = true;
  index.recipeCost.clear();
  saveSoon();
  renderRecipes();
}

const recipeAddChain = recipeAdd;
recipeAdd = function () {
  const item = menuItem(selectedRecipeId);
  if (!item) return alert('Select a menu item first.');
  if (!state.ingredients.filter((row) => row.active).length) return alert('Add an inventory ingredient first.');
  if (!Array.isArray(state.recipes[item.name])) state.recipes[item.name] = [];
  if (state.recipeCleared) delete state.recipeCleared[item.name];
  recipeAddChain();
  renderRecipes();
};

const recipeRemoveChain = recipeRemove;
recipeRemove = function (indexToRemove) {
  const item = menuItem(selectedRecipeId);
  if (item && recipeFor(item).length <= 1) {
    opsClearRecipe();
    return;
  }
  recipeRemoveChain(indexToRemove);
  renderRecipes();
};

renderRecipes = function () {
  const query = ($('recipeSearch')?.value || '').trim().toLowerCase();
  const categories = [...new Set(state.menu.map((item) => item.category).filter(Boolean))];
  if (!categories.includes(recipeCategory)) recipeCategory = '';
  const chips = $('recipeCats');
  if (chips) chips.innerHTML = `<button type="button" data-cat="" class="${recipeCategory ? '' : 'on'}">All</button>` + categories.map((category) => `<button type="button" data-cat="${esc(category)}" class="${recipeCategory === category ? 'on' : ''}">${esc(category)}</button>`).join('');
  const rows = state.menu.filter((item) => (!recipeCategory || item.category === recipeCategory) && (!query || item.name.toLowerCase().includes(query)));
  if ($('recipeList')) {
    $('recipeList').innerHTML = rows.map((item) => {
      const photo = menuPhoto(item);
      const mark = opsInitial(item.name);
      const visual = photo ? `<img class="ops-thumb menu-photo" alt="" data-mark="${mark}" src="${esc(photo)}" loading="lazy">` : `<div class="ops-thumb empty">${mark}</div>`;
      const cost = recipeConfigured(item) ? `<span class="ops-chip green">Food cost ${item.price ? ((recipeCost(item) / item.price) * 100).toFixed(0) : 0}%</span>` : '<span class="ops-chip gray">Not configured</span>';
      return `<button type="button" class="ops-recipe ${Number(selectedRecipeId) === Number(item.id) ? 'on' : ''}" onclick="selectRecipe(${Number(item.id)})">${visual}<span><b>${esc(item.name)}</b><small>${rs(item.price)}</small><div>${cost}</div></span></button>`;
    }).join('') || '<div class="ops-empty">No menu items match.</div>';
  }
  drawRecipeEditor();
};

selectRecipe = function (id) {
  selectedRecipeId = id;
  renderRecipes();
};

drawRecipeEditor = function () {
  const item = menuItem(selectedRecipeId);
  const clear = $('clearRecipeBtn');
  if (!item) {
    if ($('recipeTitle')) $('recipeTitle').textContent = 'Recipe Builder';
    if ($('recipeSubtitle')) $('recipeSubtitle').textContent = 'Choose a menu item.';
    if ($('recipeEditor')) $('recipeEditor').innerHTML = '<div class="ops-empty"><b>Select a menu item</b></div>';
    clear?.classList.add('hidden');
    return;
  }
  const configured = recipeConfigured(item);
  if ($('recipeTitle')) $('recipeTitle').textContent = item.name;
  if ($('recipeSubtitle')) $('recipeSubtitle').textContent = 'Ingredients for one sale.';
  clear?.classList.toggle('hidden', !configured);
  const photo = menuPhoto(item);
  const mark = opsInitial(item.name);
  const visual = photo ? `<img class="ops-thumb menu-photo" alt="" data-mark="${mark}" src="${esc(photo)}">` : `<div class="ops-thumb empty">${mark}</div>`;
  const cost = configured ? recipeCost(item) : null;
  const percent = configured && item.price ? ((cost / item.price) * 100).toFixed(0) + '%' : 'Not configured';
  const lines = recipeFor(item);
  const options = (selected) => {
    const rows = state.ingredients.filter((ingredientRow) => ingredientRow.active || ingredientRow.key === selected);
    return rows.map((ingredientRow) => `<option value="${esc(ingredientRow.key)}" ${ingredientRow.key === selected ? 'selected' : ''}>${esc(ingredientRow.name)}</option>`).join('');
  };
  const table = configured ? `<table class="ops-table"><thead><tr><th>Ingredient</th><th>Qty</th><th>Unit</th><th>Cost</th><th></th></tr></thead><tbody>${lines.map((line, index) => {
    const stock = ingredient(line.ingredient_key);
    return `<tr><td><select onchange="recipeIngredient(${index},this.value)">${options(line.ingredient_key)}</select></td><td><input type="number" min="0" step="0.001" value="${Number(line.qty || 0)}" onchange="recipeQty(${index},this.value)"></td><td>${esc(stock?.unit || '—')}</td><td>${rs(recipeLineCost(line))}</td><td><button class="ops-trash" type="button" onclick="recipeRemove(${index})" aria-label="Remove ingredient">×</button></td></tr>`;
  }).join('')}</tbody></table><button class="btn alt" type="button" onclick="recipeAdd()">+ Add Ingredient</button><div class="ops-cost"><div><small>Total ingredient cost</small><b>${rs(cost)}</b></div><div class="hi"><small>Menu price</small><b>${rs(item.price)}</b></div><div><small>Food cost percentage</small><b>${percent}</b></div></div>` : `<div class="ops-empty"><b>Recipe not configured</b><button class="btn" type="button" onclick="recipeAdd()">Create Recipe</button></div>`;
  $('recipeEditor').innerHTML = `<div class="ops-builder-stats">${visual}<div><small>Menu price</small><b>${rs(item.price)}</b></div><div><small>Ingredient cost</small><b>${configured ? rs(cost) : 'Not configured'}</b></div><div><small>Food cost</small><b>${percent}</b></div><div><small>Portion</small><b>1</b></div></div>${table}<div class="ops-note">When this item is sold, inventory is deducted using this recipe.</div>`;
  const chip = document.querySelector('#recipeList .ops-recipe.on .ops-chip');
  if (chip) chip.outerHTML = configured ? `<span class="ops-chip green">Food cost ${item.price ? ((cost / item.price) * 100).toFixed(0) : 0}%</span>` : '<span class="ops-chip gray">Not configured</span>';
};

function attendanceEvents() {
  const events = [];
  state.attendance.forEach((row) => {
    const person = state.staff.find((item) => item.id === row.staff_id);
    events.push({ time: row.in, name: person?.name || 'Unknown staff', role: person?.role || '', action: 'in', note: '' });
    if (row.out) events.push({ time: row.out, name: person?.name || 'Unknown staff', role: person?.role || '', action: 'out', note: row.note || '' });
  });
  state.staff.forEach((person) => {
    if (person.clockIn) events.push({ time: person.clockIn, name: person.name, role: person.role || '', action: 'in', note: 'On shift' });
  });
  return events.sort((a, b) => new Date(b.time) - new Date(a.time));
}

function openAttendanceHistory(staffId) {
  fillAttendanceFilters();
  if (staffId && $('attendanceStaffFilter')) $('attendanceStaffFilter').value = String(staffId);
  $('attendanceHistoryModal')?.classList.add('show');
  renderAttendanceHistory();
}

function opsEmergency(id) {
  const person = state.staff.find((item) => String(item.id) === String(id));
  if (!person) return;
  $('staffEmergencyTitle').textContent = person.name;
  $('staffEmergencyBody').innerHTML = `<div class="ops-lines"><div><span>Contact</span><b>${esc(person.emergency_name || '—')}</b></div><div><span>Relation</span><b>${esc(person.emergency_relation || '—')}</b></div><div><span>Phone</span><b>${esc(person.emergency_phone || '—')}</b></div>${person.can_take_orders ? '<div><span>Phone ordering</span><b>Enabled</b></div>' : ''}</div>`;
  $('staffEmergencyEdit').onclick = () => { closeModal('staffEmergencyModal'); openStaffProfile(person.id); };
  $('staffEmergencyModal').classList.add('show');
}

renderAttendanceHistory = function () {
  const preview = attendanceEvents().slice(0, 6);
  if ($('attendancePreview')) {
    $('attendancePreview').innerHTML = preview.map((event) => `<tr><td>${esc(nptDateTime(event.time))}</td><td><b>${esc(event.name)}</b><div class="ops-hint">${esc(event.role)}</div></td><td>${opsChip(event.action === 'in' ? 'Clock In' : 'Clock Out', event.action === 'in' ? 'green' : 'orange')}</td><td>${esc(event.note || '—')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No attendance yet.</td></tr>';
  }
  const body = $('attendanceBody');
  if (!body) return;
  const staffId = $('attendanceStaffFilter')?.value || '';
  const month = $('attendanceMonthFilter')?.value || '';
  const rows = state.attendance.slice().sort((a, b) => new Date(b.in) - new Date(a.in)).filter((row) => {
    if (staffId && String(row.staff_id) !== String(staffId)) return false;
    if (month && nepaliLocalParts(row.in).date.slice(0, 7) !== month) return false;
    return true;
  });
  body.innerHTML = rows.map((row) => {
    const person = state.staff.find((item) => item.id === row.staff_id);
    const start = nepaliLocalParts(row.in);
    const end = nepaliLocalParts(row.out);
    return `<tr><td>${start.date}</td><td><b>${esc(person?.name || 'Unknown staff')}</b></td><td>${start.time}</td><td>${end.time}</td><td>${Number(row.hours || 0).toFixed(2)} h</td><td>${esc(row.note || '')}</td><td><button class="btn alt small" type="button" onclick="openAttendanceEditor(${row.id})">Edit</button></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">No attendance records for this filter.</td></tr>';
};

renderStaff = function () {
  const query = ($('staffSearch')?.value || '').trim().toLowerCase();
  const role = $('staffStatusFilter');
  if (role) {
    const current = role.value;
    const roles = [...new Set(state.staff.map((person) => person.role).filter(Boolean))].sort();
    role.innerHTML = '<option value="">All roles</option>' + roles.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
    if (roles.includes(current)) role.value = current;
  }
  const selectedRole = role?.value || '';
  const list = state.staff.filter((person) => {
    if (selectedRole && person.role !== selectedRole) return false;
    if (!query) return true;
    return `${person.name} ${person.role} ${person.phone || ''} ${person.email || ''}`.toLowerCase().includes(query);
  });
  const hours = state.staff.reduce((sum, person) => sum + staffMonthHours(person), 0);
  const payroll = state.staff.reduce((sum, person) => sum + staffMonthHours(person) * Number(person.rate || 0), 0);
  const clocked = state.staff.filter((person) => person.clockIn).length;
  if ($('staffKpiTotal')) $('staffKpiTotal').textContent = state.staff.length;
  if ($('staffKpiClocked')) $('staffKpiClocked').textContent = clocked;
  if ($('staffKpiOff')) $('staffKpiOff').textContent = state.staff.length - clocked;
  if ($('staffKpiHours')) $('staffKpiHours').textContent = hours.toFixed(1) + ' h';
  if ($('staffKpiPayroll')) $('staffKpiPayroll').textContent = rs(payroll);
  if ($('staffBody')) {
    $('staffBody').innerHTML = list.map((person) => {
      const monthHours = staffMonthHours(person);
      const actions = [
        { label: 'Edit Profile', action: 'edit-staff', arg: person.id },
        { label: 'Add Shift', action: 'add-shift', arg: person.id },
        person.clockIn ? { label: 'Correct Clock-in', action: 'correct-clock', arg: person.id } : null,
        { label: 'View Attendance', action: 'view-attendance', arg: person.id },
        { label: 'Emergency Contact', action: 'emergency', arg: person.id },
        { label: 'Delete Staff', action: 'delete-staff', arg: person.id, danger: true }
      ].filter(Boolean);
      return `<tr><td><b>${esc(person.name)}</b></td><td>${esc(person.role || '')}</td><td>${esc(person.phone || '—')}</td><td>${opsChip(person.clockIn ? 'Clocked In' : 'Off Duty', person.clockIn ? 'green' : 'gray')}</td><td>${monthHours.toFixed(2)} h</td><td><b>${rs(person.rate || 0)}</b><div class="ops-hint">${rs(monthHours * Number(person.rate || 0))}</div></td><td><button class="btn small ${person.clockIn ? 'orange' : ''}" type="button" onclick="toggleClock(${person.id})">${person.clockIn ? 'Clock Out' : 'Clock In'}</button> ${opsKebab(actions)}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">No staff yet.</td></tr>';
  }
  if ($('quickAttendanceList')) {
    $('quickAttendanceList').innerHTML = state.staff.map((person) => `<div class="ops-today-row"><div class="ops-person"><span class="ops-avatar">${opsInitial(person.name)}</span><span><b>${esc(person.name)}</b><small>${esc(person.role || '')}${person.clockIn ? ' · since ' + esc(nptDateTime(person.clockIn)) : ''}</small></span></div>${opsChip(person.clockIn ? 'Clocked In' : 'Off Duty', person.clockIn ? 'green' : 'gray')}<button class="btn small ${person.clockIn ? 'orange' : ''}" type="button" onclick="toggleClock(${person.id})">${person.clockIn ? 'Clock Out' : 'Clock In'}</button></div>`).join('') || '<div class="ops-empty">No staff yet.</div>';
  }
  fillAttendanceFilters();
  renderAttendanceHistory();
};

function setOwnerMovementMode(mode) {
  ownerMovementMode = mode === 'withdrawal' || mode === 'transfer' ? mode : 'investment';
  if ($('capitalType') && ownerMovementMode !== 'transfer') $('capitalType').value = ownerMovementMode;
  document.querySelectorAll('#movementSeg button').forEach((button) => button.classList.toggle('on', button.dataset.move === ownerMovementMode));
  $('capitalAccountRow')?.classList.toggle('hidden', ownerMovementMode === 'transfer');
  $('transferAccountRow')?.classList.toggle('hidden', ownerMovementMode !== 'transfer');
  if ($('saveMovement')) $('saveMovement').textContent = ownerMovementMode === 'transfer' ? 'Transfer' : 'Save Movement';
}

function saveOwnerMovement() {
  if (ownerMovementMode === 'transfer') {
    const before = (state.accountTransfers || []).length;
    if ($('transferAmount')) $('transferAmount').value = $('capitalAmount').value;
    if ($('transferNote')) $('transferNote').value = $('capitalNote').value;
    addAccountTransfer();
    if ((state.accountTransfers || []).length !== before) {
      $('capitalAmount').value = '';
      $('capitalNote').value = '';
    }
    return;
  }
  if ($('capitalType')) $('capitalType').value = ownerMovementMode;
  addCapitalMovement();
}

function ownerMovementRows() {
  const rows = [];
  (state.ownerCapital || []).forEach((row) => rows.push({ time: row.time, type: row.type, account: row.destination || 'Cash', amount: Number(row.amount || 0), note: row.note || '', signed: row.type === 'withdrawal' ? -1 : 1 }));
  (state.accountTransfers || []).forEach((row) => rows.push({ time: row.time, type: 'transfer', account: `${row.from} → ${row.to}`, amount: Number(row.amount || 0), note: row.note || '', signed: 0 }));
  return rows.sort((a, b) => new Date(b.time) - new Date(a.time));
}

renderCapital = function () {
  const invested = state.ownerCapital.filter((row) => row.type === 'investment').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const withdrawn = state.ownerCapital.filter((row) => row.type === 'withdrawal').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const ledger = moneyMovementLedger();
  const balances = { Cash: 0, Bank: 0, Online: 0 };
  ledger.filter((row) => row.account in balances).forEach((row) => { balances[row.account] += (row.direction === 'in' ? 1 : -1) * row.amount; });
  const total = balances.Cash + balances.Bank + balances.Online;
  if ($('balanceCash')) $('balanceCash').textContent = rs(balances.Cash || 0);
  if ($('balanceBank')) $('balanceBank').textContent = rs(balances.Bank || 0);
  if ($('balanceOnline')) $('balanceOnline').textContent = rs(balances.Online || 0);
  if ($('balanceTotal')) $('balanceTotal').textContent = rs(total);
  if ($('capitalInvested')) $('capitalInvested').textContent = rs(invested);
  if ($('capitalWithdrawn')) $('capitalWithdrawn').textContent = rs(withdrawn);
  if ($('capitalNet')) $('capitalNet').textContent = rs(invested - withdrawn);
  if ($('capitalNetTop')) $('capitalNetTop').textContent = rs(invested - withdrawn);
  const today = state.ownerCapital.filter((row) => row.businessDay === businessDayKey()).reduce((sum, row) => sum + (row.type === 'withdrawal' ? -1 : 1) * Number(row.amount || 0), 0);
  if ($('capitalToday')) {
    $('capitalToday').textContent = (today > 0 ? '+ ' : today < 0 ? '− ' : '') + rs(Math.abs(today));
    $('capitalToday').className = today < 0 ? 'ops-bad' : 'ops-good';
  }
  const type = $('movementTypeFilter')?.value || '';
  const account = $('movementAccountFilter')?.value || '';
  const range = $('movementRangeFilter')?.value || '30';
  const rows = ownerMovementRows().filter((row) => {
    if (type && row.type !== type) return false;
    if (account && !String(row.account).includes(account)) return false;
    if (range !== 'all') {
      const days = Number(range);
      if (Date.now() - new Date(row.time).getTime() > days * 864e5) return false;
    }
    return true;
  });
  if ($('capitalBody')) {
    $('capitalBody').innerHTML = rows.map((row) => {
      const label = row.type === 'investment' ? 'Investment' : row.type === 'withdrawal' ? 'Withdrawal' : 'Transfer';
      const kind = row.type === 'investment' ? 'green' : row.type === 'withdrawal' ? 'orange' : 'blue';
      const amount = row.type === 'withdrawal' ? '− ' + rs(row.amount) : row.type === 'investment' ? '+ ' + rs(row.amount) : rs(row.amount);
      return `<tr><td>${esc(nptDateTime(row.time))}</td><td>${opsChip(label, kind)}</td><td>${esc(row.account)}</td><td class="${row.type === 'withdrawal' ? 'ops-bad' : row.type === 'investment' ? 'ops-good' : ''}">${amount}</td><td>${esc(row.note || '')}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">No owner movements yet.</td></tr>';
  }
  setOwnerMovementMode(ownerMovementMode);
};

function refreshMenuSurfaces() {
  if ($('menuAdminBody')) renderMenuAdmin();
  if ($('menuGrid')) renderMenu();
  if (activeSection === 'recipes') renderRecipes();
}

async function readImageResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Image request failed');
  return data;
}

function compressMenuImage(file) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) return Promise.reject(new Error('Use a JPG, PNG, or WebP image.'));
  if (file.size > 12 * 1024 * 1024) return Promise.reject(new Error('Choose a photo under 12 MB.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const width = 960;
        const height = 720;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ratio = image.width / image.height;
        const target = 4 / 3;
        let sourceWidth;
        let sourceHeight;
        let sourceX;
        let sourceY;
        if (ratio > target) {
          sourceHeight = image.height;
          sourceWidth = image.height * target;
          sourceX = (image.width - sourceWidth) / 2;
          sourceY = 0;
        } else {
          sourceWidth = image.width;
          sourceHeight = image.width / target;
          sourceX = 0;
          sourceY = (image.height - sourceHeight) / 2;
        }
        canvas.getContext('2d').drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else canvas.toBlob((jpeg) => jpeg ? resolve(jpeg) : reject(new Error('Could not prepare that image.')), 'image/jpeg', 0.82);
        }, 'image/webp', 0.82);
      };
      image.onerror = () => reject(new Error('Could not prepare that image.'));
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function opsPickMenuImage(id) {
  menuImageTarget = id;
  const input = $('menuImageFile');
  if (!input) return;
  input.value = '';
  input.click();
}

async function opsRemoveMenuImage(id) {
  const item = menuItem(id);
  if (!item) return;
  const previous = item.image_url || '';
  if (!previous && !menuPhoto(item)) return;
  if (!confirm(`Remove the photo from ${item.name}?`)) return;
  const snapshot = { image_url: item.image_url, image: item.image, photo: item.photo };
  item.image_url = '';
  if (String(item.image || '').startsWith('data:')) delete item.image;
  if (String(item.photo || '').startsWith('data:')) delete item.photo;
  if (!await persistNow('menu_image_remove')) {
    Object.assign(item, snapshot);
    return alert('The photo could not be removed.');
  }
  if (/^https?:/i.test(previous)) {
    fetch('/api/admin/menu-images', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: previous }) })
      .then((response) => { if (!response.ok) setActionStatus('Photo removed from the menu. The stored file could not be deleted.', 'warn'); })
      .catch(() => {});
  }
  pushLanConfig();
  refreshMenuSurfaces();
  setActionStatus(`Photo removed from ${item.name}.`, 'good');
}

async function uploadMenuImage(id, file) {
  const item = menuItem(id);
  if (!item) return;
  const blob = await compressMenuImage(file);
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(blob);
  });
  const response = await fetch('/api/admin/menu-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ menu_id: String(item.id), content_type: blob.type, data_base64: String(dataUrl).split(',')[1] || '' })
  });
  const payload = await readImageResponse(response);
  const previous = item.image_url || '';
  item.image_url = payload.image_url;
  if (String(item.image || '').startsWith('data:')) delete item.image;
  if (String(item.photo || '').startsWith('data:')) delete item.photo;
  if (!await persistNow('menu_image')) {
    item.image_url = previous;
    fetch('/api/admin/menu-images', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: payload.image_url }) }).catch(() => {});
    throw new Error('The photo uploaded, but the menu record could not be saved.');
  }
  if (previous && previous !== payload.image_url) {
    fetch('/api/admin/menu-images', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: previous }) })
      .then((response) => { if (!response.ok) setActionStatus(`Photo saved for ${item.name}. The previous file could not be deleted.`, 'warn'); })
      .catch(() => {});
  }
  pushLanConfig();
  refreshMenuSurfaces();
  setActionStatus(`Photo saved for ${item.name}.`, 'good');
}

renderMenuAdmin = function () {
  if (!$('menuAdminBody')) return;
  $('menuAdminBody').innerHTML = state.menu.slice().sort((a, b) => a.name.localeCompare(b.name)).map((item) => {
    const photo = menuPhoto(item);
    const mark = opsInitial(item.name);
    const visual = photo ? `<img class="menu-admin-photo menu-photo" alt="" data-mark="${mark}" src="${esc(photo)}" loading="lazy">` : `<div class="menu-admin-photo empty">${mark}</div>`;
    return `<tr><td><div class="ops-menu-cell">${visual}<div><input value="${esc(item.name)}" onchange="editMenuName(${item.id},this.value)"><div class="ops-hint">${esc(item.category || 'Menu')}</div><div class="ops-menu-actions"><button class="btn alt small" type="button" onclick="opsPickMenuImage(${item.id})">${photo ? 'Replace' : 'Upload'}</button>${photo ? `<button class="btn alt small" type="button" onclick="opsRemoveMenuImage(${item.id})">Remove</button>` : ''}</div></div></div></td><td><input type="number" min="0" step="0.01" value="${item.price == null ? '' : Number(item.price)}" placeholder="Set price" onchange="editMenuPrice(${item.id},this.value)"></td><td><input type="checkbox" ${item.active !== false ? 'checked' : ''} onchange="toggleMenuActive(${item.id},this.checked)"></td><td><button class="btn small danger" type="button" onclick="deleteMenuItemAdmin(${item.id})">Delete</button></td></tr>`;
  }).join('');
};

const deleteMenuItemChain = deleteMenuItemAdmin;
deleteMenuItemAdmin = function (id) {
  const item = menuItem(id);
  const previous = item?.image_url || '';
  deleteMenuItemChain(id);
  if (previous && !menuItem(id)) {
    fetch('/api/admin/menu-images', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: previous }) }).catch(() => {});
  }
};

const editMenuNameChain = editMenuName;
editMenuName = function (id, value) {
  const before = menuItem(id)?.name;
  editMenuNameChain(id, value);
  const after = menuItem(id)?.name;
  if (before && after && before !== after && state.recipeCleared?.[before]) {
    state.recipeCleared[after] = true;
    delete state.recipeCleared[before];
  }
};

$('customerTabs')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (!button) return;
  setCustomerTab(button.dataset.tab);
});
$('custSearch')?.addEventListener('input', debounce(renderCustomers, 80));
$('custSegment')?.addEventListener('change', renderCustomers);
$('complaintSearch')?.addEventListener('input', debounce(renderCustomers, 80));
$('complaintStatusFilter')?.addEventListener('change', renderCustomers);
$('complaintCustomer')?.addEventListener('change', () => {
  const customer = index.customers.get(Number($('complaintCustomer').value));
  if (!customer) return;
  $('complaintName').value = customer.name || '';
  $('complaintPhone').value = customer.phone || '';
});
$('recipeCats')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-cat]');
  if (!button) return;
  recipeCategory = button.dataset.cat || '';
  renderRecipes();
});
$('movementSeg')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-move]');
  if (!button) return;
  setOwnerMovementMode(button.dataset.move);
});
$('menuImageFile')?.addEventListener('change', async () => {
  const file = $('menuImageFile').files?.[0];
  const id = menuImageTarget;
  if (!file || id == null) return;
  try {
    setActionStatus('Saving photo…', 'warn');
    await uploadMenuImage(id, file);
  } catch (error) {
    alert(error.message || 'The photo could not be saved.');
  }
});
setOwnerMovementMode('investment');
