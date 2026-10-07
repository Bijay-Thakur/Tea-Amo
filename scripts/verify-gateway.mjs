import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_ANON_KEY: 'anon-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
  ASSETS: {
    async fetch(request) {
      const file = path.join(root, 'public', new URL(request.url).pathname.replace(/^\//, ''));
      if (!fs.existsSync(file)) return new Response('missing', { status: 404 });
      return new Response(fs.readFileSync(file));
    }
  }
};

const users = {
  'admin-token': { id: 'admin-1', email: 'owner@teaamo.local' },
  'server-token': { id: 'server-1', email: 'sanjay@servers.teaamo.local' },
  'disabled-token': { id: 'server-2', email: 'off@servers.teaamo.local' }
};
const profiles = {
  'admin-1': { id: 'admin-1', role: 'admin', display_name: 'Owner', username: 'owner', staff_id: null, active: true },
  'server-1': { id: 'server-1', role: 'server_staff', display_name: 'Sanjay', username: 'sanjay', staff_id: '1789724801994', active: true },
  'server-2': { id: 'server-2', role: 'server_staff', display_name: 'Off Duty', username: 'offduty', staff_id: null, active: false }
};
const calls = [];

globalThis.fetch = async (url, options = {}) => {
  const target = new URL(url);
  calls.push(`${options.method || 'GET'} ${target.pathname}${target.search}`);
  const auth = options.headers?.Authorization || options.headers?.authorization || '';
  if (target.pathname === '/auth/v1/user') {
    const token = auth.replace('Bearer ', '');
    const user = users[token];
    if (!user) return json({ message: 'invalid' }, 401);
    return json(user);
  }
  if (target.pathname === '/auth/v1/token') {
    const body = JSON.parse(options.body);
    const email = body.email;
    const user = Object.values(users).find((item) => item.email === email);
    if (!user || body.password !== 'correct-password') return json({ error_description: 'invalid' }, 400);
    const token = Object.entries(users).find(([, value]) => value.id === user.id)[0];
    return json({ access_token: token, refresh_token: `${token}-refresh` });
  }
  if (target.pathname.startsWith('/auth/v1/admin/users/')) {
    const id = target.pathname.split('/').pop();
    const user = Object.values(users).find((item) => item.id === id);
    return json(user || {});
  }
  if (target.pathname === '/rest/v1/profiles' && (options.method || 'GET') === 'GET') {
    const id = target.searchParams.get('id')?.replace(/^eq\./, '');
    const username = target.searchParams.get('username')?.replace(/^eq\./, '');
    const row = id ? profiles[decodeURIComponent(id)] : Object.values(profiles).find((item) => item.username === decodeURIComponent(username || ''));
    return json(row ? [row] : []);
  }
  if (target.pathname.startsWith('/rest/v1/')) return json(options.method === 'GET' ? [] : null);
  return json({ message: 'unmocked' }, 500);
};

function json(data, status = 200) {
  return new Response(data == null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function hit(pathname, { method = 'GET', cookie = '', body, role } = {}) {
  const headers = { cookie };
  if (body) headers['content-type'] = 'application/json';
  const response = await worker.fetch(new Request(`http://127.0.0.1:8791${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  }), env);
  const text = await response.text();
  return { status: response.status, location: response.headers.get('location'), text, cookies: response.headers.getSetCookie?.() || [] };
}

const checks = [];
function check(name, ok) {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

const home = await hit('/');
check('login screen is served', home.status === 200 && home.text.includes('Administration') && !home.text.includes('Create Account') && !home.text.includes('service-role-secret'));

const admin = await hit('/admin');
check('unauthenticated /admin redirects home', admin.status === 302 && admin.location === '/');

const server = await hit('/server');
check('unauthenticated /server redirects home', server.status === 302 && server.location === '/');

const staff = await hit('/staff');
check('/staff redirects to /server', staff.status === 302 && staff.location === '/server');

const retired = await hit('/api/staff/login', { method: 'POST', body: { pin: '1234' } });
check('LAN PIN login is retired', retired.status === 410);

const serverAdmin = await hit('/admin', { cookie: 'tea_access=server-token' });
check('server is kept out of /admin', serverAdmin.status === 302 && serverAdmin.location === '/server');

const serverApi = await hit('/api/admin/state', { cookie: 'tea_access=server-token' });
check('server cannot read admin state', serverApi.status === 403);

const before = calls.length;
const create = await hit('/api/admin/servers', {
  method: 'POST',
  cookie: 'tea_access=server-token',
  body: { username: 'newserver', display_name: 'New', password: 'long-password' }
});
check('server cannot create accounts', create.status === 403 && !calls.slice(before).some((line) => line.includes('/auth/v1/admin/users') && line.startsWith('POST')));

const adminPage = await hit('/admin', { cookie: 'tea_access=admin-token' });
check('admin workspace loads', adminPage.status === 200 && adminPage.text.includes('data-sec="servers"') && adminPage.text.includes('anon-public-key') && !adminPage.text.includes('service-role-secret'));

const adminServer = await hit('/server', { cookie: 'tea_access=admin-token' });
check('admin is routed away from /server', adminServer.status === 302 && adminServer.location === '/admin');

const disabled = await hit('/server', { cookie: 'tea_access=disabled-token' });
check('disabled server is signed out', disabled.status === 302 && disabled.location === '/' && disabled.cookies.some((cookie) => cookie.startsWith('tea_access=')));

const wrongRole = await hit('/api/auth/login', { method: 'POST', body: { username: 'sanjay', password: 'correct-password', role: 'admin' } });
check('role on the form is not authorization', wrongRole.status === 401);

const signedIn = await hit('/api/auth/login', { method: 'POST', body: { username: 'sanjay', password: 'correct-password', role: 'server_staff' } });
const session = JSON.parse(signedIn.text);
check('server login lands on /server', signedIn.status === 200 && session.home === '/server' && session.role === 'server_staff' && signedIn.cookies.some((cookie) => cookie.startsWith('tea_access=')));

if (checks.some((ok) => !ok)) process.exit(1);
console.log('Gateway checks passed.');
