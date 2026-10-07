import { json, text, redirect, readJson } from './http.js';
import { configured } from './supabase.js';
import { establish, applySession, homeFor, loginResponse, logoutResponse, requireRole } from './session.js';
import { passwordGrant, rest, rpc } from './supabase.js';
import {
  assertLoginAllowed, clearLoginFailures, completePayment, createServerAccount, findLogin,
  listServers, loadOperational, markLogin, orderPayload, projectState,
  publicProfile, recordLoginFailure, resetServerPassword, rpcStatus, saveMaster, saveOrder,
  reserveTable, seatTable, setServerActive, updateServer, workspaceForServer
} from './ops.js';

const OWNER_SECTIONS = ['dashboard', 'pos', 'dayclose', 'staff', 'servers', 'menuadmin', 'inventory', 'recipes', 'wastage', 'vendors', 'expenses', 'capital', 'customers', 'dailyreport', 'reports', 'dining', 'settings'];

function missingConfig() {
  return text(`<!doctype html><html><head><meta charset="utf-8"><title>TEA AMO</title></head><body style="font-family:Nunito,sans-serif;padding:32px"><h1>TEA AMO</h1><p>This deployment does not have Supabase credentials yet. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, then reload.</p></body></html>`, 503);
}

async function assetText(env, request, assetPath) {
  const response = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url)));
  if (!response.ok) throw new Error(`Missing ${assetPath}`);
  return response.text();
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
  if (!session || session.inactive) return redirect('/', session?.inactive ? logoutCookies(request) : []);
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
      if (error.status === 409) return json({ error: 'The café record changed on another screen. Reload and try again.', code: 'conflict' }, 409);
      throw error;
    }
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function handleOps(request, env, path) {
  const auth = await requireRole(request, env, null);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const { session } = auth;
  try {
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
      const rows = await rest(env, '/rest/v1/live_orders?select=*,order_items(menu_item_id,qty,served_qty)', { token: session.access });
      const orders = {};
      for (const row of rows || []) orders[row.table_id] = { version: row.version, attention: row.attention, order: (await orderPayload(env, row.table_id, session.access)).order, updated_by: row.updated_by_name };
      const tables = await rest(env, '/rest/v1/cafe_tables?select=id,seated,reservation,attention', { token: session.access });
      return applySession(json({ orders, completions: [], tables: tables || [] }), request, session);
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
    const orders = {};
    for (const row of rows || []) {
      const payload = await orderPayload(env, row.table_id, auth.session.access);
      orders[row.table_id] = { version: payload.version, order: payload.order, attention: payload.attention, updated_by: row.updated_by_name, updated_at: row.updated_at };
    }
    return json({ orders, completions: [] });
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

      if (path.startsWith('/api/ops/')) return handleOps(request, env, path);
      if (path.startsWith('/api/admin/')) return handleAdmin(request, env, path);
      if (path.startsWith('/api/server/')) return handleServer(request, env, path);
      if (path.startsWith('/api/staff/')) return json({ error: 'Staff PIN login has been retired. Sign in at the TEA AMO home page.' }, 410);

      if (path === '/' || path === '/index.html') {
        const session = await establish(request, env);
        if (session?.profile?.active) return redirect(homeFor(session.profile.role));
        return serveAsset(env, request, '/auth/gate.html');
      }
      if (path === '/admin') return guardedPage(request, env, 'admin', async () => text(await ownerPage(env, request)));
      if (path === '/server') return guardedPage(request, env, 'server_staff', async () => serveAsset(env, request, '/server/index.html'));
      if (path === '/staff' || path === '/staff.html') return redirect('/server');
      if (path === '/favicon.ico') return serveAsset(env, request, '/assets/favicon.ico');
      if (path === '/tea-amo-floor-plan.png') return serveAsset(env, request, '/assets/tea-amo-floor-plan.png');
      return text('Not found', 404, 'text/plain; charset=utf-8');
    } catch (error) {
      console.error(JSON.stringify({ message: error.message, status: error.status || 500 }));
      return json({ error: error.message || 'Server error' }, error.status || 500);
  }
}

export default { fetch: handle };
