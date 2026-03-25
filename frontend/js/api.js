const WORKER_URL = 'https://tan-tracker-proxy.sierrajochoa.workers.dev';

// Current user — set by login, read by all API calls
let currentUser = null;

export function setCurrentUser(name) {
  currentUser = name;
}

export function getCurrentUser() {
  return currentUser;
}

function userParam() {
  return currentUser ? `user=${encodeURIComponent(currentUser)}` : '';
}

async function request(path, options = {}) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Config ────────────────────────────────────────────────────────────────
export function fetchConfig() {
  return request('/api/config');
}

// ── UV ────────────────────────────────────────────────────────────────────
export function fetchUV(lat, lon) {
  return request(`/api/uv?lat=${lat}&lon=${lon}`);
}

// ── Parks (nearby outdoor spots) ─────────────────────────────────────────
export function fetchParks(lat, lon) {
  return request(`/api/parks?lat=${lat}&lon=${lon}`);
}

// ── Geocode (city / zip → coordinates) ───────────────────────────────────
export function geocode(query) {
  return request(`/api/geocode?q=${encodeURIComponent(query)}`);
}

// ── Profile ───────────────────────────────────────────────────────────────
export function getProfile() {
  return request(`/api/profile?${userParam()}`);
}

export function saveProfile(profile) {
  return request(`/api/profile?${userParam()}`, { method: 'PUT', body: JSON.stringify(profile) });
}

// ── Sessions ──────────────────────────────────────────────────────────────
export function getSessions() {
  return request(`/api/sessions?${userParam()}`);
}

export function logSession(session) {
  return request(`/api/sessions?${userParam()}`, { method: 'POST', body: JSON.stringify(session) });
}

// ── Tan Score ─────────────────────────────────────────────────────────────
export function getTanScore() {
  return request(`/api/tanscore?${userParam()}`);
}

export function saveTanScore(scoreData) {
  return request(`/api/tanscore?${userParam()}`, { method: 'PUT', body: JSON.stringify(scoreData) });
}
