import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGlobisentCompaniesMiddleware,
  yahooTicker,
  formatMoney,
  latestFacts,
  parsePoint,
} from './globisentCompanies.js';
import { COMPANY_CATALOG, COMPANY_SECTORS, DOMAIN_COMPANY_SECTORS } from '../../src/globisent/companyCatalog.js';

const NOW = Date.parse('2026-11-05T16:00:00Z');
const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const lit = (value) => ({ type: 'literal', value: String(value) });
const uri = (id) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${id}` });

/** Every catalog title maps to Q<n> by its position; Apple is Q312. */
function qidFor(title) {
  if (title === 'Apple Inc.') return 'Q312';
  const index = [...new Set(COMPANY_CATALOG.map((c) => c.title))].indexOf(title);
  return index >= 0 ? `Q${900000 + index}` : null;
}

function fakeFetch() {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push(url);
    if (url.startsWith('https://en.wikipedia.org/w/api.php')) {
      const params = new URL(url).searchParams;
      if (params.get('list') === 'search') {
        return ok({ query: { search: [{ title: 'Zomato' }, { title: 'Delhi' }] } });
      }
      const titles = params.get('titles').split('|');
      return ok({
        query: {
          pages: titles.map((title) => {
            if (title === 'Zomato') return { title, pageprops: { wikibase_item: 'Q8073715' } };
            if (title === 'Delhi') return { title, pageprops: { wikibase_item: 'Q1353' } };
            return { title, pageprops: { wikibase_item: qidFor(title) }, description: 'company' };
          }),
        },
      });
    }
    if (url.startsWith('https://en.wikipedia.org/api/rest_v1/page/summary/')) {
      return ok({ extract: 'Apple Inc. is an American technology company.', thumbnail: { source: 'https://upload.wikimedia.org/apple.png' }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Apple_Inc.' } } });
    }
    if (url.startsWith('https://query.wikidata.org/sparql')) {
      const query = new URLSearchParams(init.body).get('query');
      if (query.includes('?hqCoord')) {
        return ok({ results: { bindings: [
          { item: uri('Q312'), itemLabel: lit('Apple Inc.'), hqLabel: lit('Cupertino'), hqCoord: lit('Point(-122.04 37.32)'), countryLabel: lit('United States'), iso3: lit('USA') },
          { item: uri('Q312'), itemLabel: lit('Apple Inc.'), countryLabel: lit('United States') },
        ] } });
      }
      if (query.includes('wikibase:quantityAmount')) {
        return ok({ results: { bindings: [
          { kind: lit('revenue'), amount: lit(383285000000), unitLabel: lit('United States dollar'), date: lit('2023-01-01T00:00:00Z') },
          { kind: lit('revenue'), amount: lit(416161000000), unitLabel: lit('United States dollar'), date: lit('2025-01-01T00:00:00Z') },
          { kind: lit('employees'), amount: lit(164000), unitLabel: lit('1'), date: lit('2022-01-01T00:00:00Z') },
        ] } });
      }
      if (query.includes('("hq" wdt:P159)')) {
        return ok({ results: { bindings: [
          { kind: lit('hq'), value: uri('Q189471'), valueLabel: lit('Cupertino'), coord: lit('Point(-122.04 37.32)') },
          { kind: lit('founder'), value: uri('Q19837'), valueLabel: lit('Steve Jobs') },
          { kind: lit('founder'), value: uri('Q483382'), valueLabel: lit('Steve Wozniak') },
          { kind: lit('ceo'), value: uri('Q265852'), valueLabel: lit('Tim Cook') },
          { kind: lit('product'), value: uri('Q2766'), valueLabel: lit('iPhone') },
          { kind: lit('product'), value: uri('Q999'), valueLabel: lit('Q999') },
        ] } });
      }
      if (query.includes('?exLabel')) {
        return ok({ results: { bindings: [
          { label: lit('Apple Inc.'), desc: lit('American technology company'), article: { type: 'uri', value: 'https://en.wikipedia.org/wiki/Apple_Inc.' }, inception: lit('1976-04-01T00:00:00Z'), website: lit('https://www.apple.com/'), exLabel: lit('Nasdaq'), ticker: lit('AAPL') },
        ] } });
      }
      if (query.includes('wdt:P31/wdt:P279*')) {
        return ok({ results: { bindings: [
          { item: uri('Q8073715'), itemLabel: lit('Zomato'), itemDescription: lit('Indian food delivery service'), countryLabel: lit('India') },
        ] } });
      }
    }
    if (url.includes('finance.yahoo.com')) {
      return ok({ spark: { result: [{ symbol: 'AAPL', response: [{ meta: { symbol: 'AAPL', regularMarketPrice: 344.3, chartPreviousClose: 340, currency: 'USD' } }] }] } });
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  return { impl, calls };
}

test('every catalog sector exists and every domain points at real sectors', () => {
  const ids = new Set(COMPANY_SECTORS.map((s) => s.id));
  for (const company of COMPANY_CATALOG) assert.ok(ids.has(company.sector), company.title);
  for (const sectors of Object.values(DOMAIN_COMPANY_SECTORS)) for (const s of sectors) assert.ok(ids.has(s), s);
  assert.ok(COMPANY_CATALOG.length > 250);
});

test('the catalog resolves titles in batches and places companies at their HQ', async () => {
  const { impl, calls } = fakeFetch();
  const service = createGlobisentCompaniesMiddleware({ fetchImpl: impl, now: () => NOW });
  const catalog = await service.getCatalog();
  const apple = catalog.companies.find((c) => c.id === 'Q312');
  assert.deepEqual([apple.lat, apple.lon, apple.hq, apple.iso3, apple.ticker], [37.32, -122.04, 'Cupertino', 'USA', 'AAPL']);
  const berkshire = catalog.companies.find((c) => c.title === 'Berkshire Hathaway');
  assert.deepEqual(berkshire.sectors, ['finance', 'conglomerate'], 'a company in two sectors is listed once');
  const titleCount = new Set(COMPANY_CATALOG.map((c) => c.title)).size;
  assert.equal(calls.filter((u) => u.includes('w/api.php')).length, Math.ceil(titleCount / 50));
  await service.getCatalog();
  assert.equal(calls.filter((u) => u.includes('sparql')).length, 1, 'cached');
});

test('a company profile has facts, financials, share price and products', async () => {
  const service = createGlobisentCompaniesMiddleware({ fetchImpl: fakeFetch().impl, now: () => NOW });
  const apple = await service.getCompany('Q312');
  assert.equal(apple.name, 'Apple Inc.');
  assert.equal(apple.ticker, 'AAPL');
  assert.deepEqual(apple.location, { lat: 37.32, lon: -122.04 });
  const byTitle = Object.fromEntries(apple.sections.map((s) => [s.title.split(' ·')[0], s]));
  assert.match(byTitle.About.text, /American technology company/);
  const facts = Object.fromEntries(byTitle['Key facts'].items.map((i) => [i.label, i.value]));
  assert.equal(facts.Founders, 'Steve Jobs, Steve Wozniak');
  assert.equal(facts.CEO, 'Tim Cook');
  assert.equal(facts.Founded, '1976');
  assert.equal(facts['Stock listing'], 'Nasdaq · AAPL');
  const money = Object.fromEntries(byTitle.Financials.items.map((i) => [i.label, i]));
  assert.equal(money.Revenue.value, 'US$416.16B');
  assert.equal(money.Revenue.detail, 'reported 2025');
  assert.equal(byTitle['Share price'].quote.price, 344.3);
  assert.deepEqual(byTitle['Products & brands'].items.map((i) => i.label), ['iPhone'], 'unlabelled items are dropped');
});

test('bad ids are rejected before any request', async () => {
  const { impl, calls } = fakeFetch();
  const service = createGlobisentCompaniesMiddleware({ fetchImpl: impl, now: () => NOW });
  await assert.rejects(service.getCompany('Q1; DROP'), /Wikidata id/);
  await assert.rejects(service.getCompany('312'), /Wikidata id/);
  assert.equal(calls.length, 0);
});

test('search keeps only businesses and puts catalog matches first', async () => {
  const service = createGlobisentCompaniesMiddleware({ fetchImpl: fakeFetch().impl, now: () => NOW });
  const zomato = await service.search('zomato');
  assert.deepEqual(zomato.results.map((r) => r.name), ['Zomato'], 'the city Delhi is filtered out');
  const apple = await service.search('apple');
  assert.equal(apple.results[0].id, 'Q312');
  assert.deepEqual((await service.search('a')).results, []);
});

test('helpers: tickers, money, latest facts and points', () => {
  assert.equal(yahooTicker('National Stock Exchange of India', 'INFY'), 'INFY.NS');
  assert.equal(yahooTicker('Nasdaq', 'AAPL'), 'AAPL');
  assert.equal(yahooTicker('Tokyo Stock Exchange', '6758'), '6758.T');
  assert.equal(yahooTicker('Unknown Exchange', 'X'), null);
  assert.equal(yahooTicker('Nasdaq', 'BAD;TICKER'), null);
  assert.equal(formatMoney(2.5e12, 'Indian rupee'), '₹2.5T');
  assert.equal(formatMoney(1234, '1'), '1.23K');
  const latest = latestFacts([
    { kind: lit('revenue'), amount: lit(1), date: lit('2020-01-01') },
    { kind: lit('revenue'), amount: lit(2), date: lit('2024-01-01') },
    { kind: lit('revenue'), amount: lit(3) },
  ]);
  assert.equal(latest.get('revenue').amount, 2);
  assert.deepEqual(parsePoint('Point(72.8775 19.0758)'), { lat: 19.0758, lon: 72.8775 });
  assert.equal(parsePoint('Point(200 10)'), null);
});

test('the directory is saved to disk and reused after a restart', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'gx-companies-'));
  const cacheFile = join(dir, 'companies.json');
  try {
    const first = fakeFetch();
    await createGlobisentCompaniesMiddleware({ fetchImpl: first.impl, now: () => NOW, cacheFile }).getCatalog();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = fakeFetch();
    const restarted = createGlobisentCompaniesMiddleware({ fetchImpl: second.impl, now: () => NOW + 60_000, cacheFile });
    const catalog = await restarted.getCatalog();
    assert.ok(catalog.companies.some((c) => c.id === 'Q312'));
    assert.equal(second.calls.length, 0, 'no network after a restart');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a 429 from Wikipedia is retried after a pause', async () => {
  const { impl } = fakeFetch();
  let throttled = 1;
  const waits = [];
  const flaky = async (url, init) => {
    if (url.includes('w/api.php') && throttled-- > 0) {
      return { ok: false, status: 429, headers: { get: () => '3' }, text: async () => '' };
    }
    return impl(url, init);
  };
  const service = createGlobisentCompaniesMiddleware({ fetchImpl: flaky, now: () => NOW, sleep: async (ms) => { waits.push(ms); } });
  const catalog = await service.getCatalog();
  assert.ok(catalog.companies.length > 250);
  assert.deepEqual(waits, [3000], 'Retry-After is honoured');
});

test('every listed company is fetched in slices, merged and cached', async () => {
  const queries = [];
  const impl = async (url, init = {}) => {
    const query = new URLSearchParams(init.body).get('query');
    queries.push(query);
    const digit = /STRENDS\(STR\(\?item\), "(\d)"\)/.exec(query)[1];
    const bindings = [];
    for (let i = 0; i < 120; i++) {
      const id = `Q${i}${digit}`;
      bindings.push({ item: uri(id), label: lit(`Company ${i}${digit}`), coord: lit(`Point(${i % 180} ${i % 80})`), exLabel: lit('Nasdaq'), iso3: lit('USA') });
      if (i === 0) bindings.push({ item: uri(id), label: lit(`Company ${i}${digit}`), coord: lit('Point(0 0)'), ticker: lit(`T${digit}`) });
    }
    bindings.push({ item: uri(`Q999${digit}`), coord: lit('Point(1 1)') }); // no English name: skipped
    return ok({ results: { bindings } });
  };
  const service = createGlobisentCompaniesMiddleware({ fetchImpl: impl, now: () => NOW });
  const listed = await service.getListed();
  assert.equal(queries.length, 10);
  assert.equal(listed.count, 1200);
  const first = listed.rows.find((r) => r[0] === 'Q05');
  assert.deepEqual(first, ['Q05', 'Company 05', 0, 0, 'USA', 'Nasdaq', 'T5'], 'duplicate rows merge their ticker');
  await service.getListed();
  assert.equal(queries.length, 10, 'cached');
});

test('listed-company name search prefers names that start with the text', async () => {
  const { matchListed } = await import('../../src/globisent/companies.js');
  const rows = [
    ['Q1', 'Big Reliance Holdings', 0, 0, 'USA', 'NYSE', 'BRH'],
    ['Q2', 'Reliance Power', 0, 0, 'IND', 'National Stock Exchange of India', 'RPOWER'],
    ['Q3', 'Reliance Industries', 0, 0, 'IND', 'National Stock Exchange of India', 'RELIANCE'],
  ];
  assert.deepEqual(matchListed(rows, 'reliance').map((r) => r[0]), ['Q2', 'Q3', 'Q1']);
  assert.deepEqual(matchListed(rows, 'reliance', new Set(['Q3'])).map((r) => r[0]), ['Q2', 'Q1']);
  assert.deepEqual(matchListed(rows, 'rpower').map((r) => r[0]), ['Q2'], 'exact ticker matches');
  assert.deepEqual(matchListed(rows, 'r'), []);
});
