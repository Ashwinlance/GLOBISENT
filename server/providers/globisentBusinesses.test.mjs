import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGlobisentBusinessesMiddleware,
  featuresToRows,
  classify,
  tileOf,
  BUSINESS_GROUPS,
} from './globisentBusinesses.js';

const NOW = Date.parse('2026-11-05T16:00:00Z');
const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

const feature = (id, name, lat, lon, key, value, extra = {}) => ({
  geometry: { coordinates: [lon, lat] },
  properties: { osm_type: 'N', osm_id: id, name, osm_key: key, osm_value: value, street: 'Linking Road', city: 'Mumbai', ...extra },
});

function fakeFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (url.includes('/reverse?')) {
      const tags = new URL(url).searchParams.getAll('osm_tag');
      if (tags.includes('shop')) {
        return ok({ features: [
          feature(2, 'Bata', 19.0655, 72.8355, 'shop', 'shoes'),
          feature(3, 'Outside Tile Store', 19.0801, 72.8355, 'shop', 'clothes'),
          feature(2, 'Bata', 19.0655, 72.8355, 'shop', 'shoes'),
        ] });
      }
      if (tags.includes('office')) {
        return ok({ features: [
          feature(1, 'State Bank of India', 19.0659, 72.8344, 'amenity', 'bank', { housenumber: '533' }),
          feature(4, '', 19.066, 72.834, 'office', 'company'),
        ] });
      }
      return ok({ features: [feature(5, 'Hotel Linkway', 19.0651, 72.8351, 'tourism', 'hotel')] });
    }
    if (url.includes('/lookup?')) {
      return ok([{
        name: 'State Bank of India', category: 'amenity', type: 'bank', lat: '19.0659', lon: '72.8344',
        address: { road: 'Linking Road', suburb: 'Khar', city: 'Mumbai', state: 'Maharashtra', postcode: '400052', country: 'India' },
        extratags: { 'brand:wikidata': 'Q1340361', opening_hours: 'Mo-Fr 10:00-16:00', website: 'https://sbi.co.in/' },
      }]);
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  return { impl, calls };
}

test('OpenStreetMap tags map to business kinds', () => {
  assert.equal(classify('office', 'company'), 'office');
  assert.equal(classify('man_made', 'works'), 'industry');
  assert.equal(classify('amenity', 'bank'), 'bank');
  assert.equal(classify('shop', 'supermarket'), 'shop');
  assert.equal(classify('tourism', 'hotel'), 'hotel');
  assert.equal(classify('amenity', 'cafe'), 'food');
  assert.equal(classify('amenity', 'pharmacy'), 'health');
  assert.equal(classify('amenity', 'fuel'), 'fuel');
  assert.equal(classify('leisure', 'park'), 'other');
});

test('a tile keeps named businesses inside it, once each', () => {
  const tile = tileOf(19.065, 72.835);
  const rows = featuresToRows([
    feature(2, 'Bata', 19.0655, 72.8355, 'shop', 'shoes'),
    feature(2, 'Bata', 19.0655, 72.8355, 'shop', 'shoes'),
    feature(3, 'Far away', 19.2, 72.8355, 'shop', 'clothes'),
    feature(4, '', 19.0655, 72.8355, 'office', 'company'),
  ], tile);
  assert.deepEqual(rows, [['N2', 'Bata', 19.0655, 72.8355, 'shop', 'shoes', 'Linking Road, Mumbai']]);
});

test('a tile asks each category once, then comes from cache', async () => {
  const { impl, calls } = fakeFetch();
  const waits = [];
  const service = createGlobisentBusinessesMiddleware({ fetchImpl: impl, now: () => NOW, sleep: async (ms) => waits.push(ms), photonUrl: 'https://photon.example' });
  const tile = await service.getTile(19.065, 72.835);
  assert.equal(calls.length, BUSINESS_GROUPS.length);
  assert.deepEqual(tile.rows.map((r) => r[1]).sort(), ['Bata', 'Hotel Linkway', 'State Bank of India']);
  assert.equal(tile.partial, false);
  await service.getTile(19.0651, 72.8352);
  assert.equal(calls.length, BUSINESS_GROUPS.length, 'same tile is cached');
  assert.ok(calls.every((u) => u.startsWith('https://photon.example/reverse?')));
});

test('business details link to the brand company profile', async () => {
  const service = createGlobisentBusinessesMiddleware({ fetchImpl: fakeFetch().impl, now: () => NOW, sleep: async () => {} });
  const bank = await service.getBusiness('N1');
  assert.equal(bank.companyId, 'Q1340361');
  assert.equal(bank.osmUrl, 'https://www.openstreetmap.org/node/1');
  const facts = Object.fromEntries(bank.sections[0].items.map((i) => [i.label, i.value]));
  assert.equal(facts['Opening hours'], 'Mo-Fr 10:00-16:00');
  assert.equal(facts.Website, 'sbi.co.in');
  assert.match(bank.sections[1].text, /Linking Road, Khar, Mumbai/);
});

test('bad input is rejected without calling upstream', async () => {
  const { impl, calls } = fakeFetch();
  const service = createGlobisentBusinessesMiddleware({ fetchImpl: impl, now: () => NOW });
  await assert.rejects(service.getBusiness('X1'), /look like/);
  await assert.rejects(service.getBusiness('N1;drop'), /look like/);
  const result = await new Promise((resolve) => {
    const res = { statusCode: 0, setHeader() {}, end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); } };
    service.businessesMiddleware({ method: 'GET', url: '/?lat=95&lon=0' }, res, () => resolve({ status: 'next' }));
  });
  assert.equal(result.status, 400);
  assert.equal(calls.length, 0);
});
