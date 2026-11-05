/**
 * Optional hand-gesture globe controller, adapted from the MIT-licensed
 * ULTRON Orb UI hand-tracking approach (Sagar Tamang / Sagar Builds).
 * Mouse, keyboard and touch controls remain owned by Cesium and are not replaced.
 */
import * as Cesium from 'cesium';

const MEDIAPIPE_VERSION = '0.10.35';
const MEDIAPIPE_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const MEDIAPIPE_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const PINCH_ON = 0.32;
const PINCH_OFF = 0.45;
const ROTATE_SPEED = 4.2;
// MediaPipe hand landmark topology (wrist, thumb, four fingers, palm).
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const SMOOTHING = 0.4;
// rotateRight/rotateUp turn the camera around the Earth's centre, so a fixed
// angle that feels right from orbit hurls a street-level camera thousands of
// kilometres. Scale the angle by altitude: full speed at or above this height,
// proportionally slower below it (one full-frame hand sweep ≈ 1.5 screen widths).
const FULL_SPEED_HEIGHT_M = 1.6e7;
const MIN_ROTATE_SCALE = 1e-6;

export function rotationScaleForHeight(height) {
  const h = Number.isFinite(height) && height > 0 ? height : FULL_SPEED_HEIGHT_M;
  return Math.min(1, Math.max(MIN_ROTATE_SCALE, h / FULL_SPEED_HEIGHT_M));
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Hands rarely reach the very edge of the webcam frame, so the central part
// of the frame maps onto the whole globe view.
const ACTIVE_MARGIN = 0.15;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Mirrored, normalised hand position (0..1) → canvas pixel. */
export function handToScreen(point, width, height, margin = ACTIVE_MARGIN) {
  const span = 1 - 2 * margin;
  return {
    x: clamp01((point.x - margin) / span) * width,
    y: clamp01((point.y - margin) / span) * height,
  };
}

/**
 * Camera rotation that brings the grabbed globe point back under the hand.
 * The hand's ray now hits `current`; turning the camera by the rotation that
 * takes `current` onto `grabbed` makes the ray hit `grabbed` again — the same
 * "the spot stays under your finger" behaviour as dragging with the mouse.
 * Returns arguments for Camera#rotate (which applies the negated angle), or
 * null when there is nothing to turn.
 */
export function grabRotation(grabbed, current) {
  const g = Cesium.Cartesian3.normalize(grabbed, new Cesium.Cartesian3());
  const c = Cesium.Cartesian3.normalize(current, new Cesium.Cartesian3());
  const axis = Cesium.Cartesian3.cross(g, c, new Cesium.Cartesian3());
  const sin = Cesium.Cartesian3.magnitude(axis);
  const cos = Cesium.Cartesian3.dot(g, c);
  const angle = Math.atan2(sin, cos);
  if (!(sin > 1e-12) || !Number.isFinite(angle) || angle < 1e-9) return null;
  return { axis: Cesium.Cartesian3.normalize(axis, axis), angle };
}

export class HandGestureGlobeController {
  constructor({ viewer, video, overlay, onStatus = () => {} }) {
    if (!viewer?.camera) throw new TypeError('A live Cesium viewer is required.');
    this.viewer = viewer;
    this.canvas = viewer.canvas ?? viewer.scene?.canvas ?? null;
    this.video = video;
    this.overlay = overlay;
    this.onStatus = onStatus;
    this.stream = null;
    this.landmarker = null;
    this.rafId = 0;
    this.running = false;
    this.pointerActive = false;
    this.onPointerDown = () => { this.pointerActive = true; };
    this.onPointerEnd = () => { this.pointerActive = false; };
    this.lastVideoTime = -1;
    this.handStates = new Map();
    this.previousMode = 'idle';
    this.previousSpin = null;
    this.previousZoomDistance = null;
    this.grabbed = null;
    this.handScreens = [];
    this.cursors = [];
    this.lastStatus = { hands: 0, mode: 'idle' };
  }

  /** Canvas pixel for a mirrored, normalised hand point. */
  toScreen(point) {
    const width = this.canvas?.clientWidth || 0;
    const height = this.canvas?.clientHeight || 0;
    return width && height ? handToScreen(point, width, height) : null;
  }

  /** Globe point under a canvas pixel, or null for sky / an unsupported camera. */
  pickGlobe(screen) {
    const camera = this.viewer.camera;
    const ellipsoid = this.viewer.scene?.globe?.ellipsoid;
    if (!screen || typeof camera.pickEllipsoid !== 'function' || !ellipsoid) return null;
    // A camera locked onto a tracked entity works in that entity's local
    // frame; world-space grabbing would not apply there.
    if (camera.transform && !Cesium.Matrix4.equals(camera.transform, Cesium.Matrix4.IDENTITY)) return null;
    try {
      return camera.pickEllipsoid(new Cesium.Cartesian2(screen.x, screen.y), ellipsoid) ?? null;
    } catch {
      return null;
    }
  }

  ensureCursors() {
    if (this.cursors.length || typeof document === 'undefined') return;
    for (let i = 0; i < 2; i++) {
      const cursor = document.createElement('div');
      cursor.className = 'gx-hand-cursor';
      cursor.hidden = true;
      cursor.setAttribute('aria-hidden', 'true');
      document.body.append(cursor);
      this.cursors.push(cursor);
    }
  }

  updateCursors() {
    if (!this.cursors.length) return;
    const rect = this.canvas?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    this.cursors.forEach((cursor, index) => {
      const hand = this.handScreens[index];
      cursor.hidden = !hand;
      if (!hand) return;
      cursor.style.transform = `translate(${rect.left + hand.x}px, ${rect.top + hand.y}px)`;
      cursor.classList.toggle('pinching', hand.pinching);
    });
  }

  removeCursors() {
    for (const cursor of this.cursors) cursor.remove();
    this.cursors = [];
  }

  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access requires HTTPS or localhost and a supported browser.');
    }
    this.publish({ hands: 0, mode: 'loading' });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.canvas?.addEventListener('pointerdown', this.onPointerDown);
      window.addEventListener('pointerup', this.onPointerEnd);
      window.addEventListener('pointercancel', this.onPointerEnd);

      // Load MediaPipe only after the user explicitly enables gesture mode.
      const { FilesetResolver, HandLandmarker } = await import(MEDIAPIPE_MODULE);
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
      const baseOptions = { modelAssetPath: HAND_MODEL, delegate: 'GPU' };
      const options = {
        baseOptions,
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      };
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
      } catch {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'CPU' },
        });
      }
      this.running = true;
      this.ensureCursors();
      this.publish({ hands: 0, mode: 'ready' });
      this.loop();
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    this.running = false;
    this.canvas?.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerEnd);
    window.removeEventListener('pointercancel', this.onPointerEnd);
    this.pointerActive = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.landmarker?.close?.();
    this.landmarker = null;
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.handStates.clear();
    this.previousMode = 'idle';
    this.previousSpin = null;
    this.previousZoomDistance = null;
    this.grabbed = null;
    this.handScreens = [];
    this.removeCursors();
    const context = this.overlay?.getContext?.('2d');
    context?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.publish({ hands: 0, mode: 'off' });
  }

  destroy() {
    this.stop();
  }

  loop = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);
    if (!this.landmarker || this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    const result = this.landmarker.detectForVideo(this.video, performance.now());
    const labels = (result.handedness ?? []).map((items) => items?.[0]?.categoryName ?? 'hand');
    this.processHands(result.landmarks ?? [], labels);
    this.updateCursors();
    this.drawOverlay(result.landmarks ?? []);
  };

  processHands(landmarks, labels) {
    const pinched = [];
    const seen = new Set();
    this.handScreens = [];
    landmarks.forEach((points, index) => {
      const label = labels[index] ?? `hand-${index}`;
      seen.add(label);
      const handScale = distance(points[WRIST], points[MIDDLE_MCP]);
      if (handScale < 1e-6) return;
      const ratio = distance(points[THUMB_TIP], points[INDEX_TIP]) / handScale;
      const raw = {
        x: 1 - (points[THUMB_TIP].x + points[INDEX_TIP].x) / 2,
        y: (points[THUMB_TIP].y + points[INDEX_TIP].y) / 2,
      };
      let state = this.handStates.get(label);
      if (!state) {
        state = { pinching: false, grab: raw };
        this.handStates.set(label, state);
      }
      if (state.pinching && ratio > PINCH_OFF) state.pinching = false;
      else if (!state.pinching && ratio < PINCH_ON) state.pinching = true;
      state.grab = {
        x: state.grab.x + (raw.x - state.grab.x) * SMOOTHING,
        y: state.grab.y + (raw.y - state.grab.y) * SMOOTHING,
      };
      if (state.pinching) pinched.push(state.grab);
      const screen = this.toScreen(state.grab);
      if (screen) this.handScreens.push({ ...screen, pinching: state.pinching });
    });
    for (const key of this.handStates.keys()) if (!seen.has(key)) this.handStates.delete(key);

    const mode = pinched.length >= 2 ? 'zoom' : pinched.length === 1 ? 'rotate' : 'idle';
    if (this.pointerActive) {
      // Let an active mouse/touch drag own the camera until its pointer is released.
      // Gesture tracking continues, so pinch control resumes without restarting the webcam.
      this.previousSpin = null;
      this.previousZoomDistance = null;
      this.grabbed = null;
      this.previousMode = mode;
      this.publish({ hands: landmarks.length, mode: 'mouse' });
      return;
    }
    if (mode !== this.previousMode) {
      this.previousSpin = null;
      this.previousZoomDistance = null;
      this.grabbed = null;
      this.previousMode = mode;
    }
    if (mode === 'rotate') {
      const grab = pinched[0];
      const screen = this.toScreen(grab);
      if (!this.previousSpin) {
        // Pinch start: remember the exact spot on Earth under the hand.
        this.grabbed = this.pickGlobe(screen);
      } else if (this.grabbed) {
        const current = this.pickGlobe(screen);
        const turn = current ? grabRotation(this.grabbed, current) : null;
        if (turn) this.viewer.camera.rotate(turn.axis, turn.angle);
      } else {
        const dx = grab.x - this.previousSpin.x;
        const dy = grab.y - this.previousSpin.y;
        if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
          // Cesium's normal mouse/touch handlers remain active alongside this input.
          const speed = ROTATE_SPEED * rotationScaleForHeight(this.viewer.camera.positionCartographic?.height);
          this.viewer.camera.rotateRight(-dx * speed);
          this.viewer.camera.rotateUp(dy * speed);
        }
      }
      this.previousSpin = grab;
    } else if (mode === 'zoom') {
      const span = distance(pinched[0], pinched[1]);
      if (this.previousZoomDistance && span > 1e-4) {
        const factor = Math.min(1.18, Math.max(0.85, this.previousZoomDistance / span));
        const height = Math.max(1000, this.viewer.camera.positionCartographic?.height ?? 1000000);
        const amount = Math.max(25, height * Math.abs(1 - factor) * 0.9);
        if (factor < 1) this.viewer.camera.zoomIn(amount);
        else this.viewer.camera.zoomOut(amount);
      }
      this.previousZoomDistance = span;
    }
    this.publish({ hands: landmarks.length, mode });
  }

  /**
   * Size the overlay to the camera's real frame so CSS object-fit crops the
   * video and the overlay identically (a 16:9 webcam in a 4:3 preview would
   * otherwise shift every dot sideways).
   */
  syncOverlaySize() {
    const width = this.video?.videoWidth;
    const height = this.video?.videoHeight;
    if (!this.overlay || !width || !height) return;
    if (this.overlay.width !== width || this.overlay.height !== height) {
      this.overlay.width = width;
      this.overlay.height = height;
    }
  }

  /**
   * Draw the tracked hands over the preview. Points are drawn in RAW camera
   * coordinates: the stylesheet mirrors the video and this canvas together
   * (selfie view), so mirroring here as well would put the dots on the
   * opposite side from the hand.
   */
  drawOverlay(landmarks) {
    const context = this.overlay?.getContext?.('2d');
    if (!context) return;
    this.syncOverlaySize();
    const { width, height } = this.overlay;
    context.clearRect(0, 0, width, height);
    const scale = Math.max(1, width / 640);
    for (const points of landmarks) {
      const px = (p) => p.x * width;
      const py = (p) => p.y * height;
      const thumb = points[THUMB_TIP];
      const index = points[INDEX_TIP];
      const handScale = distance(points[WRIST], points[MIDDLE_MCP]);
      const pinching = handScale > 1e-6 && distance(thumb, index) / handScale < PINCH_ON;
      // Hand skeleton, so it is obvious which hand is tracked and where.
      context.strokeStyle = 'rgba(69, 210, 255, 0.55)';
      context.lineWidth = 1.5 * scale;
      for (const [a, b] of HAND_CONNECTIONS) {
        if (!points[a] || !points[b]) continue;
        context.beginPath();
        context.moveTo(px(points[a]), py(points[a]));
        context.lineTo(px(points[b]), py(points[b]));
        context.stroke();
      }
      context.fillStyle = 'rgba(140, 234, 255, 0.85)';
      for (const p of points) {
        context.beginPath();
        context.arc(px(p), py(p), 2.2 * scale, 0, Math.PI * 2);
        context.fill();
      }
      // Thumb–index pinch link, gold while pinching.
      context.strokeStyle = pinching ? '#ffce78' : 'rgba(69, 210, 255, 0.9)';
      context.lineWidth = 2.5 * scale;
      context.beginPath();
      context.moveTo(px(thumb), py(thumb));
      context.lineTo(px(index), py(index));
      context.stroke();
      context.fillStyle = pinching ? '#ffce78' : '#45d2ff';
      for (const p of [thumb, index]) {
        context.beginPath();
        context.arc(px(p), py(p), 5 * scale, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  publish(status) {
    if (status.hands !== this.lastStatus.hands || status.mode !== this.lastStatus.mode) {
      this.lastStatus = status;
      this.onStatus(status);
    }
  }
}
