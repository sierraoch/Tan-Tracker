import { setCurrentUser } from './api.js';

const STORAGE_KEY = 'tan_current_user';

// Returns saved username, or null if not logged in
export function getSavedUser() {
  return localStorage.getItem(STORAGE_KEY);
}

export function saveUser(name) {
  localStorage.setItem(STORAGE_KEY, name);
  setCurrentUser(name);
}

export function clearUser() {
  localStorage.removeItem(STORAGE_KEY);
  setCurrentUser(null);
}

// Show the login screen, call onLogin(name) when done
// Pass null as savedName to always show the screen
export function showLoginScreen(container, savedName, onLogin) {
  container.classList.remove('hidden');
  container.innerHTML = '';

  const el = document.createElement('div');
  el.className = 'login-screen';

  el.innerHTML = `
    <div class="login-inner">
      <div class="login-sun">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="24" r="10" fill="#D4833A"/>
          <line x1="24" y1="4"  x2="24" y2="10" stroke="#D4833A" stroke-width="3" stroke-linecap="round"/>
          <line x1="24" y1="38" x2="24" y2="44" stroke="#D4833A" stroke-width="3" stroke-linecap="round"/>
          <line x1="4"  y1="24" x2="10" y2="24" stroke="#D4833A" stroke-width="3" stroke-linecap="round"/>
          <line x1="38" y1="24" x2="44" y2="24" stroke="#D4833A" stroke-width="3" stroke-linecap="round"/>
          <line x1="8.69"  y1="8.69"  x2="13.03" y2="13.03" stroke="#D4833A" stroke-width="3" stroke-linecap="round"/>
          <line x1="34.97" y1="34.97" x2="39.31" y2="39.31" stroke="#D4833A" stroke-width="3" stroke-linecap="round"/>
          <line x1="39.31" y1="8.69"  x2="34.97" y2="13.03" stroke="#D4833A" stroke-width="3" stroke-linecap="round"/>
          <line x1="13.03" y1="34.97" x2="8.69"  y2="39.31" stroke="#D4833A" stroke-width="3" stroke-linecap="round"/>
        </svg>
      </div>
      <h1 class="login-title">Tan Tracker</h1>
      <p class="login-sub">What's your name?</p>

      ${savedName ? `
        <button class="login-returning-btn" id="login-returning">
          Continue as <strong>${savedName}</strong>
        </button>
        <div class="login-divider"><span>or</span></div>
      ` : ''}

      <div class="login-input-row">
        <input
          class="login-input"
          id="login-name-input"
          type="text"
          placeholder="Enter your name"
          autocomplete="given-name"
          autocorrect="off"
          maxlength="30"
          ${savedName ? '' : ''}
        >
        <button class="login-go-btn" id="login-go" disabled>Go</button>
      </div>

      <button class="login-guest-btn" id="login-guest">Continue as Guest</button>
    </div>
  `;

  container.appendChild(el);

  const input = el.querySelector('#login-name-input');
  const goBtn = el.querySelector('#login-go');

  input.addEventListener('input', () => {
    goBtn.disabled = !input.value.trim();
  });

  goBtn.addEventListener('click', () => login(input.value.trim()));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) login(input.value.trim());
  });

  el.querySelector('#login-guest')?.addEventListener('click', () => login('guest'));

  el.querySelector('#login-returning')?.addEventListener('click', () => {
    login(savedName);
  });

  // Auto-focus input if no saved user
  if (!savedName) setTimeout(() => input.focus(), 300);

  function login(name) {
    const normalized = name.toLowerCase().trim();
    saveUser(normalized);
    container.classList.add('hidden');
    container.innerHTML = '';
    onLogin(normalized);
  }
}
