import { fetchUV, geocode } from './api.js';
import { uvDescription } from './tanScore.js';

// ── Sun position ──────────────────────────────────────────────────────────
function sunPosition(date, lat, lon) {
  const rad = Math.PI / 180;
  const jd = date / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const epsilon = 23.439 * rad;
  const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lmst = ((gmst + lon / 15) % 24 + 24) % 24;
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const ha = (lmst * 15 - ra / rad) * rad;
  const latRad = lat * rad;
  const alt = Math.asin(Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(ha));
  return { altitude: alt / rad, azimuth: ((az / rad + 360) % 360) };
}

let map = null;
let currentLat = 40.758;
let currentLon = -73.985;

export async function initMapPage(lat, lon, mapboxToken) {
  currentLat = lat;
  currentLon = lon;
  mapboxgl.accessToken = mapboxToken;

  map = new mapboxgl.Map({
    container: 'map-container',
    style: 'mapbox://styles/mapbox/standard',
    center: [lon, lat],
    zoom: 15,
    pitch: 52,
    bearing: -15,
    antialias: true,
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

  map.on('style.load', () => {
    addBuildingLayer();
    addOpenAreaOverlay();
    addSkyLayer(new Date(), lat, lon);
    setSunLighting(new Date(), lat, lon);
    loadUV(lat, lon);
  });

  initScrubber(lat, lon);
  initSearch();
}

export function refreshMapLocation(lat, lon) {
  currentLat = lat;
  currentLon = lon;
  if (!map) return;
  map.flyTo({ center: [lon, lat], zoom: 15, duration: 1400, essential: true });
  if (map.isStyleLoaded()) {
    setSunLighting(new Date(), lat, lon);
    updateSkyLayer(new Date(), lat, lon);
    updateOpenAreaBrightness(new Date(), lat);
  }
  loadUV(lat, lon);
}

// ── 3D buildings with shadow casting ─────────────────────────────────────
function addBuildingLayer() {
  const labelLayer = map.getStyle().layers.find(
    l => l.type === 'symbol' && l.layout?.['text-field']
  )?.id;

  map.addLayer({
    id: '3d-buildings',
    source: 'composite',
    'source-layer': 'building',
    filter: ['==', 'extrude', 'true'],
    type: 'fill-extrusion',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'height'],
        0, '#1C160F', 50, '#28200F', 200, '#342A14'],
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': ['get', 'min_height'],
      'fill-extrusion-opacity': 0.95,
      'fill-extrusion-cast-shadows': true,
    },
  }, labelLayer);
}

// ── Open area sunny overlay (parks, grass, plazas, open ground) ───────────
function addOpenAreaOverlay() {
  // Glow layer under open areas — indicates sunlit ground
  map.addLayer({
    id: 'sunny-glow',
    type: 'fill',
    source: 'composite',
    'source-layer': 'landuse',
    filter: ['in', ['get', 'class'],
      ['literal', ['park', 'grass', 'pitch', 'cemetery', 'golf_course', 'scrub', 'sand']]],
    paint: {
      'fill-color': '#F5C250',
      'fill-opacity': 0,   // set dynamically by sun altitude
    },
  }, '3d-buildings');

  // Subtle border around open areas
  map.addLayer({
    id: 'sunny-border',
    type: 'line',
    source: 'composite',
    'source-layer': 'landuse',
    filter: ['in', ['get', 'class'],
      ['literal', ['park', 'grass', 'pitch', 'cemetery', 'golf_course']]],
    paint: {
      'line-color': '#E8A84A',
      'line-width': 1.5,
      'line-opacity': 0,   // set dynamically
      'line-blur': 2,
    },
  }, '3d-buildings');

  updateOpenAreaBrightness(new Date(), currentLat);
}

function updateOpenAreaBrightness(date, lat) {
  if (!map?.getLayer('sunny-glow')) return;
  const { altitude } = sunPosition(date.getTime(), lat, currentLon);
  const intensity = Math.max(0, Math.min(1, altitude / 45));
  map.setPaintProperty('sunny-glow',   'fill-opacity',  intensity * 0.32);
  map.setPaintProperty('sunny-border', 'line-opacity',  intensity * 0.55);
}

// ── Sky + atmosphere ──────────────────────────────────────────────────────
function addSkyLayer(date, lat, lon) {
  const { altitude, azimuth } = sunPosition(date.getTime(), lat, lon);
  map.addLayer({
    id: 'sky',
    type: 'sky',
    paint: {
      'sky-type': 'atmosphere',
      'sky-atmosphere-sun': [azimuth, 90 - Math.max(0, altitude)],
      'sky-atmosphere-sun-intensity': 12,
      'sky-atmosphere-color': 'rgba(255,220,110,1)',
    },
  });
}

function updateSkyLayer(date, lat, lon) {
  if (!map?.getLayer('sky')) return;
  const { altitude, azimuth } = sunPosition(date.getTime(), lat, lon);
  map.setPaintProperty('sky', 'sky-atmosphere-sun', [azimuth, 90 - Math.max(0, altitude)]);
}

// ── Sun lighting (directional shadows) ───────────────────────────────────
function setSunLighting(date, lat, lon) {
  if (!map) return;
  const { altitude, azimuth } = sunPosition(date.getTime(), lat, lon);
  const up = altitude > 0;
  const intensity = Math.max(0, Math.min(1, altitude / 55));
  const r = 255;
  const g = Math.round(210 + intensity * 40);
  const b = Math.round(120 + intensity * 80);

  try {
    map.setLights([
      {
        id: 'sun', type: 'directional',
        properties: {
          color: up ? `rgb(${r},${g},${b})` : 'rgb(80,100,160)',
          intensity: up ? Math.max(0.15, intensity) : 0.05,
          direction: [azimuth, Math.max(1, altitude)],
          'cast-shadows': true,
          'shadow-intensity': up ? Math.min(1.0, intensity * 1.1) : 0,
        },
      },
      {
        id: 'ambient', type: 'ambient',
        properties: { color: 'rgb(155,175,210)', intensity: 0.38 + (1 - intensity) * 0.3 },
      },
    ]);
  } catch {
    map.setLight({
      position: [1.5, azimuth, 90 - Math.max(0, altitude)],
      color: `rgb(${r},${g},${b})`,
      intensity: Math.max(0.4, intensity),
      anchor: 'map',
    });
  }
}

// ── Time scrubber ─────────────────────────────────────────────────────────
function initScrubber(lat, lon) {
  const input = document.getElementById('scrubber-input');
  const label = document.getElementById('scrubber-time-label');
  const now   = new Date();
  const mins  = now.getHours() * 60 + now.getMinutes();
  input.value = mins;
  label.textContent = formatTime(mins);

  input.addEventListener('input', () => {
    const m = parseInt(input.value);
    const d = new Date(); d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    label.textContent = formatTime(m);
    setSunLighting(d, lat, lon);
    updateSkyLayer(d, lat, lon);
    updateOpenAreaBrightness(d, lat);
  });
}

function formatTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// ── UV ────────────────────────────────────────────────────────────────────
async function loadUV(lat, lon) {
  const badge   = document.getElementById('uv-badge');
  const valueEl = document.getElementById('uv-value');
  const labelEl = document.getElementById('uv-label');
  try {
    const data = await fetchUV(lat, lon);
    const uv = data.uvIndex ?? 0;
    const { level, text } = uvDescription(uv);
    valueEl.textContent = `UV ${uv.toFixed(1)}`;
    labelEl.textContent = text;
    badge.setAttribute('data-level', level);
    window.__currentUV__ = uv;
  } catch {
    valueEl.textContent = 'UV --';
    labelEl.textContent = 'Unavailable';
  }
}

// ── City / zip search ─────────────────────────────────────────────────────
const SAVED_LOC_KEY = 'tan_saved_location';

export function getSavedLocation() {
  try { return JSON.parse(localStorage.getItem(SAVED_LOC_KEY)); } catch { return null; }
}

// Called by GPS callback in app.js — saves coords without overwriting a manually searched name
export function saveGPSLocation(lat, lon) {
  const existing = getSavedLocation();
  // Only auto-save GPS if user hasn't manually picked a city
  if (!existing?.isManual) {
    localStorage.setItem(SAVED_LOC_KEY, JSON.stringify({ name: 'Current Location', lat, lon, isManual: false }));
    updateLocationPill('Current Location');
  }
}

function saveLocation(name, lat, lon) {
  localStorage.setItem(SAVED_LOC_KEY, JSON.stringify({ name, lat, lon, isManual: true }));
  updateLocationPill(name);
}

function updateLocationPill(name) {
  const pill = document.getElementById('location-pill-name');
  if (pill) pill.textContent = name;
}

function initSearch() {
  const input   = document.getElementById('map-search-input');
  const results = document.getElementById('map-search-results');
  const clear   = document.getElementById('map-search-clear');
  let debounce  = null;

  // Show saved location name in pill
  const saved = getSavedLocation();
  if (saved) updateLocationPill(saved.name);

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clear.classList.toggle('hidden', !q);
    clearTimeout(debounce);
    if (q.length < 2) { results.classList.add('hidden'); return; }
    debounce = setTimeout(() => doSearch(q), 350);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = ''; results.classList.add('hidden'); clear.classList.add('hidden'); }
  });

  clear.addEventListener('click', () => {
    input.value = ''; results.classList.add('hidden'); results.innerHTML = '';
    clear.classList.add('hidden'); input.focus();
  });

  document.getElementById('map-container')?.addEventListener('touchstart', () => {
    results.classList.add('hidden');
  }, { passive: true });

  async function doSearch(q) {
    try {
      const data = await geocode(q);
      results.innerHTML = '';
      if (!data.results?.length) {
        results.innerHTML = `<div class="search-result-item search-no-results">No results found</div>`;
        results.classList.remove('hidden');
        return;
      }
      data.results.forEach(r => {
        const item = document.createElement('button');
        item.className = 'search-result-item';
        item.textContent = r.name;
        item.addEventListener('click', () => {
          input.value = ''; clear.classList.add('hidden');
          results.classList.add('hidden'); results.innerHTML = '';
          saveLocation(r.name, r.lat, r.lon);
          if (map) {
            map.flyTo({ center: [r.lon, r.lat], zoom: 15, pitch: 52, duration: 1600, essential: true });
            setSunLighting(new Date(), r.lat, r.lon);
            updateSkyLayer(new Date(), r.lat, r.lon);
            updateOpenAreaBrightness(new Date(), r.lat);
            loadUV(r.lat, r.lon);
            currentLat = r.lat; currentLon = r.lon;
          }
        });
        results.appendChild(item);
      });
      results.classList.remove('hidden');
    } catch {
      results.innerHTML = `<div class="search-result-item search-no-results">Search unavailable</div>`;
      results.classList.remove('hidden');
    }
  }
}
