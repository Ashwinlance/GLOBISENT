/**
 * Optional hand-gesture globe controller, adapted from the MIT-licensed
 * ULTRON Orb UI hand-tracking approach (Sagar Tamang / Sagar Builds).
 * Mouse, keyboard and touch controls remain owned by Cesium and are not replaced.
 */
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
const SMOOTHING = 0.4;

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

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
    this.lastStatus = { hands: 0, mode: 'idle' };
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
    this.drawOverlay(result.landmarks ?? []);
  };

  processHands(landmarks, labels) {
    const pinched = [];
    const seen = new Set();
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
    });
    for (const key of this.handStates.keys()) if (!seen.has(key)) this.handStates.delete(key);

    const mode = pinched.length >= 2 ? 'zoom' : pinched.length === 1 ? 'rotate' : 'idle';
    if (this.pointerActive) {
      // Let an active mouse/touch drag own the camera until its pointer is released.
      // Gesture tracking continues, so pinch control resumes without restarting the webcam.
      this.previousSpin = null;
      this.previousZoomDistance = null;
      this.previousMode = mode;
      this.publish({ hands: landmarks.length, mode: 'mouse' });
      return;
    }
    if (mode !== this.previousMode) {
      this.previousSpin = null;
      this.previousZoomDistance = null;
      this.previousMode = mode;
    }
    if (mode === 'rotate') {
      const grab = pinched[0];
      if (this.previousSpin) {
        const dx = grab.x - this.previousSpin.x;
        const dy = grab.y - this.previousSpin.y;
        if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
          // Cesium's normal mouse/touch handlers remain active alongside this input.
          this.viewer.camera.rotateRight(-dx * ROTATE_SPEED);
          this.viewer.camera.rotateUp(dy * ROTATE_SPEED);
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

  drawOverlay(landmarks) {
    const context = this.overlay?.getContext?.('2d');
    if (!context) return;
    const { width, height } = this.overlay;
    context.clearRect(0, 0, width, height);
    for (const points of landmarks) {
      const thumb = points[THUMB_TIP];
      const index = points[INDEX_TIP];
      const tx = (1 - thumb.x) * width;
      const ty = thumb.y * height;
      const ix = (1 - index.x) * width;
      const iy = index.y * height;
      const handScale = distance(points[WRIST], points[MIDDLE_MCP]);
      const pinching = handScale > 1e-6 && distance(thumb, index) / handScale < PINCH_ON;
      context.strokeStyle = pinching ? '#ffce78' : 'rgba(69, 210, 255, 0.7)';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(tx, ty);
      context.lineTo(ix, iy);
      context.stroke();
      context.fillStyle = pinching ? '#ffce78' : '#45d2ff';
      for (const [x, y] of [[tx, ty], [ix, iy]]) {
        context.beginPath();
        context.arc(x, y, 4, 0, Math.PI * 2);
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
