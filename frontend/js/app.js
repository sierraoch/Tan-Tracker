import { getProfile, fetchConfig } from './api.js';
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
  loading.classList.add('fade-out');
  setTimeout(() => loading.classList.add('hidden'), 400);

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

// Explicit location request — called fresh each time map is shown
export function requestLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve({ lat: 40.758, lon: -73.985, denied: true });
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
    // Always request fresh location when opening map
    const loc = await requestLocation();

    if (loc.denied && userLat === null) {
      // First time + denied — show location prompt overlay
      showLocationPrompt();
      return;
    }

    if (!mapInitialized) {
      mapInitialized = true;
      initMapPage(loc.lat, loc.lon, MAPBOX_TOKEN)
        .catch(e => console.error('Map init failed:', e));
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
  let prompt = document.getElementById('location-prompt');
  if (prompt) return;

  prompt = document.createElement('div');
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
    if (!mapInitialized) {
      mapInitialized = true;
      initMapPage(loc.lat, loc.lon, MAPBOX_TOKEN);
    } else {
      refreshMapLocation(loc.lat, loc.lon);
    }
  });

  document.getElementById('location-skip-btn').addEventListener('click', () => {
    prompt.remove();
    const lat = 40.758, lon = -73.985;
    userLat = lat; userLon = lon;
    if (!mapInitialized) {
      mapInitialized = true;
      initMapPage(lat, lon, MAPBOX_TOKEN);
    } else {
      refreshMapLocation(lat, lon);
    }
  });
}

boot();
