import * as THREE from 'three';
import { Pool } from '../../engine/pool.js';

// Visual effects. Colors above 1.0 are intentional: they feed the bloom pass.
// Never add/remove lights at runtime (shader recompiles): the muzzle light is permanent and toggled.
// Hot path: every particle, decal and damage number is pooled, nothing is allocated per shot once warm.
// Draw calls: sparks, casings and decals are InstancedMeshes (one draw each, whatever the count);
// their pooled objects are plain Object3Ds whose matrices are written into the instance buffers.
const HDR = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const _v = new THREE.Vector3();
const _spin = new THREE.Vector3();
const MAX_DECALS = 150;
const MAX_SPARKS = 256;
const MAX_CASINGS = 64;
const _c = new THREE.Color();
const _o = new THREE.Object3D();

export class FX {
  constructor(scene, camera, world) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.live = []; // generic particles { obj, vel?, life, max, update? }
    this.numbers = [];
    this.numberPool = new Pool(() => ({ el: null, pos: new THREE.Vector3(), life: 0, drift: 0 }));
    this.numberLayer = document.getElementById('numbers');

    this.tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: HDR(0xffd890, 6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.sparkGeo = new THREE.BoxGeometry(0.03, 0.03, 0.09);
    this.decalGeo = new THREE.PlaneGeometry(0.12, 0.12);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.smokeMat = new THREE.SpriteMaterial({ map: softTexture(), color: 0xb8b8b8, transparent: true, depthWrite: false, opacity: 0.5 });
    this.casingGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.035, 6).rotateZ(Math.PI / 2);
    this.casingMat = new THREE.MeshStandardMaterial({ color: 0xd8a84a, metalness: 0.9, roughness: 0.3 });
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 48);

    this.flashLight = new THREE.PointLight(0xffb060, 0, 10, 2);
    scene.add(this.flashLight);
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ map: flashTexture(), color: HDR(0xffc080, 5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashTime = 0;

    // Pools keyed by kind. Objects stay in the scene and are hidden when idle (no add/remove churn).
    const hidden = (obj) => {
      obj.visible = false;
      scene.add(obj);
      return obj;
    };
    const ringMat = new THREE.MeshBasicMaterial({ color: HDR(0x6fe3ff, 3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.pools = {
      spark: new Pool(() => Object.assign(new THREE.Object3D(), { color: new THREE.Color() })),
      smoke: new Pool(() => hidden(new THREE.Sprite(this.smokeMat.clone()))),
      tracer: new Pool(() => hidden(new THREE.Mesh(this.tracerGeo, this.tracerMat.clone()))),
      casing: new Pool(() => new THREE.Object3D()),
      ring: new Pool(() => hidden(new THREE.Mesh(this.ringGeo, ringMat.clone()))),
      number: new Pool(() => {
        const el = document.createElement('div');
        el.style.display = 'none';
        this.numberLayer.appendChild(el);
        return el;
      }),
    };
    this.particlePool = new Pool(() => ({ vel: new THREE.Vector3(), spin: new THREE.Vector3() }));
    this.pools.spark.warm(64);
    this.pools.smoke.warm(16);
    this.pools.tracer.warm(16);
    this.pools.casing.warm(24);
    this.decalNext = 0;
    this.decalCount = 0;

    const instanced = (geo, mat, max) => {
      const m = new THREE.InstancedMesh(geo, mat, max);
      m.count = 0;
      m.frustumCulled = false; // instances anywhere in the arena
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    };
    // sparks: white additive material tinted per instance with HDR colors (> 1 feeds bloom)
    this.sparks = instanced(this.sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), MAX_SPARKS);
    this.sparks.setColorAt(0, _c.setScalar(0)); // allocates instanceColor
    this.casings = instanced(this.casingGeo, this.casingMat, MAX_CASINGS);
    this.casings.castShadow = true;
    this.decalMesh = instanced(this.decalGeo, this.decalMat, MAX_DECALS);
  }

  // Visual reactions to gameplay events.
  listen(events) {
    const back = new THREE.Vector3();
    events.on('weapon:shot', (s) => {
      if (s.beam) this.tracer(s.from, s.to, 5, 0.4);
      else this.tracer(s.from, s.to);
      this.muzzleFlash(s.from, s.dir, s.flash);
      this.casing(back.copy(s.from).addScaledVector(s.dir, -0.6), s.right);
    });
    events.on('weapon:hit', (h) => {
      this.impact(h.point, h.normal, h.weak ? 0xff2bd6 : 0x6fe3ff, h.weak ? 14 : 6, false);
      this.number(h.point, h.amount, h.crit, h.weak);
    });
    events.on('weapon:impact', (i) => this.impact(i.point, i.normal));
    events.on('bolt:impact', (i) => this.impact(i.point, i.normal, 0xff6a2a, 10, true));
    // spider mech: blasts (mortar, stomp, death), a leg breaking off, footfalls
    const up = new THREE.Vector3(0, 1, 0);
    events.on('blast', (b) => {
      this.impact(b.point, up, 0xff6a2a, b.kind === 'drone' ? 16 : b.kind === 'stomp' ? 26 : 34, b.kind !== 'stomp');
      this.shockwave(b.point);
    });
    events.on('boss:leg', (b) => {
      this.impact(b.point, up, 0xff2bd6, 30, false);
      this.shockwave(b.point);
    });
    events.on('boss:dead', (b) => {
      for (let i = 0; i < 3; i++) this.impact(b.point, up, i ? 0xff6a2a : 0xff2bd6, 40, false);
      this.shockwave(b.point);
    });
    return this;
  }

  // Starts a particle from a pooled object. opts: vel, gravity, stretch, spin, bounce, grow, fade (max opacity), fadeMat.
  #add(kind, obj, life, opts) {
    const p = this.particlePool.acquire();
    p.kind = kind;
    p.obj = obj;
    p.life = p.max = life;
    p.hasVel = !!opts.vel;
    if (opts.vel) p.vel.copy(opts.vel);
    p.gravity = opts.gravity ?? 0;
    p.stretch = !!opts.stretch;
    p.hasSpin = !!opts.spin;
    if (opts.spin) p.spin.copy(opts.spin);
    p.bounce = !!opts.bounce;
    p.grow = opts.grow ?? 0;
    p.fade = opts.fade ?? -1;
    p.fadeMat = !!opts.fadeMat;
    obj.visible = true;
    this.live.push(p);
  }


  muzzleFlash(pos, dir, size = 1) {
    this.flashTime = 0.045;
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 16 * size;
    this.flash.position.copy(pos).addScaledVector(dir, 0.12);
    this.flash.quaternion.copy(this.camera.quaternion);
    this.flash.rotateZ(Math.random() * Math.PI);
    this.flash.scale.setScalar((0.7 + Math.random() * 0.7) * size);
    this.flash.visible = true;
    // muzzle smoke
    const s = this.pools.smoke.acquire();
    s.position.copy(pos).addScaledVector(dir, 0.2);
    s.scale.setScalar(0.15);
    s.material.opacity = 0.25;
    this.#add('smoke', s, 0.5, { vel: _v.copy(dir).multiplyScalar(0.8).setY(_v.y + 0.4), grow: 1.2, fade: 0.25 });
  }

  tracer(from, to, width = 1, life = 0.07) {
    const m = this.pools.tracer.acquire();
    m.position.copy(from);
    m.scale.set(1, 1, 1);
    m.lookAt(to);
    m.scale.set(width, width, from.distanceTo(to));
    this.#add('tracer', m, life, { fadeMat: true });
  }

  impact(point, normal, color = 0xffc070, count = 8, decal = true) {
    _c.set(color).multiplyScalar(4);
    for (let i = 0; i < count; i++) {
      const m = this.pools.spark.acquire();
      m.color.copy(_c);
      m.scale.setScalar(1);
      m.position.copy(point);
      const v = _v.copy(normal).multiplyScalar(2 + Math.random() * 4);
      v.x += (Math.random() - 0.5) * 5;
      v.y += Math.random() * 3.5;
      v.z += (Math.random() - 0.5) * 5;
      this.#add('spark', m, 0.2 + Math.random() * 0.3, { vel: v, gravity: 14, stretch: true });
    }
    // dust puff
    const s = this.pools.smoke.acquire();
    s.position.copy(point).addScaledVector(normal, 0.08);
    s.scale.setScalar(0.2);
    this.#add('smoke', s, 0.6, { vel: _v.copy(normal).multiplyScalar(0.6), grow: 1.4, fade: 0.45 });
    if (decal) {
      // ring buffer of instances: the oldest decal is recycled
      const d = _o;
      d.position.copy(point).addScaledVector(normal, 0.01);
      d.lookAt(_v.copy(d.position).add(normal));
      d.rotateZ(Math.random() * 6.28);
      d.updateMatrix();
      this.decalMesh.setMatrixAt(this.decalNext, d.matrix);
      this.decalMesh.instanceMatrix.needsUpdate = true;
      this.decalNext = (this.decalNext + 1) % MAX_DECALS;
      this.decalMesh.count = this.decalCount = Math.min(MAX_DECALS, this.decalCount + 1);
    }
  }

  casing(pos, right) {
    const m = this.pools.casing.acquire();
    m.position.copy(pos);
    const v = _v.copy(right).multiplyScalar(2.2 + Math.random());
    v.x += (Math.random() - 0.5) * 0.6;
    v.y += 2.2 + Math.random();
    v.z += (Math.random() - 0.5) * 0.6;
    this.#add('casing', m, 2.5, { vel: v, gravity: 16, spin: _spin.set(Math.random() * 30, Math.random() * 30, 0), bounce: true });
  }

  shockwave(point) {
    const m = this.pools.ring.acquire();
    m.position.copy(point);
    m.quaternion.copy(this.camera.quaternion);
    m.scale.setScalar(1);
    this.#add('ring', m, 0.3, { grow: 9, fadeMat: true });
  }

  number(pos, value, crit, weak = false) {
    const el = this.pools.number.acquire();
    el.className = 'dmg' + (weak ? ' weak' : crit ? ' crit' : '');
    el.textContent = Math.round(value);
    el.style.display = 'block';
    const n = this.numberPool.acquire();
    n.el = el;
    n.pos.copy(pos);
    n.life = 0.8;
    n.drift = (Math.random() - 0.5) * 0.8;
    this.numbers.push(n);
  }

  update(dt) {
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      const o = p.obj;
      p.life -= dt;
      const k = Math.max(0, p.life / p.max);
      if (p.hasVel) {
        if (p.gravity) p.vel.y -= p.gravity * dt;
        o.position.addScaledVector(p.vel, dt);
        if (p.stretch) o.lookAt(_v.copy(o.position).add(p.vel));
      }
      if (p.hasSpin) {
        o.rotation.x += p.spin.x * dt;
        o.rotation.y += p.spin.y * dt;
      }
      if (p.bounce) {
        const g = this.world.groundAt(o.position.x, o.position.z, o.position.y + 0.2) + 0.01;
        if (o.position.y < g) {
          o.position.y = g;
          p.vel.y = Math.abs(p.vel.y) * 0.35;
          p.vel.x *= 0.5;
          p.vel.z *= 0.5;
          p.spin.multiplyScalar(0.5);
        }
      }
      if (p.grow) o.scale.multiplyScalar(1 + p.grow * dt);
      if (p.fade >= 0) o.material.opacity = p.fade * k;
      if (p.fadeMat) o.material.opacity = k;
      if (p.life <= 0) {
        o.visible = false;
        this.pools[p.kind].release(o);
        this.particlePool.release(p);
        this.live[i] = this.live[this.live.length - 1];
        this.live.pop();
      }
    }
    // write live sparks and casings into their instance buffers
    let ns = 0;
    let nc = 0;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i];
      if (p.kind === 'spark') {
        if (ns >= MAX_SPARKS) continue;
        p.obj.updateMatrix();
        this.sparks.setMatrixAt(ns, p.obj.matrix);
        this.sparks.setColorAt(ns++, p.obj.color);
      } else if (p.kind === 'casing') {
        if (nc >= MAX_CASINGS) continue;
        p.obj.updateMatrix();
        this.casings.setMatrixAt(nc++, p.obj.matrix);
      }
    }
    if (ns || this.sparks.count) {
      this.sparks.count = ns;
      this.sparks.instanceMatrix.needsUpdate = true;
      this.sparks.instanceColor.needsUpdate = true;
    }
    if (nc || this.casings.count) {
      this.casings.count = nc;
      this.casings.instanceMatrix.needsUpdate = true;
    }

    const w = innerWidth;
    const h = innerHeight;
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.life -= dt;
      n.pos.y += dt * 1.4;
      n.pos.x += n.drift * dt;
      _v.copy(n.pos).project(this.camera);
      const st = n.el.style;
      st.display = _v.z < 1 && n.life > 0 ? 'block' : 'none';
      const pop = 1 + Math.max(0, n.life - 0.65) * 6;
      st.transform = `translate(${((_v.x + 1) / 2) * w}px, ${((1 - _v.y) / 2) * h}px) translate(-50%, -50%) scale(${pop})`;
      st.opacity = Math.min(1, n.life * 3);
      if (n.life <= 0) {
        this.pools.number.release(n.el);
        this.numberPool.release(n);
        this.numbers[i] = this.numbers[this.numbers.length - 1];
        this.numbers.pop();
      }
    }
  }
}

function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,200,120,0.8)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 ? 12 : 32;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
