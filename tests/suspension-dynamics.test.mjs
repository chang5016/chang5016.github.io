import test from 'node:test';
import assert from 'node:assert/strict';
import { stepDamper } from '../app/suspension-dynamics.ts';

test('suspension settles under load and recovers within travel at varied frame rates', () => {
  for (const fps of [25, 30, 60, 120]) {
    let p = 0, v = 0;
    for (let i = 0; i < fps * 2; i++) {
      const next = stepDamper(p, v, .055, 1 / fps);
      p = next.position; v = next.velocity;
      assert.ok(p >= 0 && p <= .08);
    }
    assert.ok(Math.abs(p - .055) < .0001);
    for (let i = 0; i < fps * 3; i++) {
      const next = stepDamper(p, v, 0, 1 / fps);
      p = next.position; v = next.velocity;
    }
    assert.ok(p < .0001);
  }
});
