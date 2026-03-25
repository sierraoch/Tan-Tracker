import { getProfile, fetchConfig } from './api.js';
import { startOnboarding } from './onboarding.js';
import { initMapPage, refreshMapLocation } from './map.js';
import { initMyTanPage } from './mytan.js';

let MAPBOX_TOKEN = '';
let userLat = 40.7580;  // Default: Times Square, NYC
let userLon = -73.9855;
let mapInitialized = false;
let profile = null;

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Fetch config token — location is requested fresh each map visit
  const configResult = await fetchConfig().catch(() => null);
  MAPBOX_TOKEN = configResult?.mapboxToken ?? '';

  let existingProfile = null;
  try {
    existingProfile = await getProfile();
  } catch {
    const local = localStorage.getItem('tan_profile');
    if (local) existingProfile = JSON.parse(local);
  }

  const loading = document.getElementById('loading');

  if (!existingProfile || !existingProfile.fitzpatrickType) {
    loading.classList.add('fade-out');
    setTimeout(() => loading.classList.add('hidden'), 400);
    startOnboarding(document.getElementById('onboarding'), (newProfile) => {
      profile = newProfile;
      showApp();
    });
  } else {
    profile = existingProfile;
    loading.classList.add('fade-out');
    setTimeout(() => { loading.classList.add('hidden'); showApp(); }, 400);
  }
}

// Always get fresh location — no cache
export function getLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve({ lat: userLat, lon: userLon, denied: false }); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        userLat = pos.coords.latitude;
        userLon = pos.coords.longitude;
        resolve({ lat: userLat, lon: userLon, denied: false });
      },
      () => resolve({ lat: userLat, lon: userLon, denied: true }),
      { timeout: 8000, maximumAge: 0 }  // always fresh, no cache
    );
  });
}

function showApp() {
  document.getElementById('app').classList.remove('hidden');
  navigateTo('map');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
}

let mytanInitialized = false;

async function navigateTo(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${pageName}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pageName);
  });

  if (pageName === 'map') {
    if (!mapInitialized) {
      mapInitialized = true;
      // Get location fresh, then init map
      const loc = await getLocation();
      userLat = loc.lat; userLon = loc.lon;
      initMapPage(userLat, userLon, MAPBOX_TOKEN, loc.denied)
        .catch(e => console.error('Map init failed:', e));
    } else {
      // Map already exists — just refresh location and re-center
      const loc = await getLocation();
      userLat = loc.lat; userLon = loc.lon;
      refreshMapLocation(userLat, userLon, loc.denied);
    }
  }

  if (pageName === 'mytan') {
    if (!mytanInitialized) mytanInitialized = true;
    initMyTanPage(profile).catch(() => {});
  }
}

boot();
