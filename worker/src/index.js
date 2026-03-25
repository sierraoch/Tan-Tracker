const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ── Config (serves public Mapbox token to frontend) ──────────────────
      if (path === '/api/config' && request.method === 'GET') {
        const token = env.MAPBOX_TOKEN;
        if (!token) return err('Mapbox token not configured', 500);
        return json({ mapboxToken: token });
      }

      // ── UV Index (Open-Meteo, no key required) ──────────────────────────
      if (path === '/api/uv') {
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        if (!lat || !lon) return err('lat and lon required');

        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          `&hourly=uv_index&timezone=auto&forecast_days=1`
        );
        const data = await res.json();

        // Pull the UV index closest to current hour
        const now = new Date();
        const currentHour = now.getHours();
        const uvIndex = data?.hourly?.uv_index?.[currentHour] ?? 0;
        const times = data?.hourly?.time ?? [];

        return json({ uvIndex, times, all: data?.hourly?.uv_index ?? [] });
      }

      // ── Nearby Places (Mapbox Search API) ───────────────────────────────
      if (path === '/api/places') {
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        if (!lat || !lon) return err('lat and lon required');

        const token = env.MAPBOX_TOKEN;
        if (!token) return err('Mapbox token not configured', 500);

        // Search for outdoor spots: parks, plazas, outdoor dining
        const categories = ['park', 'plaza', 'outdoor_dining'];
        const results = [];

        for (const cat of categories) {
          const res = await fetch(
            `https://api.mapbox.com/search/searchbox/v1/category/${cat}` +
            `?proximity=${lon},${lat}&limit=5&access_token=${token}`
          );
          if (res.ok) {
            const data = await res.json();
            const features = (data.features ?? []).map(f => ({
              id: f.properties?.mapbox_id ?? f.id,
              name: f.properties?.name ?? 'Unknown',
              category: cat,
              coordinates: f.geometry?.coordinates,
              distance: f.properties?.distance,
            }));
            results.push(...features);
          }
        }

        return json({ places: results });
      }

      // ── User Profile ─────────────────────────────────────────────────────
      if (path === '/api/profile') {
        if (request.method === 'GET') {
          const profile = await env.TAN_TRACKER_KV.get('profile', 'json');
          return json(profile ?? null);
        }
        if (request.method === 'PUT') {
          const body = await request.json();
          await env.TAN_TRACKER_KV.put('profile', JSON.stringify(body));
          return json({ ok: true });
        }
      }

      // ── Sessions ─────────────────────────────────────────────────────────
      if (path === '/api/sessions') {
        if (request.method === 'GET') {
          const sessions = await env.TAN_TRACKER_KV.get('sessions', 'json');
          return json(sessions ?? []);
        }
        if (request.method === 'POST') {
          const newSession = await request.json();
          const sessions = (await env.TAN_TRACKER_KV.get('sessions', 'json')) ?? [];
          const session = {
            ...newSession,
            id: Date.now(),
            timestamp: new Date().toISOString(),
          };
          sessions.unshift(session);
          await env.TAN_TRACKER_KV.put('sessions', JSON.stringify(sessions));
          return json({ ok: true, session });
        }
      }

      // ── Tan Score ────────────────────────────────────────────────────────
      if (path === '/api/tanscore') {
        if (request.method === 'GET') {
          const score = await env.TAN_TRACKER_KV.get('tanscore', 'json');
          return json(score ?? { score: 0, lastUpdated: null });
        }
        if (request.method === 'PUT') {
          const body = await request.json();
          await env.TAN_TRACKER_KV.put('tanscore', JSON.stringify(body));
          return json({ ok: true });
        }
      }

      return err('Not found', 404);
    } catch (e) {
      return err(e.message, 500);
    }
  },
};
