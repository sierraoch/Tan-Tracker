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

      // ── UV + Weather ──────────────────────────────────────────────────────
      if (path === '/api/uv') {
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        if (!lat || !lon) return err('lat and lon required');

        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          `&hourly=uv_index,temperature_2m,precipitation_probability,weathercode` +
          `&current_weather=true&timezone=auto&forecast_days=1`
        );
        const data = await res.json();
        console.log('[UV] Raw Open-Meteo response:', JSON.stringify(data));

        // Use the location's UTC offset (not server UTC) for the correct local hour
        const utcOffsetSecs = data.utc_offset_seconds ?? 0;
        const localMs = Date.now() + utcOffsetSecs * 1000;
        const currentHour = Math.floor(localMs / 3600000) % 24;

        const uvNow = data.hourly?.uv_index?.[currentHour] ?? 0;
        const tempC = data.current_weather?.temperature ?? null;
        const tempF = tempC !== null ? Math.round(tempC * 9 / 5 + 32) : null;
        const weathercode = data.current_weather?.weathercode ?? null;
        const isNight = uvNow === 0 && (currentHour < 6 || currentHour >= 20);
        const forecast = [1, 2, 3].map(h => data.hourly?.uv_index?.[(currentHour + h) % 24] ?? 0);

        console.log(`[UV] hour=${currentHour} uv=${uvNow} tempF=${tempF} code=${weathercode}`);

        return json({
          uvIndex: uvNow,
          currentHour,
          isNight,
          tempF,
          weathercode,
          forecast,
          all: data.hourly?.uv_index ?? [],
          times: data.hourly?.time ?? [],
        });
      }

      // ── Parks (nearby outdoor spots via Mapbox) ───────────────────────────
      if (path === '/api/parks') {
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        if (!lat || !lon) return err('lat and lon required');
        const token = env.MAPBOX_TOKEN;
        if (!token) return err('Mapbox token not configured', 500);

        const searches = [
          { q: 'park',               category: 'park'       },
          { q: 'outdoor+restaurant', category: 'restaurant' },
          { q: 'plaza',              category: 'plaza'      },
          { q: 'beach',              category: 'beach'      },
        ];

        const groups = await Promise.all(
          searches.map(({ q, category }) =>
            fetch(
              `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json` +
              `?proximity=${lon},${lat}&types=poi&limit=8&access_token=${token}`
            ).then(r => r.json()).then(data =>
              (data.features ?? []).map(f => ({
                name: f.place_name,
                lat:  f.center[1],
                lon:  f.center[0],
                category,
              }))
            )
          )
        );

        // Deduplicate by short name, cap at 15
        const seen  = new Set();
        const parks = [];
        for (const group of groups) {
          for (const place of group) {
            const key = place.name.split(',')[0].toLowerCase().trim();
            if (!seen.has(key) && parks.length < 15) {
              seen.add(key);
              parks.push(place);
            }
          }
        }

        console.log('[parks] combined result count:', parks.length);
        return json({ parks });
      }

      // ── Geocode ───────────────────────────────────────────────────────────
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
        return json({
          results: (data.features ?? []).map(f => ({
            name: f.place_name,
            lat: f.center[1],
            lon: f.center[0],
          })),
        });
      }

      // ── User-scoped routes ────────────────────────────────────────────────
      const user = url.searchParams.get('user');
      if (!user) return err('user param required', 400);

      if (path === '/api/profile') {
        if (request.method === 'GET') {
          return json(await env.TAN_TRACKER_KV.get(userKey(user, 'profile'), 'json') ?? null);
        }
        if (request.method === 'PUT') {
          await env.TAN_TRACKER_KV.put(userKey(user, 'profile'), JSON.stringify(await request.json()));
          return json({ ok: true });
        }
      }

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

      if (path === '/api/tanscore') {
        if (request.method === 'GET') {
          return json(await env.TAN_TRACKER_KV.get(userKey(user, 'tanscore'), 'json') ?? { score: 0, lastUpdated: null });
        }
        if (request.method === 'PUT') {
          await env.TAN_TRACKER_KV.put(userKey(user, 'tanscore'), JSON.stringify(await request.json()));
          return json({ ok: true });
        }
      }

      return err('Not found', 404);
    } catch (e) {
      return err(e.message, 500);
    }
  },
};
