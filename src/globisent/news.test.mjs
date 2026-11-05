import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNewsUrl, normalizeNewsResponse, NEWS_CATEGORIES } from './news.js';

test('news categories include broad global topics', () => {
  assert.ok(Object.hasOwn(NEWS_CATEGORIES, 'all'));
  assert.ok(Object.hasOwn(NEWS_CATEGORIES, 'technology'));
  assert.ok(Object.hasOwn(NEWS_CATEGORIES, 'disasters'));
  assert.ok(Object.hasOwn(NEWS_CATEGORIES, 'cybersecurity'));
  assert.ok(Object.hasOwn(NEWS_CATEGORIES, 'demographics'));
  assert.ok(Object.hasOwn(NEWS_CATEGORIES, 'travel'));
});

test('buildNewsUrl constrains the article window and supports India focus', () => {
  const url = new URL(buildNewsUrl({ category: 'technology', region: 'india', search: 'AI safety' }));
  assert.equal(url.hostname, 'api.gdeltproject.org');
  assert.equal(url.searchParams.get('mode'), 'artlist');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('timespan'), '1d');
  assert.match(url.searchParams.get('query'), /India/);
  assert.match(url.searchParams.get('query'), /AI safety/);
  assert.doesNotMatch(url.searchParams.get('query'), /\bAND\b/);
});

test('buildNewsUrl safely falls back for an unknown category', () => {
  const url = new URL(buildNewsUrl({ category: 'not-a-real-category' }));
  assert.match(url.searchParams.get('query'), /agriculture/);
  assert.match(url.searchParams.get('query'), /entertainment/);
});

test('normalizeNewsResponse deduplicates and rejects unsafe or incomplete links', () => {
  const rows = normalizeNewsResponse({ articles: [
    { title: 'Valid report', url: 'https://publisher.example/story', domain: 'publisher.example', seendate: '20261104T120000Z' },
    { title: 'Duplicate report', url: 'https://publisher.example/story' },
    { title: 'Unsafe protocol', url: 'javascript:alert(1)' },
    { title: '', url: 'https://publisher.example/empty' },
    { title: 'Valid report 2', url: 'https://other.example/story', seendate: 'not-a-date' },
  ] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].publishedAt, '2026-11-04T12:00:00.000Z');
  assert.equal(rows[1].publishedAt, null);
});

test('multi-word category terms are quoted so GDELT keeps the OR grouping', async () => {
  const { quoteMultiWordTerms } = await import('./news.js');
  assert.equal(quoteMultiWordTerms('(a OR interest rates OR "x y")'), '(a OR "interest rates" OR "x y")');
  const query = new URL(buildNewsUrl({ category: 'economy' })).searchParams.get('query');
  assert.match(query, /"interest rates"/);
  assert.match(query, /"central bank"/);
});

test('Google News RSS fallback is parsed into safe, attributed rows', async () => {
  const { parseGoogleNewsRss, buildGoogleNewsUrl } = await import('./news.js');
  const xml = `<rss><channel><item><title>Big story &amp; more - Example Times</title>
    <link>https://news.google.com/rss/articles/abc?oc=5</link>
    <pubDate>Thu, 05 Nov 2026 07:05:06 GMT</pubDate>
    <source url="https://www.example-times.com">Example Times</source></item>
    <item><title>Bad</title><link>javascript:alert(1)</link></item></channel></rss>`;
  const rows = normalizeNewsResponse(parseGoogleNewsRss(xml));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Big story & more');
  assert.equal(rows[0].source, 'example-times.com');
  assert.equal(rows[0].publishedAt, '2026-11-05T07:05:06.000Z');
  const url = new URL(buildGoogleNewsUrl({ category: 'sports', region: 'india' }));
  assert.equal(url.searchParams.get('gl'), 'IN');
  assert.match(url.searchParams.get('q'), /when:1d$/);
});

test('a search with "All topics" queries the phrase alone', () => {
  const query = new URL(buildNewsUrl({ category: 'all', search: 'New Delhi' })).searchParams.get('query');
  assert.equal(query, '"New Delhi"');
});
