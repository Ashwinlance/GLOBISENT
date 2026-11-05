/**
 * GLOBISENT local businesses (OpenStreetMap), for the zoom-in business layer.
 *   GET /api/globisent/businesses?lat=&lon=   named businesses in the ~1 km tile containing the point
 *   GET /api/globisent/business?id=N123        details for one OpenStreetMap object
 *
 * Tiles come from Photon (komoot's public OpenStreetMap search, the same
 * service the app's place lookup uses): three category queries per tile,
 * one request at a time, cached in memory and on disk for 7 days. Details
 * come from Nominatim lookup (≤1 request/second per its usage policy) on a
 * click only. PHOTON_URL / NOMINATIM_URL override the public services.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultSourceRoot } from './common/source-root.js';

const USER_AGENT = 'GLOBISENT/1.0 (local workstation; business layer)';
const TIMEOUT_MS = 20000;
export const TILE_DEG = 0.01;
const TILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DETAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PHOTON_GAP_MS = 400;
const NOMINATIM_GAP_MS = 1100;
const MAX_MEMORY_TILES = 400;
const PER_GROUP = 50;
export const BUSINESS_CACHE_DIR = path.join(defaultSourceRoot, '.gev-cache', 'globisent', 'businesses');

/** Photon tag filters, one query each. */
export const BUSINESS_GROUPS = Object.freeze([
  ['office', 'craft', 'industrial', 'man_made:works', 'amenity:bank', 'amenity:coworking_space', 'amenity:bureau_de_change'],
  ['shop'],
  ['tourism:hotel', 'tourism:guest_house', 'tourism:motel', 'amenity:restaurant', 'amenity:cafe', 'amenity:fast_food',
    'amenity:pharmacy', 'amenity:fuel', 'amenity:hospital', 'amenity:clinic', 'amenity:cinema', 'amenity:marketplace'],
]);

/** Map an OSM key/value to a display kind. */
export function classify(key, value) {
  if (key === 'office' || (key === 'amenity' && value === 'coworking_space')) return 'office';
  if (key === 'craft' || key === 'industrial' || (key === 'man_made' && value === 'works')) return 'industry';
  if (key === 'amenity' && (value === 'bank' || value === 'bureau_de_change')) return 'bank';
  if (key === 'shop') return 'shop';
  if (key === 'tourism') return 'hotel';
  if (key === 'amenity' && ['restaurant', 'cafe', 'fast_food'].includes(value)) return 'food';
  if (key === 'amenity' && ['pharmacy', 'hospital', 'clinic'].includes(value)) return 'health';
  if (key === 'amenity' && value === 'fuel') return 'fuel';
  return 'other';
}

export function tileOf(lat, lon) {
  return [Math.floor(lat / TILE_DEG), Math.floor(lon / TILE_DEG)];
}

const humanValue = (value) => String(value ?? '').replace(/_/g, ' ');
const OSM_ID = /^[NWR][1-9]\d{0,14}$/;

/** Photon features → compact rows inside the tile: [id, name, lat, lon, kind, type, address]. */
export function featuresToRows(features, [ti, tj]) {
  const south = ti * TILE_DEG;
  const west = tj * TILE_DEG;
  const rows = new Map();
  for (const feature of features ?? []) {
    const p = feature?.properties ?? {};
    const [lon, lat] = feature?.geometry?.coordinates ?? [];
    if (!p.name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < south || lat >= south + TILE_DEG || lon < west || lon >= west + TILE_DEG) continue;
    const id = `${String(p.osm_type ?? 'N').charAt(0).toUpperCase()}${p.osm_id}`;
    if (!OSM_ID.test(id) || rows.has(id)) continue;
    const address = [[p.housenumber, p.street].filter(Boolean).join(' '), p.district, p.city].filter(Boolean).join(', ');
    rows.set(id, [id, String(p.name).slice(0, 120), Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6,
      classify(p.osm_key, p.osm_value), humanValue(p.osm_value), address]);
  }
  return [...rows.values()];
}

export function createGlobisentBusinessesMiddleware({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  cacheDir = null,
  photonUrl = process.env.PHOTON_URL || 'https://photon.komoot.io',
  nominatimUrl = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
} = {}) {
  const tiles = new Map();
  const details = new Map();
  const pendingTiles = new Map();
  let photonQueue = Promise.resolve();
  let photonNextAt = 0;
  let nominatimQueue = Promise.resolve();
  let nominatimNextAt = 0;

  async function getJson(url) {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return JSON.parse(await response.text());
  }

  function serial(kind, task) {
    const isPhoton = kind === 'photon';
    const run = (isPhoton ? photonQueue : nominatimQueue).then(async () => {
      const wait = (isPhoton ? photonNextAt : nominatimNextAt) - now();
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        if (isPhoton) photonNextAt = now() + PHOTON_GAP_MS;
        else nominatimNextAt = now() + NOMINATIM_GAP_MS;
      }
    });
    if (isPhoton) photonQueue = run.catch(() => {});
    else nominatimQueue = run.catch(() => {});
    return run;
  }

  const tileFile = ([i, j]) => (cacheDir ? path.join(cacheDir, `${i}_${j}.json`) : null);

  async function loadTile(tile) {
    const [i, j] = tile;
    const lat = (i + 0.5) * TILE_DEG;
    const lon = (j + 0.5) * TILE_DEG;
    const features = [];
    let failures = 0;
    for (const group of BUSINESS_GROUPS) {
      const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5), radius: '0.8', limit: String(PER_GROUP), lang: 'en' });
      for (const tag of group) params.append('osm_tag', tag);
      try {
        const data = await serial('photon', () => getJson(`${photonUrl.replace(/\/$/, '')}/reverse?${params}`));
        features.push(...(data?.features ?? []));
      } catch {
        failures += 1;
      }
    }
    if (failures === BUSINESS_GROUPS.length) throw new Error('OpenStreetMap search unavailable');
    return { tile: [i, j], fetchedAt: new Date(now()).toISOString(), partial: failures > 0, rows: featuresToRows(features, tile) };
  }

  async function getTile(lat, lon) {
    const tile = tileOf(lat, lon);
    const key = tile.join('_');
    const hit = tiles.get(key);
    if (hit && now() - hit.at < TILE_TTL_MS) return hit.value;
    const file = tileFile(tile);
    if (!hit && file) {
      try {
        const saved = JSON.parse(await fs.readFile(file, 'utf8'));
        if (saved?.value?.rows && now() - saved.at < TILE_TTL_MS) {
          tiles.set(key, saved);
          return saved.value;
        }
      } catch { /* not cached yet */ }
    }
    if (!pendingTiles.has(key)) {
      pendingTiles.set(key, loadTile(tile)
        .then(async (value) => {
          const entry = { at: now(), value };
          tiles.set(key, entry);
          if (tiles.size > MAX_MEMORY_TILES) tiles.delete(tiles.keys().next().value);
          if (file && !value.partial) {
            try {
              await fs.mkdir(path.dirname(file), { recursive: true });
              await fs.writeFile(`${file}.tmp`, JSON.stringify(entry));
              await fs.rename(`${file}.tmp`, file);
            } catch { /* memory copy still works */ }
          }
          return value;
        })
        .finally(() => pendingTiles.delete(key)));
    }
    try {
      return await pendingTiles.get(key);
    } catch (error) {
      if (hit) return hit.value;
      throw error;
    }
  }

  async function getBusiness(id) {
    if (!OSM_ID.test(id)) throw Object.assign(new Error('id must look like N123, W123 or R123'), { status: 400 });
    const hit = details.get(id);
    if (hit && now() - hit.at < DETAIL_TTL_MS) return hit.value;
    const params = new URLSearchParams({ osm_ids: id, format: 'jsonv2', extratags: '1', addressdetails: '1', 'accept-language': 'en' });
    const data = await serial('nominatim', () => getJson(`${nominatimUrl.replace(/\/$/, '')}/lookup?${params}`));
    const place = Array.isArray(data) ? data[0] : null;
    if (!place) throw Object.assign(new Error('business not found in OpenStreetMap'), { status: 404 });
    const tags = place.extratags ?? {};
    const a = place.address ?? {};
    const pick = (...keys) => keys.map((k) => tags[k]).find(Boolean) ?? null;
    const website = pick('website', 'contact:website', 'url');
    const companyId = [tags['brand:wikidata'], tags['operator:wikidata'], tags.wikidata].find((q) => /^Q[1-9]\d*$/.test(q ?? '')) ?? null;
    const facts = [
      { label: 'Type', value: humanValue(place.type) || humanValue(place.category) },
      { label: 'Brand', value: pick('brand') },
      { label: 'Operator', value: pick('operator') },
      { label: 'Opening hours', value: pick('opening_hours') },
      { label: 'Phone', value: pick('phone', 'contact:phone') },
      { label: 'Website', value: website ? website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : null, url: website },
      { label: 'Cuisine', value: pick('cuisine') ? humanValue(pick('cuisine')).replace(/;/g, ', ') : null },
      { label: 'Wheelchair access', value: pick('wheelchair') },
    ].filter((item) => item.value);
    const address = [
      [a.house_number, a.road].filter(Boolean).join(' '),
      a.suburb || a.neighbourhood,
      a.city || a.town || a.village,
      a.state,
      a.postcode,
      a.country,
    ].filter(Boolean).join(', ');
    const osmType = { N: 'node', W: 'way', R: 'relation' }[id[0]];
    const value = {
      id,
      name: place.name || place.display_name?.split(',')[0] || 'Business',
      kind: classify(place.category, place.type),
      type: humanValue(place.type),
      lat: Number(place.lat),
      lon: Number(place.lon),
      companyId,
      osmUrl: `https://www.openstreetmap.org/${osmType}/${id.slice(1)}`,
      sections: [
        { title: 'Business', source: 'OpenStreetMap', sourceUrl: `https://www.openstreetmap.org/${osmType}/${id.slice(1)}`, kind: 'stats', items: facts },
        ...(address ? [{ title: 'Address', kind: 'text', text: address }] : []),
        ...(pick('description') ? [{ title: 'Description', kind: 'text', text: pick('description') }] : []),
      ],
    };
    details.set(id, { at: now(), value });
    if (details.size > 2000) details.delete(details.keys().next().value);
    return value;
  }

  function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  }

  async function businessesMiddleware(req, res, next) {
    if (req.method !== 'GET') return next();
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const lat = Number(params.get('lat'));
    const lon = Number(params.get('lon'));
    if (!params.has('lat') || !params.has('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
      return send(res, 400, { error: 'lat and lon must be valid coordinates' });
    }
    try {
      return send(res, 200, await getTile(lat, lon));
    } catch (error) {
      return send(res, 502, { error: `Local businesses unavailable: ${error?.message ?? 'upstream error'}` });
    }
  }

  async function businessMiddleware(req, res, next) {
    if (req.method !== 'GET') return next();
    const id = String(new URL(req.url ?? '/', 'http://localhost').searchParams.get('id') ?? '');
    try {
      return send(res, 200, await getBusiness(id));
    } catch (error) {
      return send(res, error?.status ?? 502, { error: error?.status ? error.message : `Business details unavailable: ${error?.message ?? 'upstream error'}` });
    }
  }

  return { businessesMiddleware, businessMiddleware, getTile, getBusiness };
}

export function globisentBusinessesProxy() {
  const service = createGlobisentBusinessesMiddleware({ cacheDir: BUSINESS_CACHE_DIR });
  const install = (server) => {
    server.middlewares.use('/api/globisent/businesses', service.businessesMiddleware);
    server.middlewares.use('/api/globisent/business', service.businessMiddleware);
  };
  return {
    name: 'globisent-businesses-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
