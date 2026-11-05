import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGlobisentTourMiddleware,
  quakeStop,
  disasterStop,
  marketStop,
  companyStop,
  headlineStop,
} from './globisentTour.js';

const NOW = Date.parse('2026-11-06T09:00:00Z');
const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

const usgs = { features: [
  { properties: { mag: 4.2, place: 'Small one' }, geometry: { coordinates: [10, 10, 5] } },
  { properties: { mag: 6.1, place: 'Fiji region', time: NOW }, geometry: { coordinates: [-178.6, -21.2, 580] } },
] };
const gdacs = { features: [
  { geometry: { type: 'Point', coordinates: [120, 10] }, properties: { alertlevel: 'Orange', eventtype: 'FL', name: 'Flood A', country: 'Philippines', fromdate: '2026-11-05T00:00:00' } },
  { geometry: { type: 'Point', coordinates: [80.2, 15.8] }, properties: { alertlevel: 'Red', eventtype: 'TC', name: 'Tropical Cyclone MURASU-26', country: 'India', fromdate: '2026-11-03T00:00:00' } },
] };
const markets = { exchanges: [
  { id: 'nyse', name: 'NYSE · Nasdaq', city: 'New York', country: 'United States', lat: 40.7, lon: -74, open: true, index: { label: 'S&P 500', changePct: -3.7 } },
  { id: 'krx', name: 'Korea Exchange', city: 'Seoul', country: 'South Korea', lat: 37.5, lon: 126.9, open: false, index: { label: 'KOSPI', changePct: -5.28 } },
  { id: 'nse', name: 'NSE · BSE', city: 'Mumbai', country: 'India', lat: 18.9, lon: 72.8, open: false, index: null },
] };
const catalog = { companies: [
  { id: 'Q1', name: 'Samsung Electronics', sectors: ['tech'], hq: 'Suwon', country: 'South Korea', lat: 37.25, lon: 127.05 },
  { id: 'Q2', name: 'Krafton', sectors: ['media'], hq: 'Seongnam', country: 'South Korea', lat: 37.43, lon: 127.13 },
  { id: 'Q3', name: 'Apple Inc.', sectors: ['tech'], hq: 'Cupertino', country: 'United States', lat: 37.3, lon: -122 },
  { id: 'Q4', name: 'Approx Co', sectors: ['tech'], country: 'South Korea', lat: 36, lon: 128, approximate: true },
] };
const news = { provider: 'google-news', articles: [{ title: 'Top story', source: 'example.com', url: 'https://example.com/a' }] };

test('the biggest quake, the red alert and the biggest market move are picked', () => {
  const quake = quakeStop(usgs);
  assert.equal(quake.title, 'M6.1 earthquake');
  assert.deepEqual([quake.lat, quake.lon], [-21.2, -178.6]);
  assert.match(quake.detail, /580 km deep/);
  const alert = disasterStop(gdacs);
  assert.equal(alert.title, 'Tropical Cyclone MURASU-26', 'red beats a newer orange alert');
  assert.match(alert.eyebrow, /RED ALERT/);
  const market = marketStop(markets);
  assert.equal(market.title, 'KOSPI ▼ 5.28%');
  assert.equal(market.trend, 'down');
  assert.match(market.detail, /1 of 3 exchanges open/);
});

test('the company stop prefers that market’s country and skips approximate HQs', () => {
  const day0 = companyStop(catalog, 'South Korea', 0);
  const day1 = companyStop(catalog, 'South Korea', 1);
  assert.deepEqual(new Set([day0.title, day1.title]), new Set(['Samsung Electronics', 'Krafton']));
  assert.equal(companyStop(catalog, 'Narnia', 2).title, 'Apple Inc.', 'falls back to any company');
  assert.equal(companyStop({ companies: [] }, 'X'), null);
});

test('missing sources drop their stops but the tour still plays', async () => {
  const impl = async (url) => (url.includes('usgs') ? ok(usgs) : { ok: false, status: 503, text: async () => '' });
  const tour = await createGlobisentTourMiddleware({
    fetchImpl: impl,
    now: () => NOW,
    markets: { getMarkets: async () => { throw new Error('down'); } },
    companies: { getCatalog: async () => catalog },
    news: { getNews: async () => news },
  }).getTour();
  assert.deepEqual(tour.stops.map((s) => s.id), ['intro', 'quake', 'company', 'headline', 'outro']);
  assert.match(tour.stops[0].subtitle, /2 earthquakes in 24 h/);
  assert.doesNotMatch(tour.stops[0].subtitle, /stock markets/);
  assert.equal(headlineStop(news).title, 'Top story');
});

test('the tour is cached for a few minutes', async () => {
  let calls = 0;
  let t = NOW;
  const service = createGlobisentTourMiddleware({
    fetchImpl: async (url) => { calls += 1; return url.includes('usgs') ? ok(usgs) : ok(gdacs); },
    now: () => t,
    markets: { getMarkets: async () => markets },
    companies: { getCatalog: async () => catalog },
    news: { getNews: async () => news },
  });
  const first = await service.getTour();
  assert.deepEqual(first.stops.map((s) => s.id), ['intro', 'quake', 'disaster', 'market', 'company', 'headline', 'outro']);
  await service.getTour();
  assert.equal(calls, 2);
  t += 6 * 60 * 1000;
  await service.getTour();
  assert.equal(calls, 4);
});
