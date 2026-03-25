// ── Worker URL ───────────────────────────────────────────────────────────
// After deploying the worker, update this to your worker's URL.
// e.g. https://tan-tracker-proxy.YOUR_SUBDOMAIN.workers.dev
const WORKER_URL = window.__WORKER_URL__ || 'https://tan-tracker-proxy.sierrajochoa.workers.dev';

async function request(path, options = {}) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── UV ───────────────────────────────────────────────────────────────────
export async function fetchUV(lat, lon) {
  return request(`/api/uv?lat=${lat}&lon=${lon}`);
}

// ── Places ───────────────────────────────────────────────────────────────
export async function fetchPlaces(lat, lon) {
  return request(`/api/places?lat=${lat}&lon=${lon}`);
}

// ── Profile ──────────────────────────────────────────────────────────────
export async function getProfile() {
  return request('/api/profile');
}

export async function saveProfile(profile) {
  return request('/api/profile', { method: 'PUT', body: JSON.stringify(profile) });
}

// ── Sessions ─────────────────────────────────────────────────────────────
export async function getSessions() {
  return request('/api/sessions');
}

export async function logSession(session) {
  return request('/api/sessions', { method: 'POST', body: JSON.stringify(session) });
}

// ── Tan Score ─────────────────────────────────────────────────────────────
export async function getTanScore() {
  return request('/api/tanscore');
}

export async function saveTanScore(scoreData) {
  return request('/api/tanscore', { method: 'PUT', body: JSON.stringify(scoreData) });
}
