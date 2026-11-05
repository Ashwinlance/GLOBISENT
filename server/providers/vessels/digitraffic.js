/**
 * Keyless ship positions from Fintraffic Digitraffic (Finland), used when no
 * AISSTREAM_API_KEY is set so the vessel layer is never empty.
 *
 * Coverage is the Baltic Sea (Finnish coastal AIS network), not worldwide;
 * AISStream's free key unlocks global ships. Data: Fintraffic / digitraffic.fi,
 * CC BY 4.0. Digitraffic asks clients to identify themselves with the
 * Digitraffic-User header and to poll gently: positions at most once a
 * minute, ship names every six hours, both cached and shared by all tabs.
 */

const BASE = 'https://meri.digitraffic.fi/api/ais/v1';
const USER = 'GLOBISENT/1.0';
const TIMEOUT_MS = 20000;
const POSITIONS_TTL_MS = 60 * 1000;
const NAMES_TTL_MS = 6 * 60 * 60 * 1000;
const RECENT_MS = 30 * 60 * 1000;

export const DIGITRAFFIC_SOURCE = 'Digitraffic · Baltic Sea (keyless) — add a free AISStream key for ships worldwide';

/** AIS ship-type code → readable type. */
export function shipTypeName(code) {
  const n = Number(code);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 20 && n <= 29) return 'Wing in ground';
  if (n === 30) return 'Fishing';
  if (n === 31 || n === 32 || n === 52) return 'Tug';
  if (n === 33) return 'Dredging';
  if (n === 34) return 'Diving';
  if (n === 35) return 'Military';
  if (n === 36) return 'Sailing';
  if (n === 37) return 'Pleasure craft';
  if (n >= 40 && n <= 49) return 'High-speed craft';
  if (n === 50) return 'Pilot';
  if (n === 51) return 'Search and rescue';
  if (n === 53) return 'Port tender';
  if (n === 55) return 'Law enforcement';
  if (n === 58) return 'Medical transport';
  if (n >= 60 && n <= 69) return 'Passenger';
  if (n >= 70 && n <= 79) return 'Cargo';
  if (n >= 80 && n <= 89) return 'Tanker';
  return 'Other';
}

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

/** Digitraffic GeoJSON + names → rows in the same shape as the AISStream cache. */
export function digitrafficRows(locations, names, nowMs = Date.now(), maxRows = Infinity) {
  const rows = [];
  for (const feature of locations?.features ?? []) {
    const p = feature?.properties ?? {};
    const [lon, lat] = feature?.geometry?.coordinates ?? [];
    const mmsi = finite(p.mmsi ?? feature?.mmsi);
    if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const at = finite(p.timestampExternal);
    if (at && nowMs - at > RECENT_MS) continue;
    const meta = names.get(mmsi) ?? {};
    // AIS "not available" sentinels: SOG 102.3, COG 360, heading 511.
    const sog = finite(p.sog);
    const cog = finite(p.cog);
    const heading = finite(p.heading);
    rows.push({
      lat,
      lon,
      name: String(meta.name ?? '').trim() || `MMSI ${mmsi}`,
      mmsi: String(mmsi),
      imo: meta.imo ? String(meta.imo) : '',
      type: shipTypeName(meta.shipType),
      destination: String(meta.destination ?? '').trim(),
      speed: sog !== null && sog >= 0 && sog < 102.2 ? sog : null,
      course: cog !== null && cog >= 0 && cog < 360 ? cog : null,
      heading: heading !== null && heading >= 0 && heading < 360 ? heading : null,
      last_position_UTC: new Date(at ?? nowMs).toISOString(),
      last_position_epoch: Math.floor((at ?? nowMs) / 1000),
    });
  }
  rows.sort((a, b) => b.last_position_epoch - a.last_position_epoch);
  return rows.slice(0, maxRows);
}

export function createDigitrafficFeed({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let positions = null;
  let positionsAt = 0;
  let names = new Map();
  let namesAt = 0;
  let pending = null;
  let lastError = null;

  async function getJson(url) {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'Digitraffic-User': USER },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`digitraffic HTTP ${response.status}`);
    return JSON.parse(await response.text());
  }

  async function refresh() {
    const tasks = [getJson(`${BASE}/locations?from=${now() - RECENT_MS}`)];
    const needNames = now() - namesAt > NAMES_TTL_MS;
    if (needNames) tasks.push(getJson(`${BASE}/vessels`).catch(() => null));
    const [loc, meta] = await Promise.all(tasks);
    positions = loc;
    positionsAt = now();
    if (Array.isArray(meta)) {
      names = new Map(meta.filter((m) => m?.mmsi).map((m) => [Number(m.mmsi), m]));
      namesAt = now();
    }
  }

  /** Rows plus feed metadata; serves the last good snapshot if a refresh fails. */
  async function snapshot(maxRows = Infinity) {
    if (!positions || now() - positionsAt > POSITIONS_TTL_MS) {
      pending ??= refresh()
        .then(() => {
          lastError = null;
        })
        .catch((error) => {
          lastError = error?.message ?? 'Digitraffic unavailable';
        })
        .finally(() => {
          pending = null;
        });
      await pending;
    }
    const rows = positions ? digitrafficRows(positions, names, now(), maxRows) : [];
    return { rows, error: positions ? null : lastError, fetchedAt: positionsAt || null };
  }

  return { snapshot };
}

let shared = null;
export function sharedDigitrafficFeed() {
  shared ??= createDigitrafficFeed();
  return shared;
}
