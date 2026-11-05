/**
 * GLOBISENT Companies: the COMPANIES hub tab (sector filter, catalog list and
 * worldwide search), company HQ markers on the globe coloured by sector, and
 * a company popup with everything known about it (Wikipedia, Wikidata,
 * live share price, news).
 */
import * as Cesium from 'cesium';
import { renderSection } from './domainPopup.js';
import { COMPANY_SECTORS, SECTOR_BY_ID } from './companyCatalog.js';
import { formatPrice, formatChange, nudgeRender } from './markets.js';
import { createBusinessLayer, BUSINESS_KINDS } from './businesses.js';
import { setOverlayEntries, clearOverlaySource } from '../overlays/worldOverlay.js';

const LABEL_SOURCE = 'globisent-companies';

const STORAGE_KEY = 'globisent.companiesOnGlobe';
const LISTED_KEY = 'globisent.listedOnGlobe';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

function safeHttp(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function readFlag(fallback, key = STORAGE_KEY) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value !== 'off';
  } catch {
    return fallback;
  }
}

function writeFlag(on, key = STORAGE_KEY) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch { /* private mode */ }
}

/** Listed-company rows matching a name filter (rows are [id, name, lat, lon, iso3, exchange, ticker]). */
export function matchListed(rows, text, skip = new Set(), limit = 25) {
  const needle = String(text ?? '').trim().toLowerCase();
  if (needle.length < 2) return [];
  const starts = [];
  const contains = [];
  for (const row of rows) {
    if (skip.has(row[0])) continue;
    const name = row[1].toLowerCase();
    if (name.startsWith(needle)) starts.push(row);
    else if (name.includes(needle) || (row[6] ?? '').toLowerCase() === needle) contains.push(row);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/** Turns the server's `quote` section into a stats section. */
export function quoteToStats(section) {
  const q = section.quote ?? {};
  const items = [
    { label: 'Price', value: `${formatPrice(q.price, q.symbol)}${q.currency ? ` ${q.currency}` : ''}` },
    { label: 'Today', value: formatChange(q.changePct) },
    { label: 'Day range', value: `${formatPrice(q.dayLow, q.symbol)} – ${formatPrice(q.dayHigh, q.symbol)}` },
    { label: '52-week range', value: `${formatPrice(q.yearLow, q.symbol)} – ${formatPrice(q.yearHigh, q.symbol)}` },
    { label: 'Market', value: q.open === true ? 'Open now' : q.open === false ? 'Closed' : '—', detail: q.time ? `Last price ${new Date(q.time).toLocaleString()}` : '' },
  ];
  return { title: section.title, source: section.source, sourceUrl: section.sourceUrl, kind: 'stats', items };
}

function sectorNames(ids = []) {
  return ids.map((id) => SECTOR_BY_ID.get(id)?.name).filter(Boolean).join(' · ');
}

/** Shared catalog loader (one request per page, retried on failure). */
function createCatalogStore() {
  let data = null;
  let pending = null;
  return {
    get data() { return data; },
    async load() {
      if (data) return data;
      if (!pending) {
        pending = fetch('/api/globisent/companies', { cache: 'no-store', signal: AbortSignal.timeout(60000) })
          .then(async (response) => {
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload || payload.error) throw new Error(payload?.error ?? `HTTP ${response.status}`);
            data = payload;
            return payload;
          })
          .finally(() => {
            pending = null;
          });
      }
      return pending;
    },
  };
}

function createCompanyPopup({ viewer }) {
  const overlay = el('div', 'gx-pop-overlay gx-company-overlay');
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

  function header(name, eyebrow) {
    const head = el('header', 'gx-pop-header');
    const titles = el('div', 'gx-company-titles');
    titles.append(el('div', 'gx-eyebrow', eyebrow), el('h3', '', name));
    const closeButton = el('button', 'gx-icon-button', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.addEventListener('click', close);
    head.append(titles, closeButton);
    return { head, titles, closeButton };
  }

  async function open(id, hint = {}) {
    close();
    overlay.hidden = false;
    const controller = new AbortController();
    request = controller;
    const { head, closeButton } = header(hint.name ?? 'Company', `COMPANY${hint.sectors?.length ? ` · ${sectorNames(hint.sectors)}` : ''}`);
    const body = el('div', 'gx-pop-body');
    body.append(el('p', 'gx-pop-loading', 'Loading company profile from Wikipedia, Wikidata and the stock market…'));
    dialog.setAttribute('aria-label', hint.name ?? 'Company');
    dialog.replaceChildren(head, body);
    closeButton.focus();

    let data;
    try {
      const response = await fetch(`/api/globisent/company?${new URLSearchParams({ id })}`, { signal: controller.signal });
      data = await response.json().catch(() => null);
      if (!response.ok || !data || data.error) throw new Error(data?.error ?? `HTTP ${response.status}`);
    } catch (error) {
      if (controller.signal.aborted) return;
      body.replaceChildren(el('p', 'gx-pop-error', error?.message ?? 'Company profile unavailable.'));
      return;
    }
    if (controller.signal.aborted) return;

    const { head: fullHead, titles, closeButton: fullClose } = header(data.name, `COMPANY${data.sectors?.length ? ` · ${sectorNames(data.sectors)}` : ''}${data.ticker ? ` · ${data.ticker}` : ''}`);
    if (data.description) titles.append(el('p', 'gx-pop-description', data.description));
    const picture = safeHttp(data.logo) ?? safeHttp(data.image);
    if (picture) {
      const img = el('img', 'gx-company-logo');
      img.src = picture;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        const fallback = safeHttp(data.image);
        if (fallback && img.src !== fallback) img.src = fallback;
        else img.remove();
      });
      fullHead.prepend(img);
    }

    const actions = el('div', 'gx-info-actions');
    if (data.location) {
      const fly = el('button', '', 'FLY TO HEADQUARTERS');
      fly.type = 'button';
      fly.addEventListener('click', () => {
        close();
        viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(data.location.lon, data.location.lat, 6000), duration: 2.5 });
      });
      actions.append(fly);
    }
    for (const [label, url] of [['WEBSITE ↗', data.website], ['WIKIPEDIA ↗', data.wikipedia]]) {
      const href = safeHttp(url);
      if (!href) continue;
      const a = el('a', 'gx-company-link', label);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      actions.append(a);
    }

    body.replaceChildren();
    for (const section of data.sections ?? []) {
      body.append(renderSection(section.kind === 'quote' ? quoteToStats(section) : section));
    }
    const newsSlot = el('p', 'gx-pop-loading', 'Loading company news…');
    body.append(newsSlot);
    body.append(el('p', 'gx-footnote', 'Company facts come from Wikidata and Wikipedia (community-maintained; leaders and figures can lag behind the latest filings). Share prices are exchange-delayed. Not investment advice.'));
    dialog.setAttribute('aria-label', data.name);
    dialog.replaceChildren(fullHead, actions, body);
    fullClose.focus();

    try {
      const params = new URLSearchParams({ category: 'all', region: 'global', q: data.name.replace(/[^\p{L}\p{N}&.' -]/gu, ' ').trim() });
      const news = await fetch(`/api/globisent/news?${params}`, { signal: controller.signal }).then((r) => r.json());
      if (controller.signal.aborted) return;
      newsSlot.replaceWith(renderSection(news?.error
        ? { title: 'Latest news', kind: 'error', error: news.error, items: [] }
        : {
          title: `Latest news · ${data.name}`,
          source: news?.provider === 'gdelt' ? 'GDELT' : 'Google News',
          sourceUrl: news?.provider === 'gdelt' ? 'https://www.gdeltproject.org/' : 'https://news.google.com/',
          kind: 'list',
          items: (news?.articles ?? []).slice(0, 8).map((a) => ({ label: a.title, url: a.url, detail: a.source, time: a.publishedAt })),
        }));
    } catch (error) {
      if (controller.signal.aborted) return;
      newsSlot.textContent = `Company news unavailable: ${error?.message ?? 'network error'}`;
      newsSlot.className = 'gx-pop-error';
    }
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  // Capture phase: Escape closes this popup first when it sits on a domain popup.
  const onKey = (event) => {
    if (event.key === 'Escape' && !overlay.hidden) {
      event.stopImmediatePropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);

  return {
    open,
    close,
    destroy() {
      close();
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
    },
  };
}

function createCompanyGlobeLayer({ viewer, onSelect }) {
  const source = new Cesium.CustomDataSource('globisent-companies');
  viewer.dataSources.add(source);
  const entities = new Map();
  let filter = () => true;

  const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, Cesium.Cartesian3.ZERO);
  const lastCamera = new Cesium.Cartesian3(NaN, NaN, NaN);
  let dirty = true;
  function updateVisibility() {
    if (!source.show) return;
    const cameraPosition = viewer.camera.positionWC;
    if (!dirty && Cesium.Cartesian3.equalsEpsilon(cameraPosition, lastCamera, 0, 1)) return;
    Cesium.Cartesian3.clone(cameraPosition, lastCamera);
    dirty = false;
    occluder.cameraPosition = cameraPosition;
    const time = viewer.clock.currentTime;
    let changed = false;
    for (const { entity, company } of entities.values()) {
      const position = entity.position?.getValue(time);
      const visible = filter(company) && Boolean(position) && occluder.isPointVisible(position);
      if (entity.show !== visible) {
        entity.show = visible;
        changed = true;
      }
    }
    if (changed) setTimeout(() => nudgeRender(viewer), 0);
  }
  const removePreRender = viewer.scene.preRender.addEventListener(updateVisibility);

  const occupancy = new Map();

  function setCompanies(companies) {
    for (const company of companies) {
      if (entities.has(company.id) || !Number.isFinite(company.lat) || !Number.isFinite(company.lon)) continue;
      const sector = SECTOR_BY_ID.get(company.sectors[0]);
      const color = Cesium.Color.fromCssColorString(sector?.color ?? '#ffc66e');
      const key = `${company.lat},${company.lon}`;
      const index = occupancy.get(key) ?? 0;
      occupancy.set(key, index + 1);
      const [lat, lon] = spiralOffset(company.lat, company.lon, index);
      const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
      const entity = source.entities.add({
        id: `globisent-company-${company.id}`,
        name: company.name,
        position,
        point: {
          pixelSize: 7,
          color,
          outlineColor: new Cesium.Color(0.02, 0.06, 0.1, 0.95),
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(1e5, 1.6, 2e7, 0.75),
        },
      });
      entity.globisentOwned = true;
      entity.globisentCompany = company.id;
      entities.set(company.id, { entity, company, position, color });
    }
    dirty = true;
    nudgeRender(viewer);
  }

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    if (!source.show) return;
    let picked = null;
    try {
      picked = viewer.scene.pick(click.position);
    } catch { /* nothing pickable */ }
    const id = picked?.id?.globisentCompany;
    if (id) onSelect(id, entities.get(id)?.company);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  return {
    setCompanies,
    /** How many catalog markers already sit on each recorded HQ point (so listed dots spiral past them). */
    occupancy,
    /** Visible catalog markers, for the shared label placer (drawn first, in sector colour). */
    labelItems() {
      if (!source.show) return [];
      const out = [];
      for (const { entity, company, position, color } of entities.values()) {
        if (entity.show) out.push({ id: company.id, position, name: company.name, css: SECTOR_BY_ID.get(company.sectors[0])?.color, priority: true });
      }
      return out;
    },
    setFilter(next) {
      filter = next;
      dirty = true;
      nudgeRender(viewer);
    },
    setVisible(on) {
      source.show = Boolean(on);
      dirty = true;
      nudgeRender(viewer);
    },
    destroy() {
      removePreRender();
      handler.destroy();
      viewer.dataSources.remove(source, true);
    },
  };
}

/**
 * Golden-angle spiral around a shared point: the n-th company sits about
 * 150 m × √n away, so a city with 1,000 HQs becomes a ~5 km disc.
 */
export function spiralOffset(lat, lon, index) {
  if (!index) return [lat, lon];
  const distance = 150 * Math.sqrt(index);
  const angle = index * 2.399963229728653;
  const dLat = (distance * Math.cos(angle)) / 111320;
  const dLon = (distance * Math.sin(angle)) / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lat + dLat, lon + dLon];
}

/** Nearest visible listed companies get a name label once the camera is this low. */
const LISTED_LABEL_HEIGHT_M = 2.5e6;
const LISTED_MAX_LABELS = 140;

/**
 * Every stock-listed company with a mapped HQ (~11,000) as lightweight point
 * primitives. Far-side points are hidden while the camera moves; names are
 * drawn only for the nearest companies when zoomed in.
 */
function createListedLayer({ viewer, onSelect, priorityLabels = () => [] }) {
  const scene = viewer.scene;
  const points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const color = Cesium.Color.fromCssColorString('#d6ecff').withAlpha(0.9);
  const outline = new Cesium.Color(0.02, 0.06, 0.1, 0.9);
  let items = [];
  let visible = false;

  const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, Cesium.Cartesian3.ZERO);
  const lastCamera = new Cesium.Cartesian3(NaN, NaN, NaN);
  let dirty = true;

  function updateVisibility() {
    if (!visible || !items.length) return;
    const cameraPosition = viewer.camera.positionWC;
    if (!dirty && Cesium.Cartesian3.equalsEpsilon(cameraPosition, lastCamera, 0, 1)) return;
    Cesium.Cartesian3.clone(cameraPosition, lastCamera);
    dirty = false;
    occluder.cameraPosition = cameraPosition;
    let changed = false;
    for (const item of items) {
      const show = occluder.isPointVisible(item.position);
      if (item.point.show !== show) {
        item.point.show = show;
        changed = true;
      }
    }
    if (changed) setTimeout(() => nudgeRender(viewer), 0);
  }
  const removePreRender = scene.preRender.addEventListener(updateVisibility);

  /**
   * Company names go through the app's shared world-overlay host, which
   * projects, de-overlaps and horizon-culls every world label each frame.
   * This only chooses the candidates: major companies first, then the
   * nearest listed ones, when the camera is low enough to read them.
   */
  function updateLabels() {
    const height = viewer.camera.positionCartographic?.height ?? Infinity;
    if (height > LISTED_LABEL_HEIGHT_M) {
      setOverlayEntries(LABEL_SOURCE, [], { moving: false });
      return;
    }
    const cameraPosition = viewer.camera.positionWC;
    occluder.cameraPosition = cameraPosition;
    const limit = Math.max(height * 3, 50000);
    const collect = (list) => {
      const out = [];
      for (const item of list) {
        if (item.point ? !item.point.show : !occluder.isPointVisible(item.position)) continue;
        const distance = Cesium.Cartesian3.distance(cameraPosition, item.position);
        if (distance < limit) out.push([distance, item]);
      }
      return out.sort((a, b) => a[0] - b[0]);
    };
    const near = [...collect(priorityLabels()), ...(visible ? collect(items) : [])].slice(0, LISTED_MAX_LABELS);
    setOverlayEntries(LABEL_SOURCE, near.map(([, item]) => ({
      id: item.id,
      position: item.position,
      variant: 'label',
      title: item.name,
      accent: item.css ?? '#d6ecff',
      priority: item.priority ? 3 : 1,
      interactive: true,
      accessibilityLabel: `Open the company profile for ${item.name}`,
      activate: () => {
        onSelect(item.id, { name: item.name });
        return true;
      },
    })), { cohortLimit: LISTED_MAX_LABELS, collisionCapacity: LISTED_MAX_LABELS, moving: false });
    nudgeRender(viewer);
  }
  const removeMoveEnd = viewer.camera.moveEnd.addEventListener(updateLabels);
  // Long flights that flow straight into more motion (tours, orbits) may never
  // raise moveEnd; refresh on any large camera change too, so labels placed
  // for the last place never show through the globe from the far side.
  const removeChanged = viewer.camera.changed.addEventListener(updateLabels);

  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction((click) => {
    if (!visible) return;
    let picked = null;
    try {
      picked = scene.pick(click.position);
    } catch { /* nothing pickable */ }
    const id = picked?.id?.globisentListed;
    if (id) onSelect(id, { name: picked.id.name });
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  return {
    get count() {
      return items.length;
    },
    setRows(rows, skip = new Set(), taken = new Map()) {
      points.removeAll();
      items = [];
      const stacked = new Map(taken);
      for (const [id, name, lat, lon] of rows) {
        if (skip.has(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        // Many HQs are recorded as the city centre; spread companies sharing a spot on a small spiral.
        const key = `${lat},${lon}`;
        const index = stacked.get(key) ?? 0;
        stacked.set(key, index + 1);
        const [jLat, jLon] = spiralOffset(lat, lon, index);
        const position = Cesium.Cartesian3.fromDegrees(jLon, jLat, 0);
        const point = points.add({
          position,
          pixelSize: 4,
          color,
          outlineColor: outline,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(1e5, 1.8, 1.6e7, 0.75),
          id: { globisentOwned: true, globisentListed: id, name },
        });
        items.push({ id, point, position, name });
      }
      dirty = true;
      updateLabels();
    },
    setVisible(on) {
      visible = Boolean(on);
      points.show = visible;
      dirty = true;
      updateLabels();
    },
    refreshLabels: updateLabels,
    destroy() {
      removePreRender();
      removeMoveEnd();
      removeChanged();
      handler.destroy();
      scene.primitives.remove(points);
      clearOverlaySource(LABEL_SOURCE);
    },
  };
}

/**
 * Installs the COMPANIES tab and the globe layer.
 * Returns { activate, open, companiesFor, destroy }.
 */
export function createCompanies({ section, viewer }) {
  const store = createCatalogStore();
  const popup = createCompanyPopup({ viewer });
  const globe = createCompanyGlobeLayer({ viewer, onSelect: (id, company) => popup.open(id, company) });
  const listedLayer = createListedLayer({ viewer, onSelect: (id, hint) => popup.open(id, hint), priorityLabels: () => globe.labelItems() });
  let onGlobe = readFlag(true);
  let listedOn = readFlag(true, LISTED_KEY);
  let listedRows = null;
  let listedPending = null;
  let sector = 'all';
  let filterText = '';
  let searchController = null;
  globe.setVisible(onGlobe);

  section.innerHTML = `
    <div class="gx-section-intro"><div><strong>GLOBAL COMPANIES</strong><small>Major companies in every sector · click any company for its full profile · search finds any company worldwide</small></div><span class="gx-pulse" id="gx-co-state">LOADING</span></div>
    <div class="gx-search-row"><input id="gx-co-search" type="search" maxlength="80" placeholder="Filter, or search any company in the world…" autocomplete="off"><button id="gx-co-search-button" type="button">SEARCH</button></div>
    <div class="gx-co-chips" id="gx-co-chips" role="group" aria-label="Sectors"></div>
    <div class="gx-mkt-controls"><label><input type="checkbox" id="gx-co-globe"> Show major companies on the globe</label></div>
    <div class="gx-mkt-controls"><label><input type="checkbox" id="gx-co-listed"> Show every listed company on the globe</label><small id="gx-co-listed-count"></small></div>
    <div class="gx-mkt-controls"><label><input type="checkbox" id="gx-co-local"> Show local businesses when zoomed in (OpenStreetMap)</label></div>
    <div class="gx-co-legend" id="gx-co-legend"></div>
    <div class="gx-news-status" id="gx-co-local-status" role="status" aria-live="polite"></div>
    <div class="gx-news-status" id="gx-co-status" role="status" aria-live="polite">Loading the company directory…</div>
    <div id="gx-co-listed-matches"></div>
    <div id="gx-co-remote"></div>
    <div id="gx-co-list"></div>
    <p class="gx-footnote">Profiles combine Wikipedia, Wikidata (community-maintained) and Yahoo Finance share prices (exchange-delayed). Globe markers sit at each company's headquarters, coloured by sector; small white dots are every other stock-listed company Wikidata maps (names appear as you zoom in). Zoom below 9 km over any city to see its shops, offices, banks, hotels and factories from OpenStreetMap (© OpenStreetMap contributors, ODbL).</p>`;

  const chips = section.querySelector('#gx-co-chips');
  const list = section.querySelector('#gx-co-list');
  const remote = section.querySelector('#gx-co-remote');
  const status = section.querySelector('#gx-co-status');
  const state = section.querySelector('#gx-co-state');
  const search = section.querySelector('#gx-co-search');
  const searchButton = section.querySelector('#gx-co-search-button');
  const globeToggle = section.querySelector('#gx-co-globe');
  const listedToggle = section.querySelector('#gx-co-listed');
  const listedCount = section.querySelector('#gx-co-listed-count');
  const listedMatches = section.querySelector('#gx-co-listed-matches');
  globeToggle.checked = onGlobe;
  listedToggle.checked = listedOn;

  const localToggle = section.querySelector('#gx-co-local');
  const localStatus = section.querySelector('#gx-co-local-status');
  const legend = section.querySelector('#gx-co-legend');
  for (const kind of Object.values(BUSINESS_KINDS)) {
    if (kind.label === 'Other') continue;
    const item = el('span', 'gx-co-legend-item');
    const dot = el('i');
    dot.style.background = kind.color;
    item.append(dot, `${kind.icon} ${kind.label}`);
    legend.append(item);
  }
  const businessLayer = createBusinessLayer({
    viewer,
    openCompany: (id, hint) => popup.open(id, hint),
    onStatus: (text) => {
      localStatus.textContent = text;
      localStatus.hidden = !text;
    },
  });
  localToggle.checked = businessLayer.enabled;
  legend.hidden = !businessLayer.enabled;
  localToggle.addEventListener('change', () => {
    businessLayer.setVisible(localToggle.checked);
    legend.hidden = !localToggle.checked;
  });

  async function ensureListed() {
    if (listedRows) return listedRows;
    if (!listedPending) {
      listedCount.textContent = 'loading…';
      listedPending = (async () => {
        try {
          const response = await fetch('/api/globisent/companies/listed', { cache: 'no-store', signal: AbortSignal.timeout(180000) });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload || payload.error) throw new Error(payload?.error ?? `HTTP ${response.status}`);
          listedRows = payload.rows;
          const catalog = store.data ?? (await store.load().catch(() => null));
          const catalogIds = new Set((catalog?.companies ?? []).map((c) => c.id));
          listedLayer.setRows(listedRows, catalogIds, globe.occupancy);
          listedLayer.setVisible(listedOn);
          listedCount.textContent = `${listedRows.length.toLocaleString()} companies`;
          renderListedMatches();
          return listedRows;
        } catch (error) {
          listedCount.textContent = `unavailable (${error?.message ?? 'network error'})`;
          return null;
        } finally {
          listedPending = null;
        }
      })();
    }
    return listedPending;
  }

  function renderListedMatches() {
    listedMatches.replaceChildren();
    if (!listedRows || filterText.length < 2) return;
    const catalogIds = new Set((store.data?.companies ?? []).map((c) => c.id));
    const found = matchListed(listedRows, filterText, catalogIds);
    if (!found.length) return;
    const box = el('section', 'gx-mkt-group');
    box.append(el('div', 'gx-pop-label', `LISTED COMPANIES MATCHING · ${found.length}${found.length === 25 ? '+' : ''}`));
    for (const [id, name, , , iso3, exchange, ticker] of found) {
      const row = el('button', 'gx-mkt-row gx-co-row');
      row.type = 'button';
      const left = el('span', 'gx-mkt-name');
      const dot = el('i', 'gx-mkt-dot');
      dot.style.background = '#d6ecff';
      const names = el('span');
      names.append(el('b', '', name), el('small', '', [exchange, iso3].filter(Boolean).join(' · ')));
      left.append(dot, names);
      row.append(left, el('span', 'gx-co-ticker', ticker ?? ''));
      row.addEventListener('click', () => popup.open(id, { name }));
      box.append(row);
    }
    listedMatches.append(box);
  }

  function chip(id, name, color) {
    const button = el('button', `gx-co-chip${id === sector ? ' active' : ''}`);
    button.type = 'button';
    button.dataset.sector = id;
    if (color) {
      const dot = el('i');
      dot.style.background = color;
      button.append(dot);
    }
    button.append(name);
    button.addEventListener('click', () => {
      sector = id;
      chips.querySelectorAll('.gx-co-chip').forEach((b) => b.classList.toggle('active', b.dataset.sector === id));
      render();
    });
    return button;
  }
  chips.append(chip('all', 'All sectors'));
  for (const s of COMPANY_SECTORS) chips.append(chip(s.id, s.name, s.color));

  const matches = (company) => (sector === 'all' || company.sectors.includes(sector))
    && (!filterText || company.name.toLowerCase().includes(filterText) || (company.country ?? '').toLowerCase().includes(filterText));

  function companyRow(company) {
    const row = el('button', 'gx-mkt-row gx-co-row');
    row.type = 'button';
    const left = el('span', 'gx-mkt-name');
    const dot = el('i', 'gx-mkt-dot');
    dot.style.background = SECTOR_BY_ID.get(company.sectors?.[0])?.color ?? '#3b5361';
    const names = el('span');
    names.append(el('b', '', company.name));
    names.append(el('small', '', [company.hq, company.country].filter(Boolean).join(', ') || company.description || ''));
    left.append(dot, names);
    row.append(left, el('span', 'gx-co-ticker', company.ticker ?? ''));
    row.addEventListener('click', () => popup.open(company.id, company));
    return row;
  }

  function render() {
    const data = store.data;
    if (!data) return;
    const shown = data.companies.filter(matches).sort((a, b) => a.name.localeCompare(b.name));
    list.replaceChildren();
    const groups = sector === 'all' ? COMPANY_SECTORS.filter((s) => shown.some((c) => c.sectors[0] === s.id)) : [SECTOR_BY_ID.get(sector)];
    for (const group of groups) {
      const members = sector === 'all' ? shown.filter((c) => c.sectors[0] === group.id) : shown;
      if (!members.length) continue;
      const box = el('section', 'gx-mkt-group');
      box.append(el('div', 'gx-pop-label', `${group.name.toUpperCase()} · ${members.length}`));
      for (const company of members) box.append(companyRow(company));
      list.append(box);
    }
    if (!shown.length) list.append(el('p', 'gx-pop-empty', 'No catalog companies match. Press SEARCH to look worldwide.'));
    status.textContent = `${shown.length} of ${data.companies.length} companies${sector === 'all' ? '' : ` · ${SECTOR_BY_ID.get(sector)?.name}`}${filterText ? ` · matching “${filterText}”` : ''}`;
    status.dataset.state = 'ready';
    globe.setFilter(matches);
    setTimeout(() => listedLayer.refreshLabels(), 0);
  }

  async function ensureCatalog() {
    try {
      const data = await store.load();
      state.textContent = `${data.companies.length} COMPANIES`;
      globe.setCompanies(data.companies);
      render();
      setTimeout(() => listedLayer.refreshLabels(), 0);
      return data;
    } catch (error) {
      state.textContent = 'OFFLINE';
      status.textContent = `Company directory unavailable: ${error?.message ?? 'network error'}. Open this tab again in a minute.`;
      status.dataset.state = 'error';
      return null;
    }
  }

  async function searchWorldwide() {
    const q = search.value.trim();
    remote.replaceChildren();
    if (q.length < 2) return;
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;
    searchButton.disabled = true;
    remote.append(el('p', 'gx-pop-loading', `Searching companies worldwide for “${q}”…`));
    try {
      const response = await fetch(`/api/globisent/companies/search?${new URLSearchParams({ q })}`, { signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.error) throw new Error(data?.error ?? `HTTP ${response.status}`);
      if (controller.signal.aborted) return;
      remote.replaceChildren();
      const box = el('section', 'gx-mkt-group');
      box.append(el('div', 'gx-pop-label', `WORLDWIDE RESULTS · ${data.results.length}`));
      if (!data.results.length) box.append(el('p', 'gx-pop-empty', 'No companies found. Try the official company name.'));
      for (const result of data.results) {
        box.append(companyRow({ ...result, hq: null, ticker: null, sectors: result.sectors }));
      }
      remote.append(box);
    } catch (error) {
      if (controller.signal.aborted) return;
      remote.replaceChildren(el('p', 'gx-pop-error', `Search unavailable: ${error?.message ?? 'network error'}`));
    } finally {
      if (searchController === controller) searchButton.disabled = false;
    }
  }

  let filterTimer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => {
      filterText = search.value.trim().toLowerCase();
      if (!filterText) remote.replaceChildren();
      render();
      renderListedMatches();
    }, 150);
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchWorldwide();
  });
  searchButton.addEventListener('click', searchWorldwide);
  globeToggle.addEventListener('change', () => {
    onGlobe = globeToggle.checked;
    writeFlag(onGlobe);
    globe.setVisible(onGlobe);
    setTimeout(() => listedLayer.refreshLabels(), 0);
    if (onGlobe) ensureCatalog();
  });
  listedToggle.addEventListener('change', () => {
    listedOn = listedToggle.checked;
    writeFlag(listedOn, LISTED_KEY);
    listedLayer.setVisible(listedOn);
    if (listedOn) ensureListed();
  });
  if (onGlobe) ensureCatalog();
  if (listedOn) ensureListed();

  return {
    activate() {
      ensureListed();
      return ensureCatalog();
    },
    /** Presentation mode: hide the dense layers without touching saved choices. */
    setPresentation(on) {
      listedLayer.setVisible(on ? false : listedOn);
      businessLayer.suspend(on);
      popup.close();
    },
    open: (id, hint) => popup.open(id, hint),
    /** Catalog companies for domain popups: by sector ids or by ISO3 country. */
    async companiesFor({ sectors = [], iso3 = null } = {}) {
      const data = await store.load();
      return data.companies
        .filter((c) => (iso3 ? c.iso3 === iso3 : c.sectors.some((s) => sectors.includes(s))))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    destroy() {
      window.clearTimeout(filterTimer);
      searchController?.abort();
      popup.destroy();
      globe.destroy();
      listedLayer.destroy();
      businessLayer.destroy();
    },
  };
}
