import { fetchUV, fetchPlaces } from './api.js';
import { uvDescription } from './tanScore.js';

// ── Sun position calculation ──────────────────────────────────────────────
function sunPosition(date, lat, lon) {
  const rad = Math.PI / 180;
  const jd = date / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const epsilon = 23.439 * rad;
  const sinDec = Math.sin(epsilon) * Math.sin(lambda);
  const dec = Math.asin(sinDec);
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lmst = ((gmst + lon / 15) % 24 + 24) % 24;
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const ha = (lmst * 15 - ra / rad) * rad;
  const latRad = lat * rad;
  const altitude = Math.asin(Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(ha));
  const azimuth = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(ha));
  return { altitude: altitude / rad, azimuth: ((azimuth / rad + 360) % 360) };
}

const CATEGORY_INFO = {
  park:           { label: 'Park',           color: '#3A9E5A', emoji: '🌳' },
  plaza:          { label: 'Plaza',          color: '#D4833A', emoji: '☀️' },
  outdoor_dining: { label: 'Outdoor dining', color: '#7B5EA7', emoji: '🍽' },
};

let map = null;
let markers = [];
let currentLat = 40.758;
let currentLon = -73.9855;

export async function initMapPage(lat, lon, mapboxToken, locationDenied) {
  currentLat = lat; currentLon = lon;
  mapboxgl.accessToken = mapboxToken;

  // Show location denied banner if needed
  updateLocationBanner(locationDenied);

  map = new mapboxgl.Map({
    container: 'map-container',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [lon, lat],
    zoom: 15.5,
    pitch: 55,
    bearing: -20,
    antialias: true,
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

  map.on('load', () => {
    const labelLayerId = map.getStyle().layers.find(
      l => l.type === 'symbol' && l.layout?.['text-field']
    )?.id;

    // 3D buildings
    map.addLayer({
      id: '3d-buildings',
      source: 'composite',
      'source-layer': 'building',
      filter: ['==', 'extrude', 'true'],
      type: 'fill-extrusion',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'height'],
          0, '#1E1810', 50, '#2C2218', 200, '#3A2E22'],
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': ['get', 'min_height'],
        'fill-extrusion-opacity': 0.92,
      },
    }, labelLayerId);

    // User location dot
    map.addSource('user-location', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] } },
    });
    map.addLayer({
      id: 'user-dot-glow',
      type: 'circle',
      source: 'user-location',
      paint: { 'circle-radius': 18, 'circle-color': '#D4833A', 'circle-opacity': 0.15 },
    });
    map.addLayer({
      id: 'user-dot',
      type: 'circle',
      source: 'user-location',
      paint: {
        'circle-radius': 8,
        'circle-color': '#D4833A',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#FFFFFF',
      },
    });

    updateSunLighting(new Date(), lat, lon);
    loadUV(lat, lon);
    loadPlaces(lat, lon);
  });

  // Time scrubber
  const scrubberInput = document.getElementById('scrubber-input');
  const scrubberLabel = document.getElementById('scrubber-time-label');
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  scrubberInput.value = mins;
  scrubberLabel.textContent = formatTime(mins);
  scrubberInput.addEventListener('input', () => {
    const m = parseInt(scrubberInput.value);
    const d = new Date(); d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    scrubberLabel.textContent = formatTime(m);
    updateSunLighting(d, lat, lon);
  });

  document.getElementById('place-card-close').addEventListener('click', () => {
    document.getElementById('place-card').classList.add('hidden');
  });
}

// Called when returning to map tab — re-centers and refreshes data
export function refreshMapLocation(lat, lon, locationDenied) {
  currentLat = lat; currentLon = lon;
  updateLocationBanner(locationDenied);

  if (!map) return;

  // Fly to new location
  map.flyTo({ center: [lon, lat], duration: 1200, essential: true });

  // Update user dot
  if (map.getSource('user-location')) {
    map.getSource('user-location').setData({
      type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }
    });
  }

  // Refresh UV + spots for new location
  loadUV(lat, lon);
  loadPlaces(lat, lon);
}

function updateLocationBanner(denied) {
  let banner = document.getElementById('location-banner');
  if (!denied) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'location-banner';
    banner.className = 'location-banner';
    banner.innerHTML = `
      <span>Location unavailable — showing NYC</span>
      <button id="location-retry">Allow location</button>
    `;
    document.getElementById('page-map').appendChild(banner);
    document.getElementById('location-retry').addEventListener('click', async () => {
      const { getLocation } = await import('./app.js');
      const loc = await getLocation();
      refreshMapLocation(loc.lat, loc.lon, loc.denied);
    });
  }
}

function formatTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function updateSunLighting(date, lat, lon) {
  if (!map?.isStyleLoaded()) return;
  const { altitude, azimuth } = sunPosition(date.getTime(), lat, lon);
  const intensity = Math.max(0, Math.min(1, altitude / 60));
  const r = 255;
  const g = Math.round(220 + (altitude > 30 ? 35 : altitude * 35 / 30));
  const b = Math.round(150 + (altitude > 30 ? 80 : altitude * 80 / 30));
  try {
    map.setLights([
      {
        id: 'sun-light', type: 'directional',
        properties: {
          color: `rgb(${r},${g},${b})`,
          intensity: Math.max(0.1, intensity * 0.9),
          direction: [azimuth, Math.max(0, altitude)],
          'cast-shadows': true,
          'shadow-intensity': Math.min(0.9, intensity * 0.85),
        },
      },
      {
        id: 'ambient-light', type: 'ambient',
        properties: { color: 'rgb(180,195,220)', intensity: 0.35 + (1 - intensity) * 0.25 },
      },
    ]);
  } catch {
    map.setLight({
      position: [1.5, azimuth, 90 - Math.max(0, altitude)],
      color: `rgb(${r},${g},${b})`,
      intensity: Math.max(0.3, intensity),
      anchor: 'map',
    });
  }
}

async function loadUV(lat, lon) {
  const badge = document.getElementById('uv-badge');
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
    labelEl.textContent = 'Could not load';
  }
}

async function loadPlaces(lat, lon) {
  const spotsEl = document.getElementById('spots-count');
  try {
    const data = await fetchPlaces(lat, lon);
    const places = data.places ?? [];
    spotsEl.textContent = places.length;

    markers.forEach(m => m.remove());
    markers = [];

    places.forEach(place => {
      if (!place.coordinates) return;
      const info = CATEGORY_INFO[place.category] ?? CATEGORY_INFO.plaza;

      // Pin-style marker with label
      const el = document.createElement('div');
      el.className = 'map-pin';
      el.innerHTML = `
        <div class="map-pin-bubble" style="background:${info.color}">
          <span class="map-pin-label">${place.name}</span>
        </div>
        <div class="map-pin-tail" style="border-top-color:${info.color}"></div>
      `;

      // Works on both mobile (touch) and desktop (click)
      const handleTap = (e) => {
        e.stopPropagation();
        showPlaceCard(place, info);
      };
      el.addEventListener('click', handleTap);
      el.addEventListener('touchend', handleTap, { passive: false });

      markers.push(
        new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(place.coordinates)
          .addTo(map)
      );
    });
  } catch {
    spotsEl.textContent = '0';
  }
}

function showPlaceCard(place, info) {
  document.getElementById('place-card-type').textContent = info.label;
  document.getElementById('place-card-name').textContent = place.name;
  document.getElementById('place-card-distance').textContent =
    place.distance ? `${Math.round(place.distance)}m away` : 'Nearby';
  document.getElementById('place-card').classList.remove('hidden');
}
