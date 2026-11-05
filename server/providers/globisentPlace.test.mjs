import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobisentPlaceMiddleware, parsePoint, distanceKm } from './globisentPlace.js';

const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

function fakeFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (url.includes('nominatim')) {
      if (url.includes('lat=0&')) return json({ error: 'Unable to geocode' });
      return json({ name: 'New Delhi', address: { city: 'New Delhi', state: 'Delhi', country: 'India', country_code: 'in' } });
    }
    if (url.includes('open-meteo')) return json({ timezone: 'Asia/Kolkata', current: { time: '2026-11-05T15:15', temperature_2m: 27.9, apparent_temperature: 29.4, relative_humidity_2m: 50, wind_speed_10m: 5, precipitation: 0, weather_code: 0 } });
    if (url.includes('usgs')) {
      return json({ features: [
        { properties: { mag: 4.6, place: '40 km N of Delhi', time: 0, url: 'https://e.example/1' }, geometry: { coordinates: [77.2, 28.97] } },
        { properties: { mag: 6.1, place: 'Fiji', time: 0, url: 'https://e.example/2' }, geometry: { coordinates: [178, -17] } },
      ] });
    }
    return json({}, 503);
  };
  return { impl, calls };
}

const services = {
  news: { getNews: async ({ search }) => ({ provider: 'google-news', articles: [{ title: `News about ${search}`, url: 'https://n.example/1', source: 'n.example' }] }) },
  domains: {
    getDomain: async (id) => (id === 'country'
      ? { sections: [{ kind: 'stats', items: [{ label: 'Capital', value: 'New Delhi' }] }] }
      : { sections: [{ title: 'Global disaster alerts · GDACS orange & red', items: [{ label: 'RED · Flood', detail: 'India' }, { label: 'ORANGE · Quake', detail: 'Chile' }] }] }),
  },
};

function call(mw, url) {
  return new Promise((resolve) => {
    const res = { statusCode: 0, setHeader() {}, end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); } };
    mw({ method: 'GET', url }, res, () => resolve({ status: 'next' }));
  });
}

test('a land click returns the place, weather, nearby quakes, country data and news', async () => {
  const { impl } = fakeFetch();
  const mw = createGlobisentPlaceMiddleware({ fetchImpl: impl, sleep: async () => {}, ...services });
  const { status, body } = await call(mw, '/?lat=28.61&lon=77.21');
  assert.equal(status, 200);
  assert.equal(body.place.name, 'New Delhi');
  assert.equal(body.place.countryCode, 'IN');
  const byTitle = Object.fromEntries(body.sections.map((s) => [s.title.split(' ·')[0], s]));
  assert.equal(byTitle['Weather now'].items[0].value, 'Clear sky');
  const quakes = body.sections.find((s) => s.title.startsWith('Earthquakes'));
  assert.equal(quakes.items.length, 1, 'only the quake within 500 km');
  const alerts = body.sections.find((s) => s.title.startsWith('Active disaster alerts'));
  assert.deepEqual(alerts.items.map((i) => i.detail), ['India']);
  assert.match(body.sections.at(-1).items[0].label, /New Delhi/);
});

test('open ocean still answers with weather and no country sections', async () => {
  const { impl } = fakeFetch();
  const mw = createGlobisentPlaceMiddleware({ fetchImpl: impl, sleep: async () => {}, ...services });
  const { body } = await call(mw, '/?lat=0&lon=-30');
  assert.equal(body.place.countryCode, null);
  assert.equal(body.sections.length, 2);
});

test('nearby clicks share one reverse-geocode request', async () => {
  const { impl, calls } = fakeFetch();
  const mw = createGlobisentPlaceMiddleware({ fetchImpl: impl, sleep: async () => {}, ...services });
  await call(mw, '/?lat=28.611&lon=77.211');
  await call(mw, '/?lat=28.612&lon=77.212');
  assert.equal(calls.filter((u) => u.includes('nominatim')).length, 1);
});

test('invalid coordinates are rejected', async () => {
  const mw = createGlobisentPlaceMiddleware({ fetchImpl: fakeFetch().impl, ...services });
  assert.equal((await call(mw, '/?lat=91&lon=0')).status, 400);
  assert.equal(parsePoint(new URLSearchParams('lat=abc&lon=1')), null);
  assert.ok(Math.abs(distanceKm({ lat: 28.61, lon: 77.21 }, { lat: 19.07, lon: 72.88 }) - 1150) < 20);
});
