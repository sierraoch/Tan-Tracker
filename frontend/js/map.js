import { fetchUV, fetchParks, geocode } from './api.js';
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
    loadParks(lat, lon);
  });

  initScrubber(lat, lon);
  initSearch();
  initLocateButton();
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
  clearParks();
  loadParks(lat, lon);
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

// ── UV + Weather bar ──────────────────────────────────────────────────────
async function loadUV(lat, lon) {
  try {
    const data = await fetchUV(lat, lon);
    const uv = data.uvIndex ?? 0;
    const { level, text } = uvDescription(uv);
    const displayText = data.isNight ? 'Nighttime' : text;

    // Legacy badge (keep in sync)
    const valueEl = document.getElementById('uv-value');
    const labelEl = document.getElementById('uv-label');
    const badge   = document.getElementById('uv-badge');
    if (valueEl) valueEl.textContent = `UV ${uv.toFixed(1)}`;
    if (labelEl) labelEl.textContent = displayText;
    if (badge)   badge.setAttribute('data-level', level);
    window.__currentUV__ = uv;

    // Weather bar
    updateWeatherBar(data, uv, level, displayText);
  } catch (e) {
    console.error('[UV] fetch error:', e);
    const el = document.getElementById('bar-uv-num');
    if (el) el.textContent = '--';
  }
}

function wmoToEmoji(code) {
  if (code === 0)                       return '☀️';
  if ([1, 2, 3].includes(code))         return '⛅';
  if ([45, 48].includes(code))          return '🌫️';
  if ([51, 53, 55].includes(code))      return '🌦️';
  if ([61, 63, 65].includes(code))      return '🌧️';
  if ([71, 73, 75].includes(code))      return '🌨️';
  if (code === 77)                      return '🌨️';
  if ([80, 81, 82].includes(code))      return '🌦️';
  if ([85, 86].includes(code))          return '🌨️';
  if (code === 95)                      return '⛈️';
  if ([96, 99].includes(code))          return '⛈️';
  return '🌡️';
}

// Map UV level name → CSS color var
const UV_COLORS = {
  low:       'var(--uv-green)',
  moderate:  'var(--uv-yellow)',
  high:      'var(--uv-orange)',
  'very-high': 'var(--uv-red)',
  extreme:   'var(--uv-purple)',
};

function updateWeatherBar(data, uv, level, displayText) {
  const numEl   = document.getElementById('bar-uv-num');
  const lblEl   = document.getElementById('bar-uv-label');
  const iconEl  = document.getElementById('bar-wx-icon');
  const tempEl  = document.getElementById('bar-wx-temp');

  if (numEl) {
    numEl.textContent = uv === 0 ? '0' : uv.toFixed(1);
    numEl.style.color = UV_COLORS[level] ?? 'inherit';
  }
  if (lblEl) lblEl.textContent = displayText;

  if (iconEl && data.weathercode != null) {
    iconEl.textContent = wmoToEmoji(data.weathercode);
  }
  if (tempEl && data.tempF != null) {
    tempEl.textContent = `${data.tempF}°F`;
  }

  // Forecast bars — actual clock times with UV number + colored dot
  const baseHour = data.currentHour ?? new Date().getHours();
  (data.forecast ?? []).forEach((uvH, i) => {
    const col    = document.getElementById(`bar-f${i + 1}`);
    if (!col) return;
    const fill   = col.querySelector('.forecast-bar-fill');
    const uvEl   = document.getElementById(`bar-f${i + 1}-uv`);
    const timeEl = document.getElementById(`bar-f${i + 1}-time`);

    const h      = (baseHour + i + 1) % 24;
    const ampm   = h < 12 ? 'am' : 'pm';
    const h12    = h % 12 || 12;
    const { level: fLevel } = uvDescription(uvH);
    const color  = UV_COLORS[fLevel] ?? 'var(--amber-light)';
    const pct    = Math.min(100, (uvH / 12) * 100);

    if (fill)   { fill.style.height = `${Math.max(4, pct)}%`; fill.style.background = color; }
    if (uvEl)   { uvEl.textContent = uvH.toFixed(1); uvEl.style.color = color; }
    if (timeEl) { timeEl.textContent = `${h12}${ampm}`; }
  });
}

// ── Park markers with sun-window analysis ────────────────────────────────
const parkMarkers = [];

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1);
}

// Compass bearing (degrees, north = 0, clockwise) from point 1 → point 2
function bearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1R = lat1 * Math.PI / 180;
  const lat2R = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function distMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Query rendered 3D buildings near a spot and return simplified objects
function getNearbyBuildings(spotLat, spotLon) {
  if (!map || !map.getLayer('3d-buildings')) return [];
  try {
    const pt = map.project([spotLon, spotLat]);
    const features = map.queryRenderedFeatures(
      [[pt.x - 150, pt.y - 150], [pt.x + 150, pt.y + 150]],
      { layers: ['3d-buildings'] }
    );
    return features.map(f => {
      const coords = f.geometry.type === 'Polygon'
        ? f.geometry.coordinates[0]
        : f.geometry.coordinates[0][0];
      const lons = coords.map(c => c[0]);
      const lats = coords.map(c => c[1]);
      return {
        lat: (Math.min(...lats) + Math.max(...lats)) / 2,
        lon: (Math.min(...lons) + Math.max(...lons)) / 2,
        height: f.properties.height || f.properties.render_height || 10,
      };
    });
  } catch { return []; }
}

// Returns true if a building casts shadow on the spot at the given sun position
function isShadowedByBuilding(spotLat, spotLon, bldg, sunAltDeg, sunBearingDeg) {
  if (sunAltDeg <= 0) return true;
  const dist = distMeters(spotLat, spotLon, bldg.lat, bldg.lon);
  if (dist < 2) return false;
  // Sun is at sunBearingDeg; building must be in that direction to block sun
  const bldgBearing = bearing(spotLat, spotLon, bldg.lat, bldg.lon);
  const angDiff = Math.abs(((bldgBearing - sunBearingDeg + 540) % 360) - 180);
  if (angDiff > 30) return false;
  // Building tall enough to cast shadow at this sun altitude?
  return bldg.height > dist * Math.tan(sunAltDeg * Math.PI / 180);
}

// Analyze how many consecutive hours a spot gets unobstructed sun today (8am-7pm)
function analyzeSunWindow(spot) {
  const SunCalc = window.SunCalc;
  if (!SunCalc) return { sunHours: 99, sunWindow: 'All day' }; // CDN failed → pass through

  const buildings = getNearbyBuildings(spot.lat, spot.lon);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sunnyHours = [];
  for (let h = 8; h <= 19; h++) {
    const d = new Date(today);
    d.setHours(h, 0, 0, 0);
    const pos    = SunCalc.getPosition(d, spot.lat, spot.lon);
    const altDeg = pos.altitude * 180 / Math.PI;
    if (altDeg <= 2) continue; // below horizon or nearly so

    // SunCalc azimuth: from south, positive = west. Convert to compass (north = 0).
    const sunBearing = ((pos.azimuth * 180 / Math.PI) + 180 + 360) % 360;
    const shadowed = buildings.some(b => isShadowedByBuilding(spot.lat, spot.lon, b, altDeg, sunBearing));
    if (!shadowed) sunnyHours.push(h);
  }

  // Longest consecutive block
  let maxLen = 0, maxStart = -1, curLen = 0, curStart = -1;
  sunnyHours.forEach((h, i) => {
    if (i === 0 || h !== sunnyHours[i - 1] + 1) { curLen = 1; curStart = h; }
    else curLen++;
    if (curLen > maxLen) { maxLen = curLen; maxStart = curStart; }
  });

  if (maxLen < 2) return null;

  const fmt = h => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
  return { sunHours: maxLen, sunWindow: `${fmt(maxStart)} – ${fmt(maxStart + maxLen)}` };
}

function addParkMarker(spot, userLat, userLon) {
  const el = document.createElement('div');
  const size = spot.sunHours >= 4 ? 'large' : spot.sunHours >= 3 ? 'medium' : 'small';
  el.className = `park-bubble park-bubble--${size}`;

  const icon  = spot.category === 'park' ? '🌳' : spot.category === 'restaurant' ? '🍽️' : '☀️';
  const dist  = haversine(userLat, userLon, spot.lat, spot.lon);
  const name  = spot.name.split(',')[0];

  const popup = new mapboxgl.Popup({ offset: 16, closeButton: false })
    .setHTML(
      `<strong>${icon} ${name}</strong>` +
      `<br><span>☀️ Sunny ${spot.sunWindow}</span>` +
      `<br><span>${dist} mi away</span>`
    );

  const marker = new mapboxgl.Marker({ element: el })
    .setLngLat([spot.lon, spot.lat])
    .setPopup(popup)
    .addTo(map);

  el.addEventListener('click', () => marker.togglePopup());
  parkMarkers.push(marker);
}

function clearParks() {
  parkMarkers.forEach(m => m.remove());
  parkMarkers.length = 0;
  const msg = document.getElementById('no-spots-msg');
  if (msg) msg.classList.add('hidden');
}

async function loadParks(lat, lon) {
  // Wait for map to finish rendering tiles before querying buildings
  const doAnalysis = async () => {
    try {
      const data = await fetchParks(lat, lon);
      const spots = data.parks ?? [];
      console.log('[parks] received', spots.length, 'candidates');

      const passing = [];
      for (const spot of spots) {
        const result = analyzeSunWindow(spot);
        if (result) passing.push({ ...spot, ...result });
      }

      console.log('[parks]', passing.length, 'passed sun threshold (≥2h consecutive)');

      const msg = document.getElementById('no-spots-msg');
      if (passing.length === 0) {
        if (msg) msg.classList.remove('hidden');
        return;
      }
      if (msg) msg.classList.add('hidden');
      passing.forEach(spot => addParkMarker(spot, lat, lon));
    } catch (e) {
      console.error('[parks] error:', e);
    }
  };

  // If map is already idle (tiles loaded), run now; otherwise wait
  if (map.loaded()) {
    doAnalysis();
  } else {
    map.once('idle', doAnalysis);
  }
}

// ── Locate button (iOS-safe: synchronous inside direct click handler) ──────
function initLocateButton() {
  const btn = document.getElementById('locate-btn');
  if (!btn) return;

  btn.addEventListener('click', function() {
    if (!navigator.geolocation) {
      alert('Geolocation not supported on this device');
      return;
    }
    btn.classList.add('locating');
    navigator.geolocation.getCurrentPosition(
      function(position) {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        console.log('Got location:', lat, lon);
        btn.classList.remove('locating');
        saveGPSLocation(lat, lon);
        currentLat = lat; currentLon = lon;
        if (map) map.flyTo({ center: [lon, lat], zoom: 15, duration: 1200, essential: true });
        loadUV(lat, lon);
        clearParks();
        loadParks(lat, lon);
      },
      function(error) {
        console.error('Location error code:', error.code, 'message:', error.message);
        btn.classList.remove('locating');
        alert('Location error: ' + error.message);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
    );
  });
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
