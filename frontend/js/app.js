import { getProfile, fetchConfig, setCurrentUser } from './api.js';
import { showLoginScreen, getSavedUser } from './login.js';
import { startOnboarding } from './onboarding.js';
import { initMapPage, refreshMapLocation, getSavedLocation, saveGPSLocation } from './map.js';
import { initMyTanPage } from './mytan.js';

let MAPBOX_TOKEN = '';
let mapInitialized = false;
let profile = null;

// Default to NYC only if no location has ever been saved and GPS fails
const DEFAULT_LAT = 40.758;
const DEFAULT_LON = -73.985;

// Attempt GPS once at startup — result stored here when it arrives
let gpsLat = null;
let gpsLon = null;

function requestGPS() {
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      gpsLat = pos.coords.latitude;
      gpsLon = pos.coords.longitude;
      // If the map is already showing, fly to real location now
      saveGPSLocation(gpsLat, gpsLon);
      if (mapInitialized) refreshMapLocation(gpsLat, gpsLon);
    },
    () => { /* GPS denied or unavailable — keep saved/default location */ },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );
}

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Hide loading screen immediately, show login on top
  const loading = document.getElementById('loading');
  loading.classList.add('fade-out');
  setTimeout(() => loading.classList.add('hidden'), 400);

  const configResult = await Promise.race([
    fetchConfig(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
  ]).catch(() => null);
  MAPBOX_TOKEN = configResult?.mapboxToken ?? '';

  // Kick off GPS request immediately — will resolve in background
  requestGPS();

  const savedUser = getSavedUser();
  showLoginScreen(
    document.getElementById('login-screen'),
    savedUser,
    (name) => afterLogin(name)
  );
}

async function afterLogin(name) {
  if (name === 'guest') {
    setCurrentUser(null);
    profile = null;
    showApp();
    return;
  }

  setCurrentUser(name);

  let existingProfile = null;
  try {
    existingProfile = await getProfile();
  } catch {
    const local = localStorage.getItem(`tan_profile_${name}`);
    if (local) existingProfile = JSON.parse(local);
  }

  if (!existingProfile?.fitzpatrickType) {
    startOnboarding(document.getElementById('onboarding'), (newProfile) => {
      profile = newProfile;
      showApp();
    });
  } else {
    profile = existingProfile;
    showApp();
  }
}

function showApp() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  navigateTo('map');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
}

let mytanInitialized = false;

function navigateTo(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${pageName}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pageName);
  });

  if (pageName === 'map') {
    // Priority: GPS (if already arrived) > saved location > NYC default
    const saved = getSavedLocation();
    const lat = gpsLat ?? saved?.lat ?? DEFAULT_LAT;
    const lon = gpsLon ?? saved?.lon ?? DEFAULT_LON;

    if (!mapInitialized) {
      mapInitialized = true;
      initMapPage(lat, lon, MAPBOX_TOKEN).catch(console.error);
    } else {
      refreshMapLocation(lat, lon);
    }
  }

  if (pageName === 'mytan') {
    if (!mytanInitialized) mytanInitialized = true;
    initMyTanPage(profile).catch(() => {});
  }
}

boot();
