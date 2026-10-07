import { cookiesOf, sessionCookies, clearCookies } from './http.js';
import { authUser, refreshGrant, rest } from './supabase.js';

export function homeFor(role) {
  return role === 'admin' ? '/admin' : '/server';
}

export async function profileFor(env, userId) {
  const rows = await rest(env, `/rest/v1/profiles?id=eq.${userId}&select=id,role,display_name,username,staff_id,active,created_at,updated_at,last_login_at,last_seen_at`);
  return rows?.[0] || null;
}

export async function establish(request, env) {
  try {
  const jar = cookiesOf(request);
  let access = jar.tea_access || bearer(request);
  let refresh = jar.tea_refresh || '';
  let renewed = null;
  if (!access && refresh) {
    renewed = await refreshGrant(env, refresh);
    access = renewed.access_token;
    refresh = renewed.refresh_token || refresh;
  }
  if (!access) return null;
  let user;
  try {
    user = await authUser(env, access);
  } catch (error) {
    if (!refresh || error.status !== 401) return null;
    try {
      renewed = await refreshGrant(env, refresh);
      access = renewed.access_token;
      refresh = renewed.refresh_token || refresh;
      user = await authUser(env, access);
    } catch {
      return null;
    }
  }
  const profile = await profileFor(env, user.id);
  if (!profile || !profile.active) return { inactive: true, profile };
  return { user, profile, access, refresh, renewed: Boolean(renewed) };
  } catch {
    return null;
  }
}

export function applySession(response, request, session) {
  if (!session?.renewed) return response;
  const headers = new Headers(response.headers);
  for (const cookie of sessionCookies(session.access, session.refresh, new URL(request.url).protocol === 'https:')) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(response.body, { status: response.status, headers });
}

export function logoutResponse(request) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  for (const cookie of clearCookies(new URL(request.url).protocol === 'https:')) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export function loginResponse(request, session, body) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  for (const cookie of sessionCookies(session.access_token, session.refresh_token, new URL(request.url).protocol === 'https:')) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(JSON.stringify(body), { status: 200, headers });
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

export async function requireRole(request, env, role) {
  const session = await establish(request, env);
  if (!session || session.inactive) return { error: 'Authentication required', status: 401 };
  if (role && session.profile.role !== role) return { error: 'This account cannot open that area', status: 403, session };
  return { session };
}
