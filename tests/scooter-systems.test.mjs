import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scooterLamps } from '../app/scooter-signals.ts';
import { createCharacterMotion, stepCharacterMotion } from '../app/character-animation.ts';

test('front/rear signal clock, hazard and stationary brake lamp states', () => {
  assert.deepEqual(scooterLamps('left', .1, false), { tail: .35, left: 3, right: 0 });
  assert.deepEqual(scooterLamps('right', .1, true), { tail: 3.2, left: 0, right: 3 });
  assert.deepEqual(scooterLamps('hazard', .1, false), { tail: .35, left: 3, right: 3 });
  assert.deepEqual(scooterLamps('hazard', .5, false), { tail: .35, left: 0, right: 0 });
  assert.deepEqual(scooterLamps('off', .1, true), { tail: 3.2, left: 0, right: 0 });
});

test('wheel rotation follows distance/radius, including reverse and stops', () => {
  const vehicle = { speed: 2, steering: 0, throttle: 0, suspension: 0, lean: 0 };
  const input = { brake: false };
  const motion = stepCharacterMotion(createCharacterMotion(), vehicle, input, .02, .4);
  assert.ok(Math.abs(motion.wheelAngle - .1) < 1e-8);
  const reverse = stepCharacterMotion(motion, { ...vehicle, speed: -2 }, input, .02, .4);
  assert.ok(Math.abs(reverse.wheelAngle) < 1e-8);
  assert.equal(stepCharacterMotion(motion, { ...vehicle, speed: 0 }, input, .02, .4).wheelAngle, motion.wheelAngle);
});
