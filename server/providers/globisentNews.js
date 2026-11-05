/**
 * GLOBISENT News Desk proxy: GET /api/globisent/news?category=&region=&q=
 *
 * The browser used to call GDELT directly. GDELT allows one request every
 * five seconds per IP and answers faster traffic with an HTTP 429 that carries
 * no CORS header, so the browser only saw "Failed to fetch". This proxy:
 *   - spaces upstream GDELT requests at least GDELT_MIN_GAP_MS apart,
 *   - caches each filter combination for CACHE_TTL_MS and coalesces duplicates,
 *   - backs off from GDELT for GDELT_COOLDOWN_MS after a 429 or network failure,
 *   - falls back to the Google News RSS search feed, then to a stale cache entry.
 */
import {
  buildGoogleNewsUrl,
  buildNewsUrl,
  normalizeNewsFilters,
  normalizeNewsResponse,
  parseGoogleNewsRss,
} from '../../src/globisent/news.js';

export const CACHE_TTL_MS = 4 * 60 * 1000;
const STALE_LIMIT_MS = 6 * 60 * 60 * 1000;
const GDELT_MIN_GAP_MS = 5500;
const GDELT_COOLDOWN_MS = 2 * 60 * 1000;
const GDELT_TIMEOUT_MS = 15000;
const FALLBACK_TIMEOUT_MS = 12000;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 200;
const USER_AGENT = 'GLOBISENT-NewsDesk/1.0 (+local workstation)';

async function fetchText(fetchImpl, url, timeoutMs, accept) {
  const response = await fetchImpl(url, {
    headers: { Accept: accept, 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error('response too large');
  return { status: response.status, ok: response.ok, text };
}

export function createGlobisentNewsMiddleware({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const cache = new Map();
  const inflight = new Map();
  let gdeltQueue = Promise.resolve();
  let gdeltNextAt = 0;
  let gdeltCooldownUntil = 0;

  // Serialize GDELT calls so this process never exceeds its one-per-5s limit.
  function throttledGdelt(url) {
    const run = gdeltQueue.then(async () => {
      const wait = gdeltNextAt - now();
      if (wait > 0) await sleep(wait);
      try {
        return await fetchText(fetchImpl, url, GDELT_TIMEOUT_MS, 'application/json');
      } finally {
        gdeltNextAt = now() + GDELT_MIN_GAP_MS;
      }
    });
    gdeltQueue = run.catch(() => {});
    return run;
  }

  async function fromGdelt(filters) {
    if (now() < gdeltCooldownUntil) throw new Error('GDELT cooling down after rate limit');
    try {
      const { status, ok, text } = await throttledGdelt(buildNewsUrl(filters));
      if (status === 429) throw new Error('GDELT rate limit (HTTP 429)');
      if (!ok) throw new Error(`GDELT HTTP ${status}`);
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        // GDELT reports query errors as plain text with HTTP 200.
        throw new Error(`GDELT: ${text.slice(0, 160).trim() || 'invalid response'}`);
      }
      return normalizeNewsResponse(payload);
    } catch (error) {
      gdeltCooldownUntil = now() + GDELT_COOLDOWN_MS;
      throw error;
    }
  }

  async function fromGoogleNews(filters) {
    const { ok, status, text } = await fetchText(
      fetchImpl,
      buildGoogleNewsUrl(filters),
      FALLBACK_TIMEOUT_MS,
      'application/rss+xml, application/xml, text/xml',
    );
    if (!ok) throw new Error(`Google News HTTP ${status}`);
    return normalizeNewsResponse(parseGoogleNewsRss(text));
  }

  async function load(filters, key) {
    const errors = [];
    for (const [provider, loader] of [
      ['gdelt', fromGdelt],
      ['google-news', fromGoogleNews],
    ]) {
      try {
        const articles = await loader(filters);
        // An empty GDELT result is valid, but give the fallback a chance first.
        if (!articles.length && provider === 'gdelt') {
          errors.push('GDELT returned no articles');
          continue;
        }
        const entry = { provider, articles, fetchedAt: now() };
        cache.set(key, entry);
        if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        return { ...entry, stale: false };
      } catch (error) {
        errors.push(error?.message ?? String(error));
      }
    }
    const cached = cache.get(key);
    if (cached && now() - cached.fetchedAt < STALE_LIMIT_MS) {
      return { ...cached, stale: true, warnings: errors };
    }
    const failure = new Error(errors.join('; ') || 'No news provider available');
    failure.statusCode = 502;
    throw failure;
  }

  /** Same cache/throttle as the HTTP route, for in-process callers (the AI agent). */
  async function getNews({ category = 'all', region = 'global', search = '' } = {}) {
    const filters = normalizeNewsFilters({ category, region, search });
    const key = JSON.stringify(filters);
    const cached = cache.get(key);
    if (cached && now() - cached.fetchedAt < CACHE_TTL_MS) return { ...cached, stale: false, cached: true, filters };
    if (!inflight.has(key)) inflight.set(key, load(filters, key).finally(() => inflight.delete(key)));
    return { ...(await inflight.get(key)), filters };
  }

  async function globisentNewsMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const filters = normalizeNewsFilters({
      category: params.get('category') ?? 'all',
      region: params.get('region') ?? 'global',
      search: params.get('q') ?? '',
    });
    const key = JSON.stringify(filters);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const cached = cache.get(key);
      let result;
      if (cached && now() - cached.fetchedAt < CACHE_TTL_MS) {
        result = { ...cached, stale: false, cached: true };
      } else {
        if (!inflight.has(key)) {
          inflight.set(key, load(filters, key).finally(() => inflight.delete(key)));
        }
        result = await inflight.get(key);
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ ...result, filters }));
    } catch (error) {
      res.statusCode = error?.statusCode ?? 502;
      res.end(JSON.stringify({ error: error?.message ?? 'News providers unavailable', filters }));
    }
  }
  globisentNewsMiddleware.getNews = getNews;
  return globisentNewsMiddleware;
}

let sharedNews = null;
/** One news service per server process, shared by the route and the agent. */
export function sharedGlobisentNews() {
  sharedNews ??= createGlobisentNewsMiddleware();
  return sharedNews;
}

export function globisentNewsProxy() {
  const middleware = sharedGlobisentNews();
  const install = (server) => {
    server.middlewares.use('/api/globisent/news', middleware);
  };
  return {
    name: 'globisent-news-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
