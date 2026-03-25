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
function err(msg, status = 400) { return json({ error: msg }, status); }

// KV keys are namespaced per user: user:{name}:profile etc.
function userKey(user, key) {
  return `user:${user.toLowerCase().trim()}:${key}`;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ── Config ───────────────────────────────────────────────────────────
      if (path === '/api/config') {
        const token = env.MAPBOX_TOKEN;
        if (!token) return err('Mapbox token not configured', 500);
        return json({ mapboxToken: token });
      }

      // ── UV ───────────────────────────────────────────────────────────────
      if (path === '/api/uv') {
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        if (!lat || !lon) return err('lat and lon required');
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          `&hourly=uv_index&timezone=auto&forecast_days=1`
        );
        const data = await res.json();
        const hour = new Date().getHours();
        return json({
          uvIndex: data?.hourly?.uv_index?.[hour] ?? 0,
          all: data?.hourly?.uv_index ?? [],
          times: data?.hourly?.time ?? [],
        });
      }

      // ── Places ───────────────────────────────────────────────────────────
      if (path === '/api/places') {
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        if (!lat || !lon) return err('lat and lon required');
        const token = env.MAPBOX_TOKEN;
        if (!token) return err('Mapbox token not configured', 500);
        const results = [];
        for (const cat of ['park', 'plaza', 'outdoor_dining']) {
          const res = await fetch(
            `https://api.mapbox.com/search/searchbox/v1/category/${cat}` +
            `?proximity=${lon},${lat}&limit=5&access_token=${token}`
          );
          if (res.ok) {
            const data = await res.json();
            results.push(...(data.features ?? []).map(f => ({
              id: f.properties?.mapbox_id ?? f.id,
              name: f.properties?.name ?? 'Unknown',
              category: cat,
              coordinates: f.geometry?.coordinates,
              distance: f.properties?.distance,
            })));
          }
        }
        return json({ places: results });
      }

      // ── Geocode (city / zip search) ───────────────────────────────────────
      if (path === '/api/geocode') {
        const q = url.searchParams.get('q');
        if (!q) return err('q required');
        const token = env.MAPBOX_TOKEN;
        if (!token) return err('Mapbox token not configured', 500);
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
          `?types=place,postcode&country=US&limit=5&access_token=${token}`
        );
        const data = await res.json();
        const results = (data.features ?? []).map(f => ({
          name: f.place_name,
          lat: f.center[1],
          lon: f.center[0],
        }));
        return json({ results });
      }

      // ── All user-scoped routes require ?user= ─────────────────────────────
      const user = url.searchParams.get('user');
      if (!user) return err('user param required', 400);

      // ── Profile ──────────────────────────────────────────────────────────
      if (path === '/api/profile') {
        if (request.method === 'GET') {
          const profile = await env.TAN_TRACKER_KV.get(userKey(user, 'profile'), 'json');
          return json(profile ?? null);
        }
        if (request.method === 'PUT') {
          const body = await request.json();
          await env.TAN_TRACKER_KV.put(userKey(user, 'profile'), JSON.stringify(body));
          return json({ ok: true });
        }
      }

      // ── Sessions ─────────────────────────────────────────────────────────
      if (path === '/api/sessions') {
        if (request.method === 'GET') {
          return json(await env.TAN_TRACKER_KV.get(userKey(user, 'sessions'), 'json') ?? []);
        }
        if (request.method === 'POST') {
          const newSession = await request.json();
          const sessions = await env.TAN_TRACKER_KV.get(userKey(user, 'sessions'), 'json') ?? [];
          const session = { ...newSession, id: Date.now(), timestamp: new Date().toISOString() };
          sessions.unshift(session);
          await env.TAN_TRACKER_KV.put(userKey(user, 'sessions'), JSON.stringify(sessions));
          return json({ ok: true, session });
        }
      }

      // ── Tan Score ────────────────────────────────────────────────────────
      if (path === '/api/tanscore') {
        if (request.method === 'GET') {
          return json(await env.TAN_TRACKER_KV.get(userKey(user, 'tanscore'), 'json') ?? { score: 0, lastUpdated: null });
        }
        if (request.method === 'PUT') {
          const body = await request.json();
          await env.TAN_TRACKER_KV.put(userKey(user, 'tanscore'), JSON.stringify(body));
          return json({ ok: true });
        }
      }

      return err('Not found', 404);
    } catch (e) {
      return err(e.message, 500);
    }
  },
};
