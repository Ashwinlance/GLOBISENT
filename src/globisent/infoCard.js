/**
 * GLOBISENT click info card. Listens for plain left-clicks on the globe
 * (alongside the app's own click handling, never replacing it) and shows
 * everything known about the clicked object and place: the object's own
 * record (aircraft, ship, fire, camera…), then /api/globisent/place for the
 * place name, weather, nearby earthquakes, alerts, country profile and news.
 */
import * as Cesium from 'cesium';
import { getContextStore } from '../data/contextStore.js';
import { renderSection } from './domainPopup.js';

const STORAGE_KEY = 'globisent.clickInfo';
// Tracked layers (aircraft) publish their selection just after the click.
const SELECTION_SETTLE_MS = 180;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

function readEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeEnabled(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch { /* private mode: the toggle still works for this session */ }
}

/** "speedKt" → "Speed kt", "frp" → "Frp". */
function humanKey(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return null;
  return String(value).slice(0, 160);
}

/** The app's context record for a picked object, if it registered one. */
function recordForPick(picked) {
  const store = getContextStore();
  const candidates = [picked?.id, picked?.primitive?.id, picked?.primitive, picked];
  for (const candidate of candidates) {
    const contextId = candidate?.__gevContextId ?? (typeof candidate === 'string' ? candidate : null);
    if (contextId && store.entities.has(contextId)) return store.entities.get(contextId);
  }
  return null;
}

function cartographicAt(viewer, position) {
  const scene = viewer.scene;
  let cartesian = null;
  try {
    if (scene.pickPositionSupported) cartesian = scene.pickPosition(position);
  } catch { /* depth picking unavailable on this frame */ }
  if (!cartesian) {
    const ray = viewer.camera.getPickRay(position);
    cartesian = ray ? scene.globe.pick(ray, scene) : null;
  }
  if (!cartesian) cartesian = viewer.camera.pickEllipsoid(position, scene.globe.ellipsoid);
  if (!cartesian) return null;
  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  if (!carto) return null;
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lon = Cesium.Math.toDegrees(carto.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

export function createInfoCard({ viewer, onEnabledChange = () => {} }) {
  const card = el('aside', 'gx-info');
  card.hidden = true;
  card.setAttribute('aria-label', 'Selected place information');
  document.body.append(card);

  let enabled = readEnabled();
  let suspended = false;
  let request = null;
  let current = null;
  let lastSelection = { id: null, at: 0 };

  function close() {
    request?.abort();
    request = null;
    current = null;
    card.hidden = true;
    card.replaceChildren();
  }

  function objectSection(record) {
    const items = [];
    if (record.layerName) items.push({ label: 'Layer', value: record.layerName });
    if (record.source) items.push({ label: 'Source', value: String(record.source) });
    for (const [key, value] of Object.entries(record.properties ?? {})) {
      const shown = displayValue(value);
      if (shown !== null) items.push({ label: humanKey(key), value: shown });
    }
    return { title: 'Selected object', kind: 'stats', items };
  }

  async function show({ point, record }) {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    current = { point, record };
    card.hidden = false;

    const header = el('header', 'gx-info-header');
    const titles = el('div');
    titles.append(el('div', 'gx-eyebrow', record ? 'SELECTED' : 'LOCATION'));
    const title = el('h3', '', record?.label ?? 'Locating…');
    titles.append(title);
    const coords = el('small', 'gx-info-coords', `${point.lat.toFixed(4)}°, ${point.lon.toFixed(4)}°`);
    titles.append(coords);
    const closeButton = el('button', 'gx-icon-button', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.addEventListener('click', close);
    header.append(titles, closeButton);

    const actions = el('div', 'gx-info-actions');
    const fly = el('button', '', 'FLY HERE');
    fly.type = 'button';
    fly.addEventListener('click', () => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 25000),
        duration: 2,
      });
    });
    actions.append(fly);

    const body = el('div', 'gx-info-body');
    if (record) body.append(renderSection(objectSection(record)));
    const loading = el('p', 'gx-pop-loading', 'Loading place information…');
    body.append(loading);

    const footer = el('label', 'gx-info-toggle');
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = enabled;
    toggle.addEventListener('change', () => setEnabled(toggle.checked));
    footer.append(toggle, document.createTextNode(' Show this card on every globe click'));

    card.replaceChildren(header, actions, body, footer);

    try {
      const data = await fetch(`/api/globisent/place?lat=${point.lat}&lon=${point.lon}`, { signal: controller.signal }).then((r) => r.json());
      if (controller.signal.aborted) return;
      const place = data?.place ?? {};
      const placeName = [place.locality || place.name, place.region, place.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      if (!record) title.textContent = place.name || 'Selected location';
      if (placeName) coords.textContent = `${placeName} · ${point.lat.toFixed(4)}°, ${point.lon.toFixed(4)}°`;
      loading.remove();
      for (const section of data?.sections ?? []) body.append(renderSection(section));
    } catch (error) {
      if (controller.signal.aborted) return;
      loading.textContent = `Place information unavailable: ${error?.message ?? 'network error'}`;
      loading.className = 'gx-pop-error';
    }
  }

  function setEnabled(on) {
    enabled = Boolean(on);
    writeEnabled(enabled);
    if (!enabled) close();
    onEnabledChange(enabled);
  }

  // Additive: a second handler on the canvas; Cesium keeps the app's own.
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    if (!enabled || suspended) return;
    const clickedAt = Date.now();
    let picked = null;
    try {
      picked = viewer.scene.pick(click.position);
    } catch { /* nothing pickable */ }
    // GLOBISENT markers (exchanges, companies) open their own popups.
    if (picked?.id?.globisentOwned) return;
    const point = cartographicAt(viewer, click.position);
    setTimeout(() => {
      let record = recordForPick(picked);
      const store = getContextStore();
      if (!record && store.selectedAt && store.selectedAt >= clickedAt) {
        record = store.entities.get(store.selectedEntityId) ?? null;
      }
      const where = record && Number.isFinite(record.latitude) && Number.isFinite(record.longitude)
        ? { lat: record.latitude, lon: record.longitude }
        : point;
      // A selection event for this click already opened the card.
      if (record && lastSelection.id === record.id && lastSelection.at >= clickedAt) return;
      if (where) show({ point: where, record });
    }, SELECTION_SETTLE_MS);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // Any selection the app publishes (globe click, Contacts list, voice) opens
  // the card for that object. Tracked layers write the store right after the
  // event, so read it on the next tick.
  const onSelected = () => {
    if (!enabled || suspended) return;
    setTimeout(() => {
      const store = getContextStore();
      const record = store.selectedEntityId ? store.entities.get(store.selectedEntityId) : null;
      if (!record || !Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)) return;
      if (current?.record?.id === record.id && Date.now() - lastSelection.at < 1500) return;
      lastSelection = { id: record.id, at: Date.now() };
      show({ point: { lat: record.latitude, lon: record.longitude }, record });
    }, 0);
  };
  window.addEventListener('gev:awareness-subject-selected', onSelected);
  window.addEventListener('gev:entity-selected', onSelected);

  const onKey = (event) => {
    if (event.key === 'Escape' && !card.hidden) close();
  };
  document.addEventListener('keydown', onKey);

  return {
    get enabled() {
      return enabled;
    },
    setEnabled,
    /** Ignore clicks without changing the saved choice (presentation mode). */
    suspend(on) {
      suspended = Boolean(on);
      if (suspended) close();
    },
    showPoint: (point) => show({ point, record: null }),
    close,
    destroy() {
      close();
      handler.destroy();
      window.removeEventListener('gev:awareness-subject-selected', onSelected);
      window.removeEventListener('gev:entity-selected', onSelected);
      document.removeEventListener('keydown', onKey);
      card.remove();
    },
  };
}
