// auth.js — Simple token authentication
import { bus, el } from './utils.js';
import { setAuthToken, clearAuth, isAuthenticated, verifyAuth } from './db.js';

let loginOverlay = null;

export async function initAuth() {
  // Listen for auth:required events (401 from API)
  bus.on('auth:required', showLogin);

  // Check if we have a stored token
  if (isAuthenticated()) {
    const valid = await verifyAuth();
    if (!valid) {
      clearAuth();
      showLogin();
      return false;
    }
    return true;
  } else {
    showLogin();
    return false;
  }
}

export function showLogin() {
  if (loginOverlay) return;

  loginOverlay = el('div', { class: 'login-overlay' });

  const tokenInput = el('input', {
    class: 'input',
    type: 'password',
    placeholder: 'Enter your password',
  });

  const errorEl = el('div', {
    class: 'login-error',
    style: 'display: none;',
  });

  const submitBtn = el('button', {
    class: 'btn btn-primary',
    text: 'Sign In',
    style: 'width: 100%; padding: 10px;',
    onClick: () => doLogin(),
  });

  async function doLogin() {
    const token = tokenInput.value.trim();
    if (!token) return;

    submitBtn.textContent = 'Signing in...';
    submitBtn.disabled = true;
    errorEl.style.display = 'none';

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();

      if (data.ok) {
        setAuthToken(data.session);
        if (data.userName) localStorage.setItem('ulysses_user', data.userName);
        if (data.isAdmin) localStorage.setItem('ulysses_admin', '1');
        else localStorage.removeItem('ulysses_admin');
        loginOverlay.remove();
        loginOverlay = null;
        bus.emit('auth:success');
      } else {
        errorEl.textContent = 'Invalid password';
        errorEl.style.display = 'block';
        submitBtn.textContent = 'Sign In';
        submitBtn.disabled = false;
        tokenInput.focus();
      }
    } catch (e) {
      errorEl.textContent = 'Connection error';
      errorEl.style.display = 'block';
      submitBtn.textContent = 'Sign In';
      submitBtn.disabled = false;
    }
  }

  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  const card = el('div', { class: 'login-card' }, [
    el('div', { class: 'login-icon', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="48" height="48"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' }),
    el('h2', { text: 'Ulysses', style: 'margin: 0 0 4px; font-size: 22px; font-weight: 600;' }),
    el('p', { text: 'Sign in to access your writing', style: 'color: var(--text-secondary); margin: 0 0 24px; font-size: 14px;' }),
    el('div', { class: 'input-group', style: 'margin-bottom: 16px;' }, [tokenInput]),
    errorEl,
    submitBtn,
  ]);

  loginOverlay.appendChild(card);
  document.body.appendChild(loginOverlay);
  tokenInput.focus();
}

export function logout() {
  clearAuth();
  localStorage.removeItem('ulysses_user');
  localStorage.removeItem('ulysses_admin');
  location.reload();
}
