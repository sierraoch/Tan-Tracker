import { fetchUV, fetchPlaces } from './api.js';
import { uvDescription } from './tanScore.js';

// ── Sun position calculation (no external lib needed) ────────────────────
function sunPosition(date, lat, lon) {
  // Julian date
  const rad = Math.PI / 180;
  const jd = date / 86400000 + 2440587.5;
  const n = jd - 2451545.0;

  // Mean longitude and anomaly
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;

  // Ecliptic longitude
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;

  // Obliquity
  const epsilon = 23.439 * rad;

  // Right ascension & declination
  const sinDec = Math.sin(epsilon) * Math.sin(lambda);
  const dec = Math.asin(sinDec);

  // Greenwich mean sidereal time
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lmst = ((gmst + lon / 15) % 24 + 24) % 24;
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const ha = (lmst * 15 - ra / rad) * rad;

  const latRad = lat * rad;
  const altitude = Math.asin(
    Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(ha)
  );
  const azimuth = Math.atan2(
    -Math.sin(ha),
    Math.tan(dec) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(ha)
  );

  return {
    altitude: altitude / rad,  // degrees above horizon
    azimuth: ((azimuth / rad + 360) % 360),  // degrees clockwise from north
  };
}

// Category display info
const CATEGORY_INFO = {
  park:           { label: 'Park',            color: '#3A9E5A', weight: 3 },
  plaza:          { label: 'Plaza',           color: '#D4833A', weight: 2 },
  outdoor_dining: { label: 'Outdoor dining',  color: '#7B5EA7', weight: 1 },
};

let map = null;
let markers = [];
let currentUV = 0;

export async function initMapPage(lat, lon, mapboxToken) {
  // ── Init map ───────────────────────────────────────────────────────────
  mapboxgl.accessToken = mapboxToken;

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
    // 3D buildings
    const labelLayerId = map.getStyle().layers.find(
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
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['get', 'height'],
          0, '#1E1810',
          50, '#2C2218',
          200, '#3A2E22',
        ],
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
      id: 'user-dot',
      type: 'circle',
      source: 'user-location',
      paint: {
        'circle-radius': 8,
        'circle-color': '#D4833A',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#FFFFFF',
        'circle-opacity': 1,
      },
    });

    // Set initial sun position
    updateSunLighting(new Date(), lat, lon);

    // Load UV + places
    loadUV(lat, lon);
    loadPlaces(lat, lon);
  });

  // ── Time scrubber ──────────────────────────────────────────────────────
  const scrubberInput = document.getElementById('scrubber-input');
  const scrubberLabel = document.getElementById('scrubber-time-label');

  // Set to current time
  const now = new Date();
  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
  scrubberInput.value = minutesSinceMidnight;
  scrubberLabel.textContent = formatTime(minutesSinceMidnight);

  scrubberInput.addEventListener('input', () => {
    const mins = parseInt(scrubberInput.value);
    const date = new Date();
    date.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    scrubberLabel.textContent = formatTime(mins);
    updateSunLighting(date, lat, lon);
  });

  // ── Place card close ───────────────────────────────────────────────────
  document.getElementById('place-card-close').addEventListener('click', () => {
    document.getElementById('place-card').classList.add('hidden');
  });
}

function formatTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function updateSunLighting(date, lat, lon) {
  if (!map?.isStyleLoaded()) return;

  const { altitude, azimuth } = sunPosition(date.getTime(), lat, lon);

  // Normalize altitude for light intensity
  const intensity = Math.max(0, Math.min(1, altitude / 60));

  // Sun color transitions from golden (low sun) to white (high sun)
  const r = Math.round(255);
  const g = Math.round(220 + (altitude > 30 ? 35 : altitude * 35 / 30));
  const b = Math.round(150 + (altitude > 30 ? 80 : altitude * 80 / 30));

  try {
    // Mapbox GL v3 lights API
    map.setLights([
      {
        id: 'sun-light',
        type: 'directional',
        properties: {
          color: `rgb(${r},${g},${b})`,
          intensity: Math.max(0.1, intensity * 0.9),
          direction: [azimuth, Math.max(0, altitude)],
          'cast-shadows': true,
          'shadow-intensity': Math.min(0.9, intensity * 0.85),
        },
      },
      {
        id: 'ambient-light',
        type: 'ambient',
        properties: {
          color: 'rgb(180, 195, 220)',
          intensity: 0.35 + (1 - intensity) * 0.25,
        },
      },
    ]);
  } catch {
    // Fallback for older Mapbox versions
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
    currentUV = data.uvIndex ?? 0;
    const { level, text } = uvDescription(currentUV);

    valueEl.textContent = `UV ${currentUV.toFixed(1)}`;
    labelEl.textContent = text;
    badge.setAttribute('data-level', level);

    // Store globally for modal
    window.__currentUV__ = currentUV;
  } catch (e) {
    valueEl.textContent = 'UV --';
    labelEl.textContent = 'Could not load';
    console.warn('UV load failed:', e.message);
  }
}

async function loadPlaces(lat, lon) {
  const spotsEl = document.getElementById('spots-count');

  try {
    const data = await fetchPlaces(lat, lon);
    const places = data.places ?? [];
    spotsEl.textContent = places.length;

    // Clear old markers
    markers.forEach(m => m.remove());
    markers = [];

    places.forEach(place => {
      if (!place.coordinates) return;
      const info = CATEGORY_INFO[place.category] ?? CATEGORY_INFO.plaza;

      // Custom marker element
      const el = document.createElement('div');
      el.style.cssText = `
        width: ${14 + info.weight * 4}px;
        height: ${14 + info.weight * 4}px;
        border-radius: 50%;
        background: ${info.color};
        border: 2.5px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        cursor: pointer;
        opacity: 0.9;
        transition: transform 0.15s, opacity 0.15s;
      `;
      el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.2)'; el.style.opacity = '1'; });
      el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)'; el.style.opacity = '0.9'; });

      el.addEventListener('click', () => showPlaceCard(place, info));

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat(place.coordinates)
        .addTo(map);

      markers.push(marker);
    });
  } catch (e) {
    spotsEl.textContent = '0';
    console.warn('Places load failed:', e.message);
  }
}

function showPlaceCard(place, info) {
  const card = document.getElementById('place-card');
  document.getElementById('place-card-type').textContent = info.label;
  document.getElementById('place-card-name').textContent = place.name;
  document.getElementById('place-card-distance').textContent =
    place.distance ? `${Math.round(place.distance)}m away` : 'Nearby';
  card.classList.remove('hidden');
}
