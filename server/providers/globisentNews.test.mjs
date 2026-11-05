import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobisentNewsMiddleware } from './globisentNews.js';

function call(middleware, url) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); },
    };
    middleware({ method: 'GET', url }, res, () => resolve({ status: 'next' }));
  });
}

const rss = `<rss><channel><item><title>Fallback headline - Pub</title><link>https://news.google.com/rss/articles/x</link>
  <pubDate>Thu, 05 Nov 2026 07:00:00 GMT</pubDate><source url="https://pub.example">Pub</source></item></channel></rss>`;

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const { status = 200, body } = handler(url);
    return { status, ok: status >= 200 && status < 300, text: async () => body };
  };
  return { impl, calls };
}

const noSleep = async () => {};

test('serves GDELT articles and caches repeat requests', async () => {
  const { impl, calls } = fakeFetch(() => ({
    body: JSON.stringify({ articles: [{ title: 'Live', url: 'https://a.example/1', domain: 'a.example' }] }),
  }));
  const mw = createGlobisentNewsMiddleware({ fetchImpl: impl, sleep: noSleep });
  const first = await call(mw, '/?category=technology&region=india');
  assert.equal(first.status, 200);
  assert.equal(first.body.provider, 'gdelt');
  assert.equal(first.body.articles.length, 1);
  const second = await call(mw, '/?category=technology&region=india');
  assert.equal(second.body.cached, true);
  assert.equal(calls.length, 1);
});

test('falls back to Google News when GDELT rate-limits, then skips GDELT while cooling down', async () => {
  const { impl, calls } = fakeFetch((url) =>
    url.includes('gdeltproject') ? { status: 429, body: 'Please limit requests' } : { body: rss });
  const mw = createGlobisentNewsMiddleware({ fetchImpl: impl, sleep: noSleep });
  const result = await call(mw, '/?category=sports');
  assert.equal(result.status, 200);
  assert.equal(result.body.provider, 'google-news');
  assert.equal(result.body.articles[0].title, 'Fallback headline');
  await call(mw, '/?category=health');
  assert.equal(calls.filter((u) => u.includes('gdeltproject')).length, 1);
});

test('returns a JSON error when every provider fails', async () => {
  const { impl } = fakeFetch(() => ({ status: 503, body: 'down' }));
  const mw = createGlobisentNewsMiddleware({ fetchImpl: impl, sleep: noSleep });
  const result = await call(mw, '/?category=world');
  assert.equal(result.status, 502);
  assert.match(result.body.error, /HTTP 503/);
});

test('rejects unknown categories by falling back to the default', async () => {
  const { impl, calls } = fakeFetch(() => ({ body: rss }));
  const mw = createGlobisentNewsMiddleware({ fetchImpl: impl, sleep: noSleep });
  const result = await call(mw, '/?category=__proto__&region=mars');
  assert.deepEqual(result.body.filters, { category: 'all', region: 'global', search: '' });
  assert.ok(calls.length >= 1);
});
