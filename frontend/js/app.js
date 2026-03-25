import { getProfile, fetchConfig, setCurrentUser } from './api.js';
import { showLoginScreen, getSavedUser, saveUser, clearUser } from './login.js';
import { startOnboarding } from './onboarding.js';
import { initMapPage, refreshMapLocation } from './map.js';
import { initMyTanPage } from './mytan.js';

let MAPBOX_TOKEN = '';
let userLat = null;
let userLon = null;
let mapInitialized = false;
let profile = null;

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Hide loading screen before showing login
  const loading = document.getElementById('loading');
  loading.classList.add('fade-out');
  setTimeout(() => loading.classList.add('hidden'), 400);

  const configResult = await Promise.race([
    fetchConfig(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
  ]).catch(() => null);
  MAPBOX_TOKEN = configResult?.mapboxToken ?? '';

  const savedUser = getSavedUser();

  showLoginScreen(
    document.getElementById('login-screen'),
    savedUser,
    (name) => afterLogin(name)
  );
}

async function afterLogin(name) {
  // Guest mode — no KV, just local
  if (name === 'guest') {
    setCurrentUser(null);
    profile = null;
    showApp();
    return;
  }

  setCurrentUser(name);

  // Check for existing profile in KV
  let existingProfile = null;
  try {
    existingProfile = await getProfile();
  } catch {
    // KV unavailable — try localStorage fallback
    const local = localStorage.getItem(`tan_profile_${name}`);
    if (local) existingProfile = JSON.parse(local);
  }

  if (!existingProfile?.fitzpatrickType) {
    // New user — run onboarding
    startOnboarding(document.getElementById('onboarding'), (newProfile) => {
      profile = newProfile;
      showApp();
    });
  } else {
    profile = existingProfile;
    showApp();
  }
}

// Fresh GPS every time map is opened — no cached fallback
export function requestLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve({ lat: userLat ?? 40.758, lon: userLon ?? -73.985, denied: true });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        userLat = pos.coords.latitude;
        userLon = pos.coords.longitude;
        resolve({ lat: userLat, lon: userLon, denied: false });
      },
      () => resolve({ lat: userLat ?? 40.758, lon: userLon ?? -73.985, denied: true }),
      { timeout: 8000, maximumAge: 0 }
    );
  });
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

async function navigateTo(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${pageName}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pageName);
  });

  if (pageName === 'map') {
    const loc = await requestLocation();

    if (loc.denied && userLat === null) {
      showLocationPrompt();
      return;
    }

    if (!mapInitialized) {
      mapInitialized = true;
      initMapPage(loc.lat, loc.lon, MAPBOX_TOKEN).catch(console.error);
    } else {
      refreshMapLocation(loc.lat, loc.lon);
    }
  }

  if (pageName === 'mytan') {
    if (!mytanInitialized) mytanInitialized = true;
    initMyTanPage(profile).catch(() => {});
  }
}

function showLocationPrompt() {
  const page = document.getElementById('page-map');
  if (document.getElementById('location-prompt')) return;

  const prompt = document.createElement('div');
  prompt.id = 'location-prompt';
  prompt.className = 'location-prompt';
  prompt.innerHTML = `
    <div class="location-prompt-inner">
      <div class="location-prompt-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
          <circle cx="12" cy="9" r="2.5"/>
        </svg>
      </div>
      <h2>Where are you?</h2>
      <p>Tan Tracker needs your location to show real-time sun and shadows on your map.</p>
      <button id="location-allow-btn">Allow location</button>
      <button id="location-skip-btn">Use New York City instead</button>
    </div>
  `;
  page.appendChild(prompt);

  document.getElementById('location-allow-btn').addEventListener('click', async () => {
    prompt.remove();
    const loc = await requestLocation();
    if (!mapInitialized) { mapInitialized = true; initMapPage(loc.lat, loc.lon, MAPBOX_TOKEN); }
    else refreshMapLocation(loc.lat, loc.lon);
  });

  document.getElementById('location-skip-btn').addEventListener('click', () => {
    prompt.remove();
    userLat = 40.758; userLon = -73.985;
    if (!mapInitialized) { mapInitialized = true; initMapPage(40.758, -73.985, MAPBOX_TOKEN); }
    else refreshMapLocation(40.758, -73.985);
  });
}

boot();
