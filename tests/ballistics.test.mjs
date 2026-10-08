// node tests/ballistics.test.mjs — pure shot math (no browser needed)
import * as THREE from 'three';
import { coneDir, recoilKick, falloff } from '../src/game/combat/ballistics.js';
import { GUNS } from '../src/game/combat/guns.js';

let failed = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) failed++;
};

// cone: every sample inside the half-angle, uniform over the disc (mean radius = 2/3 of max)
const fwd = new THREE.Vector3(0, 0, -1);
const right = new THREE.Vector3(1, 0, 0);
const out = new THREE.Vector3();
const angle = 0.03;
let maxA = 0;
let sumR = 0;
let sumX = 0;
let sumY = 0;
const N = 20000;
for (let i = 0; i < N; i++) {
  coneDir(out, fwd, right, angle);
  const a = out.angleTo(fwd);
  maxA = Math.max(maxA, a);
  sumR += a;
  sumX += out.x;
  sumY += out.y;
}
check('cone stays inside spread', maxA <= angle + 1e-9, `max ${maxA.toFixed(4)}`);
check('cone uniform over disc', Math.abs(sumR / N / angle - 2 / 3) < 0.02, `mean r ${(sumR / N / angle).toFixed(3)}`);
check('cone centered', Math.abs(sumX / N) < 0.001 && Math.abs(sumY / N) < 0.001);
check('zero spread is exact', coneDir(out, fwd, right, 0).equals(fwd));
coneDir(out, fwd, right, angle, 0.999999, 0.25); // r2 = 0.25 -> straight up on screen
check('cone up is camera up', out.y > 0 && Math.abs(out.x) < 1e-6);

// recoil patterns: deterministic without jitter, loop past the end
for (const [id, g] of Object.entries(GUNS)) {
  const r = g.recoil;
  const k = Math.min(3, r.pattern.length - 1);
  const a = recoilKick(r, k, [0, 0], 0.5, 0.5);
  check(`${id} pattern deterministic at jitter midpoint`, a[0] === r.pattern[k][0] && a[1] === r.pattern[k][1]);
  const last = r.pattern.length - 1;
  const loopStart = r.pattern.length - r.loop;
  const b = recoilKick(r, last + 1, [0, 0], 0.5, 0.5);
  check(`${id} pattern loops`, b[0] === r.pattern[loopStart][0] && b[1] === r.pattern[loopStart][1]);
  const lo = recoilKick(r, 0, [0, 0], 0, 0)[0];
  const hi = recoilKick(r, 0, [0, 0], 1, 1)[0];
  check(`${id} jitter bounded`, Math.abs(hi / r.pattern[0][0] - 1) <= r.jitter + 1e-9 && Math.abs(lo / r.pattern[0][0] - 1) <= r.jitter + 1e-9);
  if (g.semi) {
    // one big kick per round instead of a climbing burst
    check(`${id} single kick sane`, r.pattern[0][0] > 0.03 && r.pattern[0][0] < 0.1 && r.recover >= 0.9);
  } else {
    let up = 0;
    for (let i = 0; i < 10; i++) up += r.pattern[i][0];
    check(`${id} 10-round climb sane`, up > 0.04 && up < 0.15, `${((up * 180) / Math.PI).toFixed(1)}°`);
  }
  if (!g.falloff) {
    check(`${id} no falloff`, falloff(g.falloff, 1e4) === 1);
    continue;
  }
  check(`${id} falloff`, falloff(g.falloff, 0) === 1 && falloff(g.falloff, 1e4) === g.falloff.min && falloff(g.falloff, (g.falloff.start + g.falloff.end) / 2) === (1 + g.falloff.min) / 2);
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
