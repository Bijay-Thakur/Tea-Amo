import { loadEnv } from './load-env.mjs';

loadEnv();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const username = (process.env.TEA_AMO_ADMIN_USERNAME || 'owner').trim().toLowerCase();
const email = process.env.TEA_AMO_ADMIN_EMAIL || `${username}@teaamo.local`;
const password = process.env.TEA_AMO_ADMIN_PASSWORD;
const name = process.env.TEA_AMO_ADMIN_NAME || 'Owner';
if (!url || !key || !password) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and TEA_AMO_ADMIN_PASSWORD.');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
async function call(path, method, body) {
  const response = await fetch(new URL(path, url), { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.msg || text || response.statusText);
  return data;
}

const existing = await call(`/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id,role`, 'GET');
if (existing?.length) {
  console.log(`Administration account "${username}" already exists.`);
  process.exit(0);
}
const created = await call('/auth/v1/admin/users', 'POST', { email, password, email_confirm: true, user_metadata: { username, role: 'admin' } });
try {
  await call('/rest/v1/profiles', 'POST', { id: created.id, role: 'admin', display_name: name, username, active: true });
} catch (error) {
  await call(`/auth/v1/admin/users/${created.id}`, 'DELETE').catch(() => {});
  throw error;
}
console.log(`Created Administration account ${username} (${email}).`);
