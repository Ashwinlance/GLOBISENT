/**
 * GLOBISENT local businesses: when the camera is low over a city, load every
 * named business OpenStreetMap knows in the ~1 km tiles around the view
 * (offices, industry, banks, shops, hotels, food, health, fuel), draw them as
 * kind-coloured dots with icon labels, and open a details popup on click,
 * linking to the full company profile when OpenStreetMap names the brand.
 */
import * as Cesium from 'cesium';
import { renderSection } from './domainPopup.js';
import { nudgeRender } from './markets.js';

export const BUSINESS_KINDS = Object.freeze({
  office: { icon: '🏢', label: 'Offices & companies', color: '#35c9f2' },
  industry: { icon: '🏭', label: 'Industry & crafts', color: '#d4a373' },
  bank: { icon: '🏦', label: 'Banks', color: '#ffd166' },
  shop: { icon: '🛒', label: 'Shops', color: '#ff9fb2' },
  hotel: { icon: '🏨', label: 'Hotels', color: '#b28cff' },
  food: { icon: '🍽', label: 'Food & drink', color: '#ff9f43' },
  health: { icon: '⚕', label: 'Health', color: '#5ef0a3' },
  fuel: { icon: '⛽', label: 'Fuel', color: '#c0c8d0' },
  other: { icon: '📍', label: 'Other', color: '#9fb6c3' },
});

export const TILE_DEG = 0.01;
/** Load businesses only below this camera height; labels below LABEL_HEIGHT_M. */
export const LOAD_HEIGHT_M = 9000;
const LABEL_HEIGHT_M = 5000;
const MAX_TILES_PER_VIEW = 9;
const MAX_KEPT_TILES = 120;
const MAX_LABELS = 120;
const STORAGE_KEY = 'globisent.businessesOnGlobe';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

/** Tiles covering a view, nearest to the centre first, at most `max`. */
export function tilesForView(center, rect, max = MAX_TILES_PER_VIEW) {
  const ci = Math.floor(center.lat / TILE_DEG);
  const cj = Math.floor(center.lon / TILE_DEG);
  const out = [];
  for (let r = 0; r <= 3 && out.length < max; r++) {
    const ring = [];
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di;
        const j = cj + dj;
        if (rect) {
          const south = i * TILE_DEG;
          const west = j * TILE_DEG;
          if (south > rect.north || south + TILE_DEG < rect.south || west > rect.east || west + TILE_DEG < rect.west) continue;
        }
        ring.push([i, j, Math.hypot(di, dj)]);
      }
    }
    ring.sort((a, b) => a[2] - b[2]);
    for (const [i, j] of ring) if (out.length < max) out.push([i, j]);
  }
  return out;
}

function readFlag() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeFlag(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch { /* private mode */ }
}

function createBusinessPopup({ viewer, openCompany }) {
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

  async function open(row) {
    const [id, name, lat, lon, kind, type, address] = row;
    close();
    overlay.hidden = false;
    const controller = new AbortController();
    request = controller;
    const meta = BUSINESS_KINDS[kind] ?? BUSINESS_KINDS.other;

    const header = el('header', 'gx-pop-header');
    const titles = el('div', 'gx-company-titles');
    titles.append(el('div', 'gx-eyebrow', `LOCAL BUSINESS · ${meta.label.toUpperCase()}${type ? ` · ${type}` : ''}`));
    titles.append(el('h3', '', `${meta.icon} ${name}`));
    if (address) titles.append(el('p', 'gx-pop-description', address));
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
      viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, 600), duration: 2 });
    });
    actions.append(fly);

    const body = el('div', 'gx-pop-body');
    body.append(el('p', 'gx-pop-loading', 'Loading details from OpenStreetMap…'));
    dialog.setAttribute('aria-label', name);
    dialog.replaceChildren(header, actions, body);
    closeButton.focus();

    try {
      const response = await fetch(`/api/globisent/business?${new URLSearchParams({ id })}`, { signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.error) throw new Error(data?.error ?? `HTTP ${response.status}`);
      if (controller.signal.aborted) return;
      body.replaceChildren();
      for (const section of data.sections ?? []) body.append(renderSection(section));
      if (data.companyId) {
        const profile = el('button', '', 'OPEN COMPANY PROFILE');
        profile.type = 'button';
        profile.addEventListener('click', () => {
          close();
          openCompany(data.companyId, { name });
        });
        actions.append(profile);
      }
      const osm = el('a', 'gx-company-link', 'OPENSTREETMAP ↗');
      osm.href = data.osmUrl;
      osm.target = '_blank';
      osm.rel = 'noopener noreferrer';
      actions.append(osm);
      body.append(el('p', 'gx-footnote', 'Business data © OpenStreetMap contributors (ODbL). Volunteer-mapped: coverage and details vary by area.'));
    } catch (error) {
      if (controller.signal.aborted) return;
      body.replaceChildren(el('p', 'gx-pop-error', `Details unavailable: ${error?.message ?? 'network error'}`));
    }
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
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

/**
 * The zoom-in business layer. `onStatus(text)` reports progress for the
 * COMPANIES tab. Returns { setVisible, enabled, destroy }.
 */
export function createBusinessLayer({ viewer, openCompany, onStatus = () => {} }) {
  const scene = viewer.scene;
  const points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const labels = scene.primitives.add(new Cesium.LabelCollection());
  const popup = createBusinessPopup({ viewer, openCompany });
  const tiles = new Map(); // key -> { points: PointPrimitive[], rows }
  const loading = new Set();
  const failed = new Map();
  let enabled = readFlag();
  let generation = 0;
  let queue = Promise.resolve();
  const colors = Object.fromEntries(Object.entries(BUSINESS_KINDS).map(([k, v]) => [k, Cesium.Color.fromCssColorString(v.color)]));
  const outline = new Cesium.Color(0.02, 0.06, 0.1, 0.95);

  function cameraHeight() {
    return viewer.camera.positionCartographic?.height ?? Infinity;
  }

  function viewCenter() {
    const canvas = scene.canvas;
    const hit = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2), scene.globe.ellipsoid);
    const carto = hit ? Cesium.Cartographic.fromCartesian(hit) : viewer.camera.positionCartographic;
    return carto ? { lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) } : null;
  }

  function viewRect() {
    const r = viewer.camera.computeViewRectangle(scene.globe.ellipsoid);
    if (!r) return null;
    return { west: Cesium.Math.toDegrees(r.west), south: Cesium.Math.toDegrees(r.south), east: Cesium.Math.toDegrees(r.east), north: Cesium.Math.toDegrees(r.north) };
  }

  function addTile(key, rows) {
    const list = [];
    for (const row of rows) {
      const [, name, lat, lon, kind] = row;
      const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
      list.push(points.add({
        position,
        pixelSize: 7,
        color: colors[kind] ?? colors.other,
        outlineColor: outline,
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { globisentOwned: true, globisentBusiness: row, name },
      }));
    }
    tiles.set(key, { points: list, rows });
    // Keep memory bounded: drop the oldest tiles beyond the cap.
    while (tiles.size > MAX_KEPT_TILES) {
      const [oldKey, old] = tiles.entries().next().value;
      for (const p of old.points) points.remove(p);
      tiles.delete(oldKey);
    }
  }

  function updateLabels() {
    labels.removeAll();
    if (!enabled || cameraHeight() > LABEL_HEIGHT_M) return;
    const cameraPosition = viewer.camera.positionWC;
    const candidates = [];
    for (const { points: list } of tiles.values()) {
      for (const p of list) candidates.push([Cesium.Cartesian3.distance(cameraPosition, p.position), p]);
    }
    candidates.sort((a, b) => a[0] - b[0]);
    const placed = [];
    const scratch = new Cesium.Cartesian2();
    const { clientWidth: width, clientHeight: height } = scene.canvas;
    for (const [, p] of candidates) {
      if (placed.length >= MAX_LABELS) break;
      const screen = Cesium.SceneTransforms.worldToWindowCoordinates(scene, p.position, scratch);
      if (!screen || screen.x < 0 || screen.y < 0 || screen.x > width || screen.y > height) continue;
      const row = p.id.globisentBusiness;
      const text = `${(BUSINESS_KINDS[row[4]] ?? BUSINESS_KINDS.other).icon} ${row[1]}`;
      const box = { x: screen.x + 6, y: screen.y - 8, w: text.length * 6 + 14, h: 16 };
      if (placed.some((b) => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h)) continue;
      placed.push(box);
      labels.add({
        position: p.position,
        text,
        font: '500 11px Inter, system-ui, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(8, 0),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
  }

  function totalBusinesses() {
    let n = 0;
    for (const t of tiles.values()) n += t.rows.length;
    return n;
  }

  function refresh() {
    const visible = enabled && cameraHeight() <= LOAD_HEIGHT_M;
    points.show = visible;
    labels.show = visible;
    if (!enabled) {
      onStatus('');
      nudgeRender(viewer);
      return;
    }
    if (!visible) {
      onStatus(`Zoom in below ${LOAD_HEIGHT_M / 1000} km over any city to load its local businesses.`);
      labels.removeAll();
      nudgeRender(viewer);
      return;
    }
    const center = viewCenter();
    if (!center) return;
    const wanted = tilesForView(center, viewRect()).map(([i, j]) => `${i}_${j}`)
      .filter((key) => !tiles.has(key) && !loading.has(key) && !(failed.get(key) > Date.now()));
    updateLabels();
    nudgeRender(viewer);
    if (!wanted.length) {
      onStatus(`${totalBusinesses().toLocaleString()} local businesses loaded · click a dot for details`);
      return;
    }
    const myGeneration = ++generation;
    for (const key of wanted) loading.add(key);
    onStatus(`Loading local businesses… (${wanted.length} area${wanted.length > 1 ? 's' : ''} of ~1 km)`);
    // One tile at a time, nearest first; a newer view cancels what is still queued.
    queue = queue.then(async () => {
      for (const key of wanted) {
        if (myGeneration !== generation || !enabled) {
          loading.delete(key);
          continue;
        }
        const [i, j] = key.split('_').map(Number);
        try {
          const response = await fetch(`/api/globisent/businesses?${new URLSearchParams({ lat: ((i + 0.5) * TILE_DEG).toFixed(5), lon: ((j + 0.5) * TILE_DEG).toFixed(5) })}`, { signal: AbortSignal.timeout(90000) });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data || data.error) throw new Error(data?.error ?? `HTTP ${response.status}`);
          addTile(key, data.rows ?? []);
          updateLabels();
          nudgeRender(viewer);
          onStatus(`${totalBusinesses().toLocaleString()} local businesses loaded · click a dot for details`);
        } catch (error) {
          failed.set(key, Date.now() + 60000);
          onStatus(`Some areas could not load (${error?.message ?? 'network error'}); they retry in a minute.`);
        } finally {
          loading.delete(key);
        }
      }
    });
  }

  const removeMoveEnd = viewer.camera.moveEnd.addEventListener(refresh);

  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction((click) => {
    if (!enabled || !points.show) return;
    let picked = null;
    try {
      picked = scene.pick(click.position);
    } catch { /* nothing pickable */ }
    const row = picked?.id?.globisentBusiness;
    if (row) popup.open(row);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  refresh();

  return {
    get enabled() {
      return enabled;
    },
    setVisible(on) {
      enabled = Boolean(on);
      writeFlag(enabled);
      if (!enabled) generation += 1;
      refresh();
    },
    refresh,
    destroy() {
      removeMoveEnd();
      handler.destroy();
      popup.destroy();
      scene.primitives.remove(points);
      scene.primitives.remove(labels);
    },
  };
}
