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
