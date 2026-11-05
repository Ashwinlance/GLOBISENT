import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobisentDomainMiddleware, formatIndicator } from './globisentDomains.js';
import { DOMAINS } from '../../src/globisent/domains.js';
import { NEWS_CATEGORIES } from '../../src/globisent/news.js';

function call(middleware, url) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      setHeader() {},
      end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); },
    };
    middleware({ method: 'GET', url }, res, () => resolve({ status: 'next' }));
  });
}

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern));
    if (!match) return { ok: false, status: 503, text: async () => 'down' };
    return { ok: true, status: 200, text: async () => JSON.stringify(match[1]) };
  };
  return { impl, calls };
}

const worldBank = [{ page: 1 }, [{ indicator: { id: 'X', value: 'GDP growth (annual %)' }, country: { id: 'IN' }, date: '2025', value: 7.5667 }]];

test('every domain names a valid news category and a known status', () => {
  for (const domain of DOMAINS) {
    assert.ok(Object.hasOwn(NEWS_CATEGORIES, domain.news), `${domain.id} → ${domain.news}`);
    assert.ok(['map', 'data'].includes(domain.status), domain.id);
  }
  assert.equal(new Set(DOMAINS.map((d) => d.id)).size, DOMAINS.length);
});

test('economy combines World Bank indicators with exchange rates and caches them', async () => {
  const { impl, calls } = fakeFetch({
    'api.worldbank.org': worldBank,
    'frankfurter.app': { date: '2026-11-04', rates: { INR: 94.64, EUR: 0.8875 } },
  });
  const mw = createGlobisentDomainMiddleware({ fetchImpl: impl });
  const first = await call(mw, '/?id=economy&country=IND');
  assert.equal(first.status, 200);
  const titles = first.body.sections.map((s) => s.title);
  assert.ok(titles.includes('Key indicators'));
  assert.ok(titles.some((t) => t.startsWith('Exchange rates')));
  assert.equal(first.body.sections[0].items[0].value, '7.57');
  const count = calls.length;
  await call(mw, '/?id=economy&country=IND');
  assert.equal(calls.length, count, 'second request is served from cache');
});

test('a failing feed is reported in its own section without breaking the rest', async () => {
  const { impl } = fakeFetch({ 'api.worldbank.org': worldBank });
  const mw = createGlobisentDomainMiddleware({ fetchImpl: impl });
  const result = await call(mw, '/?id=tech&country=WLD');
  assert.equal(result.status, 200);
  const cisa = result.body.sections.find((s) => s.kind === 'error');
  assert.ok(cisa, 'CISA failure is surfaced');
  assert.ok(result.body.sections.some((s) => s.title === 'Key indicators'));
});

test('unknown domains 404 and unknown countries fall back to India', async () => {
  const { impl } = fakeFetch({ 'api.worldbank.org': worldBank });
  const mw = createGlobisentDomainMiddleware({ fetchImpl: impl });
  assert.equal((await call(mw, '/?id=nope')).status, 404);
  assert.equal((await call(mw, '/?id=health&country=../../etc')).body.country, 'IND');
});

test('indicator values are formatted for reading', () => {
  assert.equal(formatIndicator(3.96e12, 'GDP (current US$)'), '$3.96T');
  assert.equal(formatIndicator(1.45e9, 'Population, total'), '1.45B');
  assert.equal(formatIndicator(Number.NaN, 'x'), 'n/a');
});
