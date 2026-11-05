/**
 * GLOBISENT world markets: GET /api/globisent/markets
 *
 * Major stock exchanges (with their location, main index and whether the
 * market is open right now), global indices, commodities, currencies and
 * crypto, from keyless public endpoints:
 *  - Yahoo Finance chart "spark" endpoint for indices, futures and FX
 *    (exchange-delayed, typically ~15 min; unofficial, personal use only),
 *  - CoinGecko simple price API for crypto (24 h change).
 * One upstream refresh per minute at most, shared by every browser tab; a
 * failed refresh keeps serving the last good snapshot for up to 30 minutes.
 */

const USER_AGENT = 'GLOBISENT/1.0 (local workstation; markets)';
const TIMEOUT_MS = 15000;
const FRESH_MS = 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
const SPARK_BATCH = 20;

/** Exchanges drawn on the globe. `index` is the headline index; `extra` are shown in the popup. */
export const MARKET_EXCHANGES = Object.freeze([
  { id: 'nyse', name: 'NYSE · Nasdaq', city: 'New York', country: 'United States', lat: 40.7069, lon: -74.0113, index: '^GSPC', extra: ['^DJI', '^IXIC', '^VIX'], news: 'Wall Street stocks' },
  { id: 'tsx', name: 'Toronto Stock Exchange', city: 'Toronto', country: 'Canada', lat: 43.6487, lon: -79.3817, index: '^GSPTSE', extra: [], news: 'TSX stocks' },
  { id: 'bmv', name: 'Bolsa Mexicana de Valores', city: 'Mexico City', country: 'Mexico', lat: 19.427, lon: -99.1676, index: '^MXX', extra: [], news: 'Mexican stock market' },
  { id: 'b3', name: 'B3', city: 'São Paulo', country: 'Brazil', lat: -23.5475, lon: -46.6361, index: '^BVSP', extra: [], news: 'Ibovespa' },
  { id: 'lse', name: 'London Stock Exchange', city: 'London', country: 'United Kingdom', lat: 51.5155, lon: -0.099, index: '^FTSE', extra: [], news: 'FTSE 100' },
  { id: 'euronext', name: 'Euronext Paris', city: 'Paris', country: 'France', lat: 48.8698, lon: 2.3412, index: '^FCHI', extra: ['^STOXX50E'], news: 'CAC 40' },
  { id: 'xetra', name: 'Frankfurt Stock Exchange', city: 'Frankfurt', country: 'Germany', lat: 50.1155, lon: 8.6722, index: '^GDAXI', extra: [], news: 'DAX stocks' },
  { id: 'six', name: 'SIX Swiss Exchange', city: 'Zurich', country: 'Switzerland', lat: 47.3725, lon: 8.5345, index: '^SSMI', extra: [], news: 'Swiss stocks SMI' },
  { id: 'jse', name: 'Johannesburg Stock Exchange', city: 'Johannesburg', country: 'South Africa', lat: -26.1076, lon: 28.0567, index: '^J203.JO', extra: [], news: 'JSE stocks' },
  { id: 'tadawul', name: 'Saudi Exchange (Tadawul)', city: 'Riyadh', country: 'Saudi Arabia', lat: 24.7136, lon: 46.6753, index: '^TASI.SR', extra: [], news: 'Tadawul' },
  { id: 'nse', name: 'NSE · BSE', city: 'Mumbai', country: 'India', lat: 18.9293, lon: 72.8333, index: '^NSEI', extra: ['^BSESN'], news: 'Sensex Nifty', india: true },
  { id: 'sgx', name: 'Singapore Exchange', city: 'Singapore', country: 'Singapore', lat: 1.2789, lon: 103.85, index: '^STI', extra: [], news: 'Singapore stocks' },
  { id: 'bursa', name: 'Bursa Malaysia', city: 'Kuala Lumpur', country: 'Malaysia', lat: 3.1428, lon: 101.6941, index: '^KLSE', extra: [], news: 'Bursa Malaysia' },
  { id: 'idx', name: 'Indonesia Stock Exchange', city: 'Jakarta', country: 'Indonesia', lat: -6.2238, lon: 106.8085, index: '^JKSE', extra: [], news: 'Jakarta stocks' },
  { id: 'hkex', name: 'Hong Kong Exchanges', city: 'Hong Kong', country: 'Hong Kong', lat: 22.2836, lon: 114.158, index: '^HSI', extra: [], news: 'Hang Seng' },
  { id: 'sse', name: 'Shanghai Stock Exchange', city: 'Shanghai', country: 'China', lat: 31.2363, lon: 121.5011, index: '000001.SS', extra: [], news: 'China stocks Shanghai' },
  { id: 'twse', name: 'Taiwan Stock Exchange', city: 'Taipei', country: 'Taiwan', lat: 25.0339, lon: 121.5645, index: '^TWII', extra: [], news: 'Taiwan stocks' },
  { id: 'krx', name: 'Korea Exchange', city: 'Seoul', country: 'South Korea', lat: 37.5226, lon: 126.924, index: '^KS11', extra: [], news: 'KOSPI' },
  { id: 'tse', name: 'Tokyo Stock Exchange', city: 'Tokyo', country: 'Japan', lat: 35.6826, lon: 139.7783, index: '^N225', extra: [], news: 'Nikkei' },
  { id: 'asx', name: 'Australian Securities Exchange', city: 'Sydney', country: 'Australia', lat: -33.865, lon: 151.2094, index: '^AXJO', extra: [], news: 'ASX 200' },
  { id: 'nzx', name: 'NZX', city: 'Wellington', country: 'New Zealand', lat: -41.2865, lon: 174.7762, index: '^NZ50', extra: [], news: 'NZX 50' },
]);

/** Friendly labels; Yahoo's own names are long or truncated. */
export const SYMBOL_LABELS = Object.freeze({
  '^GSPC': 'S&P 500', '^DJI': 'Dow Jones', '^IXIC': 'Nasdaq', '^VIX': 'VIX (fear index)', '^GSPTSE': 'S&P/TSX',
  '^MXX': 'IPC Mexico', '^BVSP': 'Ibovespa', '^FTSE': 'FTSE 100', '^FCHI': 'CAC 40', '^STOXX50E': 'Euro Stoxx 50',
  '^GDAXI': 'DAX', '^SSMI': 'SMI', '^J203.JO': 'JSE All Share', '^TASI.SR': 'Tadawul (TASI)', '^NSEI': 'Nifty 50',
  '^BSESN': 'Sensex', '^STI': 'Straits Times', '^KLSE': 'KLCI', '^JKSE': 'Jakarta Composite', '^HSI': 'Hang Seng',
  '000001.SS': 'Shanghai Composite', '^TWII': 'TAIEX', '^KS11': 'KOSPI', '^N225': 'Nikkei 225', '^AXJO': 'ASX 200',
  '^NZ50': 'NZX 50', '^TNX': 'US 10-year yield',
  'GC=F': 'Gold', 'SI=F': 'Silver', 'CL=F': 'Crude oil (WTI)', 'BZ=F': 'Crude oil (Brent)', 'NG=F': 'Natural gas', 'HG=F': 'Copper',
  'USDINR=X': 'USD / INR', 'EURUSD=X': 'EUR / USD', 'GBPUSD=X': 'GBP / USD', 'USDJPY=X': 'USD / JPY', 'USDCNY=X': 'USD / CNY',
  'DX-Y.NYB': 'US Dollar Index',
});

export const MARKET_GROUPS = Object.freeze([
  { id: 'commodities', title: 'Commodities', symbols: ['GC=F', 'SI=F', 'CL=F', 'BZ=F', 'NG=F', 'HG=F'] },
  { id: 'fx', title: 'Currencies', symbols: ['USDINR=X', 'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'USDCNY=X', 'DX-Y.NYB'] },
  { id: 'rates', title: 'Bonds & volatility', symbols: ['^TNX', '^VIX'] },
]);

export const CRYPTO = Object.freeze([
  { id: 'bitcoin', label: 'Bitcoin', symbol: 'BTC' },
  { id: 'ethereum', label: 'Ethereum', symbol: 'ETH' },
  { id: 'solana', label: 'Solana', symbol: 'SOL' },
  { id: 'ripple', label: 'XRP', symbol: 'XRP' },
  { id: 'binancecoin', label: 'BNB', symbol: 'BNB' },
]);

export function allSymbols() {
  const set = new Set();
  for (const ex of MARKET_EXCHANGES) [ex.index, ...ex.extra].forEach((s) => set.add(s));
  for (const group of MARKET_GROUPS) group.symbols.forEach((s) => set.add(s));
  return [...set];
}

const finite = (value) => (Number.isFinite(value) ? value : null);

/** Normalize one Yahoo spark result into a quote, or null when it has no price. */
export function parseSparkQuote(result, nowMs = Date.now()) {
  const meta = result?.response?.[0]?.meta;
  const price = finite(meta?.regularMarketPrice);
  if (!meta || price === null) return null;
  const previous = finite(meta.chartPreviousClose) ?? finite(meta.previousClose);
  let changePct = finite(meta.regularMarketChangePercent);
  if (changePct === null && previous) changePct = ((price - previous) / previous) * 100;
  const change = previous !== null ? price - previous : finite(meta.fulldayChange);
  const regular = meta.currentTradingPeriod?.regular;
  const nowSec = nowMs / 1000;
  const open = Number.isFinite(regular?.start) && Number.isFinite(regular?.end)
    ? regular.start <= nowSec && nowSec < regular.end
    : null;
  const symbol = String(result.symbol ?? meta.symbol);
  return {
    symbol,
    label: SYMBOL_LABELS[symbol] ?? meta.shortName ?? meta.longName ?? symbol,
    price,
    change: finite(change),
    changePct: finite(changePct),
    previousClose: previous,
    dayHigh: finite(meta.regularMarketDayHigh),
    dayLow: finite(meta.regularMarketDayLow),
    yearHigh: finite(meta.fiftyTwoWeekHigh),
    yearLow: finite(meta.fiftyTwoWeekLow),
    currency: meta.currency ?? null,
    timezone: meta.exchangeTimezoneName ?? null,
    time: Number.isFinite(meta.regularMarketTime) ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    open,
    session: Number.isFinite(regular?.start) && Number.isFinite(regular?.end)
      ? { start: new Date(regular.start * 1000).toISOString(), end: new Date(regular.end * 1000).toISOString() }
      : null,
  };
}

export function createGlobisentMarketsMiddleware({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let snapshot = null;
  let snapshotAt = 0;
  let pending = null;

  async function getJson(url) {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return JSON.parse(await response.text());
  }

  async function loadQuotes() {
    const symbols = allSymbols();
    const batches = [];
    for (let i = 0; i < symbols.length; i += SPARK_BATCH) batches.push(symbols.slice(i, i + SPARK_BATCH));
    const quotes = new Map();
    const errors = [];
    const results = await Promise.allSettled(batches.map((batch) => getJson(
      `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${batch.map(encodeURIComponent).join(',')}&range=1d&interval=1d`,
    )));
    for (const result of results) {
      if (result.status === 'rejected') {
        errors.push(result.reason?.message ?? 'Yahoo Finance unavailable');
        continue;
      }
      for (const item of result.value?.spark?.result ?? []) {
        const quote = parseSparkQuote(item, now());
        if (quote) quotes.set(quote.symbol, quote);
      }
    }
    if (!quotes.size && errors.length) throw new Error(errors[0]);
    return { quotes, errors };
  }

  async function loadCrypto() {
    const data = await getJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${CRYPTO.map((c) => c.id).join(',')}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`,
    );
    return CRYPTO.filter((c) => finite(data?.[c.id]?.usd) !== null).map((c) => ({
      symbol: c.symbol,
      label: c.label,
      price: data[c.id].usd,
      changePct: finite(data[c.id].usd_24h_change),
      currency: 'USD',
      time: Number.isFinite(data[c.id].last_updated_at) ? new Date(data[c.id].last_updated_at * 1000).toISOString() : null,
      open: true,
    }));
  }

  async function build() {
    const [quoteResult, cryptoResult] = await Promise.allSettled([loadQuotes(), loadCrypto()]);
    if (quoteResult.status === 'rejected' && cryptoResult.status === 'rejected') throw quoteResult.reason;
    const quotes = quoteResult.status === 'fulfilled' ? quoteResult.value.quotes : new Map();
    const errors = [
      ...(quoteResult.status === 'fulfilled' ? quoteResult.value.errors : [`Stocks: ${quoteResult.reason?.message ?? 'unavailable'}`]),
      ...(cryptoResult.status === 'rejected' ? [`Crypto: ${cryptoResult.reason?.message ?? 'unavailable'}`] : []),
    ];
    const exchanges = MARKET_EXCHANGES.map((ex) => {
      const index = quotes.get(ex.index) ?? null;
      return {
        id: ex.id, name: ex.name, city: ex.city, country: ex.country, lat: ex.lat, lon: ex.lon,
        news: ex.news, india: Boolean(ex.india),
        index,
        extra: ex.extra.map((s) => quotes.get(s)).filter(Boolean),
        open: index?.open ?? null,
        timezone: index?.timezone ?? null,
      };
    });
    const groups = MARKET_GROUPS.map((group) => ({
      id: group.id,
      title: group.title,
      items: group.symbols.map((s) => quotes.get(s)).filter(Boolean),
    }));
    groups.push({ id: 'crypto', title: 'Crypto · 24 h', items: cryptoResult.status === 'fulfilled' ? cryptoResult.value : [] });
    return {
      generatedAt: new Date(now()).toISOString(),
      stale: false,
      exchanges,
      groups,
      errors,
      sources: [
        { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/', note: 'Exchange-delayed quotes (about 15 minutes)' },
        { name: 'CoinGecko', url: 'https://www.coingecko.com/', note: 'Crypto prices, 24 h change' },
      ],
    };
  }

  async function getMarkets() {
    if (snapshot && now() - snapshotAt < FRESH_MS) return snapshot;
    if (!pending) {
      pending = build()
        .then((value) => {
          snapshot = value;
          snapshotAt = now();
          return value;
        })
        .finally(() => {
          pending = null;
        });
    }
    try {
      return await pending;
    } catch (error) {
      if (snapshot && now() - snapshotAt < STALE_MS) return { ...snapshot, stale: true, errors: [error?.message ?? 'refresh failed'] };
      throw error;
    }
  }

  async function middleware(req, res, next) {
    if (req.method !== 'GET') return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.statusCode = 200;
      res.end(JSON.stringify(await getMarkets()));
    } catch (error) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: `Market data unavailable: ${error?.message ?? 'upstream error'}` }));
    }
  }
  middleware.getMarkets = getMarkets;
  return middleware;
}

let sharedMarkets = null;
/** One markets service per process, shared by the route and the tour. */
export function sharedGlobisentMarkets() {
  sharedMarkets ??= createGlobisentMarketsMiddleware();
  return sharedMarkets;
}

export function globisentMarketsProxy() {
  const middleware = sharedGlobisentMarkets();
  const install = (server) => {
    server.middlewares.use('/api/globisent/markets', middleware);
  };
  return {
    name: 'globisent-markets-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
