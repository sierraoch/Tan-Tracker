import { getProfile, fetchConfig } from './api.js';
import { startOnboarding } from './onboarding.js';
import { initMapPage } from './map.js';
import { initMyTanPage } from './mytan.js';

let MAPBOX_TOKEN = '';

let userLat = 40.7580;  // Default: Times Square, NYC
let userLon = -73.9855;
let mapInitialized = false;
let profile = null;

async function boot() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW reg failed:', e));
  }

  // Fetch config (Mapbox token) and GPS in parallel
  const [, configResult] = await Promise.allSettled([
    getLocation(),
    fetchConfig(),
  ]);
  if (configResult.status === 'fulfilled') {
    MAPBOX_TOKEN = configResult.value?.mapboxToken ?? '';
  }

  // Check for existing profile
  let existingProfile = null;
  try {
    existingProfile = await getProfile();
  } catch (e) {
    // Try local fallback
    const local = localStorage.getItem('tan_profile');
    if (local) existingProfile = JSON.parse(local);
  }

  const loading = document.getElementById('loading');

  if (!existingProfile || !existingProfile.fitzpatrickType) {
    // First launch — show onboarding
    loading.classList.add('fade-out');
    setTimeout(() => loading.classList.add('hidden'), 400);

    startOnboarding(document.getElementById('onboarding'), (newProfile) => {
      profile = newProfile;
      showApp();
    });
  } else {
    // Returning user
    profile = existingProfile;
    loading.classList.add('fade-out');
    setTimeout(() => {
      loading.classList.add('hidden');
      showApp();
    }, 400);
  }
}

function getLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        userLat = pos.coords.latitude;
        userLon = pos.coords.longitude;
        resolve();
      },
      () => resolve(),  // Use NYC default on denial
      { timeout: 5000, maximumAge: 60000 }
    );
  });
}

function showApp() {
  const app = document.getElementById('app');
  app.classList.remove('hidden');
  navigateTo('map');

  // Bottom nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
}

let mytanInitialized = false;

function navigateTo(pageName) {
  // Update pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${pageName}`).classList.add('active');

  // Update nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pageName);
  });

  // Init pages lazily
  if (pageName === 'map' && !mapInitialized) {
    mapInitialized = true;
    initMapPage(userLat, userLon, MAPBOX_TOKEN).catch(e => console.error('Map init failed:', e));
  }

  if (pageName === 'mytan' && !mytanInitialized) {
    mytanInitialized = true;
    initMyTanPage(profile).catch(e => console.error('MyTan init failed:', e));
  } else if (pageName === 'mytan') {
    // Refresh on every visit to pick up score changes / new UV
    initMyTanPage(profile).catch(() => {});
  }
}

boot();
