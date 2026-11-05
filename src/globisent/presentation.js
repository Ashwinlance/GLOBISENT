/**
 * GLOBISENT presentation mode: hides every panel (map credits stay), turns
 * off the busy layers, and plays a cinematic tour built from live data
 * (/api/globisent/tour): an opening globe spin, the biggest earthquake, the
 * top disaster alert, the biggest market move, a major company HQ and the
 * top headline, each with a caption card and a slow orbit.
 *
 * Keys while presenting: Space pause/resume · → next stop · Esc exit.
 */
import * as Cesium from 'cesium';

const FLIGHT_S = 4.5;
const HOLD_MS = 8000;
const SPIN_RAD_PER_MS = 0.000035;
const ORBIT_RAD_PER_MS = 0.00006;
const HOME = { lat: 20, lon: 78, height: 17500000 };

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

/** Camera pitch (degrees) and range (m) for a stop, from its suggested height. */
export function framingFor(stop) {
  const height = Number(stop?.height) || 0;
  if (height >= 500000) return { pitch: -75, range: height };
  if (height >= 30000) return { pitch: -55, range: height };
  return { pitch: -35, range: Math.max(height, 1500) };
}

export function createPresentation({ viewer, onEnter = () => {}, onExit = () => {} }) {
  const scene = viewer.scene;
  const card = el('section', 'gx-tour');
  card.hidden = true;
  card.setAttribute('aria-live', 'polite');
  card.innerHTML = `
    <div class="gx-tour-card">
      <div class="gx-tour-eyebrow"></div>
      <h2 class="gx-tour-title"></h2>
      <p class="gx-tour-subtitle"></p>
      <p class="gx-tour-detail"></p>
      <div class="gx-tour-foot">
        <span class="gx-tour-source"></span>
        <span class="gx-tour-progress"></span>
      </div>
    </div>
    <div class="gx-tour-controls">
      <button type="button" data-act="pause" aria-label="Pause tour">❚❚</button>
      <button type="button" data-act="next" aria-label="Next stop">⏭</button>
      <button type="button" data-act="replay" aria-label="Replay tour" hidden>↻ REPLAY</button>
      <button type="button" data-act="exit" aria-label="Exit presentation">✕ EXIT</button>
    </div>
    <div class="gx-tour-brand"><b>GLOBISENT</b> · Global Intelligence Command Center</div>`;
  document.body.append(card);
  const q = (selector) => card.querySelector(selector);
  const ui = {
    eyebrow: q('.gx-tour-eyebrow'),
    title: q('.gx-tour-title'),
    subtitle: q('.gx-tour-subtitle'),
    detail: q('.gx-tour-detail'),
    source: q('.gx-tour-source'),
    progress: q('.gx-tour-progress'),
    inner: q('.gx-tour-card'),
    pause: q('[data-act="pause"]'),
    replay: q('[data-act="replay"]'),
  };

  // A pulsing marker on the current stop, so open-ocean quakes and storms are visible.
  const markerSource = new Cesium.CustomDataSource('globisent-tour');
  viewer.dataSources.add(markerSource);
  const STOP_COLORS = { quake: '#ff6a78', disaster: '#ffc66e', market: '#5ef0a3', company: '#35c9f2' };
  let markerColor = Cesium.Color.WHITE;
  const marker = markerSource.entities.add({
    position: Cesium.Cartesian3.ZERO,
    show: false,
    point: {
      pixelSize: new Cesium.CallbackProperty(() => 14 + 8 * (0.5 + 0.5 * Math.sin(performance.now() / 260)), false),
      color: new Cesium.CallbackProperty(() => markerColor, false),
      outlineColor: new Cesium.CallbackProperty(() => markerColor.withAlpha(0.35 + 0.35 * (0.5 + 0.5 * Math.sin(performance.now() / 260))), false),
      outlineWidth: 10,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  function placeMarker(stop) {
    if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lon)) {
      marker.show = false;
      return;
    }
    const css = stop.id === 'market' && stop.trend === 'down' ? '#ff6a78' : STOP_COLORS[stop.id] ?? '#ffffff';
    markerColor = Cesium.Color.fromCssColorString(css);
    marker.position = Cesium.Cartesian3.fromDegrees(stop.lon, stop.lat, 0);
    marker.show = true;
  }

  let active = false;
  let paused = false;
  let run = 0;
  let skip = null;
  let motion = null; // { kind: 'spin' } | { kind: 'orbit', target, pitch, range, heading }
  let lastFrame = 0;
  let frameHandle = 0;
  let savedRenderMode = null;
  let addedCleanView = false;

  function show(stop, index, total) {
    ui.inner.classList.remove('gx-tour-in');
    void ui.inner.offsetWidth; // restart the fade-in
    ui.inner.classList.add('gx-tour-in');
    ui.eyebrow.textContent = stop.eyebrow ?? '';
    ui.title.textContent = stop.title ?? '';
    ui.subtitle.textContent = stop.subtitle ?? '';
    ui.detail.textContent = stop.detail ?? '';
    ui.detail.hidden = !stop.detail;
    ui.source.textContent = stop.source ? `Source: ${stop.source}` : '';
    ui.progress.textContent = total ? `${index + 1} / ${total}` : '';
    ui.inner.dataset.trend = stop.trend ?? '';
  }

  function releaseCamera() {
    if (!Cesium.Matrix4.equals(viewer.camera.transform, Cesium.Matrix4.IDENTITY)) {
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
  }

  function frame(time) {
    if (!active) return;
    const dt = lastFrame ? Math.min(time - lastFrame, 100) : 16;
    lastFrame = time;
    if (!paused && motion?.kind === 'spin') {
      viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -SPIN_RAD_PER_MS * dt);
    } else if (!paused && motion?.kind === 'orbit') {
      motion.heading += ORBIT_RAD_PER_MS * dt;
      viewer.camera.lookAt(motion.target, new Cesium.HeadingPitchRange(motion.heading, motion.pitch, motion.range));
    }
    scene.requestRender();
    frameHandle = requestAnimationFrame(frame);
  }

  /** Resolves after `ms` of un-paused time, or early on skip/exit. */
  function hold(ms, myRun) {
    return new Promise((resolve) => {
      let left = ms;
      let last = performance.now();
      const tick = () => {
        if (!active || myRun !== run) return resolve(false);
        const t = performance.now();
        if (!paused) left -= t - last;
        last = t;
        if (left <= 0) return resolve(true);
        setTimeout(tick, 100);
      };
      skip = () => {
        left = 0;
      };
      tick();
    });
  }

  function fly(options) {
    return new Promise((resolve) => {
      viewer.camera.cancelFlight?.();
      viewer.camera.flyTo({ ...options, complete: () => resolve(true), cancel: () => resolve(false) });
    });
  }

  function flyToStop(stop) {
    releaseCamera();
    motion = null;
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) {
      return fly({ destination: Cesium.Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height), duration: FLIGHT_S }).then(() => {
        motion = { kind: 'spin' };
      });
    }
    const target = Cesium.Cartesian3.fromDegrees(stop.lon, stop.lat, 0);
    const { pitch, range } = framingFor(stop);
    const heading = 0;
    return new Promise((resolve) => {
      viewer.camera.cancelFlight?.();
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
        offset: new Cesium.HeadingPitchRange(heading, Cesium.Math.toRadians(pitch), range),
        duration: FLIGHT_S,
        complete: () => {
          motion = { kind: 'orbit', target, pitch: Cesium.Math.toRadians(pitch), range, heading };
          resolve(true);
        },
        cancel: () => resolve(false),
      });
    });
  }

  async function play() {
    const myRun = ++run;
    ui.replay.hidden = true;
    show({ eyebrow: 'GLOBISENT · PRESENTATION', title: 'Preparing the live tour…', subtitle: 'Gathering earthquakes, disaster alerts, markets, companies and headlines', source: '' }, 0, 0);
    // Pull out to the whole Earth while the tour loads, then spin slowly.
    releaseCamera();
    motion = null;
    fly({ destination: Cesium.Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height), duration: 3 }).then(() => {
      if (active && myRun === run && !motion) motion = { kind: 'spin' };
    });
    let tour;
    try {
      const response = await fetch('/api/globisent/tour', { cache: 'no-store', signal: AbortSignal.timeout(60000) });
      tour = await response.json();
      if (!response.ok || !Array.isArray(tour?.stops)) throw new Error(tour?.error ?? `HTTP ${response.status}`);
    } catch (error) {
      if (myRun !== run) return;
      show({ eyebrow: 'GLOBISENT', title: 'Live tour unavailable', subtitle: error?.message ?? 'network error', detail: 'The globe keeps spinning; press EXIT to return.' }, 0, 0);
      return;
    }
    const stops = tour.stops;
    for (let i = 0; i < stops.length; i++) {
      if (!active || myRun !== run) return;
      show(stops[i], i, stops.length);
      placeMarker(stops[i]);
      // "Next" during a flight lands it immediately; during a hold it moves on.
      skip = () => viewer.camera.completeFlight?.();
      await flyToStop(stops[i]);
      if (!active || myRun !== run) return;
      await hold(stops[i].id === 'outro' ? HOLD_MS * 1.5 : HOLD_MS, myRun);
    }
    if (active && myRun === run) {
      releaseCamera();
      placeMarker(null);
      motion = { kind: 'spin' };
      ui.replay.hidden = false;
    }
  }

  function setPaused(next) {
    paused = next;
    ui.pause.textContent = paused ? '▶' : '❚❚';
    ui.pause.setAttribute('aria-label', paused ? 'Resume tour' : 'Pause tour');
  }

  function start() {
    if (active) return;
    active = true;
    setPaused(false);
    document.body.classList.add('gx-presenting');
    // The app's own clean view hides its panels; restore the user's choice on exit.
    addedCleanView = !document.body.classList.contains('ui-clean-view');
    document.body.classList.add('ui-clean-view');
    card.hidden = false;
    onEnter();
    savedRenderMode = scene.requestRenderMode;
    lastFrame = 0;
    frameHandle = requestAnimationFrame(frame);
    play();
  }

  function stop() {
    if (!active) return;
    active = false;
    run += 1;
    cancelAnimationFrame(frameHandle);
    viewer.camera.cancelFlight?.();
    releaseCamera();
    placeMarker(null);
    motion = null;
    if (savedRenderMode !== null) scene.requestRenderMode = savedRenderMode;
    document.body.classList.remove('gx-presenting');
    if (addedCleanView) document.body.classList.remove('ui-clean-view');
    addedCleanView = false;
    card.hidden = true;
    onExit();
    scene.requestRender();
  }

  card.addEventListener('click', (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'exit') stop();
    else if (act === 'pause') setPaused(!paused);
    else if (act === 'next') skip?.();
    else if (act === 'replay') play();
  });
  const onKey = (event) => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      stop();
    } else if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      setPaused(!paused);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      skip?.();
    }
  };
  document.addEventListener('keydown', onKey, true);

  return {
    get active() {
      return active;
    },
    start,
    stop,
    destroy() {
      stop();
      document.removeEventListener('keydown', onKey, true);
      viewer.dataSources.remove(markerSource, true);
      card.remove();
    },
  };
}
