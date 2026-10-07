(function () {
  if (!window.TEA_AMO_CLOUD || typeof window.TEA_AMO_BOOT !== 'function') return;

  let accessToken = '';
  let refreshTimer = null;
  let pushChain = Promise.resolve();
  const paymentKeys = new Map();

  async function authHeaders() {
    return { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) };
  }

  async function cloudFetch(path, opts = {}) {
    const headers = { ...(await authHeaders()), ...(opts.headers || {}) };
    const response = await fetch(path, { ...opts, headers, credentials: 'include', cache: 'no-store' });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (response.status === 401) {
      window.location.assign('/');
      throw new Error('Authentication expired');
    }
    if (!response.ok) {
      const error = new Error(data.error || ('Request failed (' + response.status + ')'));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function restoreSession() {
    const data = await cloudFetch('/api/auth/session');
    accessToken = data.access_token || '';
    if (window.supabase && TEA_AMO_CLOUD.url && accessToken) {
      try {
        window.teaSupabase = window.supabase.createClient(TEA_AMO_CLOUD.url, TEA_AMO_CLOUD.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tea-amo-admin' }
        });
        await window.teaSupabase.auth.setSession({ access_token: accessToken, refresh_token: data.refresh_token || '' });
      } catch (error) {
        console.error(error);
        window.teaSupabase = null;
      }
    }
    return data;
  }

  function applyRemoteOrders(orders, tables) {
    if (typeof lanApplyingRemote !== 'undefined' && lanApplyingRemote) return;
    lanApplyingRemote = true;
    const changed = [];
    const flags = new Map((tables || []).map((table) => [String(table.id), table]));
    for (const table of state.tables || []) {
      const flag = flags.get(String(table.id));
      if (flag) {
        const nextReservation = flag.reservation || null;
        const nextSeated = !!flag.seated;
        const sameReservation = JSON.stringify(table.reservation || null) === JSON.stringify(nextReservation);
        if (!sameReservation || !!table.seated !== nextSeated) {
          table.reservation = nextReservation;
          table.seated = nextSeated;
          changed.push(table.id);
        }
      }
      if (lanPushTimers[table.id]) continue;
      const remote = orders[table.id];
      const local = state.tableOrders[table.id];
      if (!remote || !remote.order) {
        if (local && !lanPushTimers[table.id]) {
          delete state.tableOrders[table.id];
          table.attention = false;
          changed.push(table.id);
        }
        continue;
      }
      const remoteVersion = Number(remote.version || 0);
      const localVersion = Number(local?._lan_version || 0);
      if (remoteVersion !== localVersion) {
        state.tableOrders[table.id] = { ...remote.order, _lan_version: remoteVersion, _lan_updated_by: remote.updated_by || remote.order._lan_updated_by || '' };
        table.attention = !!remote.attention;
        changed.push(table.id);
      }
    }
    lanApplyingRemote = false;
    if (!changed.length) return;
    if (activeSection === 'pos') {
      if (activeTableId) renderPOSWorkspace();
      else renderTableFloor();
    } else if (activeSection === 'dashboard') renderDashboard();
  }

  async function refreshOrders() {
    const data = await cloudFetch('/api/ops/orders');
    lanOnline = true;
    applyRemoteOrders(data.orders || {}, data.tables || []);
    updateLanUI();
  }

  function subscribe() {
    if (!window.teaSupabase) {
      refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshOrders().catch(() => { lanOnline = false; updateLanUI(); }); }, 4000);
      return;
    }
    window.teaSupabase.channel('tea-amo-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_orders' }, () => refreshOrders().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cafe_tables' }, () => refreshOrders().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => refreshOrders().catch(() => {}))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, (payload) => {
        const bill = payload.new?.bill;
        if (bill && !state.bills.some((item) => item.id === bill.id)) {
          state.bills.unshift(bill);
          refreshOrders().catch(() => {});
          if (activeSection === 'dashboard') renderDashboard();
          if (activeSection === 'pos') renderTableFloor();
        }
      })
      .subscribe((status) => {
        lanOnline = status === 'SUBSCRIBED';
        updateLanUI();
        if (status === 'SUBSCRIBED') refreshOrders().catch(() => {});
      });
  }

  serverStateGet = async function () {
    try {
      const data = await cloudFetch('/api/admin/state');
      window.__teaRevision = Number(data.revision || 0);
      return data.state && Array.isArray(data.state.menu) ? data.state : null;
    } catch {
      return null;
    }
  };

  serverStatePut = async function (data) {
    try {
      const saved = await cloudFetch('/api/admin/state', { method: 'PUT', body: JSON.stringify({ state: data, expected_revision: window.__teaRevision || 0 }) });
      window.__teaRevision = Number(saved.revision || window.__teaRevision || 0);
      return true;
    } catch (error) {
      if (error.status === 409) {
        const latest = await serverStateGet();
        if (!latest) return false;
        const retry = await cloudFetch('/api/admin/state', { method: 'PUT', body: JSON.stringify({ state: data, expected_revision: window.__teaRevision || 0 }) });
        window.__teaRevision = Number(retry.revision || 0);
        return true;
      }
      console.error('Cloud state save failed', error);
      return false;
    }
  };

  function orderBody(tableId) {
    const table = tableById(tableId);
    const order = state.tableOrders[tableId] || { cart: [] };
    return {
      expected_version: Number(order._lan_version || 0),
      attention: !!table?.attention,
      guest_count: order.guestCount || 1,
      discount_type: order.discountType || 'percent',
      discount_value: Number(order.discountValue || 0),
      opened_at: order.openedAt || null,
      order_ref: order.orderRef || table?.name || '',
      order_type: order.orderType || 'Dine-in',
      items: (order.cart || []).filter((item) => Number(item.qty) > 0).map((item) => ({
        menu_item_id: String(item.id),
        qty: Number(item.qty),
        served_qty: Number(item.served || 0)
      }))
    };
  }

  pushLanOrder = async function (tableId) {
    if (!tableId || tableId === 'counter') return;
    pushChain = pushChain.then(async () => {
      try {
        const result = await cloudFetch('/api/ops/orders/' + encodeURIComponent(tableId), { method: 'PUT', body: JSON.stringify(orderBody(tableId)) });
        if (state.tableOrders[tableId] && result.version) state.tableOrders[tableId]._lan_version = result.version;
        if (result.deleted) delete state.tableOrders[tableId];
        lanOnline = true;
      } catch (error) {
        lanOnline = false;
        if (error.status === 409) await refreshOrders();
      }
      updateLanUI();
    }).catch(() => {});
    return pushChain;
  };

  pushLanAttention = async function (tableId) { return pushLanOrder(tableId); };
  deleteLanOrder = async function (tableId) {
    const order = state.tableOrders[tableId];
    if (order) order.cart = [];
    return pushLanOrder(tableId);
  };
  queueLanOrderPush = function (tableId) {
    if (!tableId || tableId === 'counter' || lanApplyingRemote) return;
    clearTimeout(lanPushTimers[tableId]);
    lanPushTimers[tableId] = setTimeout(() => { delete lanPushTimers[tableId]; pushLanOrder(tableId); }, 90);
  };
  pushLanConfig = async function () { lanOnline = true; updateLanUI(); return true; };
  startLanPolling = function () { subscribe(); refreshOrders().catch(() => {}); };
  pullLanOrders = async function () { await refreshOrders(); return true; };
  processStaffCompletion = async function () {};

  updateLanUI = async function () {
    const status = $('lanSyncStatus');
    const detail = $('lanSyncDetail');
    const url = $('lanStaffUrl');
    if (status) { status.textContent = lanOnline ? 'CLOUD CONNECTED' : 'RECONNECTING'; status.className = lanOnline ? 'good' : 'warn'; }
    if (detail) detail.textContent = 'Tables, orders and payments sync with every signed-in Administration and Server screen.';
    if (url) url.textContent = location.origin + '/server';
  };

  const localComplete = completeSelection;
  completeSelection = async function (selection, paymentInfo, opts = {}) {
    if (paymentKeys.get('busy')) throw new Error('A payment is already being confirmed.');
    paymentKeys.set('busy', true);
    const table = activeTableId && activeTableId !== 'counter' ? tableById(activeTableId) : null;
    const order = typeof currentOrderMeta === 'function' ? currentOrderMeta() : null;
    const key = crypto.randomUUID();
    try {
      const result = await cloudFetch('/api/ops/payments', {
        method: 'POST',
        body: JSON.stringify({
          idempotency_key: key,
          table_id: table ? table.id : null,
          expected_version: table ? Number(order?._lan_version || 0) : null,
          items: selection.map((item) => ({ menu_item_id: String(item.id), qty: Number(item.qty) })),
          payment: paymentInfo.payment,
          payments: paymentInfo.payments || {},
          cash_received: Number(paymentInfo.cash_received || 0),
          change_due: Number(paymentInfo.change_due || 0),
          non_chargeable: !!opts.nonChargeable,
          non_chargeable_reason: opts.reason || '',
          non_chargeable_note: opts.note || '',
          customer_id: $('posCustomer')?.value || null,
          order_type: $('orderType')?.value || 'Takeaway',
          order_ref: table ? table.name : ($('orderRef')?.value || ''),
          guest_count: Number(order?.guestCount || $('guestCount')?.value || 1),
          discount_type: order?.discountType || $('discountType')?.value || 'percent',
          discount_value: Number(order?.discountValue ?? $('discountValue')?.value ?? 0),
          opened_at: order?.openedAt || null,
          business_day: businessDayKey(),
          time: workingNowIso()
        })
      });
      const bill = result.bill;
      if (bill && !state.bills.some((item) => item.id === bill.id)) state.bills.unshift(bill);
      for (const row of result.stocks || []) {
        const ingredientRow = ingredient(row.key);
        if (ingredientRow) {
          ingredientRow.stock = Number(row.stock);
          ingredientRow.avg_cost = Number(row.avg_cost);
        }
      }
      const cart = table ? (state.tableOrders[table.id]?.cart || []) : state.cart;
      for (const picked of selection) {
        const line = cart.find((item) => String(item.id) === String(picked.id));
        if (!line) continue;
        line.qty -= Number(picked.qty || 0);
        line.served = Math.max(0, Math.min(line.qty, Number(line.served || 0)));
        if (line.qty <= 0) cart.splice(cart.indexOf(line), 1);
      }
      if (table && result.table_closed) {
        delete state.tableOrders[table.id];
        table.attention = false;
        table.reservation = null;
        activeTableId = null;
        $('tableOrderView')?.classList.add('hidden');
        $('tableSelectView')?.classList.remove('hidden');
        renderTableFloor();
      } else if (table && result.order?.order) {
        state.tableOrders[table.id] = result.order.order;
        renderPOSWorkspace();
      } else if (!table && !cart.length) {
        state.cart = [];
        renderCart();
      } else {
        renderCart();
      }
      const customerId = bill?.customer_id;
      if (customerId) {
        const customer = index.customers.get(customerId) || index.customers.get(Number(customerId));
        if (customer) {
          if (!table || result.table_closed) customer.visits = (customer.visits || 0) + 1;
          customer.spend = (customer.spend || 0) + Number(bill.total || 0);
        }
      }
      audit(opts.nonChargeable ? 'non_chargeable_order' : 'sale_completed', `${bill.id} ${bill.payment} ${bill.total}`);
      await persistNow('cloud_payment');
      lastPaidBill = bill;
      showReceipt(bill);
      setActionStatus(`${opts.nonChargeable ? 'Non-chargeable order' : 'Payment'} completed: ${bill.id}${opts.nonChargeable ? '' : ' · ' + rs(bill.total)}`, 'good');
      if (activeSection === 'dashboard') renderDashboard();
      return bill;
    } catch (error) {
      if (error.status === 409) await refreshOrders().catch(() => {});
      throw error;
    } finally {
      paymentKeys.delete('busy');
    }
  };
  void localComplete;

  document.addEventListener('DOMContentLoaded', () => {
    const actions = document.querySelector('.top-actions');
    if (!actions || document.getElementById('cloudLogout')) return;
    const button = document.createElement('button');
    button.className = 'quick-btn';
    button.id = 'cloudLogout';
    button.type = 'button';
    button.textContent = 'Log out';
    button.onclick = async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      try { await window.teaSupabase?.auth?.signOut(); } catch {}
      location.assign('/');
    };
    actions.appendChild(button);
  });

  restoreSession().then(() => window.TEA_AMO_BOOT()).catch((error) => {
    console.error(error);
    location.assign('/');
  });
})();
