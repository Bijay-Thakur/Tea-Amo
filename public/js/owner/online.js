(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const money = (value) => `${(window.state?.business?.currency || 'Rs')} ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  async function load() {
    const box = $('onlineAdminList');
    if (!box) return;
    box.textContent = 'Loading website orders…';
    try {
      const response = await fetch('/api/ops/guest-orders', { credentials: 'include', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load website orders');
      const rows = data.orders || [];
      box.innerHTML = rows.map((row) => {
        const items = (row.items || []).map((item) => `${esc(item.name)} × ${item.qty}`).join(', ');
        const contact = row.contact_redacted ? 'Contact redacted after retention' : `${esc(row.customer_name || '')} · ${esc(row.customer_phone || '')}`;
        const address = row.fulfillment === 'delivery' ? `<div class="muted">${esc(row.delivery_address || '')}${row.landmark ? ' · ' + esc(row.landmark) : ''}</div>` : '<div class="muted">Pickup at TEA AMO</div>';
        return `<article class="card" style="margin-bottom:10px"><div class="srow"><b>${esc(row.public_ref)}</b><span>${esc(row.status)} · ${esc(row.fulfillment)}</span></div><div>${items}</div><div class="muted">${contact}</div>${address}<div class="srow"><span>${money(row.total)} · ${esc(row.payment_status)}</span><span>${esc(row.created_at || '')}</span></div><div class="table-actions" style="margin-top:8px">${row.status === 'pending' ? `<button class="btn small" data-online="${esc(row.id)}" data-next="accepted">Accept</button><button class="btn small danger" data-online="${esc(row.id)}" data-next="rejected">Reject</button>` : ''}${row.status === 'accepted' ? `<button class="btn small" data-online="${esc(row.id)}" data-next="preparing">Prepare</button>` : ''}${row.status === 'preparing' ? `<button class="btn small" data-online="${esc(row.id)}" data-next="ready">Ready</button>` : ''}${row.status === 'ready' && row.fulfillment === 'delivery' ? `<button class="btn small" data-online="${esc(row.id)}" data-next="dispatched">Dispatch</button>` : ''}${row.status === 'ready' && row.fulfillment === 'pickup' ? `<button class="btn small" data-online="${esc(row.id)}" data-next="awaiting_pickup">Hold for pickup</button>` : ''}${['ready', 'dispatched', 'awaiting_pickup'].includes(row.status) ? `<button class="btn small" data-online="${esc(row.id)}" data-pay="1">Collect payment</button>` : ''}</div></article>`;
      }).join('') || '<p class="muted">No website orders yet.</p>';
    } catch (error) {
      box.innerHTML = `<p class="bad">${esc(error.message)}</p>`;
    }
  }

  window.renderOnlineOrders = load;

  document.addEventListener('click', async (event) => {
    if (event.target.id === 'onlineAdminRefresh') return load();
    const button = event.target.closest('#onlineAdminList [data-online]');
    if (!button) return;
    try {
      if (button.dataset.pay) {
        const response = await fetch('/api/ops/guest-orders/' + encodeURIComponent(button.dataset.online), {
          method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collect_payment: true, payment: 'Cash', idempotency_key: crypto.randomUUID() })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Payment was not recorded');
      } else {
        const response = await fetch('/api/ops/guest-orders/' + encodeURIComponent(button.dataset.online), {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: button.dataset.next })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not update the order');
      }
      await load();
    } catch (error) {
      alert(error.message);
    }
  });
})();
