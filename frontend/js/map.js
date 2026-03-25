import { fetchUV, fetchPlaces } from './api.js';
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
  const altitude = Math.asin(Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(ha));
  const azimuth = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(ha));
  return { altitude: altitude / rad, azimuth: ((azimuth / rad + 360) % 360) };
}

const CATEGORY_WEIGHT = { park: 3, plaza: 2, outdoor_dining: 1 };
const CATEGORY_LABEL  = { park: 'Park', plaza: 'Plaza', outdoor_dining: 'Outdoor dining' };

let map = null;
let placesData = [];

export async function initMapPage(lat, lon, mapboxToken) {
  mapboxgl.accessToken = mapboxToken;

  map = new mapboxgl.Map({
    container: 'map-container',
    style: 'mapbox://styles/mapbox/standard',  // best shadow support
    center: [lon, lat],
    zoom: 15.5,
    pitch: 55,
    bearing: -20,
    antialias: true,
  });

  map.on('style.load', () => {
    addBuildingsLayer();
    addUserDot(lat, lon);
    addSkyLayer(new Date(), lat, lon);
    setSunLighting(new Date(), lat, lon);
    loadUV(lat, lon);
    loadPlaces(lat, lon);
  });

  initScrubber(lat, lon);

  document.getElementById('place-card-close').addEventListener('click', () => {
    document.getElementById('place-card').classList.add('hidden');
  });
}

export function refreshMapLocation(lat, lon) {
  if (!map) return;
  map.flyTo({ center: [lon, lat], duration: 1400, essential: true });
  if (map.getSource('user-location')) {
    map.getSource('user-location').setData({
      type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }
    });
  }
  loadUV(lat, lon);
  loadPlaces(lat, lon);
}

// ── Buildings with shadow casting ─────────────────────────────────────────
function addBuildingsLayer() {
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
        0,   '#2A2118',
        50,  '#352A1E',
        200, '#3E3025',
      ],
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': ['get', 'min_height'],
      'fill-extrusion-opacity': 0.95,
      'fill-extrusion-cast-shadows': true,  // key: enables building shadows
    },
  });
}

// ── Sky layer (shows sun disc + atmosphere) ───────────────────────────────
function addSkyLayer(date, lat, lon) {
  const { altitude, azimuth } = sunPosition(date.getTime(), lat, lon);
  if (map.getLayer('sky')) map.removeLayer('sky');
  map.addLayer({
    id: 'sky',
    type: 'sky',
    paint: {
      'sky-type': 'atmosphere',
      'sky-atmosphere-sun': [azimuth, 90 - Math.max(0, altitude)],
      'sky-atmosphere-sun-intensity': 12,
      'sky-atmosphere-color': 'rgba(255, 225, 120, 1)',
      'sky-atmosphere-halo-color': 'rgba(255, 200, 80, 0.6)',
    },
  });
}

// ── Directional sun lighting ──────────────────────────────────────────────
function setSunLighting(date, lat, lon) {
  if (!map) return;
  const { altitude, azimuth } = sunPosition(date.getTime(), lat, lon);
  const sunUp = altitude > 0;
  const intensity = Math.max(0, Math.min(1, altitude / 55));

  // Warm golden sun color
  const r = 255;
  const g = Math.round(210 + intensity * 40);
  const b = Math.round(120 + intensity * 80);

  try {
    map.setLights([
      {
        id: 'sun',
        type: 'directional',
        properties: {
          color: sunUp ? `rgb(${r},${g},${b})` : 'rgb(100,120,180)',
          intensity: sunUp ? Math.max(0.15, intensity) : 0.1,
          direction: [azimuth, Math.max(1, altitude)],
          'cast-shadows': true,
          'shadow-intensity': sunUp ? Math.min(1.0, intensity * 1.1) : 0,
        },
      },
      {
        id: 'ambient',
        type: 'ambient',
        properties: {
          color: 'rgb(160, 180, 210)',
          intensity: 0.4 + (1 - intensity) * 0.3,
        },
      },
    ]);
  } catch {
    // Fallback for older Mapbox builds
    map.setLight({
      position: [1.5, azimuth, 90 - Math.max(0, altitude)],
      color: `rgb(${r},${g},${b})`,
      intensity: Math.max(0.4, intensity),
      anchor: 'map',
    });
  }
}

// ── User location dot ─────────────────────────────────────────────────────
function addUserDot(lat, lon) {
  map.addSource('user-location', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] } },
  });
  map.addLayer({
    id: 'user-glow',
    type: 'circle',
    source: 'user-location',
    paint: { 'circle-radius': 22, 'circle-color': '#D4833A', 'circle-opacity': 0.18, 'circle-blur': 0.6 },
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
}

// ── Place heat bubbles (GeoJSON layers — no HTML markers) ─────────────────
function renderPlaceBubbles(places) {
  // Remove old layers/source
  ['places-glow', 'places-core'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
  if (map.getSource('places')) map.removeSource('places');

  if (!places.length) return;

  placesData = places;

  const features = places
    .filter(p => p.coordinates)
    .map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p.coordinates },
      properties: {
        name: p.name,
        category: p.category,
        distance: p.distance,
        weight: CATEGORY_WEIGHT[p.category] ?? 1,
      },
    }));

  map.addSource('places', { type: 'geojson', data: { type: 'FeatureCollection', features } });

  // Outer glow — heat map feel
  map.addLayer({
    id: 'places-glow',
    type: 'circle',
    source: 'places',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 1, 28, 3, 48],
      'circle-color': '#E8A84A',
      'circle-opacity': 0.18,
      'circle-blur': 0.8,
    },
  });

  // Core dot
  map.addLayer({
    id: 'places-core',
    type: 'circle',
    source: 'places',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 1, 9, 3, 14],
      'circle-color': [
        'match', ['get', 'category'],
        'park',           '#3A9E5A',
        'outdoor_dining', '#7B5EA7',
        '#E8A84A',
      ],
      'circle-opacity': 0.92,
      'circle-stroke-width': 2.5,
      'circle-stroke-color': 'rgba(255,255,255,0.9)',
    },
  });

  // Click / tap on bubble
  const handleClick = (e) => {
    if (!e.features?.length) return;
    const props = e.features[0].properties;
    const info = { label: CATEGORY_LABEL[props.category] ?? 'Outdoor spot' };
    document.getElementById('place-card-type').textContent = info.label;
    document.getElementById('place-card-name').textContent = props.name;
    document.getElementById('place-card-distance').textContent =
      props.distance ? `${Math.round(props.distance)}m away` : 'Nearby';
    document.getElementById('place-card').classList.remove('hidden');
  };

  map.on('click', 'places-core', handleClick);
  map.on('touchend', 'places-core', handleClick);
  map.on('mouseenter', 'places-core', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'places-core', () => { map.getCanvas().style.cursor = ''; });
}

// ── Scrubber ──────────────────────────────────────────────────────────────
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
    if (map.getLayer('sky')) {
      map.setPaintProperty('sky', 'sky-atmosphere-sun',
        (() => { const s = sunPosition(d.getTime(), lat, lon); return [s.azimuth, 90 - Math.max(0, s.altitude)]; })()
      );
    }
  });
}

function formatTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// ── UV ────────────────────────────────────────────────────────────────────
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
    labelEl.textContent = 'Tap to retry';
  }
}

// ── Places ────────────────────────────────────────────────────────────────
async function loadPlaces(lat, lon) {
  const spotsEl = document.getElementById('spots-count');
  try {
    const data = await fetchPlaces(lat, lon);
    const places = data.places ?? [];
    spotsEl.textContent = places.length;
    if (map.isStyleLoaded()) {
      renderPlaceBubbles(places);
    } else {
      map.once('style.load', () => renderPlaceBubbles(places));
    }
  } catch {
    spotsEl.textContent = '0';
  }
}
