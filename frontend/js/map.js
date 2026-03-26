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
const sunMarkers = []; // amber bubble markers for top spots

const OPEN_AREA_CLASSES = [
  'park', 'grass', 'pitch', 'cemetery', 'golf_course',
  'scrub', 'sand', 'meadow', 'farmland',
];

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
    addHeatmapLayers();
    addSkyLayer(new Date(), lat, lon);
    setSunLighting(new Date(), lat, lon);
    loadUV(lat, lon);
    // Run analysis once tiles are loaded
    map.once('idle', runSunScoreAnalysis);
  });

  initScrubber(lat, lon);
  initSearch();
  initLocateButton();
  initPills();
}

export function refreshMapLocation(lat, lon) {
  currentLat = lat;
  currentLon = lon;
  if (!map) return;
  map.flyTo({ center: [lon, lat], zoom: 15, duration: 1400, essential: true });
  if (map.isStyleLoaded()) {
    setSunLighting(new Date(), lat, lon);
    updateSkyLayer(new Date(), lat, lon);
    map.once('idle', runSunScoreAnalysis);
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

// ── Heatmap layers (GeoJSON source, populated by analysis) ────────────────
function addHeatmapLayers() {
  map.addSource('sun-score-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Fill: color driven by sunHours property
  const fillDef = {
    id: 'sun-score-fill',
    type: 'fill',
    source: 'sun-score-source',
    paint: {
      'fill-color': [
        'step', ['get', 'sunHours'],
        '#7BA7BC',    // 0–3h: cool blue-grey
        4, '#EEC840', // 4–5h: yellow
        6, '#E07820', // 6–7h: orange
        8, '#C42C10', // 8+h:  deep amber-red
      ],
      'fill-opacity': 0.44,
    },
  };

  // Border: matching warm/cool tone
  const borderDef = {
    id: 'sun-score-border',
    type: 'line',
    source: 'sun-score-source',
    paint: {
      'line-color': ['case',
        ['>=', ['get', 'sunHours'], 8], '#9C2208',
        ['>=', ['get', 'sunHours'], 6], '#B05A0C',
        ['>=', ['get', 'sunHours'], 4], '#887000',
        '#506070',
      ],
      'line-width': 1.5,
      'line-opacity': 0.7,
      'line-blur': 1.5,
    },
  };

  // Insert below 3d-buildings so buildings sit on top of the glow
  try {
    map.addLayer(fillDef, '3d-buildings');
    map.addLayer(borderDef, '3d-buildings');
  } catch {
    if (!map.getLayer('sun-score-fill'))   map.addLayer(fillDef);
    if (!map.getLayer('sun-score-border')) map.addLayer(borderDef);
  }
}

// ── Shadow / sun analysis ─────────────────────────────────────────────────

function getPolygonCentroid(geometry) {
  let coords;
  if      (geometry.type === 'Polygon')      coords = geometry.coordinates[0];
  else if (geometry.type === 'MultiPolygon') coords = geometry.coordinates[0]?.[0];
  else if (geometry.type === 'Point')        return { lon: geometry.coordinates[0], lat: geometry.coordinates[1] };
  else return null;
  if (!coords?.length) return null;
  let lon = 0, lat = 0;
  for (const [x, y] of coords) { lon += x; lat += y; }
  return { lon: lon / coords.length, lat: lat / coords.length };
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBearing(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180, dLon = (lon2 - lon1) * rad;
  const y = Math.sin(dLon) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
            Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLon);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

function angleDiff(a, b) {
  const d = ((a - b + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Count hours (8am–6pm local) where the sun is unblocked at this point.
 * Uses longitude-based UTC offset to avoid browser-timezone bias.
 */
function countSunnyHours(lat, lon, buildings) {
  // Approximate local UTC offset from longitude (avoids browser TZ issues)
  const utcOffsetMs = Math.round(lon / 15) * 3_600_000;

  // Today's local midnight as a UTC timestamp
  const locationNow = new Date(Date.now() + utcOffsetMs);
  const localMidnightUTC =
    Date.UTC(locationNow.getUTCFullYear(), locationNow.getUTCMonth(), locationNow.getUTCDate())
    - utcOffsetMs;

  let sunny = 0;

  for (let h = 8; h <= 18; h++) {
    const ts = localMidnightUTC + h * 3_600_000;
    const { altitude, azimuth } = sunPosition(ts, lat, lon);

    if (altitude <= 5) continue; // below horizon or too low

    // Check if any nearby building blocks the sun at this hour
    let blocked = false;
    for (const b of buildings) {
      const bh = b.properties?.height || b.properties?.render_height || 0;
      if (bh < 5) continue;

      const bc = getPolygonCentroid(b.geometry);
      if (!bc) continue;

      const dist = haversineMeters(lat, lon, bc.lat, bc.lon);
      if (dist < 4 || dist > 350) continue; // ignore overlap/far

      // Is the building in the sun's direction from our point?
      const bear = getBearing(lat, lon, bc.lat, bc.lon);
      if (angleDiff(bear, azimuth) > 55) continue;

      // Does its angular height exceed sun altitude?
      const angularHeight = Math.atan2(bh, dist) / (Math.PI / 180);
      if (angularHeight > altitude) { blocked = true; break; }
    }

    if (!blocked) sunny++;
  }

  return sunny;
}

function runSunScoreAnalysis() {
  if (!map?.getSource('sun-score-source')) return;

  // Query landuse polygons visible in the current viewport
  let openAreas = [];
  try {
    openAreas = map.querySourceFeatures('composite', {
      sourceLayer: 'landuse',
      filter: ['match', ['get', 'class'], OPEN_AREA_CLASSES, true, false],
    });
  } catch { return; }

  if (!openAreas.length) return;

  // Deduplicate features split across tile boundaries
  const seen = [];
  const deduped = [];
  for (const f of openAreas) {
    const center = getPolygonCentroid(f.geometry);
    if (!center) continue;
    if (seen.some(s => haversineMeters(center.lat, center.lon, s.lat, s.lon) < 25)) continue;
    seen.push(center);
    deduped.push({ feature: f, center });
  }

  const candidates = deduped.slice(0, 30); // cap for performance
  const scored = [];

  for (const { feature, center } of candidates) {
    // Query buildings within ~75px (~350m at zoom 15) of this area's center
    const sp = map.project([center.lon, center.lat]);
    let buildings = [];
    try {
      buildings = map.queryRenderedFeatures(
        [[sp.x - 75, sp.y - 75], [sp.x + 75, sp.y + 75]],
        { layers: ['3d-buildings'] }
      );
    } catch { /* buildings layer not ready */ }

    const sunHours = countSunnyHours(center.lat, center.lon, buildings);

    scored.push({
      type: 'Feature',
      geometry: feature.geometry,
      properties: { sunHours, centerLon: center.lon, centerLat: center.lat },
    });
  }

  map.getSource('sun-score-source')?.setData({
    type: 'FeatureCollection',
    features: scored,
  });

  updateSunMarkers(scored);
}

function updateSunMarkers(scored) {
  sunMarkers.forEach(m => m.remove());
  sunMarkers.length = 0;

  const topSpots = scored
    .filter(f => f.properties.sunHours >= 6)
    .sort((a, b) => b.properties.sunHours - a.properties.sunHours)
    .slice(0, 5);

  for (const spot of topSpots) {
    const { sunHours, centerLon, centerLat } = spot.properties;
    const el = document.createElement('div');
    el.className = 'sun-bubble';
    el.dataset.tier = sunHours >= 8 ? 'hot' : 'warm';
    el.textContent = `${sunHours}h`;

    const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([centerLon, centerLat])
      .addTo(map);

    sunMarkers.push(marker);
  }
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
  });
}

function formatTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// ── UV + Weather (stored for pill detail panels) ──────────────────────────
let lastWeatherData = null;

async function loadUV(lat, lon) {
  try {
    const data = await fetchUV(lat, lon);
    const uv = data.uvIndex ?? 0;
    const { level, text } = uvDescription(uv);
    const displayText = data.isNight ? 'Nighttime' : text;
    window.__currentUV__ = uv;
    lastWeatherData = { ...data, uv, level, displayText };

    const uvPill = document.getElementById('pill-uv-num');
    const wxPill = document.getElementById('pill-wx-icon');
    if (uvPill) {
      uvPill.textContent = uv === 0 ? '0' : uv.toFixed(0);
      uvPill.style.color = UV_COLORS[level] ?? 'var(--amber)';
    }
    if (wxPill && data.weathercode != null) {
      wxPill.textContent = wmoToEmoji(data.weathercode);
    }
  } catch (e) {
    console.error('[UV] fetch error:', e);
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

function wmoToLabel(code) {
  if (code === 0)                              return 'Clear';
  if ([1, 2, 3].includes(code))               return 'Partly Cloudy';
  if ([45, 48].includes(code))                return 'Fog';
  if ([51, 53, 55].includes(code))            return 'Drizzle';
  if ([61, 63, 65].includes(code))            return 'Rain';
  if ([71, 73, 75, 77].includes(code))        return 'Snow';
  if ([80, 81, 82].includes(code))            return 'Showers';
  if ([85, 86].includes(code))                return 'Snow Showers';
  if ([95, 96, 99].includes(code))            return 'Thunderstorm';
  return '';
}

const UV_COLORS = {
  low:         'var(--uv-green)',
  moderate:    'var(--uv-yellow)',
  high:        'var(--uv-orange)',
  'very-high': 'var(--uv-red)',
  extreme:     'var(--uv-purple)',
};

// ── Sidebar pills ─────────────────────────────────────────────────────────
function initPills() {
  const detail  = document.getElementById('pill-detail');
  const content = document.getElementById('pill-detail-content');
  const close   = document.getElementById('pill-detail-close');
  if (!detail || !content) return;

  let activePill = null;

  function showDetail(type) {
    if (activePill === type) { detail.classList.add('hidden'); activePill = null; return; }
    activePill = type;
    const d = lastWeatherData;

    if (type === 'uv') {
      const uv = d?.uv ?? 0;
      const { level } = uvDescription(uv);
      content.innerHTML =
        `<div class="detail-row"><span class="detail-big" style="color:${UV_COLORS[level] ?? 'var(--amber)'}">UV ${uv.toFixed(1)}</span></div>` +
        `<div class="detail-sub">${d?.displayText ?? '--'}</div>`;
    } else if (type === 'wx') {
      const emoji = d?.weathercode != null ? wmoToEmoji(d.weathercode) : '--';
      const label = d?.weathercode != null ? wmoToLabel(d.weathercode) : '';
      const temp  = d?.tempF != null ? `${d.tempF}°F` : '--';
      content.innerHTML =
        `<div class="detail-row"><span class="detail-big">${emoji} ${temp}</span></div>` +
        `<div class="detail-sub">${label}</div>`;
    } else if (type === 'forecast') {
      const baseHour = d?.currentHour ?? new Date().getHours();
      let html = '<div class="detail-sub" style="margin-bottom:6px">UV Forecast</div>';
      (d?.forecast ?? []).forEach((uvH, i) => {
        const h = (baseHour + i + 1) % 24;
        const h12 = h % 12 || 12;
        const ampm = h < 12 ? 'am' : 'pm';
        const { level: fLevel } = uvDescription(uvH);
        const color = UV_COLORS[fLevel] ?? 'var(--amber)';
        html += `<div class="detail-forecast-row">` +
          `<span class="detail-forecast-time">${h12}${ampm}</span>` +
          `<span class="detail-forecast-dot" style="background:${color}"></span>` +
          `<span class="detail-forecast-val" style="color:${color}">${uvH.toFixed(1)}</span>` +
          `</div>`;
      });
      content.innerHTML = html;
    }

    detail.classList.remove('hidden');
  }

  document.getElementById('pill-uv')?.addEventListener('click', e => { e.stopPropagation(); showDetail('uv'); });
  document.getElementById('pill-wx')?.addEventListener('click', e => { e.stopPropagation(); showDetail('wx'); });
  document.getElementById('pill-forecast')?.addEventListener('click', e => { e.stopPropagation(); showDetail('forecast'); });
  close?.addEventListener('click', () => { detail.classList.add('hidden'); activePill = null; });
  document.getElementById('map-container')?.addEventListener('click', () => { detail.classList.add('hidden'); activePill = null; });
}

// ── Locate button ─────────────────────────────────────────────────────────
function initLocateButton() {
  const btn = document.getElementById('locate-btn');
  if (!btn) return;

  btn.addEventListener('click', function () {
    if (!navigator.geolocation) { alert('Geolocation not supported on this device'); return; }
    btn.classList.add('locating');
    navigator.geolocation.getCurrentPosition(
      function (position) {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        btn.classList.remove('locating');
        saveGPSLocation(lat, lon);
        currentLat = lat; currentLon = lon;
        if (map) {
          map.flyTo({ center: [lon, lat], zoom: 15, duration: 1200, essential: true });
          map.once('idle', runSunScoreAnalysis);
        }
        loadUV(lat, lon);
      },
      function (error) {
        btn.classList.remove('locating');
        alert('Location error: ' + error.message);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
    );
  });
}

// ── Location helpers ──────────────────────────────────────────────────────
const SAVED_LOC_KEY = 'tan_saved_location';

export function getSavedLocation() {
  try { return JSON.parse(localStorage.getItem(SAVED_LOC_KEY)); } catch { return null; }
}

export function saveGPSLocation(lat, lon) {
  const existing = getSavedLocation();
  if (!existing?.isManual) {
    localStorage.setItem(SAVED_LOC_KEY, JSON.stringify({ name: 'Current Location', lat, lon, isManual: false }));
  }
}

function saveLocation(name, lat, lon) {
  localStorage.setItem(SAVED_LOC_KEY, JSON.stringify({ name, lat, lon, isManual: true }));
}

// ── Search ────────────────────────────────────────────────────────────────
function initSearch() {
  const input   = document.getElementById('map-search-input');
  const results = document.getElementById('map-search-results');
  const clear   = document.getElementById('map-search-clear');
  let debounce  = null;

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
          currentLat = r.lat; currentLon = r.lon;
          if (map) {
            map.flyTo({ center: [r.lon, r.lat], zoom: 15, pitch: 52, duration: 1600, essential: true });
            setSunLighting(new Date(), r.lat, r.lon);
            updateSkyLayer(new Date(), r.lat, r.lon);
            loadUV(r.lat, r.lon);
            map.once('idle', runSunScoreAnalysis);
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
