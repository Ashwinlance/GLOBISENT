/**
 * GLOBISENT cinematic tour: GET /api/globisent/tour
 *
 * Builds the stops for presentation mode from what is happening right now:
 * the biggest earthquake of the last 24 h (USGS), the newest red/orange
 * disaster alert (GDACS), the biggest stock-market move (markets service),
 * a major company headquartered in that market's country, and the top world
 * headline. Every source is optional: a stop is skipped when its source fails.
 */
import { sharedGlobisentMarkets } from './globisentMarkets.js';
import { sharedGlobisentCompanies } from './globisentCompanies.js';
import { sharedGlobisentNews } from './globisentNews.js';
import { SECTOR_BY_ID } from '../../src/globisent/companyCatalog.js';

const USER_AGENT = 'GLOBISENT/1.0 (local workstation; presentation tour)';
const TIMEOUT_MS = 15000;
const TOUR_TTL_MS = 5 * 60 * 1000;
const GDACS_TYPES = { EQ: 'Earthquake', TC: 'Tropical cyclone', FL: 'Flood', VO: 'Volcano', DR: 'Drought', WF: 'Wildfire' };

const pct = (value) => `${value > 0 ? '▲' : value < 0 ? '▼' : '■'} ${Math.abs(value).toFixed(2)}%`;

/** Biggest quake from a USGS GeoJSON feed. */
export function quakeStop(feed) {
  const best = (feed?.features ?? [])
    .filter((f) => Number.isFinite(f?.properties?.mag) && Array.isArray(f?.geometry?.coordinates))
    .sort((a, b) => b.properties.mag - a.properties.mag)[0];
  if (!best) return null;
  const [lon, lat, depth] = best.geometry.coordinates;
  return {
    id: 'quake',
    eyebrow: 'BIGGEST EARTHQUAKE · LAST 24 H',
    title: `M${best.properties.mag.toFixed(1)} earthquake`,
    subtitle: best.properties.place ?? 'Location unknown',
    detail: `${Number.isFinite(depth) ? `${Math.round(depth)} km deep · ` : ''}${best.properties.time ? new Date(best.properties.time).toUTCString().slice(5, 22) : ''} UTC`,
    source: 'USGS',
    lat,
    lon,
    height: 900000,
  };
}

/** Newest red (else orange) GDACS alert with a location. */
export function disasterStop(feed) {
  const events = (feed?.features ?? [])
    .filter((f) => Array.isArray(f?.geometry?.coordinates) && f.geometry.type === 'Point')
    .map((f) => ({ ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
  const rank = (e) => (String(e.alertlevel).toLowerCase() === 'red' ? 1 : 0);
  const best = events.sort((a, b) => rank(b) - rank(a) || String(b.fromdate).localeCompare(String(a.fromdate)))[0];
  if (!best) return null;
  return {
    id: 'disaster',
    eyebrow: `${String(best.alertlevel ?? '').toUpperCase()} ALERT · ${GDACS_TYPES[best.eventtype] ?? best.eventtype ?? 'DISASTER'}`.toUpperCase(),
    title: best.name || `${GDACS_TYPES[best.eventtype] ?? 'Disaster'} alert`,
    subtitle: best.country || 'Affected area',
    detail: best.fromdate ? `Since ${String(best.fromdate).slice(0, 10)}` : '',
    source: 'GDACS (UN / European Commission)',
    lat: best.lat,
    lon: best.lon,
    height: 1500000,
  };
}

/** The exchange whose main index moved most today. */
export function marketStop(markets) {
  const best = (markets?.exchanges ?? [])
    .filter((e) => Number.isFinite(e.index?.changePct))
    .sort((a, b) => Math.abs(b.index.changePct) - Math.abs(a.index.changePct))[0];
  if (!best) return null;
  const open = (markets.exchanges ?? []).filter((e) => e.open === true).length;
  return {
    id: 'market',
    eyebrow: 'BIGGEST MARKET MOVE TODAY',
    title: `${best.index.label} ${pct(best.index.changePct)}`,
    subtitle: `${best.name} · ${best.city}`,
    detail: `${best.open ? 'Open now' : 'Closed'} · ${open} of ${markets.exchanges.length} exchanges open worldwide`,
    source: 'Yahoo Finance (delayed)',
    lat: best.lat,
    lon: best.lon,
    height: 60000,
    country: best.country,
    trend: best.index.changePct >= 0 ? 'up' : 'down',
  };
}

/** A major company headquartered in `country`, chosen by `seed` so it changes daily. */
export function companyStop(catalog, country, seed = 0) {
  const pool = (catalog?.companies ?? []).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon) && !c.approximate);
  const local = pool.filter((c) => c.country === country);
  const choices = local.length ? local : pool;
  if (!choices.length) return null;
  const company = choices[Math.abs(seed) % choices.length];
  return {
    id: 'company',
    eyebrow: `MAJOR COMPANY · ${(SECTOR_BY_ID.get(company.sectors?.[0])?.name ?? 'Business').toUpperCase()}`,
    title: company.name,
    subtitle: [company.hq, company.country].filter(Boolean).join(', '),
    detail: company.description ?? '',
    source: 'Wikidata · Wikipedia',
    lat: company.lat,
    lon: company.lon,
    height: 4000,
    companyId: company.id,
  };
}

export function headlineStop(news) {
  const article = (news?.articles ?? [])[0];
  if (!article?.title) return null;
  return {
    id: 'headline',
    eyebrow: 'TOP WORLD HEADLINE',
    title: article.title,
    subtitle: article.source ?? '',
    detail: '',
    source: news.provider === 'gdelt' ? 'GDELT' : 'Google News',
    url: article.url,
  };
}

export function createGlobisentTourMiddleware({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  markets = sharedGlobisentMarkets(),
  companies = sharedGlobisentCompanies(),
  news = sharedGlobisentNews(),
} = {}) {
  let cache = null;
  let pending = null;

  async function getJson(url) {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return JSON.parse(await response.text());
  }

  const settle = (promise) => promise.then((value) => value, () => null);

  async function build() {
    const [usgs, gdacs, marketData, catalog, headlines] = await Promise.all([
      settle(getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson')),
      settle(getJson('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?alertlevel=Orange;Red&eventlist=EQ;TC;FL;VO;DR;WF')),
      settle(markets.getMarkets()),
      settle(companies.getCatalog()),
      settle(news.getNews({ category: 'world', region: 'global', search: '' })),
    ]);
    const market = marketStop(marketData);
    const day = Math.floor(now() / 86400000);
    const stops = [
      quakeStop(usgs),
      disasterStop(gdacs),
      market,
      companyStop(catalog, market?.country ?? null, day),
      headlineStop(headlines),
    ].filter(Boolean);
    const quakes = (usgs?.features ?? []).length;
    const alerts = (gdacs?.features ?? []).length;
    const open = (marketData?.exchanges ?? []).filter((e) => e.open === true).length;
    const intro = {
      id: 'intro',
      eyebrow: 'GLOBISENT · LIVE WORLD',
      title: 'One Earth. Every Signal.',
      subtitle: [
        quakes ? `${quakes} earthquakes in 24 h` : null,
        alerts ? `${alerts} disaster alerts` : null,
        marketData ? `${open} stock markets open` : null,
        catalog ? `${(catalog.companies?.length ?? 0).toLocaleString('en')} major companies tracked` : null,
      ].filter(Boolean).join(' · '),
      detail: 'Live public data · flights, ships, disasters, markets, companies and news',
      source: 'GLOBISENT',
    };
    const outro = {
      id: 'outro',
      eyebrow: 'GLOBISENT',
      title: 'Global Intelligence Command Center',
      subtitle: 'Built on the open-source GOD’S EYE VIEW engine · CesiumJS',
      detail: 'Open the GLOBISENT hub to explore every signal',
      source: 'GLOBISENT',
    };
    return { generatedAt: new Date(now()).toISOString(), stops: [intro, ...stops, outro] };
  }

  async function getTour() {
    if (cache && now() - cache.at < TOUR_TTL_MS) return cache.value;
    pending ??= build()
      .then((value) => {
        cache = { at: now(), value };
        return value;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  async function middleware(req, res, next) {
    if (req.method !== 'GET') return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.statusCode = 200;
      res.end(JSON.stringify(await getTour()));
    } catch (error) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: `Tour unavailable: ${error?.message ?? 'upstream error'}` }));
    }
  }
  middleware.getTour = getTour;
  return middleware;
}

export function globisentTourProxy() {
  let middleware = null;
  const install = (server) => {
    middleware ??= createGlobisentTourMiddleware();
    server.middlewares.use('/api/globisent/tour', middleware);
  };
  return {
    name: 'globisent-tour',
    configureServer: install,
    configurePreviewServer: install,
  };
}
