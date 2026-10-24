import { rest, rpc } from './supabase.js';

export function stripPaymentQr(business = {}) {
  const methods = (business.payment_methods || []).map((item) => (typeof item === 'string' ? item : item?.name)).filter(Boolean);
  return {
    name: business.name || 'TEA AMO',
    branch: business.branch || '',
    currency: business.currency || 'Rs',
    taxRate: Number(business.taxRate || 0),
    payment_methods: methods.length ? methods : ['Cash'],
    payment_qr: {}
  };
}

export async function loadWorkspaceBusiness(env) {
  try {
    const row = await rpc(env, 'workspace_business_config', {});
    if (row && typeof row === 'object') return { ...stripPaymentQr(row), generation: Number(row.generation || 1) };
  } catch {
    // Fall back to a targeted document read when the RPC is not deployed yet.
  }
  let rows = [];
  try {
    rows = await rest(env, '/rest/v1/business_documents?name=eq.master&select=name:data->business->>name,branch:data->business->>branch,currency:data->business->>currency,tax_rate:data->business->taxRate,payment_methods:data->business->payment_methods,generation:operational_generation');
  } catch {
    rows = await rest(env, '/rest/v1/business_documents?name=eq.master&select=name:data->business->>name,branch:data->business->>branch,currency:data->business->>currency,tax_rate:data->business->taxRate,payment_methods:data->business->payment_methods');
  }
  const raw = rows?.[0] || {};
  return {
    ...stripPaymentQr({
      name: raw.name,
      branch: raw.branch,
      currency: raw.currency,
      taxRate: raw.tax_rate,
      payment_methods: raw.payment_methods
    }),
    generation: Number(raw.generation || 1)
  };
}

export async function loadPaymentQr(env, method) {
  const wanted = String(method || '').trim();
  if (!wanted) return '';
  try {
    const row = await rpc(env, 'payment_qr_for_method', { p_method: wanted });
    if (typeof row === 'string') return row;
    if (row && typeof row === 'object') return row.image || row.qr || '';
  } catch {
    // Compatibility path for deployments that have not received the slim RPC yet.
  }
  const rows = await rest(env, '/rest/v1/business_documents?name=eq.master&select=data->business->payment_qr');
  const qr = rows?.[0]?.payment_qr || rows?.[0]?.business || {};
  return typeof qr === 'object' ? String(qr[wanted] || '') : '';
}

export function collectOrders(rows) {
  const orders = {};
  for (const row of rows || []) {
    orders[row.table_id] = {
      version: row.version,
      attention: row.attention,
      order: {
        cart: (row.order_items || []).map((item) => ({
          id: /^[0-9]+$/.test(String(item.menu_item_id)) ? Number(item.menu_item_id) : item.menu_item_id,
          qty: item.qty,
          served: item.served_qty
        })),
        openedAt: row.opened_at,
        customerId: null,
        discountType: row.discount_type || 'percent',
        discountValue: Number(row.discount_value || 0),
        orderRef: row.order_ref || '',
        orderType: row.order_type || 'Dine-in',
        guestCount: row.guest_count || 1,
        _lan_version: row.version,
        _lan_updated_by: row.updated_by_name || ''
      },
      updated_by: row.updated_by_name || ''
    };
  }
  return orders;
}
