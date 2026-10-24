import { json, text, redirect, readJson } from './http.js';
import { configured, uploadMenuImageObject, deleteMenuImageObject } from './supabase.js';
import { establish, applySession, homeFor, loginResponse, logoutResponse, requireRole } from './session.js';
import { passwordGrant, rest, rpc } from './supabase.js';
import {
  assertLoginAllowed, clearLoginFailures, completePayment, createServerAccount, findLogin,
  listServers, loadOperational, loadPaymentQr, markLogin, orderPayload, projectState,
  publicProfile, recordLoginFailure, resetServerPassword, rpcStatus, saveMaster, saveOrder,
  reserveTable, seatTable, setServerActive, setTableAttention, updateServer, workspaceForServer
} from './ops.js';
import { collectOrders } from './slim.js';
import { previewOperationalReset, runOperationalReset, saveDashboardBaseline } from './reset.js';
import {
  guestOrderByToken, listGuestOrders, loadMasterData, loadPublicMenu, placeGuestOrder,
  publicBusiness, publicGuestOrder, saveStorefront, staffGuestOrder, updateGuestOrder
} from './storefront.js';

const OWNER_SECTIONS = ['dashboard', 'pos', 'dayclose', 'online', 'staff', 'servers', 'menuadmin', 'inventory', 'recipes', 'wastage', 'vendors', 'expenses', 'capital', 'customers', 'dailyreport', 'reports', 'dining', 'settings'];
const STAFF_LOGIN = '/staff/login';
const PUBLIC_PAGES = {
  '/': { page: 'home', title: 'TEA AMO — Café in Gokarna, Kathmandu' },
  '/menu': { page: 'menu', title: 'Menu — TEA AMO' },
  '/cart': { page: 'cart', title: 'Cart — TEA AMO' },
  '/checkout': { page: 'checkout', title: 'Checkout — TEA AMO' },
  '/order/confirmation': { page: 'confirmation', title: 'Order confirmation — TEA AMO' },
  '/delivery': { page: 'delivery', title: 'Delivery & pickup — TEA AMO' },
  '/about': { page: 'about', title: 'About — TEA AMO' },
  '/contact': { page: 'contact', title: 'Contact — TEA AMO' },
  '/faq': { page: 'faq', title: 'FAQ — TEA AMO' },
  '/privacy-policy': { page: 'privacy', title: 'Privacy policy — TEA AMO' },
  '/terms': { page: 'terms', title: 'Terms — TEA AMO' },
  '/delivery-policy': { page: 'delivery-policy', title: 'Delivery, cancellation & refunds — TEA AMO' }
};

function missingConfig() {
  return text(`<!doctype html><html><head><meta charset="utf-8"><title>TEA AMO</title></head><body style="font-family:Nunito,sans-serif;padding:32px"><h1>TEA AMO</h1><p>This deployment does not have Supabase credentials yet. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, then reload.</p></body></html>`, 503);
}

async function assetText(env, request, assetPath) {
  const response = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url)));
  if (!response.ok) throw new Error(`Missing ${assetPath}`);
  return response.text();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

async function publicPage(env, request, spec, path) {
  const [shell, body] = await Promise.all([
    assetText(env, request, '/site/shell.html'),
    assetText(env, request, `/site/pages/${spec.page}.html`)
  ]);
  return text(shell
    .replaceAll('{{TITLE}}', escapeHtml(spec.title))
    .replaceAll('{{PATH}}', escapeHtml(path))
    .replace('<!--PAGE-->', body));
}

async function serverPage(env, request, session) {
  const [html, workspace] = await Promise.all([
    assetText(env, request, '/server/index.html'),
    workspaceForServer(env, session.access, session.profile)
  ]);
  const boot = `<script>window.TEA_AMO_CLOUD=${JSON.stringify({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY })};window.TEA_AMO_SESSION=${JSON.stringify({
    role: session.profile.role,
    home: homeFor(session.profile.role),
    access_token: session.access,
    refresh_token: session.refresh,
    profile: publicProfile(session.profile)
  })};window.TEA_AMO_WORKSPACE=${JSON.stringify(workspace)};</script>`;
  return text(html.replace('<!--BOOT-->', boot));
}

async function ownerPage(env, request) {
  const sections = (await Promise.all(OWNER_SECTIONS.map((name) => assetText(env, request, `/owner/sections/${name}.html`)))).join('\n');
  const shell = await assetText(env, request, '/owner/shell.html');
  const boot = `<script>window.TEA_AMO_CLOUD=${JSON.stringify({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY })};</script>\n<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.js"></script>`;
  return shell
    .replace('<!--SIDEBAR-->', await assetText(env, request, '/owner/partials/sidebar.html'))
    .replace('<!--TOPBAR-->', await assetText(env, request, '/owner/partials/topbar.html'))
    .replace('<!--SECTIONS-->', sections)
    .replace('<!--MODALS-->', await assetText(env, request, '/owner/partials/modals.html'))
    .replace('<!--CLOUD_BOOT-->', boot);
}

async function serveAsset(env, request, assetPath) {
  const response = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url)));
  if (!response.ok) return text('Not found', 404, 'text/plain; charset=utf-8');
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: 200, headers });
}

async function guardedPage(request, env, role, html) {
  const session = await establish(request, env);
  if (!session || session.inactive) return redirect(STAFF_LOGIN, session?.inactive ? logoutCookies(request) : []);
  if (session.profile.role !== role) return redirect(homeFor(session.profile.role));
  const response = await html();
  return applySession(response, request, session);
}

function logoutCookies(request) {
  const secure = new URL(request.url).protocol === 'https:';
  const base = `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
  return [`tea_access=; ${base}`, `tea_refresh=; ${base}`];
}

async function login(request, env) {
  const body = await readJson(request, 64 * 1024);
  const identifier = String(body.username || body.email || '').trim();
  const intended = body.role === 'admin' ? 'admin' : body.role === 'server_staff' ? 'server_staff' : '';
  if (!identifier || !body.password) return json({ error: 'Enter your username and password.' }, 400);
  await assertLoginAllowed(env, identifier);
  const found = await findLogin(env, identifier);
  if (!found || (intended && found.profile.role !== intended)) {
    await recordLoginFailure(env, identifier);
    return json({ error: 'Those credentials were not accepted.' }, 401);
  }
  if (!found.profile.active) return json({ error: 'This account is disabled.' }, 403);
  let session;
  try {
    session = await passwordGrant(env, found.email, body.password);
  } catch {
    await recordLoginFailure(env, identifier);
    return json({ error: 'Those credentials were not accepted.' }, 401);
  }
  await clearLoginFailures(env, identifier);
  await markLogin(env, found.profile.id);
  return loginResponse(request, session, {
    role: found.profile.role,
    home: homeFor(found.profile.role),
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    profile: publicProfile(found.profile)
  });
}

async function adminState(request, env, session) {
  if (request.method === 'GET') {
    const rows = await rest(env, '/rest/v1/business_documents?name=eq.master&select=revision,data');
    if (!rows?.[0]?.data?.menu) return json({ state: null, revision: Number(rows?.[0]?.revision || 0) });
    const operational = await loadOperational(env);
    const state = projectState(rows[0], operational);
    return json({ state, revision: Number(rows[0].revision || 0) });
  }
  if (request.method === 'PUT') {
    const body = await readJson(request, 128 * 1024 * 1024);
    if (!body.state || typeof body.state !== 'object' || !Array.isArray(body.state.menu)) return json({ error: 'Invalid TEA AMO state payload' }, 400);
    try {
      const saved = await saveMaster(env, body.state, body.expected_revision);
      return json({ ok: true, ...saved, saved_at: new Date().toISOString() });
    } catch (error) {
      if (error.status === 409) return json({ error: error.code === 'stale_generation' ? 'This browser copy is from before a system reset. Reload TEA AMO.' : 'The café record changed on another screen. Reload and try again.', code: error.code || 'conflict' }, 409);
      throw error;
    }
  }
  return json({ error: 'Method not allowed' }, 405);
}

function decodeImage(data) {
  const clean = String(data || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function imageKind(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return '';
}

async function menuImageRequest(request, env) {
  try {
    const body = await readJson(request, 3 * 1024 * 1024);
    if (request.method === 'DELETE') {
      const removed = await deleteMenuImageObject(env, body.image_url || '');
      return json({ ok: removed }, removed ? 200 : 404);
    }
    const menuId = String(body.menu_id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    if (!menuId) return json({ error: 'Choose a menu item before uploading a photo.' }, 400);
    const bytes = decodeImage(body.data_base64);
    if (!bytes.length || bytes.length > 1.5 * 1024 * 1024) return json({ error: 'Use a photo under 1.5 MB.' }, 400);
    const kind = imageKind(bytes);
    if (!kind) return json({ error: 'Use a JPG, PNG, or WebP image.' }, 400);
    const ext = kind === 'image/png' ? 'png' : kind === 'image/webp' ? 'webp' : 'jpg';
    const previous = body.previous_url || '';
    const imageUrl = await uploadMenuImageObject(env, `${menuId}/${Date.now()}.${ext}`, bytes, kind);
    if (previous && previous !== imageUrl) await deleteMenuImageObject(env, previous);
    return json({ image_url: imageUrl });
  } catch (error) {
    return json({ error: error.message || 'Image upload failed' }, error.status || 500);
  }
}

async function handleOps(request, env, path) {
  const auth = await requireRole(request, env, null);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const { session } = auth;
  try {
    if (path === '/api/ops/stocks' && request.method === 'GET') {
      if (session.profile.role !== 'admin') return json({ error: 'Forbidden' }, 403);
      return json({ stocks: await rest(env, '/rest/v1/ingredients?select=key,stock,avg_cost') || [] });
    }
    const orderMatch = path.match(/^\/api\/ops\/orders\/([^/]+)$/);
    if (orderMatch && request.method === 'GET') return json(await orderPayload(env, decodeURIComponent(orderMatch[1]), session.access));
    if (orderMatch && request.method === 'PUT') {
      const result = await saveOrder(env, session.access, decodeURIComponent(orderMatch[1]), await readJson(request));
      return applySession(json(result), request, session);
    }
    if (orderMatch && request.method === 'DELETE') {
      const current = await orderPayload(env, decodeURIComponent(orderMatch[1]), session.access);
      const result = await saveOrder(env, session.access, decodeURIComponent(orderMatch[1]), { expected_version: current.version, items: [], order: { cart: [] } });
      return applySession(json(result), request, session);
    }
    if (path === '/api/ops/orders' && request.method === 'GET') {
      const [rows, tables, incoming] = await Promise.all([
        rest(env, '/rest/v1/live_orders?select=*,order_items(menu_item_id,qty,served_qty)', { token: session.access }),
        rest(env, '/rest/v1/cafe_tables?select=id,seated,reservation,attention', { token: session.access }),
        listGuestOrders(env).catch(() => [])
      ]);
      const orders = collectOrders(rows);
      return applySession(json({
        orders,
        completions: [],
        tables: tables || [],
        guest_orders: (incoming || []).map(staffGuestOrder)
      }), request, session);
    }
    if (path === '/api/ops/guest-orders' && request.method === 'GET') {
      return applySession(json({ orders: (await listGuestOrders(env).catch(() => [])).map(staffGuestOrder) }), request, session);
    }
    const guestMatch = path.match(/^\/api\/ops\/guest-orders\/([^/]+)$/);
    if (guestMatch && request.method === 'POST') {
      const result = await updateGuestOrder(env, decodeURIComponent(guestMatch[1]), await readJson(request), session);
      return applySession(json({ order: staffGuestOrder(result) }), request, session);
    }
    if (guestMatch && request.method === 'PUT') {
      const body = await readJson(request);
      const current = (await listGuestOrders(env).catch(() => [])).find((row) => row.id === decodeURIComponent(guestMatch[1]));
      if (!current) return json({ error: 'Order not found' }, 404);
      if (body.status && body.status !== current.status) {
        await updateGuestOrder(env, current.id, { status: body.status, reason: body.reason }, session);
      }
      if (body.collect_payment) {
        const result = await completePayment(env, session.access, {
          idempotency_key: body.idempotency_key || `guest-${current.id}`,
          table_id: null,
          items: (current.items || []).map((item) => ({ menu_item_id: item.menu_item_id, qty: item.qty })),
          payment: body.payment || (current.fulfillment === 'delivery' ? 'Cash' : 'Cash'),
          payments: body.payments || {},
          cash_received: Number(body.cash_received || current.total || 0),
          change_due: Number(body.change_due || 0),
          order_type: current.fulfillment === 'delivery' ? 'Delivery' : 'Takeaway',
          order_ref: current.public_ref,
          guest_count: 1,
          discount_type: 'percent',
          discount_value: 0
        });
        await rest(env, `/rest/v1/guest_orders?id=eq.${encodeURIComponent(current.id)}`, {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: { payment_status: 'paid', sale_id: result.bill?.id || null, status: 'completed', updated_at: new Date().toISOString() }
        });
        return applySession(json({ ok: true, bill: result.bill }), request, session);
      }
      return applySession(json({ order: staffGuestOrder(current) }), request, session);
    }
    if (path === '/api/ops/payments' && request.method === 'POST') {
      const result = await completePayment(env, session.access, await readJson(request));
      return applySession(json(result), request, session);
    }
    if (path === '/api/ops/presence' && request.method === 'POST') {
      await rpc(env, 'touch_presence', {}, session.access);
      return applySession(json({ ok: true }), request, session);
    }
  } catch (error) {
    const mapped = rpcStatus(error);
    return json({ error: mapped.error, code: mapped.code || 'error' }, mapped.status);
  }
  return json({ error: 'Unknown endpoint' }, 404);
}

async function handleAdmin(request, env, path) {
  const auth = await requireRole(request, env, 'admin');
  if (auth.error) return json({ error: auth.error }, auth.status);
  if (path === '/api/admin/state') return applySession(await adminState(request, env, auth.session), request, auth.session);
  if (path === '/api/admin/menu-images' && (request.method === 'POST' || request.method === 'DELETE')) {
    return applySession(await menuImageRequest(request, env), request, auth.session);
  }
  if (path === '/api/admin/servers' && request.method === 'GET') return json({ servers: await listServers(env) });
  if (path === '/api/admin/servers' && request.method === 'POST') {
    try {
      return json(await createServerAccount(env, await readJson(request, 64 * 1024)));
    } catch (error) {
      return json({ error: error.message || 'Could not create the server account' }, error.status || 500);
    }
  }
  if (path === '/api/admin/staff' && request.method === 'GET') {
    const rows = await rest(env, '/rest/v1/staff?select=id,name,role,active&order=name.asc');
    return json({ staff: rows || [] });
  }
  const serverMatch = path.match(/^\/api\/admin\/servers\/([^/]+)(?:\/(password|disable|enable))?$/);
  if (serverMatch) {
    const id = decodeURIComponent(serverMatch[1]);
    const action = serverMatch[2];
    try {
      if (!action && request.method === 'PATCH') return json({ server: await updateServer(env, id, await readJson(request, 64 * 1024)) });
      if (action === 'password' && request.method === 'POST') {
        const body = await readJson(request, 64 * 1024);
        await resetServerPassword(env, id, body.password);
        return json({ ok: true });
      }
      if (action === 'disable' && request.method === 'POST') {
        await setServerActive(env, id, false);
        return json({ ok: true });
      }
      if (action === 'enable' && request.method === 'POST') {
        await setServerActive(env, id, true);
        return json({ ok: true });
      }
    } catch (error) {
      return json({ error: error.message || 'Request failed' }, error.status || 500);
    }
  }
  if (path === '/api/admin/config' && request.method === 'POST') return json({ ok: true });
  if (path === '/api/admin/orders' && request.method === 'GET') {
    const rows = await rest(env, '/rest/v1/live_orders?select=*,order_items(menu_item_id,qty,served_qty)');
    const orders = collectOrders(rows);
    return json({ orders, completions: [], guest_orders: (await listGuestOrders(env).catch(() => [])).map(staffGuestOrder) });
  }
  if (path === '/api/admin/reset/preview' && request.method === 'GET') {
    return json(await previewOperationalReset(env));
  }
  if (path === '/api/admin/reset/dashboard' && request.method === 'POST') {
    const body = await readJson(request, 64 * 1024);
    return json({ ok: true, ...(await saveDashboardBaseline(env, body.baseline ?? null)) });
  }
  if (path === '/api/admin/reset/operational' && request.method === 'POST') {
    try {
      const body = await readJson(request, 256 * 1024);
      const result = await runOperationalReset(env, { password: body.password, phrase: body.phrase, actor: auth.session.profile });
      return json(result, result.verified ? 200 : 409);
    } catch (error) {
      return json({ error: error.message || 'Reset failed', verified: false, result: error.result || null }, error.status || 500);
    }
  }
  if (path === '/api/admin/storefront' && request.method === 'GET') {
    const row = await loadMasterData(env);
    return json({ storefront: publicBusiness(row?.data || {}).storefront, revision: Number(row?.revision || 0) });
  }
  if (path === '/api/admin/storefront' && request.method === 'POST') {
    try {
      return json({ ok: true, ...(await saveStorefront(env, (await readJson(request, 256 * 1024)).storefront || {})) });
    } catch (error) {
      return json({ error: error.message || 'Could not save website settings' }, error.status || 500);
    }
  }
  const legacyOrder = path.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (legacyOrder && request.method === 'PUT') {
    try {
      const result = await saveOrder(env, auth.session.access, decodeURIComponent(legacyOrder[1]), await readJson(request));
      return json(result);
    } catch (error) {
      const mapped = rpcStatus(error);
      return json({ error: mapped.error }, mapped.status);
    }
  }
  if (legacyOrder && request.method === 'DELETE') {
    const id = decodeURIComponent(legacyOrder[1]);
    const current = await orderPayload(env, id, auth.session.access);
    const result = await saveOrder(env, auth.session.access, id, { expected_version: current.version, items: [] });
    return json(result);
  }
  if (path.startsWith('/api/admin/completions/')) return json({ ok: true });
  return json({ error: 'Unknown admin endpoint' }, 404);
}

async function handleServer(request, env, path) {
  const auth = await requireRole(request, env, 'server_staff');
  if (auth.error) return json({ error: auth.error }, auth.status);
  if (path === '/api/server/workspace' && request.method === 'GET') {
    return applySession(json(await workspaceForServer(env, auth.session.access, auth.session.profile)), request, auth.session);
  }
  if (path === '/api/server/guest-orders' && request.method === 'GET') {
    return json({ orders: (await listGuestOrders(env).catch(() => [])).map(staffGuestOrder) });
  }
  const qrMatch = path.match(/^\/api\/server\/payment-qr\/([^/]+)$/);
  if (qrMatch && request.method === 'GET') {
    return json({ method: decodeURIComponent(qrMatch[1]), image: await loadPaymentQr(env, decodeURIComponent(qrMatch[1])) });
  }
  const orderMatch = path.match(/^\/api\/server\/orders\/([^/]+)$/);
  if (orderMatch && request.method === 'GET') return json(await orderPayload(env, decodeURIComponent(orderMatch[1]), auth.session.access));
  const tableAction = path.match(/^\/api\/server\/tables\/([^/]+)$/);
  if (tableAction && request.method === 'POST') {
    const id = decodeURIComponent(tableAction[1]);
    const body = await readJson(request);
    try {
      if (body.action === 'occupy') return json(await seatTable(env, id, true, auth.session.profile));
      if (body.action === 'leave') return json(await seatTable(env, id, false, auth.session.profile));
      if (body.action === 'reserve') return json(await reserveTable(env, id, body.reservation || null, auth.session.profile));
      if (body.action === 'attention') return json(await setTableAttention(env, id, !!body.attention, auth.session.profile));
      return json({ error: 'Unknown table action' }, 400);
    } catch (error) {
      return json({ error: error.message || 'Could not update the table' }, error.status || 500);
    }
  }
  if (path === '/api/server/presence' && request.method === 'POST') {
    await rpc(env, 'touch_presence', {}, auth.session.access);
    return json({ ok: true });
  }
  return json({ error: 'Unknown server endpoint' }, 404);
}

export async function handle(request, env) {
  try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (!configured(env) && path !== '/favicon.ico') return missingConfig();

      if (path === '/api/auth/config' && request.method === 'GET') {
        return json({ configured: true, url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
      }
      if (path === '/api/auth/login' && request.method === 'POST') return login(request, env);
      if (path === '/api/auth/logout' && request.method === 'POST') return logoutResponse(request);
      if (path === '/api/auth/session' && request.method === 'GET') {
        const session = await establish(request, env);
        if (!session || session.inactive) return session?.inactive ? logoutResponse(request) : json({ error: 'Authentication required' }, 401);
        return applySession(json({
          profile: publicProfile(session.profile),
          role: session.profile.role,
          home: homeFor(session.profile.role),
          access_token: session.access,
          refresh_token: session.refresh
        }), request, session);
      }
      if (path === '/api/network' && request.method === 'GET') {
        return json({ staff_urls: [new URL('/server', request.url).href], port: url.port || (url.protocol === 'https:' ? 443 : 80) });
      }
      if (path === '/api/public/cafe' && request.method === 'GET') {
        const row = await loadMasterData(env);
        return json({ cafe: publicBusiness(row?.data || {}) });
      }
      if (path === '/api/public/menu' && request.method === 'GET') {
        const [row, menu] = await Promise.all([loadMasterData(env), loadPublicMenu(env)]);
        return json({ cafe: publicBusiness(row?.data || {}), menu });
      }
      if (path === '/api/public/orders' && request.method === 'POST') {
        try {
          const result = await placeGuestOrder(env, await readJson(request, 256 * 1024), request);
          return json({ ok: true, order: publicGuestOrder(result) }, 201);
        } catch (error) {
          return json({ error: error.message || 'Could not place the order', code: error.code || 'error', item: error.item || null }, error.status || 500);
        }
      }
      const publicOrder = path.match(/^\/api\/public\/orders\/([^/]+)$/);
      if (publicOrder && request.method === 'GET') {
        const row = await guestOrderByToken(env, decodeURIComponent(publicOrder[1]));
        if (!row) return json({ error: 'Order not found' }, 404);
        return json({ order: publicGuestOrder(row) });
      }

      if (path.startsWith('/api/ops/')) return handleOps(request, env, path);
      if (path.startsWith('/api/admin/')) return handleAdmin(request, env, path);
      if (path.startsWith('/api/server/')) return handleServer(request, env, path);
      if (path.startsWith('/api/staff/')) return json({ error: 'Staff PIN login has been retired. Sign in at /staff/login.' }, 410);

      if (path === '/staff/login' || path === '/login') {
        const session = await establish(request, env);
        if (session?.profile?.active) return redirect(homeFor(session.profile.role));
        return serveAsset(env, request, '/auth/gate.html');
      }
      if (path === '/admin') return guardedPage(request, env, 'admin', async () => text(await ownerPage(env, request)));
      if (path === '/server') {
        const session = await establish(request, env);
        if (!session || session.inactive) return redirect(STAFF_LOGIN, session?.inactive ? logoutCookies(request) : []);
        if (session.profile.role !== 'server_staff') return redirect(homeFor(session.profile.role));
        return applySession(await serverPage(env, request, session), request, session);
      }
      if (path === '/staff' || path === '/staff.html') return redirect('/server');
      if (path === '/index.html') return publicPage(env, request, PUBLIC_PAGES['/'], '/');
      if (path === '/sitemap.xml') {
        const origin = new URL(request.url).origin;
        const urls = Object.keys(PUBLIC_PAGES).map((route) => `<url><loc>${origin}${route === '/' ? '/' : route}</loc></url>`).join('');
        return text(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, 200, 'application/xml; charset=utf-8');
      }
      if (path === '/robots.txt') {
        return text(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /server\nDisallow: /staff/login\nDisallow: /api/\nSitemap: ${new URL('/sitemap.xml', request.url).href}\n`, 200, 'text/plain; charset=utf-8');
      }
      if (path === '/favicon.ico') return serveAsset(env, request, '/assets/favicon.ico');
      if (path === '/tea-amo-floor-plan.png') return serveAsset(env, request, '/assets/tea-amo-floor-plan.png');
      if (PUBLIC_PAGES[path]) return publicPage(env, request, PUBLIC_PAGES[path], path);
      const menuItem = path.match(/^\/menu\/([^/]+)$/);
      if (menuItem) return publicPage(env, request, { page: 'item', title: 'Menu item — TEA AMO' }, path);
      return text('Not found', 404, 'text/plain; charset=utf-8');
    } catch (error) {
      console.error(JSON.stringify({ message: error.message, status: error.status || 500 }));
      return json({ error: error.message || 'Server error' }, error.status || 500);
  }
}

export default { fetch: handle };
