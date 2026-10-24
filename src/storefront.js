import { rest, rpc } from './supabase.js';
import { menuImageUrl, stripPaymentQr } from './slim.js';

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 8;
const attempts = new Map();
const DEFAULT_RETENTION_DAYS = 90;

export const GUEST_STATUSES = [
  'pending', 'accepted', 'preparing', 'ready', 'dispatched', 'awaiting_pickup',
  'completed', 'rejected', 'cancelled', 'failed'
];

export function validNepalPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.startsWith('977') ? digits.slice(3) : digits;
  return /^(9[6-8]\d{8}|0?[1-9]\d{6,8})$/.test(local);
}

export function clientKey(request) {
  const forwarded = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'local';
}

export function rateLimitCheckout(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) return { ok: false, retry_after: Math.ceil((RATE_WINDOW_MS - (now - list[0])) / 1000) };
  list.push(now);
  attempts.set(key, list);
  return { ok: true };
}

export function defaultStorefront() {
  return {
    enabled: true,
    pickupEnabled: true,
    deliveryEnabled: false,
    orderingPaused: false,
    minOrder: 0,
    deliveryFee: 0,
    prepMinutes: 25,
    deliveryMinutes: 0,
    hours: '',
    address: 'Gokarna, Kathmandu, Nepal',
    phone: '',
    email: '',
    mapUrl: '',
    social: { facebook: '', instagram: '', tiktok: '' },
    about: 'TEA AMO is a café in Gokarna, Kathmandu. This website uses the same live menu as the café counter.',
    legalName: 'TEA AMO',
    registration: '',
    pan: '',
    vat: '',
    ecommerceListing: '',
    complaintContact: '',
    zones: [],
    policiesPublished: false,
    policiesUpdatedAt: '',
    contactRetentionDays: DEFAULT_RETENTION_DAYS,
    heroTag: 'Café in Gokarna, Kathmandu',
    featuredCategory: ''
  };
}

export function mergeStorefront(raw) {
  return { ...defaultStorefront(), ...(raw && typeof raw === 'object' ? raw : {}) };
}

export async function loadMasterData(env) {
  try {
    const rows = await rest(env, '/rest/v1/business_documents?name=eq.master&select=data,revision,operational_generation');
    return rows?.[0] || null;
  } catch (error) {
    if (!/operational_generation|schema cache|column/i.test(String(error.message || error))) throw error;
    const rows = await rest(env, '/rest/v1/business_documents?name=eq.master&select=data,revision');
    const row = rows?.[0];
    if (row) row.operational_generation = Number(row.data?.operationalGeneration || 1);
    return row || null;
  }
}

export function publicBusiness(data = {}) {
  const business = data.business || {};
  const site = mergeStorefront(data.storefront);
  return {
    name: business.name || 'TEA AMO',
    branch: business.branch || '',
    currency: business.currency || 'Rs',
    taxRate: Number(business.taxRate || 0),
    ...stripPaymentQr(business),
    storefront: {
      ...site,
      social: site.social || {}
    }
  };
}

export async function loadPublicMenu(env) {
  const attempts = [
    '/rest/v1/menu_items?active=eq.true&select=id,name,category,price,image_url,description&order=category.asc,name.asc',
    '/rest/v1/menu_items?active=eq.true&select=id,name,category,price,image_url&order=category.asc,name.asc',
    '/rest/v1/menu_items?active=eq.true&select=id,name,category,price&order=category.asc,name.asc'
  ];
  let rows = [];
  let lastError;
  for (const path of attempts) {
    try {
      rows = await rest(env, path);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!/description|image_url|schema cache|column/i.test(String(error?.message || error))) throw error;
    }
  }
  if (lastError) throw lastError;
  return (rows || []).map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category || 'Menu',
    price: Number(item.price || 0),
    image_url: menuImageUrl(item),
    description: item.description || '',
    available: true
  }));
}

export function quoteItems(menu, items, site, fulfillment) {
  const byId = new Map((menu || []).map((item) => [String(item.id), item]));
  const lines = [];
  for (const item of items || []) {
    const qty = Math.max(0, Math.floor(Number(item.qty || 0)));
    if (!qty) continue;
    const menuItem = byId.get(String(item.id ?? item.menu_item_id));
    if (!menuItem || menuItem.available === false) {
      const error = new Error(`${item.name || 'An item'} is no longer available.`);
      error.status = 409;
      error.code = 'unavailable';
      throw error;
    }
    const submitted = item.unit_price ?? item.price;
    if (submitted != null && Number(submitted) !== Number(menuItem.price)) {
      const error = new Error(`The price for ${menuItem.name} changed. Review your cart before placing the order.`);
      error.status = 409;
      error.code = 'price_changed';
      error.item = { id: menuItem.id, name: menuItem.name, price: menuItem.price };
      throw error;
    }
    lines.push({
      menu_item_id: String(menuItem.id),
      name: menuItem.name,
      unit_price: Number(menuItem.price),
      qty,
      line_total: Number(menuItem.price) * qty
    });
  }
  if (!lines.length) {
    const error = new Error('Add at least one available item.');
    error.status = 400;
    throw error;
  }
  const subtotal = lines.reduce((sum, line) => sum + line.line_total, 0);
  const tax = subtotal * Number(site.taxRate || 0) / 100;
  let deliveryFee = 0;
  if (fulfillment === 'delivery') {
    deliveryFee = Math.max(0, Number(site.storefront?.deliveryFee || 0));
    const minOrder = Math.max(0, Number(site.storefront?.minOrder || 0));
    if (minOrder && subtotal < minOrder) {
      const error = new Error(`Delivery orders need a minimum of ${site.currency || 'Rs'} ${minOrder}.`);
      error.status = 409;
      throw error;
    }
  }
  return {
    lines,
    subtotal,
    tax,
    delivery_fee: deliveryFee,
    total: subtotal + tax + deliveryFee
  };
}

function requireStorefrontOpen(site, fulfillment) {
  const cfg = site.storefront || defaultStorefront();
  if (!cfg.enabled || cfg.orderingPaused) {
    const error = new Error('Online ordering is paused. Please visit the café or try again later.');
    error.status = 409;
    throw error;
  }
  if (fulfillment === 'delivery' && !cfg.deliveryEnabled) {
    const error = new Error('Delivery is not available right now. Choose pickup or contact the café.');
    error.status = 409;
    throw error;
  }
  if (fulfillment === 'pickup' && !cfg.pickupEnabled) {
    const error = new Error('Pickup is not available right now.');
    error.status = 409;
    throw error;
  }
}

export function validateGuestDetails(body) {
  const fulfillment = body.fulfillment === 'delivery' ? 'delivery' : body.fulfillment === 'pickup' ? 'pickup' : '';
  if (!fulfillment) {
    const error = new Error('Choose delivery or pickup.');
    error.status = 400;
    throw error;
  }
  const name = String(body.customer_name || '').trim();
  const phone = String(body.customer_phone || '').trim();
  if (name.length < 2 || name.length > 80) {
    const error = new Error('Enter the name we should put on this order.');
    error.status = 400;
    throw error;
  }
  if (!validNepalPhone(phone)) {
    const error = new Error('Enter a valid Nepal phone number.');
    error.status = 400;
    throw error;
  }
  const address = String(body.delivery_address || '').trim();
  const landmark = String(body.landmark || '').trim().slice(0, 120);
  const instructions = String(body.instructions || '').trim().slice(0, 280);
  if (fulfillment === 'delivery') {
    if (address.length < 6 || address.length > 240) {
      const error = new Error('Enter the delivery address for this order.');
      error.status = 400;
      throw error;
    }
  }
  const payment = fulfillment === 'delivery' ? 'cash_on_delivery' : 'pay_at_pickup';
  return { fulfillment, name, phone, address: fulfillment === 'delivery' ? address : '', landmark, instructions, payment };
}

export async function placeGuestOrder(env, body, request) {
  const limited = rateLimitCheckout(clientKey(request));
  if (!limited.ok) {
    const error = new Error('Too many checkout attempts. Please wait a few minutes and try again.');
    error.status = 429;
    error.retry_after = limited.retry_after;
    throw error;
  }
  const idempotency = String(body.idempotency_key || '').trim();
  if (!/^[a-zA-Z0-9._-]{8,80}$/.test(idempotency)) {
    const error = new Error('This order could not be submitted. Reload and try once more.');
    error.status = 400;
    throw error;
  }
  const details = validateGuestDetails(body);
  const master = await loadMasterData(env);
  const site = publicBusiness(master?.data || {});
  requireStorefrontOpen(site, details.fulfillment);
  const menu = await loadPublicMenu(env);
  const quote = quoteItems(menu, body.items, site, details.fulfillment);
  const generation = Number(master?.operational_generation || master?.data?.operationalGeneration || 1);
  const result = await rpc(env, 'place_guest_order', {
    p_idempotency_key: idempotency,
    p_fulfillment: details.fulfillment,
    p_payment_method: details.payment,
    p_customer_name: details.name,
    p_customer_phone: details.phone,
    p_delivery_address: details.address,
    p_landmark: details.landmark,
    p_instructions: details.instructions,
    p_items: quote.lines,
    p_subtotal: quote.subtotal,
    p_tax: quote.tax,
    p_delivery_fee: quote.delivery_fee,
    p_total: quote.total,
    p_currency: site.currency || 'Rs',
    p_generation: generation
  });
  if (!result?.id) {
    const error = new Error(result?.error || 'The order was not accepted.');
    error.status = 500;
    throw error;
  }
  return result;
}

export function publicGuestOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    public_ref: row.public_ref,
    access_token: row.access_token,
    status: row.status,
    fulfillment: row.fulfillment,
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    items: row.items,
    subtotal: Number(row.subtotal || 0),
    tax: Number(row.tax || 0),
    delivery_fee: Number(row.delivery_fee || 0),
    total: Number(row.total || 0),
    currency: row.currency || 'Rs',
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function staffGuestOrder(row) {
  return {
    ...publicGuestOrder(row),
    customer_name: row.contact_redacted_at ? '' : row.customer_name,
    customer_phone: row.contact_redacted_at ? '' : row.customer_phone,
    delivery_address: row.contact_redacted_at ? '' : row.delivery_address,
    landmark: row.contact_redacted_at ? '' : row.landmark,
    instructions: row.instructions || '',
    contact_redacted: !!row.contact_redacted_at,
    sale_id: row.sale_id || null,
    accepted_by_name: row.accepted_by_name || ''
  };
}

export async function guestOrderByToken(env, token) {
  const rows = await rest(env, `/rest/v1/guest_orders?access_token=eq.${encodeURIComponent(token)}&select=*`);
  return rows?.[0] || null;
}

export async function listGuestOrders(env, { status } = {}) {
  const filter = status ? `&status=eq.${encodeURIComponent(status)}` : '';
  return await rest(env, `/rest/v1/guest_orders?select=*&order=created_at.desc&limit=200${filter}`) || [];
}

const TRANSITIONS = {
  accepted: ['pending'],
  preparing: ['accepted', 'pending'],
  ready: ['preparing', 'accepted'],
  dispatched: ['ready'],
  awaiting_pickup: ['ready'],
  completed: ['ready', 'dispatched', 'awaiting_pickup', 'accepted'],
  rejected: ['pending'],
  cancelled: ['pending', 'accepted'],
  failed: ['pending', 'accepted', 'preparing', 'ready', 'dispatched', 'awaiting_pickup']
};

export async function updateGuestOrder(env, id, body, session) {
  const rows = await rest(env, `/rest/v1/guest_orders?id=eq.${encodeURIComponent(id)}&select=*`);
  const row = rows?.[0];
  if (!row) {
    const error = new Error('Order not found');
    error.status = 404;
    throw error;
  }
  const next = String(body.status || '').trim();
  if (!TRANSITIONS[next]) {
    const error = new Error('Unknown order status');
    error.status = 400;
    throw error;
  }
  if (!TRANSITIONS[next].includes(row.status)) {
    const error = new Error(`This order cannot move from ${row.status} to ${next}.`);
    error.status = 409;
    throw error;
  }
  const patch = {
    status: next,
    updated_at: new Date().toISOString(),
    accepted_by: row.accepted_by || session?.profile?.id || null,
    accepted_by_name: row.accepted_by_name || session?.profile?.display_name || ''
  };
  if (next === 'rejected' || next === 'cancelled' || next === 'failed') {
    patch.closed_reason = String(body.reason || next).slice(0, 180);
  }
  const updated = await rest(env, `/rest/v1/guest_orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: patch
  });
  return updated?.[0] || { ...row, ...patch };
}

export async function saveStorefront(env, incoming) {
  const row = await loadMasterData(env);
  if (!row?.data) {
    const error = new Error('The café record is not available.');
    error.status = 409;
    throw error;
  }
  const storefront = mergeStorefront({ ...row.data.storefront, ...incoming });
  const data = { ...row.data, storefront, stateUpdatedAt: new Date().toISOString() };
  const updated = await rest(env, `/rest/v1/business_documents?name=eq.master&revision=eq.${Number(row.revision || 0)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { revision: Number(row.revision || 0) + 1, data, updated_at: new Date().toISOString() }
  });
  if (!updated?.length) {
    const error = new Error('The café record changed on another screen. Reload and try again.');
    error.status = 409;
    throw error;
  }
  return { revision: Number(updated[0].revision), storefront };
}
