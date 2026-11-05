import test from 'node:test';
import assert from 'node:assert/strict';
import { createDigitrafficFeed, digitrafficRows, shipTypeName } from './digitraffic.js';

const NOW = Date.parse('2026-11-06T10:00:00Z');
const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

const locations = {
  features: [
    { mmsi: 636020889, geometry: { coordinates: [24.95, 60.15] }, properties: { mmsi: 636020889, sog: 12.4, cog: 88.1, heading: 90, timestampExternal: NOW - 60_000 } },
    { mmsi: 230000001, geometry: { coordinates: [22.1, 59.9] }, properties: { mmsi: 230000001, sog: 102.3, cog: 360, heading: 511, timestampExternal: NOW - 5 * 60_000 } },
    { mmsi: 230000002, geometry: { coordinates: [21, 59] }, properties: { mmsi: 230000002, sog: 5, timestampExternal: NOW - 2 * 60 * 60_000 } },
    { mmsi: 230000003, geometry: { coordinates: [200, 59] }, properties: { mmsi: 230000003 } },
  ],
};
const names = [{ mmsi: 636020889, name: 'ANIKITOS STAR ', shipType: 80, destination: 'RUULU', imo: 9412086 }];

test('Digitraffic positions become vessel rows with names and types', () => {
  const rows = digitrafficRows(locations, new Map(names.map((n) => [n.mmsi, n])), NOW);
  assert.equal(rows.length, 2, 'stale and invalid positions are dropped');
  const [tanker, unknown] = rows;
  assert.deepEqual(
    { name: tanker.name, mmsi: tanker.mmsi, type: tanker.type, destination: tanker.destination, speed: tanker.speed, imo: tanker.imo },
    { name: 'ANIKITOS STAR', mmsi: '636020889', type: 'Tanker', destination: 'RUULU', speed: 12.4, imo: '9412086' },
  );
  assert.equal(unknown.name, 'MMSI 230000001');
  assert.deepEqual([unknown.speed, unknown.course, unknown.heading], [null, null, null], 'AIS not-available sentinels become null');
  assert.equal(tanker.last_position_epoch, Math.floor((NOW - 60_000) / 1000));
});

test('ship type codes read as words', () => {
  assert.equal(shipTypeName(70), 'Cargo');
  assert.equal(shipTypeName(61), 'Passenger');
  assert.equal(shipTypeName(30), 'Fishing');
  assert.equal(shipTypeName(35), 'Military');
  assert.equal(shipTypeName(0), '');
});

test('the feed polls at most once a minute, identifies itself and keeps the last good data', async () => {
  let t = NOW;
  const calls = [];
  let fail = false;
  const feed = createDigitrafficFeed({
    now: () => t,
    fetchImpl: async (url, init) => {
      calls.push({ url, user: init.headers['Digitraffic-User'] });
      if (fail) throw new Error('offline');
      return ok(url.includes('/locations') ? locations : names);
    },
  });
  const first = await feed.snapshot();
  assert.equal(first.rows.length, 2);
  assert.equal(calls.length, 2, 'positions and names');
  assert.ok(calls.every((c) => c.user === 'GLOBISENT/1.0'));
  await feed.snapshot();
  assert.equal(calls.length, 2, 'cached within a minute');
  t += 61_000;
  await feed.snapshot();
  assert.equal(calls.length, 3, 'names are not refetched for six hours');
  fail = true;
  t += 61_000;
  const kept = await feed.snapshot();
  assert.equal(kept.rows.length, 2, 'last good positions survive a failed refresh');
});
