/**
 * GLOBISENT World Markets: the MARKETS hub tab, stock-exchange markers on the
 * globe (green = index up today, red = down, bright ring = market open now)
 * and an exchange popup with index details and local market news.
 * Data comes from /api/globisent/markets (one shared server snapshot, at most
 * one upstream refresh per minute).
 */
import * as Cesium from 'cesium';
import { renderSection } from './domainPopup.js';

/**
 * The app renders on demand (requestRenderMode). Entity changes made now, or
 * in a preRender pass, only reach the screen on a later frame, so ask for a
 * few frames instead of one.
 */
export function nudgeRender(viewer) {
  const request = () => viewer?.scene?.requestRender?.();
  request();
  setTimeout(request, 50);
  setTimeout(request, 250);
}

const ENDPOINT = '/api/globisent/markets';
const REFRESH_MS = 60 * 1000;
const STORAGE_KEY = 'globisent.marketsOnGlobe';
const UP = '#5ef0a3';
const DOWN = '#ff6a78';
const FLAT = '#9fb6c3';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

export function formatPrice(value, symbol = '') {
  if (!Number.isFinite(value)) return '—';
  const digits = /=X$/.test(symbol) ? 4 : Math.abs(value) < 10 ? 3 : 2;
  return value.toLocaleString('en-US', { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits });
}

export function formatChange(pct) {
  if (!Number.isFinite(pct)) return '—';
  const arrow = pct > 0.005 ? '▲' : pct < -0.005 ? '▼' : '■';
  return `${arrow} ${Math.abs(pct).toFixed(2)}%`;
}

export function trend(pct) {
  if (!Number.isFinite(pct)) return 'flat';
  return pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : 'flat';
}

function localTime(timezone, iso = null) {
  if (!timezone) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', weekday: 'short' })
      .format(iso ? new Date(iso) : new Date());
  } catch {
    return '—';
  }
}

function readOnGlobe() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeOnGlobe(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch { /* private mode: still works for this session */ }
}

/** Shared poller: fetches only while someone needs data and the page is visible. */
function createMarketsService() {
  const listeners = new Set();
  let data = null;
  let error = null;
  let timer = 0;
  let inflight = null;
  let demand = 0;

  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const response = await fetch(ENDPOINT, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || payload.error) throw new Error(payload?.error ?? `HTTP ${response.status}`);
        data = payload;
        error = null;
      } catch (err) {
        error = err?.name === 'TimeoutError' ? 'request timed out' : err?.message ?? 'network error';
      } finally {
        inflight = null;
      }
      for (const listener of listeners) listener({ data, error });
    })();
    return inflight;
  }

  function schedule() {
    window.clearInterval(timer);
    timer = 0;
    if (demand > 0) {
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') refresh();
      }, REFRESH_MS);
    }
  }

  const onVisibility = () => {
    if (demand > 0 && document.visibilityState === 'visible') refresh();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    get data() { return data; },
    get error() { return error; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Register interest; returns a release function. */
    want() {
      demand += 1;
      schedule();
      if (!data || Date.now() - Date.parse(data.generatedAt) > REFRESH_MS) refresh();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        demand = Math.max(0, demand - 1);
        schedule();
      };
    },
    refresh,
    destroy() {
      window.clearInterval(timer);
      listeners.clear();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

/** Exchange markers on the globe. */
function createMarketGlobeLayer({ viewer, onSelect }) {
  const source = new Cesium.CustomDataSource('globisent-markets');
  viewer.dataSources.add(source);
  const entities = new Map();

  function update(data) {
    for (const exchange of data?.exchanges ?? []) {
      const pct = exchange.index?.changePct;
      const color = Cesium.Color.fromCssColorString(trend(pct) === 'up' ? UP : trend(pct) === 'down' ? DOWN : FLAT);
      const open = exchange.open === true;
      const text = `${exchange.index?.label ?? exchange.name}  ${formatChange(pct)}${open ? '  ● OPEN' : ''}`;
      let entity = entities.get(exchange.id);
      if (!entity) {
        entity = source.entities.add({
          id: `globisent-market-${exchange.id}`,
          name: exchange.name,
          position: Cesium.Cartesian3.fromDegrees(exchange.lon, exchange.lat, 0),
          point: {
            pixelSize: 11,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(2e5, 1.4, 2.5e7, 0.8),
          },
          label: {
            font: '600 12px "JetBrains Mono", Consolas, monospace',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            showBackground: true,
            backgroundColor: new Cesium.Color(0.02, 0.07, 0.11, 0.72),
            backgroundPadding: new Cesium.Cartesian2(6, 4),
            pixelOffset: new Cesium.Cartesian2(0, -18),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(2e5, 1.1, 2.5e7, 0.72),
          },
        });
        entity.globisentMarket = exchange.id;
        entity.globisentOwned = true;
        entities.set(exchange.id, entity);
      }
      entity.point.color = color;
      entity.point.outlineColor = open ? Cesium.Color.WHITE : new Cesium.Color(0.05, 0.1, 0.14, 0.9);
      entity.label.text = text;
      entity.label.fillColor = color;
    }
    visibilityDirty = true;
    nudgeRender(viewer);
  }

  // Markers ignore depth so terrain and 3D buildings never bury them; hide the
  // ones on the far side of the Earth instead, re-checked when the camera moves.
  const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, Cesium.Cartesian3.ZERO);
  const lastCamera = new Cesium.Cartesian3(NaN, NaN, NaN);
  let visibilityDirty = true;
  function updateVisibility() {
    const cameraPosition = viewer.camera.positionWC;
    if (!visibilityDirty && Cesium.Cartesian3.equalsEpsilon(cameraPosition, lastCamera, 0, 1)) return;
    Cesium.Cartesian3.clone(cameraPosition, lastCamera);
    visibilityDirty = false;
    occluder.cameraPosition = cameraPosition;
    const time = viewer.clock.currentTime;
    let changed = false;
    for (const entity of entities.values()) {
      const position = entity.position?.getValue(time);
      const visible = Boolean(position) && occluder.isPointVisible(position);
      if (entity.show !== visible) {
        entity.show = visible;
        changed = true;
      }
    }
    if (changed) setTimeout(() => nudgeRender(viewer), 0);
  }
  const removePreRender = viewer.scene.preRender.addEventListener(updateVisibility);

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    if (!source.show) return;
    let picked = null;
    try {
      picked = viewer.scene.pick(click.position);
    } catch { /* nothing pickable */ }
    const id = picked?.id?.globisentMarket;
    if (id) onSelect(id);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  return {
    update,
    setVisible(on) {
      source.show = Boolean(on);
      nudgeRender(viewer);
    },
    destroy() {
      removePreRender();
      handler.destroy();
      viewer.dataSources.remove(source, true);
    },
  };
}

function quoteStats(quote, exchange) {
  const items = [
    { label: 'Price', value: `${formatPrice(quote.price, quote.symbol)}${quote.currency ? ` ${quote.currency}` : ''}` },
    { label: 'Today', value: formatChange(quote.changePct), detail: Number.isFinite(quote.change) ? `${quote.change >= 0 ? '+' : ''}${formatPrice(quote.change, quote.symbol)}` : '' },
    { label: 'Day range', value: `${formatPrice(quote.dayLow, quote.symbol)} – ${formatPrice(quote.dayHigh, quote.symbol)}` },
    { label: 'Previous close', value: formatPrice(quote.previousClose, quote.symbol) },
    { label: '52-week range', value: `${formatPrice(quote.yearLow, quote.symbol)} – ${formatPrice(quote.yearHigh, quote.symbol)}` },
  ];
  if (exchange) {
    items.push({ label: 'Local time', value: localTime(exchange.timezone), detail: exchange.timezone ?? '' });
    if (quote.session) {
      items.push({ label: 'Trading session', value: `${localTime(exchange.timezone, quote.session.start)} – ${localTime(exchange.timezone, quote.session.end)}`, detail: 'Local exchange time' });
    }
  }
  items.push({ label: 'Last price at', value: quote.time ? new Date(quote.time).toLocaleString() : '—', detail: 'Exchange-delayed' });
  return items;
}

/** Popup with everything about one exchange. */
function createMarketPopup({ viewer, service }) {
  const overlay = el('div', 'gx-pop-overlay');
  overlay.hidden = true;
  const dialog = el('div', 'gx-pop');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  overlay.append(dialog);
  document.body.append(overlay);
  let request = null;

  function close() {
    request?.abort();
    request = null;
    overlay.hidden = true;
    dialog.replaceChildren();
  }

  async function open(id) {
    const exchange = service.data?.exchanges?.find((ex) => ex.id === id);
    if (!exchange) return;
    close();
    overlay.hidden = false;
    const controller = new AbortController();
    request = controller;

    const header = el('header', 'gx-pop-header');
    const titles = el('div');
    titles.append(el('div', 'gx-eyebrow', `STOCK EXCHANGE · ${exchange.city}, ${exchange.country}`));
    titles.append(el('h3', '', exchange.name));
    const state = exchange.open === true ? 'OPEN NOW' : exchange.open === false ? 'CLOSED' : 'HOURS UNKNOWN';
    titles.append(el('span', `gx-status ${exchange.open ? 'gx-status-map' : 'gx-status-next-integration'}`, state));
    const closeButton = el('button', 'gx-icon-button', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.addEventListener('click', close);
    header.append(titles, closeButton);

    const actions = el('div', 'gx-info-actions');
    const fly = el('button', '', 'FLY HERE');
    fly.type = 'button';
    fly.addEventListener('click', () => {
      close();
      viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(exchange.lon, exchange.lat, 18000), duration: 2.5 });
    });
    actions.append(fly);

    const body = el('div', 'gx-pop-body');
    if (exchange.index) {
      body.append(renderSection({ title: exchange.index.label, source: 'Yahoo Finance', sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(exchange.index.symbol)}`, kind: 'stats', items: quoteStats(exchange.index, exchange) }));
    } else {
      body.append(renderSection({ title: 'Main index', kind: 'error', error: 'no quote right now', items: [] }));
    }
    if (exchange.extra?.length) {
      body.append(renderSection({
        title: 'Other indices here',
        kind: 'stats',
        items: exchange.extra.map((q) => ({ label: q.label, value: formatPrice(q.price, q.symbol), detail: formatChange(q.changePct) })),
      }));
    }
    const loading = el('p', 'gx-pop-loading', 'Loading market news…');
    body.append(loading);

    dialog.setAttribute('aria-label', exchange.name);
    dialog.replaceChildren(header, actions, body);
    closeButton.focus();

    try {
      const params = new URLSearchParams({ category: 'all', region: exchange.india ? 'india' : 'global', q: exchange.news });
      const news = await fetch(`/api/globisent/news?${params}`, { signal: controller.signal }).then((r) => r.json());
      if (controller.signal.aborted) return;
      loading.replaceWith(renderSection(news?.error
        ? { title: 'Market news', kind: 'error', error: news.error, items: [] }
        : {
          title: `Market news · ${exchange.news}`,
          source: news?.provider === 'gdelt' ? 'GDELT' : 'Google News',
          sourceUrl: news?.provider === 'gdelt' ? 'https://www.gdeltproject.org/' : 'https://news.google.com/',
          kind: 'list',
          items: (news?.articles ?? []).slice(0, 8).map((a) => ({ label: a.title, url: a.url, detail: a.source, time: a.publishedAt })),
        }));
    } catch (error) {
      if (controller.signal.aborted) return;
      loading.textContent = `Market news unavailable: ${error?.message ?? 'network error'}`;
      loading.className = 'gx-pop-error';
    }
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  const onKey = (event) => {
    if (event.key === 'Escape' && !overlay.hidden) close();
  };
  document.addEventListener('keydown', onKey);

  return {
    open,
    close,
    destroy() {
      close();
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    },
  };
}

function quoteRow({ name, sub, quote, open = null, onClick = null }) {
  const row = el(onClick ? 'button' : 'div', `gx-mkt-row gx-mkt-${trend(quote?.changePct)}`);
  if (onClick) {
    row.type = 'button';
    row.addEventListener('click', onClick);
  }
  const left = el('span', 'gx-mkt-name');
  if (open !== null) {
    const dot = el('i', `gx-mkt-dot${open ? ' open' : ''}`);
    dot.title = open ? 'Market open now' : 'Market closed';
    left.append(dot);
  }
  const names = el('span');
  names.append(el('b', '', name));
  if (sub) names.append(el('small', '', sub));
  left.append(names);
  row.append(left, el('span', 'gx-mkt-price', quote ? formatPrice(quote.price, quote.symbol) : '—'), el('span', 'gx-mkt-change', quote ? formatChange(quote.changePct) : '—'));
  return row;
}

/**
 * Installs the MARKETS tab into `section` and the globe layer.
 * Returns { activate, deactivate, destroy }.
 */
export function createMarkets({ section, viewer }) {
  const service = createMarketsService();
  const popup = createMarketPopup({ viewer, service });
  let onGlobe = readOnGlobe();
  let globeLease = null;
  let tabLease = null;

  const globe = createMarketGlobeLayer({ viewer, onSelect: (id) => popup.open(id) });
  globe.setVisible(onGlobe);

  section.innerHTML = `
    <div class="gx-section-intro"><div><strong>WORLD MARKETS</strong><small>Stocks, commodities, currencies and crypto · exchange-delayed ~15 min · refreshes every minute</small></div><span class="gx-pulse" id="gx-mkt-state">LOADING</span></div>
    <div class="gx-mkt-controls">
      <label><input type="checkbox" id="gx-mkt-globe"> Show stock exchanges on the globe</label>
      <button type="button" id="gx-mkt-refresh">REFRESH</button>
    </div>
    <div class="gx-news-status" id="gx-mkt-status" role="status" aria-live="polite">Loading market data…</div>
    <div id="gx-mkt-body"></div>
    <p class="gx-footnote">Index, futures and FX quotes: Yahoo Finance (exchange-delayed, about 15 minutes; personal use). Crypto: CoinGecko. Green means up today, red down; a white ring on the globe marks a market that is open right now. Not investment advice.</p>`;

  const stateBadge = section.querySelector('#gx-mkt-state');
  const status = section.querySelector('#gx-mkt-status');
  const body = section.querySelector('#gx-mkt-body');
  const globeToggle = section.querySelector('#gx-mkt-globe');
  const refreshButton = section.querySelector('#gx-mkt-refresh');
  globeToggle.checked = onGlobe;

  function render({ data, error }) {
    if (data) globe.update(data);
    if (!data) {
      status.textContent = `Market data unavailable: ${error ?? 'no data yet'}. Try REFRESH in a minute.`;
      status.dataset.state = 'error';
      stateBadge.textContent = 'OFFLINE';
      return;
    }
    const openCount = data.exchanges.filter((ex) => ex.open === true).length;
    stateBadge.textContent = `${openCount} OPEN`;
    const notes = [];
    if (data.stale || error) notes.push('showing the last saved prices, live refresh failed');
    if (data.errors?.length) notes.push(data.errors.join('; '));
    status.textContent = `${data.exchanges.length} exchanges · ${openCount} open now · updated ${new Date(data.generatedAt).toLocaleTimeString()}${notes.length ? ` · ${notes.join(' · ')}` : ''}`;
    status.dataset.state = notes.length ? 'error' : 'ready';

    body.replaceChildren();
    const exchangesBox = el('section', 'gx-mkt-group');
    exchangesBox.append(el('div', 'gx-pop-label', 'STOCK EXCHANGES · click for details'));
    const sorted = [...data.exchanges].sort((a, b) => (b.open === true) - (a.open === true));
    for (const exchange of sorted) {
      exchangesBox.append(quoteRow({
        name: exchange.index?.label ?? exchange.name,
        sub: `${exchange.city} · ${exchange.open ? 'open' : 'closed'} · ${localTime(exchange.timezone)}`,
        quote: exchange.index,
        open: exchange.open === true,
        onClick: () => popup.open(exchange.id),
      }));
    }
    body.append(exchangesBox);
    for (const group of data.groups ?? []) {
      const box = el('section', 'gx-mkt-group');
      box.append(el('div', 'gx-pop-label', group.title.toUpperCase()));
      if (!group.items.length) box.append(el('p', 'gx-pop-empty', 'No quotes right now.'));
      for (const quote of group.items) box.append(quoteRow({ name: quote.label, sub: quote.currency && group.id !== 'fx' ? quote.currency : '', quote }));
      body.append(box);
    }
  }

  const unsubscribe = service.subscribe(render);
  if (onGlobe) globeLease = service.want();

  globeToggle.addEventListener('change', () => {
    onGlobe = globeToggle.checked;
    writeOnGlobe(onGlobe);
    globe.setVisible(onGlobe);
    if (onGlobe && !globeLease) globeLease = service.want();
    if (!onGlobe) {
      globeLease?.();
      globeLease = null;
    }
  });
  refreshButton.addEventListener('click', async () => {
    refreshButton.disabled = true;
    await service.refresh();
    refreshButton.disabled = false;
  });

  return {
    activate() {
      if (!tabLease) tabLease = service.want();
      if (service.data) render({ data: service.data, error: service.error });
    },
    deactivate() {
      tabLease?.();
      tabLease = null;
    },
    destroy() {
      unsubscribe();
      globeLease?.();
      tabLease?.();
      service.destroy();
      popup.destroy();
      globe.destroy();
    },
  };
}
