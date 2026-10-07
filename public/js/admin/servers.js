(function () {
  const $ = (id) => document.getElementById(id);
  let editingId = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  function when(value) {
    if (!value) return '—';
    try { return new Date(value).toLocaleString(); } catch { return '—'; }
  }

  function note(message, kind) {
    const box = $('serverStatus');
    if (!box) return;
    box.className = `notice ${kind === 'bad' ? 'bad' : 'good'}`;
    box.textContent = message;
    box.classList.remove('hidden');
  }

  async function api(path, opts = {}) {
    const response = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function fillStaff() {
    const select = $('serverStaffLink');
    if (!select || !window.state) return;
    const current = select.value;
    select.innerHTML = '<option value="">No staff profile</option>' + (state.staff || []).map((staff) => `<option value="${esc(staff.id)}">${esc(staff.name)} · ${esc(staff.role || 'Staff')}</option>`).join('');
    if (current) select.value = current;
  }

  async function render() {
    if (!$('serverRows')) return;
    fillStaff();
    const data = await api('/api/admin/servers');
    $('serverRows').innerHTML = (data.servers || []).map((server) => `<tr>
      <td><b>${esc(server.display_name)}</b><div class="sub">${esc(server.staff_name ? 'Staff: ' + server.staff_name : 'No staff profile')}</div></td>
      <td>${esc(server.username)}</td>
      <td>${server.active ? '<span class="good">Enabled</span>' : '<span class="bad">Disabled</span>'}</td>
      <td>${server.duty === 'on_duty' ? '<span class="good">On duty</span>' : '<span class="muted">Off duty</span>'}</td>
      <td>${server.presence === 'online' ? '<span class="good">Online</span>' : '<span class="muted">Offline</span>'}</td>
      <td>${esc(when(server.last_seen_at))}</td>
      <td>${esc(when(server.last_login_at))}</td>
      <td>${esc(when(server.created_at))}</td>
      <td>
        <button class="btn small alt" type="button" data-edit="${esc(server.id)}">Edit</button>
        <button class="btn small alt" type="button" data-reset="${esc(server.id)}">Reset password</button>
        <button class="btn small ${server.active ? 'danger' : ''}" type="button" data-toggle="${esc(server.id)}" data-active="${server.active ? '1' : '0'}">${server.active ? 'Disable' : 'Enable'}</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted">No Server accounts yet.</td></tr>';
  }

  function openModal(server) {
    editingId = server?.id || null;
    $('serverModalTitle').textContent = server ? 'Edit Server' : 'Create Server';
    $('serverDisplayName').value = server?.display_name || '';
    $('serverUsername').value = server?.username || '';
    $('serverUsername').disabled = !!server;
    $('serverStaffLink').value = server?.staff_id || '';
    $('serverPassword').value = '';
    $('serverPasswordLabel').style.display = server ? 'none' : '';
    $('serverModal').classList.add('show');
  }

  document.addEventListener('click', async (event) => {
    const edit = event.target.closest?.('[data-edit]');
    const reset = event.target.closest?.('[data-reset]');
    const toggle = event.target.closest?.('[data-toggle]');
    try {
      if (edit) {
        const data = await api('/api/admin/servers');
        openModal((data.servers || []).find((server) => server.id === edit.dataset.edit));
      }
      if (reset) {
        const password = prompt('New password for this Server (at least 8 characters):');
        if (!password) return;
        await api(`/api/admin/servers/${encodeURIComponent(reset.dataset.reset)}/password`, { method: 'POST', body: JSON.stringify({ password }) });
        note('Password reset. Existing sessions were signed out.', 'good');
      }
      if (toggle) {
        const disable = toggle.dataset.active === '1';
        await api(`/api/admin/servers/${encodeURIComponent(toggle.dataset.toggle)}/${disable ? 'disable' : 'enable'}`, { method: 'POST', body: '{}' });
        note(disable ? 'Server disabled.' : 'Server enabled.', 'good');
        await render();
      }
    } catch (error) {
      note(error.message, 'bad');
    }
  });

  function bind() {
    $('openCreateServer')?.addEventListener('click', () => openModal(null));
    $('closeServerModal')?.addEventListener('click', () => $('serverModal')?.classList.remove('show'));
    $('saveServerAccount')?.addEventListener('click', async () => {
      try {
        if (editingId) {
          await api(`/api/admin/servers/${encodeURIComponent(editingId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ display_name: $('serverDisplayName').value, staff_id: $('serverStaffLink').value })
          });
          note('Server account updated.', 'good');
        } else {
          await api('/api/admin/servers', {
            method: 'POST',
            body: JSON.stringify({
              display_name: $('serverDisplayName').value,
              username: $('serverUsername').value,
              password: $('serverPassword').value,
              staff_id: $('serverStaffLink').value
            })
          });
          note('Server account created. They can sign in from the home page as Server.', 'good');
        }
        $('serverModal').classList.remove('show');
        await render();
      } catch (error) {
        note(error.message, 'bad');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  const original = window.hardNav;
  window.hardNav = function (section) {
    const result = typeof original === 'function' ? original(section) : undefined;
    if (section === 'servers') render().catch((error) => note(error.message, 'bad'));
    return result;
  };
  window.TeaServers = { render };
})();
