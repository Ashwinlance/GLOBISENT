/**
 * GLOBISENT place info: GET /api/globisent/place?lat=<deg>&lon=<deg>
 *
 * Everything worth knowing about a clicked point on the globe, from keyless
 * public sources: the place name (OpenStreetMap Nominatim, ≤1 request/second
 * per its usage policy), current weather (Open-Meteo), earthquakes within
 * 500 km in the last 24 h (USGS), GDACS alerts for the country, the World
 * Bank country profile, and news about the place.
 */
import { sharedGlobisentNews } from './globisentNews.js';
import { sharedGlobisentDomains } from './globisentDomains.js';

const USER_AGENT = 'GLOBISENT/1.0 (local workstation; place lookup)';
const TIMEOUT_MS = 12000;
const NOMINATIM_GAP_MS = 1100;
const PLACE_TTL_MS = 24 * 60 * 60 * 1000;
const WEATHER_TTL_MS = 10 * 60 * 1000;
const QUAKE_TTL_MS = 5 * 60 * 1000;
const NEARBY_KM = 500;
const MAX_CACHE = 500;

const WMO = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Heavy freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Heavy rain showers', 82: 'Violent rain showers', 85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail',
};

/** Validate the query; null when the point is not a real coordinate. */
export function parsePoint(params) {
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (!params.has('lat') || !params.has('lon')) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function createGlobisentPlaceMiddleware({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  news = sharedGlobisentNews(),
  domains = sharedGlobisentDomains(),
} = {}) {
  const cache = new Map();
  let nominatimQueue = Promise.resolve();
  let nominatimNextAt = 0;

  function remember(key, value) {
    cache.set(key, { at: now(), value });
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return value;
  }
  function recall(key, ttl) {
    const hit = cache.get(key);
    return hit && now() - hit.at < ttl ? hit.value : undefined;
  }

  async function getJson(url) {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return JSON.parse(await response.text());
  }

  async function reverseGeocode({ lat, lon }) {
    // ~1 km grid: nearby clicks share one Nominatim request.
    const key = `place:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const hit = recall(key, PLACE_TTL_MS);
    if (hit !== undefined) return hit;
    const run = nominatimQueue.then(async () => {
      const wait = nominatimNextAt - now();
      if (wait > 0) await sleep(wait);
      try {
        return await getJson(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1&accept-language=en`,
        );
      } finally {
        nominatimNextAt = now() + NOMINATIM_GAP_MS;
      }
    });
    nominatimQueue = run.catch(() => {});
    const data = await run;
    if (data?.error) return remember(key, { name: 'Open ocean or unnamed area', country: null, countryCode: null });
    const a = data?.address ?? {};
    const locality = a.city || a.town || a.village || a.municipality || a.county || a.state_district || null;
    return remember(key, {
      name: data?.name || locality || a.state || a.country || 'Unnamed place',
      locality,
      region: a.state || a.region || null,
      country: a.country || null,
      countryCode: a.country_code ? a.country_code.toUpperCase() : null,
      displayName: data?.display_name ?? null,
    });
  }

  async function weather({ lat, lon }) {
    const key = `wx:${lat.toFixed(1)},${lon.toFixed(1)}`;
    const hit = recall(key, WEATHER_TTL_MS);
    if (hit !== undefined) return hit;
    const data = await getJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&timezone=auto`,
    );
    const c = data.current ?? {};
    return remember(key, {
      title: 'Weather now',
      source: 'Open-Meteo',
      sourceUrl: 'https://open-meteo.com/',
      kind: 'stats',
      items: [
        { label: 'Conditions', value: WMO[c.weather_code] ?? '—' },
        { label: 'Temperature', value: `${c.temperature_2m ?? '—'} °C`, detail: `Feels like ${c.apparent_temperature ?? '—'} °C` },
        { label: 'Humidity', value: `${c.relative_humidity_2m ?? '—'} %` },
        { label: 'Wind', value: `${c.wind_speed_10m ?? '—'} km/h` },
        { label: 'Precipitation', value: `${c.precipitation ?? 0} mm` },
        { label: 'Local time', value: c.time ? c.time.replace('T', ' ') : '—', detail: data.timezone ?? '' },
      ],
    });
  }

  async function nearbyQuakes(point) {
    let feed = recall('usgs', QUAKE_TTL_MS);
    if (feed === undefined) {
      const data = await getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
      feed = remember('usgs', (data.features ?? []).map((f) => ({
        mag: f.properties?.mag, place: f.properties?.place, time: f.properties?.time, url: f.properties?.url,
        lon: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1],
      })));
    }
    const near = feed
      .map((q) => ({ ...q, km: distanceKm(point, q) }))
      .filter((q) => Number.isFinite(q.km) && q.km <= NEARBY_KM)
      .sort((a, b) => (b.mag ?? 0) - (a.mag ?? 0))
      .slice(0, 8);
    return {
      title: `Earthquakes within ${NEARBY_KM} km · last 24 h`,
      source: 'USGS',
      sourceUrl: 'https://earthquake.usgs.gov/earthquakes/map/',
      kind: 'list',
      items: near.map((q) => ({
        label: `M${(q.mag ?? 0).toFixed(1)} · ${q.place ?? 'Unknown'}`,
        detail: `${Math.round(q.km)} km away`,
        time: q.time ? new Date(q.time).toISOString() : null,
        url: q.url,
      })),
    };
  }

  async function settle(title, promise) {
    try {
      return await promise;
    } catch (error) {
      return { title, kind: 'error', error: error?.message ?? 'unavailable', items: [] };
    }
  }

  async function describe(point) {
    const place = await reverseGeocode(point).catch(() => ({ name: 'Unknown place', country: null, countryCode: null }));
    const sections = [settle('Weather now', weather(point)), settle('Earthquakes nearby', nearbyQuakes(point))];
    if (place.countryCode) {
      sections.push(settle('Country profile', domains.getDomain('country', place.countryCode).then((result) => {
        const merged = result.sections.flatMap((s) => (s.kind === 'stats' ? s.items : []));
        if (!merged.length) throw new Error('World Bank profile unavailable');
        return { title: `${place.country} · country profile`, source: 'World Bank', sourceUrl: 'https://data.worldbank.org/', kind: 'stats', items: merged };
      })));
      sections.push(settle('Disaster alerts', domains.getDomain('news', 'WLD').then((result) => {
        const gdacs = result.sections.find((s) => s.title?.startsWith('Global disaster alerts'));
        const items = (gdacs?.items ?? []).filter((item) => String(item.detail ?? '').toLowerCase().includes(String(place.country).toLowerCase()));
        return { title: `Active disaster alerts · ${place.country}`, source: 'GDACS', sourceUrl: 'https://www.gdacs.org/', kind: 'list', items };
      })));
    }
    const query = place.locality || place.country || '';
    if (query) {
      const region = place.countryCode === 'IN' ? 'india' : 'global';
      sections.push(settle('Latest news', news.getNews({ category: 'all', region, search: query }).then((result) => ({
        title: `Latest news · ${place.locality || place.country}`,
        source: result.provider === 'gdelt' ? 'GDELT' : 'Google News',
        sourceUrl: result.provider === 'gdelt' ? 'https://www.gdeltproject.org/' : 'https://news.google.com/',
        kind: 'list',
        items: (result.articles ?? []).slice(0, 8).map((a) => ({ label: a.title, url: a.url, detail: a.source, time: a.publishedAt })),
      }))));
    }
    return { point, place, sections: await Promise.all(sections), generatedAt: new Date(now()).toISOString() };
  }

  async function middleware(req, res, next) {
    if (req.method !== 'GET') return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const point = parsePoint(new URL(req.url ?? '/', 'http://localhost').searchParams);
    if (!point) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'lat and lon must be valid coordinates' }));
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify(await describe(point)));
  }
  middleware.describe = describe;
  return middleware;
}

export function globisentPlaceProxy() {
  const middleware = createGlobisentPlaceMiddleware();
  const install = (server) => {
    server.middlewares.use('/api/globisent/place', middleware);
  };
  return {
    name: 'globisent-place-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
