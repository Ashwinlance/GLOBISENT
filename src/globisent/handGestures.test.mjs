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
