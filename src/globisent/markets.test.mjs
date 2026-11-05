import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice, formatChange, trend } from './markets.js';

test('changes show an arrow and two decimals', () => {
  assert.equal(formatChange(2.404), '▲ 2.40%');
  assert.equal(formatChange(-5.278), '▼ 5.28%');
  assert.equal(formatChange(0), '■ 0.00%');
  assert.equal(formatChange(null), '—');
});

test('trend picks the marker colour', () => {
  assert.equal(trend(1.2), 'up');
  assert.equal(trend(-0.4), 'down');
  assert.equal(trend(0.001), 'flat');
  assert.equal(trend(undefined), 'flat');
});

test('prices use more decimals for currencies and small values', () => {
  assert.equal(formatPrice(24536.6, '^NSEI'), '24,536.60');
  assert.equal(formatPrice(1.12384, 'EURUSD=X'), '1.1238');
  assert.equal(formatPrice(2.976, 'NG=F'), '2.976');
  assert.equal(formatPrice(NaN), '—');
});

test('a company share-price section becomes a stats section', async () => {
  const { quoteToStats } = await import('./companies.js');
  const stats = quoteToStats({ title: 'Share price · AAPL', source: 'Yahoo Finance', quote: { symbol: 'AAPL', price: 344.3, changePct: 1.26, dayLow: 340, dayHigh: 346, open: true, currency: 'USD' } });
  assert.equal(stats.kind, 'stats');
  const items = Object.fromEntries(stats.items.map((i) => [i.label, i.value]));
  assert.equal(items.Price, '344.30 USD');
  assert.equal(items.Today, '▲ 1.26%');
  assert.equal(items.Market, 'Open now');
});

test('companies sharing a city-centre HQ are spread on a small spiral', async () => {
  const { spiralOffset } = await import('./companies.js');
  assert.deepEqual(spiralOffset(19.07, 72.87, 0), [19.07, 72.87]);
  const seen = new Set();
  for (let i = 1; i <= 400; i++) {
    const [lat, lon] = spiralOffset(19.07, 72.87, i);
    const metres = Math.hypot((lat - 19.07) * 111320, (lon - 72.87) * 111320 * Math.cos((19.07 * Math.PI) / 180));
    assert.ok(Math.abs(metres - 150 * Math.sqrt(i)) < 1, `index ${i} at ${metres} m`);
    seen.add(`${lat.toFixed(5)},${lon.toFixed(5)}`);
  }
  assert.equal(seen.size, 400, 'no two companies share a spot');
});

test('business tiles cover the view from the centre outwards', async () => {
  const { tilesForView, TILE_DEG } = await import('./businesses.js');
  const tiles = tilesForView({ lat: 19.065, lon: 72.835 }, null, 9);
  assert.equal(tiles.length, 9);
  assert.deepEqual(tiles[0], [1906, 7283], 'centre tile first');
  const keys = new Set(tiles.map((t) => t.join('_')));
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) assert.ok(keys.has(`${1906 + di}_${7283 + dj}`));
  const narrow = tilesForView({ lat: 19.065, lon: 72.835 }, { west: 72.83, east: 72.84, south: 19.06, north: 19.07 }, 9);
  assert.ok(narrow.every(([i, j]) => i * TILE_DEG <= 19.07 && j * TILE_DEG <= 72.84), 'tiles outside the view are skipped');
});

test('presentation framing pulls back for wide events and leans in for buildings', async () => {
  const { framingFor } = await import('./presentation.js');
  assert.deepEqual(framingFor({ height: 900000 }), { pitch: -75, range: 900000 });
  assert.deepEqual(framingFor({ height: 60000 }), { pitch: -55, range: 60000 });
  assert.deepEqual(framingFor({ height: 4000 }), { pitch: -35, range: 4000 });
  assert.deepEqual(framingFor({ height: 200 }), { pitch: -35, range: 1500 });
});
