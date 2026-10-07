const roleAdmin = document.getElementById('roleAdmin');
const roleServer = document.getElementById('roleServer');
const form = document.getElementById('authForm');
const status = document.getElementById('authStatus');
let role = '';

function setStatus(message, kind) {
  status.textContent = message || '';
  status.className = 'auth-status' + (kind ? ' ' + kind : '');
}

function choose(next) {
  role = next;
  roleAdmin.classList.toggle('selected', next === 'admin');
  roleServer.classList.toggle('selected', next === 'server_staff');
  form.hidden = false;
  setStatus(next === 'admin' ? 'Administration sign in.' : 'Server sign in.');
  document.getElementById('username').focus();
}

roleAdmin.onclick = () => choose('admin');
roleServer.onclick = () => choose('server_staff');
document.getElementById('changeRole').onclick = () => {
  role = '';
  form.hidden = true;
  roleAdmin.classList.remove('selected');
  roleServer.classList.remove('selected');
  setStatus('');
};

form.onsubmit = async (event) => {
  event.preventDefault();
  const button = document.getElementById('signIn');
  button.disabled = true;
  setStatus('Signing in…');
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value,
        role
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Sign in failed');
    setStatus('Opening TEA AMO…', 'good');
    location.assign(data.home || (data.role === 'admin' ? '/admin' : '/server'));
  } catch (error) {
    setStatus(error.message, 'bad');
    button.disabled = false;
  }
};

fetch('/api/auth/session', { credentials: 'include' }).then(async (response) => {
  if (!response.ok) return;
  const data = await response.json();
  if (data.home) location.assign(data.home);
}).catch(() => {});
