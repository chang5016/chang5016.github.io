import test from "node:test";
import assert from "node:assert/strict";
import { createResolutionGovernor, stepResolution, MIN_RENDER_SCALE } from "../app/adaptive-resolution.ts";

test("render scale drops after sustained slow frames and never below the floor", () => {
  let governor = createResolutionGovernor(1.2);
  governor = stepResolution(governor, 50, 1.2);
  assert.equal(governor.ratio, 1.2, "A single slow second keeps full resolution");
  governor = stepResolution(governor, 50, 1.2);
  assert.ok(governor.ratio < 1.2, "Two slow seconds lower the render scale");
  for (let i = 0; i < 40; i++) governor = stepResolution(governor, 20, 1.2);
  assert.equal(governor.ratio, MIN_RENDER_SCALE);
});

test("render scale recovers slowly once frames are smooth again", () => {
  let governor = { ratio: 0.8, slow: 0, fast: 0 };
  for (let i = 0; i < 5; i++) governor = stepResolution(governor, 60, 1.2);
  assert.equal(governor.ratio, 0.8, "Recovery waits for six smooth seconds");
  governor = stepResolution(governor, 60, 1.2);
  assert.equal(governor.ratio, 0.85);
  for (let i = 0; i < 100; i++) governor = stepResolution(governor, 60, 1.2);
  assert.equal(governor.ratio, 1.2, "Never exceeds the device cap");
});
