import test from 'node:test';
import assert from 'node:assert/strict';
import { HandGestureGlobeController } from './handGestures.js';

function createLandmarks(midpointX) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  points[0] = { x: 0, y: 0 };
  points[9] = { x: 0, y: 1 };
  points[4] = { x: midpointX - 0.005, y: 0.5 };
  points[8] = { x: midpointX + 0.005, y: 0.5 };
  return points;
}

function createController() {
  const calls = { right: [], up: [], in: [], out: [] };
  const viewer = {
    camera: {
      positionCartographic: { height: 1000000 },
      rotateRight: (value) => calls.right.push(value),
      rotateUp: (value) => calls.up.push(value),
      zoomIn: (value) => calls.in.push(value),
      zoomOut: (value) => calls.out.push(value),
    },
  };
  return { controller: new HandGestureGlobeController({ viewer }), calls };
}

test('one pinched hand rotates the Cesium camera', () => {
  const { controller, calls } = createController();
  controller.processHands([createLandmarks(0.5)], ['Right']);
  controller.processHands([createLandmarks(0.6)], ['Right']);
  assert.ok(calls.right.length > 0);
  assert.ok(calls.up.length > 0);
});

test('active mouse drag temporarily takes priority over gesture rotation', () => {
  const { controller, calls } = createController();
  controller.processHands([createLandmarks(0.5)], ['Right']);
  controller.pointerActive = true;
  controller.processHands([createLandmarks(0.7)], ['Right']);
  assert.equal(calls.right.length, 0);
  assert.equal(controller.lastStatus.mode, 'mouse');
  controller.pointerActive = false;
  controller.processHands([createLandmarks(0.8)], ['Right']);
  assert.equal(calls.right.length, 0, 'first frame after mouse drag establishes a fresh gesture baseline');
  controller.processHands([createLandmarks(0.9)], ['Right']);
  assert.ok(calls.right.length > 0);
});

test('two pinched hands change zoom distance', () => {
  const { controller, calls } = createController();
  const first = createLandmarks(0.3);
  const second = createLandmarks(0.7);
  controller.processHands([first, second], ['Left', 'Right']);
  controller.processHands([createLandmarks(0.4), createLandmarks(0.6)], ['Left', 'Right']);
  assert.ok(calls.in.length + calls.out.length > 0);
});

test('rotation slows down near the ground so one gesture does not jump continents', async () => {
  const { rotationScaleForHeight } = await import('./handGestures.js');
  assert.equal(rotationScaleForHeight(2e7), 1);
  assert.ok(rotationScaleForHeight(600) < 1e-4);
  assert.ok(rotationScaleForHeight(1e6) < rotationScaleForHeight(5e6));
  assert.equal(rotationScaleForHeight(undefined), 1);
});

test('a pinch keeps the grabbed spot on Earth under the hand (Camera#rotate semantics)', async () => {
  const Cesium = await import('cesium');
  const { grabRotation } = await import('./handGestures.js');
  const toWorld = (lon, lat) => Cesium.Cartesian3.fromDegrees(lon, lat, 0, Cesium.Ellipsoid.SPHERE ?? Cesium.Ellipsoid.UNIT_SPHERE);
  for (const [grabbed, current] of [
    [toWorld(77.2, 28.6), toWorld(77.5, 28.4)],
    [toWorld(-10, 51), toWorld(15, 48)],
    [toWorld(139.7, 35.7), toWorld(139.71, 35.69)],
  ]) {
    const turn = grabRotation(grabbed, current);
    assert.ok(turn, 'a rotation is produced');
    // Camera#rotate(axis, angle) applies Quaternion.fromAxisAngle(axis, -angle);
    // the hand's ray then lands on that rotation of `current`, which must be `grabbed`.
    const q = Cesium.Quaternion.fromAxisAngle(turn.axis, -turn.angle);
    const m = Cesium.Matrix3.fromQuaternion(q);
    const landed = Cesium.Matrix3.multiplyByVector(m, current, new Cesium.Cartesian3());
    const gap = Cesium.Cartesian3.angleBetween(landed, grabbed);
    assert.ok(gap < 1e-9, `hand ray lands on the grabbed point (off by ${gap} rad)`);
  }
  assert.equal(grabRotation(toWorld(1, 1), toWorld(1, 1)), null, 'no movement → no rotation');
});

test('hand positions map from the central webcam area onto the whole canvas', async () => {
  const { handToScreen } = await import('./handGestures.js');
  assert.deepEqual(handToScreen({ x: 0.5, y: 0.5 }, 1000, 600), { x: 500, y: 300 });
  assert.deepEqual(handToScreen({ x: 0.15, y: 0.85 }, 1000, 600), { x: 0, y: 600 });
  assert.deepEqual(handToScreen({ x: 0, y: 1 }, 1000, 600), { x: 0, y: 600 }, 'clamped at the edges');
});

test('preview dots line up with the hand: raw camera coordinates on a canvas sized to the video', () => {
  const arcs = [];
  const context = {
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    arc(x, y) { arcs.push([x, y]); },
  };
  const overlay = { width: 640, height: 480, getContext: () => context };
  const video = { videoWidth: 1280, videoHeight: 720 };
  const viewer = { camera: { rotateRight() {}, rotateUp() {}, zoomIn() {}, zoomOut() {} } };
  const controller = new HandGestureGlobeController({ viewer, video, overlay });
  const points = createLandmarks(0.8); // index/thumb around camera x = 0.8
  controller.drawOverlay([points]);
  assert.equal(overlay.width, 1280, 'overlay follows the real camera frame');
  assert.equal(overlay.height, 720);
  const thumb = points[4];
  // The thumb-tip dot is drawn where the camera saw it (CSS mirrors canvas and video together).
  assert.ok(arcs.some(([x, y]) => Math.abs(x - thumb.x * 1280) < 1e-6 && Math.abs(y - thumb.y * 720) < 1e-6));
  assert.ok(!arcs.some(([x]) => Math.abs(x - (1 - thumb.x) * 1280) < 1), 'never double-mirrored');
});
