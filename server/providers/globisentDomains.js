/**
 * GLOBISENT domain data: GET /api/globisent/domain?id=<domain>&country=<ISO3>
 *
 * Aggregates keyless public sources so the browser only ever talks to this
 * server: World Bank indicators and country metadata, ECB reference rates
 * (Frankfurter), USGS earthquakes, GDACS alerts, CISA KEV and OpenAlex.
 * Every upstream answer is cached; a failing source is reported per section
 * and never breaks the rest of the popup.
 */
import { DOMAIN_BY_ID, DOMAIN_COUNTRY_CODES } from '../../src/globisent/domains.js';

const USER_AGENT = 'GLOBISENT-Domains/1.0 (+local workstation)';
const TIMEOUT_MS = 15000;
const MAX_BYTES = 8 * 1024 * 1024;
const TTL = Object.freeze({
  indicator: 12 * 60 * 60 * 1000,
  country: 24 * 60 * 60 * 1000,
  fx: 60 * 60 * 1000,
  usgs: 5 * 60 * 1000,
  gdacs: 10 * 60 * 1000,
  cisa: 60 * 60 * 1000,
  openalex: 60 * 60 * 1000,
});

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const fixed = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

/** Human formatting for an indicator value based on its unit. */
export function formatIndicator(value, name = '') {
  if (!Number.isFinite(value)) return 'n/a';
  if (/%|percent|per 100|per 1,000|rate/i.test(name) && Math.abs(value) < 1e5) return fixed.format(value);
  if (/US\$|current US/i.test(name)) return `$${compact.format(value)}`;
  return Math.abs(value) >= 1e4 ? compact.format(value) : fixed.format(value);
}

export function createGlobisentDomainMiddleware({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map();

  async function cached(key, ttl, load) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value;
    if (hit?.pending) return hit.pending;
    const pending = load().then(
      (value) => {
        cache.set(key, { at: now(), value });
        return value;
      },
      (error) => {
        // Serve the last good answer when an upstream briefly fails.
        if (hit?.value !== undefined) {
          cache.set(key, { ...hit, pending: null });
          return hit.value;
        }
        cache.delete(key);
        throw error;
      },
    );
    cache.set(key, { ...(hit ?? {}), pending });
    return pending;
  }

  async function getJson(url) {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error('response too large');
    return JSON.parse(text);
  }

  // ── World Bank ──────────────────────────────────────────────────────────
  async function indicator(country, code) {
    return cached(`wb:${country}:${code}`, TTL.indicator, async () => {
      const url = `https://api.worldbank.org/v2/country/${country}/indicator/${code}?format=json&mrnev=1&per_page=1`;
      const payload = await getJson(url);
      const row = Array.isArray(payload?.[1]) ? payload[1][0] : null;
      if (!row) return null;
      return {
        label: row.indicator?.value ?? code,
        value: formatIndicator(row.value, row.indicator?.value),
        detail: row.date ? `Latest: ${row.date}` : '',
        url: `https://data.worldbank.org/indicator/${code}?locations=${row.country?.id ?? ''}`,
      };
    });
  }

  async function countryMeta(country) {
    return cached(`wbc:${country}`, TTL.country, async () => {
      const payload = await getJson(`https://api.worldbank.org/v2/country/${country}?format=json`);
      const row = Array.isArray(payload?.[1]) ? payload[1][0] : null;
      if (!row) return [];
      return [
        { label: 'Country', value: row.name },
        { label: 'Capital', value: row.capitalCity || '—' },
        { label: 'Region', value: row.region?.value?.trim() || '—' },
        { label: 'Income group', value: row.incomeLevel?.value || '—' },
        { label: 'Coordinates', value: row.latitude && row.longitude ? `${Number(row.latitude).toFixed(2)}, ${Number(row.longitude).toFixed(2)}` : '—' },
      ];
    });
  }

  // ── Live feeds ──────────────────────────────────────────────────────────
  const FEEDS = {
    fx: () => cached('fx', TTL.fx, async () => {
      const data = await getJson('https://api.frankfurter.app/latest?from=USD&to=INR,EUR,GBP,JPY,CNY,AED,SGD,AUD,CAD,CHF');
      return {
        title: `Exchange rates · 1 USD (ECB reference, ${data.date})`,
        source: 'European Central Bank via Frankfurter',
        sourceUrl: 'https://www.frankfurter.app/',
        kind: 'stats',
        items: Object.entries(data.rates ?? {}).map(([currency, rate]) => ({ label: currency, value: fixed.format(rate) })),
      };
    }),
    usgs: () => cached('usgs', TTL.usgs, async () => {
      const data = await getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
      const quakes = (data.features ?? [])
        .map((f) => f.properties)
        .sort((a, b) => (b.mag ?? 0) - (a.mag ?? 0))
        .slice(0, 10);
      return {
        title: `Earthquakes · last 24 h (${data.features?.length ?? 0} of M2.5+)`,
        source: 'USGS Earthquake Hazards Program',
        sourceUrl: 'https://earthquake.usgs.gov/earthquakes/map/',
        kind: 'list',
        items: quakes.map((q) => ({
          label: `M${fixed.format(q.mag ?? 0)} · ${q.place ?? 'Unknown location'}`,
          time: q.time ? new Date(q.time).toISOString() : null,
          url: q.url,
          detail: q.tsunami ? 'Tsunami flag raised' : '',
        })),
      };
    }),
    gdacs: () => cached('gdacs', TTL.gdacs, async () => {
      const data = await getJson('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?alertlevel=Orange;Red&eventlist=EQ;TC;FL;VO;DR;WF');
      const TYPES = { EQ: 'Earthquake', TC: 'Tropical cyclone', FL: 'Flood', VO: 'Volcano', DR: 'Drought', WF: 'Wildfire' };
      const events = (data.features ?? [])
        .map((f) => f.properties)
        .sort((a, b) => String(b.fromdate).localeCompare(String(a.fromdate)))
        .slice(0, 12);
      return {
        title: 'Global disaster alerts · GDACS orange & red',
        source: 'GDACS (UN / European Commission)',
        sourceUrl: 'https://www.gdacs.org/',
        kind: 'list',
        items: events.map((e) => ({
          label: `${e.alertlevel?.toUpperCase() ?? ''} · ${TYPES[e.eventtype] ?? e.eventtype} · ${e.name ?? ''}`.trim(),
          detail: e.country ?? '',
          time: e.fromdate ? `${e.fromdate}Z` : null,
          url: e.url?.report ?? 'https://www.gdacs.org/',
        })),
      };
    }),
    cisa: () => cached('cisa', TTL.cisa, async () => {
      const data = await getJson('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json');
      const items = [...(data.vulnerabilities ?? [])]
        .sort((a, b) => String(b.dateAdded).localeCompare(String(a.dateAdded)))
        .slice(0, 10)
        .map((v) => ({
          label: `${v.cveID} · ${v.vendorProject} ${v.product}`,
          detail: v.vulnerabilityName,
          time: v.dateAdded ? `${v.dateAdded}T00:00:00Z` : null,
          url: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
        }));
      return {
        title: `Newly exploited vulnerabilities (catalogue v${data.catalogVersion ?? '?'})`,
        source: 'CISA Known Exploited Vulnerabilities',
        sourceUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
        kind: 'list',
        items,
      };
    }),
    openalex: () => cached('openalex', TTL.openalex, async () => {
      const today = new Date(now());
      const weekAgo = new Date(today.getTime() - 7 * 86400000);
      const day = (d) => d.toISOString().slice(0, 10);
      const data = await getJson(
        `https://api.openalex.org/works?filter=from_publication_date:${day(weekAgo)},to_publication_date:${day(today)},type:article&sort=cited_by_count:desc&per-page=10&select=id,display_name,publication_date,doi,primary_location,cited_by_count`,
      );
      return {
        title: 'Most-cited new research this week',
        source: 'OpenAlex',
        sourceUrl: 'https://openalex.org/',
        kind: 'list',
        items: (data.results ?? []).map((w) => ({
          label: w.display_name ?? 'Untitled',
          detail: [w.primary_location?.source?.display_name, w.cited_by_count ? `${w.cited_by_count} citations` : ''].filter(Boolean).join(' · '),
          time: w.publication_date ? `${w.publication_date}T00:00:00Z` : null,
          url: w.doi ?? w.id,
        })),
      };
    }),
  };

  async function settle(title, promise) {
    try {
      return await promise;
    } catch (error) {
      return { title, kind: 'error', error: error?.message ?? 'unavailable', items: [] };
    }
  }

  async function buildDomain(domain, country) {
    const sections = [];
    if (domain.profile) {
      sections.push(settle('Country profile', countryMeta(country).then((items) => ({
        title: 'Country profile', source: 'World Bank', sourceUrl: `https://data.worldbank.org/country/${country}`, kind: 'stats', items,
      }))));
    }
    if (domain.indicators.length) {
      sections.push(settle('Key indicators', Promise.all(domain.indicators.map((code) => indicator(country, code).catch(() => null)))
        .then((rows) => {
          const items = rows.filter(Boolean);
          if (!items.length) throw new Error('World Bank indicators unavailable');
          return { title: 'Key indicators', source: 'World Bank Open Data', sourceUrl: 'https://data.worldbank.org/', kind: 'stats', items };
        })));
    }
    for (const feed of domain.feeds) {
      if (FEEDS[feed]) sections.push(settle(feed, FEEDS[feed]()));
    }
    return Promise.all(sections);
  }

  async function globisentDomainMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const domain = DOMAIN_BY_ID.get(params.get('id') ?? '');
    const requested = String(params.get('country') ?? 'IND').toUpperCase();
    const country = DOMAIN_COUNTRY_CODES.has(requested) ? requested : 'IND';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (!domain) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Unknown domain' }));
      return;
    }
    const sections = await buildDomain(domain, country);
    res.statusCode = 200;
    res.end(JSON.stringify({ id: domain.id, country, generatedAt: new Date(now()).toISOString(), sections }));
  }
  /** In-process access for the AI agent; same caches as the HTTP route. */
  globisentDomainMiddleware.getDomain = async (id, requested = 'IND') => {
    const domain = DOMAIN_BY_ID.get(id);
    if (!domain) throw new Error(`Unknown domain: ${id}`);
    // In-process callers (globe clicks) may pass any ISO 3166 alpha-2/alpha-3
    // code the World Bank API accepts; the shape check keeps the URL safe.
    const code = String(requested).toUpperCase();
    const country = DOMAIN_COUNTRY_CODES.has(code) || /^[A-Z]{2,3}$/.test(code) ? code : 'IND';
    return { id: domain.id, name: domain.name, country, sections: await buildDomain(domain, country) };
  };
  return globisentDomainMiddleware;
}

let sharedDomains = null;
/** One domain service per server process, shared by the route and the agent. */
export function sharedGlobisentDomains() {
  sharedDomains ??= createGlobisentDomainMiddleware();
  return sharedDomains;
}

export function globisentDomainProxy() {
  const middleware = sharedGlobisentDomains();
  const install = (server) => {
    server.middlewares.use('/api/globisent/domain', middleware);
  };
  return {
    name: 'globisent-domain-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
