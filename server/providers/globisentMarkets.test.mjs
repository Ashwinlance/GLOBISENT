import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGlobisentMarketsMiddleware,
  parseSparkQuote,
  allSymbols,
  MARKET_EXCHANGES,
} from './globisentMarkets.js';

const NOW = Date.parse('2026-11-05T16:00:00Z');
const sec = (iso) => Date.parse(iso) / 1000;

function spark(symbol, { price = 100, prev = 98, pct, open = true } = {}) {
  return {
    symbol,
    response: [{
      meta: {
        symbol,
        currency: 'USD',
        regularMarketPrice: price,
        chartPreviousClose: prev,
        ...(pct === undefined ? {} : { regularMarketChangePercent: pct }),
        regularMarketDayHigh: price + 1,
        regularMarketDayLow: price - 2,
        regularMarketTime: sec('2026-11-05T15:59:00Z'),
        exchangeTimezoneName: 'America/New_York',
        currentTradingPeriod: {
          regular: open
            ? { start: sec('2026-11-05T14:30:00Z'), end: sec('2026-11-05T21:00:00Z') }
            : { start: sec('2026-11-06T00:00:00Z'), end: sec('2026-11-06T06:00:00Z') },
        },
      },
    }],
  };
}

const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

function fakeFetch({ failYahoo = false, failCrypto = false } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (url.includes('yahoo')) {
      if (failYahoo) return { ok: false, status: 429, text: async () => '' };
      const symbols = decodeURIComponent(new URL(url).searchParams.get('symbols')).split(',');
      return ok({ spark: { result: symbols.map((s) => spark(s, { open: s !== '^N225' })) } });
    }
    if (url.includes('coingecko')) {
      if (failCrypto) return { ok: false, status: 503, text: async () => '' };
      return ok({ bitcoin: { usd: 75000, usd_24h_change: -5.2, last_updated_at: sec('2026-11-05T15:58:00Z') } });
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  return { impl, calls };
}

test('a spark result becomes a quote with change and open status', () => {
  const quote = parseSparkQuote(spark('^GSPC', { price: 102, prev: 100 }), NOW);
  assert.equal(quote.label, 'S&P 500');
  assert.equal(quote.price, 102);
  assert.ok(Math.abs(quote.changePct - 2) < 1e-9, 'computed from the previous close when Yahoo omits it');
  assert.equal(quote.change, 2);
  assert.equal(quote.open, true);
  assert.equal(parseSparkQuote(spark('^N225', { open: false }), NOW).open, false);
  assert.equal(parseSparkQuote(spark('^GSPC', { pct: -3.5 }), NOW).changePct, -3.5, 'Yahoo percent wins when present');
  assert.equal(parseSparkQuote({ symbol: 'X', response: [] }, NOW), null);
});

test('every exchange gets its index, open status and position', async () => {
  const { impl, calls } = fakeFetch();
  const mw = createGlobisentMarketsMiddleware({ fetchImpl: impl, now: () => NOW });
  const data = await mw.getMarkets();
  assert.equal(data.exchanges.length, MARKET_EXCHANGES.length);
  const tokyo = data.exchanges.find((e) => e.id === 'tse');
  assert.equal(tokyo.open, false);
  assert.equal(tokyo.index.label, 'Nikkei 225');
  const ny = data.exchanges.find((e) => e.id === 'nyse');
  assert.equal(ny.open, true);
  assert.deepEqual(ny.extra.map((q) => q.label), ['Dow Jones', 'Nasdaq', 'VIX (fear index)']);
  assert.ok(Number.isFinite(ny.lat) && Number.isFinite(ny.lon));
  const groups = Object.fromEntries(data.groups.map((g) => [g.id, g]));
  assert.ok(groups.commodities.items.some((q) => q.label === 'Gold'));
  assert.equal(groups.crypto.items[0].label, 'Bitcoin');
  const yahooCalls = calls.filter((u) => u.includes('yahoo')).length;
  assert.equal(yahooCalls, Math.ceil(allSymbols().length / 20), 'symbols are batched');
});

test('snapshots are shared for a minute, then refreshed', async () => {
  let t = NOW;
  const { impl, calls } = fakeFetch();
  const mw = createGlobisentMarketsMiddleware({ fetchImpl: impl, now: () => t });
  await Promise.all([mw.getMarkets(), mw.getMarkets()]);
  const first = calls.length;
  t += 30_000;
  await mw.getMarkets();
  assert.equal(calls.length, first, 'served from cache within a minute');
  t += 60_000;
  await mw.getMarkets();
  assert.ok(calls.length > first);
});

test('a failed refresh serves the last snapshot marked stale', async () => {
  let t = NOW;
  let fail = false;
  const good = fakeFetch().impl;
  const impl = (url) => (fail ? Promise.reject(new Error('offline')) : good(url));
  const mw = createGlobisentMarketsMiddleware({ fetchImpl: impl, now: () => t });
  await mw.getMarkets();
  fail = true;
  t += 2 * 60_000;
  const data = await mw.getMarkets();
  assert.equal(data.stale, true);
  assert.equal(data.exchanges.length, MARKET_EXCHANGES.length);
});

test('crypto failing alone still returns stocks with an error note', async () => {
  const mw = createGlobisentMarketsMiddleware({ fetchImpl: fakeFetch({ failCrypto: true }).impl, now: () => NOW });
  const data = await mw.getMarkets();
  assert.ok(data.exchanges[0].index);
  assert.match(data.errors.join(' '), /Crypto/);
});

test('the route answers 502 when every source is down and nothing is cached', async () => {
  const mw = createGlobisentMarketsMiddleware({ fetchImpl: fakeFetch({ failYahoo: true, failCrypto: true }).impl, now: () => NOW });
  const result = await new Promise((resolve) => {
    const res = { statusCode: 0, setHeader() {}, end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); } };
    mw({ method: 'GET', url: '/' }, res, () => resolve({ status: 'next' }));
  });
  assert.equal(result.status, 502);
  assert.match(result.body.error, /Market data unavailable/);
});
