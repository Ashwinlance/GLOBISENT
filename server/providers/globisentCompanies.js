/**
 * GLOBISENT companies.
 *   GET /api/globisent/companies            catalog: every company with sector, ticker and HQ location
 *   GET /api/globisent/companies/search?q=  any company in the world (Wikipedia search + Wikidata check)
 *   GET /api/globisent/companies/listed     every stock-listed company with a mapped HQ (~11,000, compact rows)
 *   GET /api/globisent/company?id=Q312      everything about one company
 *
 * Keyless public sources: Wikipedia (titles → Wikidata ids, article summary
 * and image), the Wikidata Query Service (headquarters, leaders, founders,
 * industry, products, subsidiaries, reported financials, stock listing) and
 * Yahoo Finance for the live, exchange-delayed share price. Every answer is
 * cached; Wikidata asks for a descriptive User-Agent, which every request sends.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { COMPANY_CATALOG, COMPANY_SECTORS } from '../../src/globisent/companyCatalog.js';
import { parseSparkQuote } from './globisentMarkets.js';
import { defaultSourceRoot } from './common/source-root.js';

const USER_AGENT = 'GLOBISENT/1.0 (local workstation; company lookup)';
const TIMEOUT_MS = 30000;
const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CATALOG_RETRY_MS = 5 * 60 * 1000;
const DETAIL_TTL_MS = 24 * 60 * 60 * 1000;
const QUOTE_TTL_MS = 60 * 1000;
const SEARCH_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE = 600;
const SPARQL = 'https://query.wikidata.org/sparql';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const BUSINESS = 'Q4830453';

const QID = /^Q[1-9]\d{0,11}$/;
const MAX_RETRIES = 2;

/** The resolved directory is saved here (git-ignored) so dev-server restarts don't refetch it. */
export const COMPANY_CACHE_FILE = path.join(defaultSourceRoot, '.gev-cache', 'globisent', 'companies.json');
export const LISTED_CACHE_FILE = path.join(defaultSourceRoot, '.gev-cache', 'globisent', 'listed-companies.json');
const LISTED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Changes whenever the catalog does, so an edited catalog is rebuilt. */
const CATALOG_VERSION = (() => {
  let hash = 0;
  for (const ch of JSON.stringify(COMPANY_CATALOG)) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  return `1:${(hash >>> 0).toString(36)}`;
})();

/** Yahoo suffix for a Wikidata stock-exchange label (for companies outside the catalog). */
const EXCHANGE_SUFFIX = [
  [/New York Stock Exchange|Nasdaq|NYSE|OTC Markets/i, ''],
  [/KOSDAQ/i, '.KQ'],
  [/Tel Aviv/i, '.TA'],
  [/Indonesia Stock Exchange/i, '.JK'],
  [/São Paulo|Sao Paulo/i, '.SA'],
  [/Warsaw/i, '.WA'],
  [/Vienna/i, '.VI'],
  [/Bursa Malaysia/i, '.KL'],
  [/Stock Exchange of Thailand/i, '.BK'],
  [/Philippine Stock Exchange/i, '.PS'],
  [/Mexican Stock Exchange|Bolsa Mexicana/i, '.MX'],
  [/Istanbul/i, '.IS'],
  [/Athens/i, '.AT'],
  [/Euronext Dublin|Irish Stock Exchange/i, '.IR'],
  [/Euronext Lisbon/i, '.LS'],
  [/New Zealand|NZX/i, '.NZ'],
  [/Santiago/i, '.SN'],
  [/Buenos Aires/i, '.BA'],
  [/National Stock Exchange of India/i, '.NS'],
  [/Bombay Stock Exchange|BSE Limited/i, '.BO'],
  [/London Stock Exchange/i, '.L'],
  [/Tokyo Stock Exchange/i, '.T'],
  [/Hong Kong/i, '.HK'],
  [/Euronext Paris/i, '.PA'],
  [/Euronext Amsterdam/i, '.AS'],
  [/Euronext Brussels/i, '.BR'],
  [/Frankfurt|Xetra/i, '.DE'],
  [/SIX Swiss/i, '.SW'],
  [/Korea Exchange|KOSPI/i, '.KS'],
  [/Taiwan Stock Exchange/i, '.TW'],
  [/Australian Securities Exchange/i, '.AX'],
  [/Toronto Stock Exchange/i, '.TO'],
  [/Shanghai Stock Exchange/i, '.SS'],
  [/Shenzhen Stock Exchange/i, '.SZ'],
  [/B3|BM&F|Bovespa/i, '.SA'],
  [/Johannesburg/i, '.JO'],
  [/Saudi|Tadawul/i, '.SR'],
  [/Borsa Italiana|Milan/i, '.MI'],
  [/Bolsa de Madrid|Madrid Stock/i, '.MC'],
  [/Stockholm/i, '.ST'],
  [/Copenhagen/i, '.CO'],
  [/Oslo/i, '.OL'],
  [/Helsinki/i, '.HE'],
  [/Singapore Exchange/i, '.SI'],
];

export function yahooTicker(exchangeLabel, ticker) {
  if (!exchangeLabel || !ticker) return null;
  const clean = String(ticker).trim().toUpperCase().replace(/\s+/g, '-');
  if (!/^[A-Z0-9.&-]{1,15}$/.test(clean)) return null;
  for (const [pattern, suffix] of EXCHANGE_SUFFIX) {
    if (pattern.test(exchangeLabel)) return `${clean}${suffix}`;
  }
  return null;
}

const CURRENCY = {
  'United States dollar': 'US$', euro: '€', 'Indian rupee': '₹', 'Japanese yen': '¥', 'pound sterling': '£',
  renminbi: 'CN¥', 'South Korean won': '₩', 'Swiss franc': 'CHF ', 'Canadian dollar': 'C$', 'Australian dollar': 'A$',
  'Hong Kong dollar': 'HK$', 'New Taiwan dollar': 'NT$', 'Brazilian real': 'R$', 'Saudi riyal': 'SAR ',
  'Danish krone': 'DKK ', 'Swedish krona': 'SEK ', 'Norwegian krone': 'NOK ', 'Singapore dollar': 'S$',
};

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });

export function formatMoney(amount, unitLabel) {
  if (!Number.isFinite(amount)) return '—';
  const symbol = CURRENCY[unitLabel];
  if (symbol) return `${symbol}${compact.format(amount)}`;
  return unitLabel && unitLabel !== '1' ? `${compact.format(amount)} ${unitLabel}` : compact.format(amount);
}

/** Parse a WKT "Point(lon lat)" literal. */
export function parsePoint(wkt) {
  const match = /Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(String(wkt ?? ''));
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

const year = (iso) => (iso ? String(iso).slice(0, 4).replace(/^-?0+/, '') : '');
const qidOf = (uri) => /Q\d+$/.exec(String(uri ?? ''))?.[0] ?? null;
const val = (binding, name) => binding?.[name]?.value ?? null;

/** Latest statement per kind (by point-in-time date; undated ones lose). */
export function latestFacts(rows) {
  const best = new Map();
  for (const row of rows) {
    const kind = val(row, 'kind');
    const amount = Number(val(row, 'amount'));
    if (!kind || !Number.isFinite(amount)) continue;
    const date = val(row, 'date') ?? '';
    const previous = best.get(kind);
    if (!previous || date > previous.date || (date === previous.date && Math.abs(amount) > Math.abs(previous.amount))) {
      best.set(kind, { amount, unit: val(row, 'unitLabel'), date });
    }
  }
  return best;
}

export function createGlobisentCompaniesMiddleware({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  cacheFile = null,
  listedFile = null,
} = {}) {
  const cache = new Map();
  let listed = null;
  let listedAt = 0;
  let listedPending = null;
  let listedDiskChecked = false;
  let catalog = null;
  let catalogAt = 0;
  let catalogFailedAt = 0;
  let catalogPending = null;
  let diskChecked = false;

  function remember(key, value) {
    cache.set(key, { at: now(), value });
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return value;
  }
  function recall(key, ttl) {
    const hit = cache.get(key);
    return hit && now() - hit.at < ttl ? hit.value : undefined;
  }

  async function request(url, init = {}) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(url, {
        ...init,
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // Wikipedia and Wikidata ask clients to slow down with 429; honour Retry-After (capped).
      if ((response.status === 429 || response.status === 503) && attempt < MAX_RETRIES) {
        const header = Number(response.headers?.get?.('retry-after'));
        await sleep(Math.min(Number.isFinite(header) && header > 0 ? header * 1000 : 2000 * 2 ** attempt, 15000));
        continue;
      }
      if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
      return JSON.parse(await response.text());
    }
  }

  async function readDiskCatalog() {
    if (!cacheFile) return null;
    try {
      const saved = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
      return saved?.version === CATALOG_VERSION && Array.isArray(saved.catalog?.companies) ? saved : null;
    } catch {
      return null;
    }
  }

  async function writeDiskCatalog(value) {
    if (!cacheFile) return;
    try {
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      const temp = `${cacheFile}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify({ version: CATALOG_VERSION, savedAt: now(), catalog: value }));
      await fs.rename(temp, cacheFile);
    } catch { /* the in-memory copy still works */ }
  }

  async function sparql(query) {
    const data = await request(SPARQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: new URLSearchParams({ query }).toString(),
    });
    return data?.results?.bindings ?? [];
  }

  /** Wikipedia titles → { title: { qid, description } } (follows redirects). */
  async function titlesToQids(titles) {
    const out = new Map();
    for (let i = 0; i < titles.length; i += 50) {
      const batch = titles.slice(i, i + 50);
      const params = new URLSearchParams({
        action: 'query', prop: 'pageprops|description', ppprop: 'wikibase_item|disambiguation',
        redirects: '1', format: 'json', formatversion: '2', titles: batch.join('|'),
      });
      const data = await request(`${WIKI_API}?${params}`);
      const hops = new Map([...(data?.query?.normalized ?? []), ...(data?.query?.redirects ?? [])].map((n) => [n.from, n.to]));
      const pages = new Map((data?.query?.pages ?? []).map((p) => [p.title, p]));
      for (const title of batch) {
        let resolved = title;
        for (let k = 0; k < 3 && hops.has(resolved); k++) resolved = hops.get(resolved);
        const page = pages.get(resolved);
        const qid = page?.pageprops?.wikibase_item;
        if (qid && page.pageprops.disambiguation === undefined) out.set(title, { qid, description: page.description ?? '', title: resolved });
      }
    }
    return out;
  }

  /** HQ (or the company's own / its country's) coordinates for many companies at once. */
  async function locate(qids) {
    const rows = await sparql(`SELECT ?item ?itemLabel ?hqLabel ?hqCoord ?itemCoord ?countryLabel ?iso3 ?countryCoord WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(' ')} }
  OPTIONAL { ?item wdt:P159 ?hq . OPTIONAL { ?hq wdt:P625 ?hqCoord } }
  OPTIONAL { ?item wdt:P625 ?itemCoord }
  OPTIONAL { ?item wdt:P17 ?country . OPTIONAL { ?country wdt:P298 ?iso3 } OPTIONAL { ?country wdt:P625 ?countryCoord } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`);
    const best = new Map();
    const score = (r) => (r.hqCoord ? 4 : r.itemCoord ? 2 : 0) + (r.iso3 ? 1 : 0);
    for (const row of rows) {
      const qid = qidOf(val(row, 'item'));
      if (!qid) continue;
      const candidate = {
        name: val(row, 'itemLabel'),
        hq: val(row, 'hqLabel'),
        hqCoord: parsePoint(val(row, 'hqCoord')),
        itemCoord: parsePoint(val(row, 'itemCoord')),
        country: val(row, 'countryLabel'),
        iso3: val(row, 'iso3'),
        countryCoord: parsePoint(val(row, 'countryCoord')),
      };
      const previous = best.get(qid);
      if (!previous || score(candidate) > score(previous)) best.set(qid, candidate);
    }
    return best;
  }

  async function buildCatalog() {
    const titles = [...new Set(COMPANY_CATALOG.map((c) => c.title))];
    const resolved = await titlesToQids(titles);
    const qids = [...new Set([...resolved.values()].map((r) => r.qid))];
    const places = await locate(qids);
    const byQid = new Map();
    for (const entry of COMPANY_CATALOG) {
      const ref = resolved.get(entry.title);
      if (!ref) continue;
      const existing = byQid.get(ref.qid);
      if (existing) {
        if (!existing.sectors.includes(entry.sector)) existing.sectors.push(entry.sector);
        continue;
      }
      const place = places.get(ref.qid) ?? {};
      const point = place.hqCoord ?? place.itemCoord ?? place.countryCoord ?? null;
      byQid.set(ref.qid, {
        id: ref.qid,
        name: place.name && !QID.test(place.name) ? place.name : ref.title.replace(/\s*\(.*\)$/, ''),
        title: ref.title,
        description: ref.description,
        sectors: [entry.sector],
        ticker: entry.ticker,
        hq: place.hq ?? null,
        country: place.country ?? null,
        iso3: place.iso3 ?? null,
        lat: point?.lat ?? null,
        lon: point?.lon ?? null,
        approximate: !place.hqCoord && !place.itemCoord,
      });
    }
    return { generatedAt: new Date(now()).toISOString(), sectors: COMPANY_SECTORS, companies: [...byQid.values()] };
  }

  async function getCatalog() {
    if (!catalog && !diskChecked) {
      diskChecked = true;
      const saved = await readDiskCatalog();
      if (saved && !catalog) {
        catalog = saved.catalog;
        catalogAt = Number(saved.savedAt) || 0;
      }
    }
    if (catalog && now() - catalogAt < CATALOG_TTL_MS) return catalog;
    if (!catalog && catalogFailedAt && now() - catalogFailedAt < 15000 && !catalogPending) {
      throw new Error('company directory temporarily unavailable');
    }
    if (!catalogPending) {
      catalogPending = buildCatalog()
        .then((value) => {
          catalog = value;
          catalogAt = now();
          writeDiskCatalog(value);
          return value;
        })
        .catch((error) => {
          catalogFailedAt = now();
          if (catalog) catalogAt = now() - CATALOG_TTL_MS + CATALOG_RETRY_MS;
          throw error;
        })
        .finally(() => {
          catalogPending = null;
        });
    }
    try {
      return await catalogPending;
    } catch (error) {
      if (catalog) return catalog;
      throw error;
    }
  }

  /**
   * Every stock-listed company in Wikidata whose headquarters has coordinates
   * (~11,000). Fetched as 10 slices (by the id's last digit) so no single
   * query nears the 60 s Wikidata limit; saved to disk for 30 days.
   */
  async function buildListed() {
    const byId = new Map();
    for (let digit = 0; digit <= 9; digit++) {
      const rows = await sparql(`SELECT ?item ?label ?coord ?iso3 ?exLabel ?ticker WHERE {
  ?item p:P414 ?st . ?st ps:P414 ?ex .
  FILTER(STRENDS(STR(?item), "${digit}"))
  ?item wdt:P159 ?hq . ?hq wdt:P625 ?coord .
  OPTIONAL { ?st pq:P249 ?ticker }
  OPTIONAL { ?item rdfs:label ?label FILTER(lang(?label) = "en") }
  OPTIONAL { ?ex rdfs:label ?exLabel FILTER(lang(?exLabel) = "en") }
  OPTIONAL { ?item wdt:P17 ?country . ?country wdt:P298 ?iso3 }
}`);
      for (const row of rows) {
        const id = qidOf(val(row, 'item'));
        const point = parsePoint(val(row, 'coord'));
        const name = val(row, 'label');
        if (!id || !point || !name) continue;
        const existing = byId.get(id);
        const ticker = val(row, 'ticker');
        if (existing) {
          if (!existing[5] && val(row, 'exLabel')) existing[5] = val(row, 'exLabel');
          if (!existing[6] && ticker) existing[6] = ticker;
          if (!existing[4] && val(row, 'iso3')) existing[4] = val(row, 'iso3');
          continue;
        }
        byId.set(id, [id, name, Math.round(point.lat * 1e4) / 1e4, Math.round(point.lon * 1e4) / 1e4, val(row, 'iso3'), val(row, 'exLabel'), ticker]);
      }
    }
    const rows = [...byId.values()].sort((a, b) => a[1].localeCompare(b[1]));
    if (rows.length < 1000) throw new Error(`only ${rows.length} listed companies returned`);
    return {
      generatedAt: new Date(now()).toISOString(),
      count: rows.length,
      fields: ['id', 'name', 'lat', 'lon', 'iso3', 'exchange', 'ticker'],
      rows,
    };
  }

  async function getListed() {
    if (listed && now() - listedAt < LISTED_TTL_MS) return listed;
    if (!listed && !listedDiskChecked && listedFile) {
      listedDiskChecked = true;
      try {
        const saved = JSON.parse(await fs.readFile(listedFile, 'utf8'));
        if (Array.isArray(saved?.listed?.rows)) {
          listed = saved.listed;
          listedAt = Number(saved.savedAt) || 0;
          if (now() - listedAt < LISTED_TTL_MS) return listed;
        }
      } catch { /* no saved copy yet */ }
    }
    if (!listedPending) {
      listedPending = buildListed()
        .then(async (value) => {
          listed = value;
          listedAt = now();
          if (listedFile) {
            try {
              await fs.mkdir(path.dirname(listedFile), { recursive: true });
              const temp = `${listedFile}.${process.pid}.tmp`;
              await fs.writeFile(temp, JSON.stringify({ savedAt: listedAt, listed: value }));
              await fs.rename(temp, listedFile);
            } catch { /* memory copy still works */ }
          }
          return value;
        })
        .finally(() => {
          listedPending = null;
        });
    }
    try {
      return await listedPending;
    } catch (error) {
      if (listed) return listed;
      throw error;
    }
  }

  async function quote(symbol) {
    if (!symbol) return null;
    const key = `quote:${symbol}`;
    const hit = recall(key, QUOTE_TTL_MS);
    if (hit !== undefined) return hit;
    try {
      const data = await request(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbol)}&range=1d&interval=1d`);
      return remember(key, parseSparkQuote(data?.spark?.result?.[0], now()));
    } catch {
      return null;
    }
  }

  async function facts(qid) {
    const [relations, numbers, literals] = await Promise.all([
      sparql(`SELECT ?kind ?value ?valueLabel ?coord WHERE {
  VALUES (?kind ?p) { ("hq" wdt:P159) ("country" wdt:P17) ("ceo" wdt:P169) ("chair" wdt:P488) ("parent" wdt:P749)
    ("owner" wdt:P127) ("legal" wdt:P1454) ("industry" wdt:P452) ("founder" wdt:P112) ("product" wdt:P1056)
    ("subsidiary" wdt:P355) ("brand" wdt:P1716) }
  wd:${qid} ?p ?value .
  OPTIONAL { ?value wdt:P625 ?coord }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`),
      sparql(`SELECT ?kind ?amount ?unitLabel ?date WHERE {
  VALUES (?kind ?p ?psv) { ("employees" p:P1128 psv:P1128) ("revenue" p:P2139 psv:P2139) ("operatingIncome" p:P3362 psv:P3362)
    ("netIncome" p:P2295 psv:P2295) ("assets" p:P2403 psv:P2403) ("equity" p:P2137 psv:P2137) ("marketCap" p:P2226 psv:P2226) }
  wd:${qid} ?p ?s . ?s ?psv ?v . ?v wikibase:quantityAmount ?amount .
  OPTIONAL { ?v wikibase:quantityUnit ?unit }
  OPTIONAL { ?s pq:P585 ?date }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`),
      sparql(`SELECT ?label ?desc ?article ?inception ?website ?logo ?exLabel ?ticker ?isin WHERE {
  BIND(wd:${qid} AS ?item)
  OPTIONAL { ?item rdfs:label ?label FILTER(lang(?label) = "en") }
  OPTIONAL { ?item schema:description ?desc FILTER(lang(?desc) = "en") }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item wdt:P856 ?website }
  OPTIONAL { ?item wdt:P154 ?logo }
  OPTIONAL { ?item wdt:P946 ?isin }
  OPTIONAL { ?item p:P414 ?listing . ?listing ps:P414 ?ex . ?ex rdfs:label ?exLabel FILTER(lang(?exLabel) = "en")
             OPTIONAL { ?listing pq:P249 ?ticker } }
}`),
    ]);
    return { relations, numbers, literals };
  }

  async function wikipediaSummary(articleUrl) {
    const title = articleUrl ? decodeURIComponent(articleUrl.split('/wiki/')[1] ?? '') : '';
    if (!title) return null;
    try {
      const data = await request(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      return {
        extract: data?.extract ?? null,
        image: data?.thumbnail?.source ?? data?.originalimage?.source ?? null,
        url: data?.content_urls?.desktop?.page ?? articleUrl,
      };
    } catch {
      return { extract: null, image: null, url: articleUrl };
    }
  }

  async function getCompany(qid) {
    if (!QID.test(qid)) throw Object.assign(new Error('id must be a Wikidata id such as Q312'), { status: 400 });
    let base = recall(`company:${qid}`, DETAIL_TTL_MS);
    if (base === undefined) {
      const { relations, numbers, literals } = await facts(qid);
      const list = (kind) => [...new Map(relations.filter((r) => val(r, 'kind') === kind)
        .map((r) => [val(r, 'value'), { label: val(r, 'valueLabel'), coord: parsePoint(val(r, 'coord')) }])).values()]
        .filter((x) => x.label && !QID.test(x.label));
      const pick = (name) => [...new Set(literals.map((r) => val(r, name)).filter(Boolean))];
      const listings = [...new Map(literals.filter((r) => val(r, 'exLabel'))
        .map((r) => [`${val(r, 'exLabel')}|${val(r, 'ticker') ?? ''}`, { exchange: val(r, 'exLabel'), ticker: val(r, 'ticker') }])).values()];
      const article = pick('article')[0] ?? null;
      const summary = await wikipediaSummary(article);
      const logoFile = pick('logo')[0];
      base = remember(`company:${qid}`, {
        id: qid,
        name: pick('label')[0] ?? qid,
        description: pick('desc')[0] ?? null,
        inception: pick('inception').sort()[0] ?? null,
        websites: pick('website').slice(0, 2),
        logo: logoFile ? `${logoFile.replace(/^http:/, 'https:')}?width=160` : null,
        isin: pick('isin')[0] ?? null,
        listings,
        hq: list('hq'),
        country: list('country'),
        ceo: list('ceo'),
        chair: list('chair'),
        parent: list('parent'),
        owner: list('owner'),
        legal: list('legal'),
        industry: list('industry'),
        founders: list('founder'),
        products: list('product'),
        subsidiaries: list('subsidiary'),
        brands: list('brand'),
        financials: Object.fromEntries(latestFacts(numbers)),
        wikipedia: summary,
      });
    }
    const directory = await getCatalog().catch(() => null);
    const listed = directory?.companies.find((c) => c.id === qid) ?? null;
    const symbol = listed?.ticker ?? base.listings.map((l) => yahooTicker(l.exchange, l.ticker)).find(Boolean) ?? null;
    const stock = await quote(symbol);
    return shape(base, listed, symbol, stock);
  }

  function shape(base, listed, symbol, stock) {
    const names = (items, n = 4) => items.slice(0, n).map((x) => x.label).join(', ');
    const hqPoint = base.hq.find((h) => h.coord)?.coord ?? (listed && Number.isFinite(listed.lat) ? { lat: listed.lat, lon: listed.lon } : null);
    const f = base.financials;
    const facts = [
      { label: 'Industry', value: names(base.industry, 3) },
      { label: 'Founded', value: year(base.inception) },
      { label: 'Founders', value: names(base.founders, 5) },
      { label: 'Headquarters', value: names(base.hq, 2) },
      { label: 'Country', value: names(base.country, 2) },
      { label: 'CEO', value: names(base.ceo, 2) },
      { label: 'Chairperson', value: names(base.chair, 2) },
      { label: 'Parent company', value: names(base.parent, 2) },
      { label: 'Owned by', value: names(base.owner, 3) },
      { label: 'Legal form', value: names(base.legal, 1) },
      { label: 'Employees', value: f.employees ? compact.format(f.employees.amount) : '', detail: f.employees?.date ? `as of ${year(f.employees.date)}` : '' },
      { label: 'Stock listing', value: base.listings.map((l) => `${l.exchange}${l.ticker ? ` · ${l.ticker}` : ''}`).slice(0, 3).join('; ') },
      { label: 'ISIN', value: base.isin ?? '' },
      ...base.websites.map((w) => ({ label: 'Website', value: w.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), url: w })),
    ].filter((item) => item.value);
    const money = [
      ['revenue', 'Revenue'], ['operatingIncome', 'Operating income'], ['netIncome', 'Net income'],
      ['assets', 'Total assets'], ['equity', 'Equity'], ['marketCap', 'Market value'],
    ].filter(([key]) => f[key]).map(([key, label]) => ({
      label,
      value: formatMoney(f[key].amount, f[key].unit),
      detail: f[key].date ? `reported ${year(f[key].date)}` : '',
    }));
    const sections = [];
    if (base.wikipedia?.extract) {
      sections.push({ title: 'About', source: 'Wikipedia', sourceUrl: base.wikipedia.url, kind: 'text', text: base.wikipedia.extract });
    }
    sections.push({ title: 'Key facts', source: 'Wikidata', sourceUrl: `https://www.wikidata.org/wiki/${base.id}`, kind: 'stats', items: facts });
    if (stock) {
      sections.push({
        title: `Share price · ${stock.symbol}`,
        source: 'Yahoo Finance',
        sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(stock.symbol)}`,
        kind: 'quote',
        quote: stock,
      });
    } else if (listed && !listed.ticker) {
      sections.push({ title: 'Share price', kind: 'text', text: 'No public share listing found for this company.' });
    }
    if (money.length) {
      sections.push({ title: 'Financials · latest reported', source: 'Wikidata', sourceUrl: `https://www.wikidata.org/wiki/${base.id}`, kind: 'stats', items: money });
    }
    if (base.products.length || base.brands.length) {
      sections.push({ title: 'Products & brands', kind: 'tags', items: [...base.products, ...base.brands].slice(0, 24).map((x) => ({ label: x.label })) });
    }
    if (base.subsidiaries.length) {
      sections.push({ title: `Subsidiaries${base.subsidiaries.length > 24 ? ` · ${base.subsidiaries.length} known` : ''}`, kind: 'tags', items: base.subsidiaries.slice(0, 24).map((x) => ({ label: x.label })) });
    }
    return {
      id: base.id,
      name: base.name,
      description: base.description,
      image: base.wikipedia?.image ?? null,
      logo: base.logo,
      wikipedia: base.wikipedia?.url ?? null,
      website: base.websites[0] ?? null,
      sectors: listed?.sectors ?? [],
      ticker: symbol,
      location: hqPoint,
      sections,
    };
  }

  async function search(raw) {
    const q = String(raw ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
    if (q.length < 2) return { query: q, results: [] };
    const key = `search:${q.toLowerCase()}`;
    const hit = recall(key, SEARCH_TTL_MS);
    if (hit !== undefined) return hit;
    const directory = await getCatalog().catch(() => null);
    const needle = q.toLowerCase();
    const local = (directory?.companies ?? []).filter((c) => c.name.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle));
    const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: q, srlimit: '12', srnamespace: '0', format: 'json', formatversion: '2' });
    let remote = [];
    try {
      const data = await request(`${WIKI_API}?${params}`);
      const titles = (data?.query?.search ?? []).map((s) => s.title);
      const resolved = titles.length ? await titlesToQids(titles) : new Map();
      const qids = [...new Set([...resolved.values()].map((r) => r.qid))].filter((id) => !local.some((c) => c.id === id));
      if (qids.length) {
        const rows = await sparql(`SELECT DISTINCT ?item ?itemLabel ?itemDescription ?countryLabel WHERE {
  VALUES ?item { ${qids.map((id) => `wd:${id}`).join(' ')} }
  ?item wdt:P31/wdt:P279* wd:${BUSINESS} .
  OPTIONAL { ?item wdt:P17 ?country }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`);
        const seen = new Map();
        for (const row of rows) {
          const id = qidOf(val(row, 'item'));
          if (id && !seen.has(id)) seen.set(id, { id, name: val(row, 'itemLabel'), description: val(row, 'itemDescription'), country: val(row, 'countryLabel') });
        }
        remote = qids.map((id) => seen.get(id)).filter(Boolean);
      }
    } catch { /* local matches still answer */ }
    const results = [
      ...local.slice(0, 10).map((c) => ({ id: c.id, name: c.name, description: c.description, country: c.country, sectors: c.sectors })),
      ...remote,
    ].slice(0, 15);
    return remember(key, { query: q, results });
  }

  function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  }

  async function companiesMiddleware(req, res, next) {
    if (req.method !== 'GET') return next();
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/' || url.pathname === '') return send(res, 200, await getCatalog());
      if (url.pathname === '/search') return send(res, 200, await search(url.searchParams.get('q')));
      if (url.pathname === '/listed') return send(res, 200, await getListed());
      return next();
    } catch (error) {
      return send(res, error?.status ?? 502, { error: `Company data unavailable: ${error?.message ?? 'upstream error'}` });
    }
  }

  async function companyMiddleware(req, res, next) {
    if (req.method !== 'GET') return next();
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      return send(res, 200, await getCompany(String(url.searchParams.get('id') ?? '')));
    } catch (error) {
      return send(res, error?.status ?? 502, { error: error?.status === 400 ? error.message : `Company data unavailable: ${error?.message ?? 'upstream error'}` });
    }
  }

  return { companiesMiddleware, companyMiddleware, getCatalog, getCompany, getListed, search };
}

export function globisentCompaniesProxy() {
  const service = createGlobisentCompaniesMiddleware({ cacheFile: COMPANY_CACHE_FILE, listedFile: LISTED_CACHE_FILE });
  const install = (server) => {
    // Warm the directory in the background so the first COMPANIES view is quick.
    setTimeout(() => service.getCatalog().catch(() => {}), 3000).unref?.();
    server.middlewares.use('/api/globisent/companies', service.companiesMiddleware);
    server.middlewares.use('/api/globisent/company', service.companyMiddleware);
  };
  return {
    name: 'globisent-companies-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
