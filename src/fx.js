import * as THREE from 'three';

// Visual effects. Colors above 1.0 are intentional: they feed the bloom pass.
// Never add/remove lights at runtime (shader recompiles): the muzzle light is permanent and toggled.
const HDR = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

export class FX {
  constructor(scene, camera, world) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.live = []; // generic particles { obj, vel?, life, max, update? }
    this.decals = [];
    this.numbers = [];
    this.numberLayer = document.getElementById('numbers');

    this.tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: HDR(0xffd890, 6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.sparkGeo = new THREE.BoxGeometry(0.03, 0.03, 0.09);
    this.sparkMats = new Map();
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
  }

  #add(obj, life, extra = {}) {
    this.scene.add(obj);
    this.live.push({ obj, life, max: life, ...extra });
  }

  #sparkMat(color) {
    if (!this.sparkMats.has(color)) {
      this.sparkMats.set(color, new THREE.MeshBasicMaterial({ color: HDR(color, 4), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    }
    return this.sparkMats.get(color);
  }

  muzzleFlash(pos, dir) {
    this.flashTime = 0.045;
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 16;
    this.flash.position.copy(pos).addScaledVector(dir, 0.12);
    this.flash.quaternion.copy(this.camera.quaternion);
    this.flash.rotateZ(Math.random() * Math.PI);
    this.flash.scale.setScalar(0.7 + Math.random() * 0.7);
    this.flash.visible = true;
    // muzzle smoke
    const s = new THREE.Sprite(this.smokeMat.clone());
    s.position.copy(pos).addScaledVector(dir, 0.2);
    s.scale.setScalar(0.15);
    s.material.opacity = 0.25;
    this.#add(s, 0.5, { vel: dir.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.4, 0)), grow: 1.2, fade: 0.25 });
  }

  tracer(from, to) {
    const len = from.distanceTo(to);
    const m = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, len);
    this.#add(m, 0.07, { fadeMat: true });
  }

  impact(point, normal, color = 0xffc070, count = 8, decal = true) {
    const mat = this.#sparkMat(color);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.sparkGeo, mat);
      m.position.copy(point);
      const v = normal.clone().multiplyScalar(2 + Math.random() * 4);
      v.x += (Math.random() - 0.5) * 5;
      v.y += Math.random() * 3.5;
      v.z += (Math.random() - 0.5) * 5;
      this.#add(m, 0.2 + Math.random() * 0.3, { vel: v, gravity: 14, stretch: true });
    }
    // dust puff
    const s = new THREE.Sprite(this.smokeMat.clone());
    s.position.copy(point).addScaledVector(normal, 0.08);
    s.scale.setScalar(0.2);
    this.#add(s, 0.6, { vel: normal.clone().multiplyScalar(0.6), grow: 1.4, fade: 0.45 });
    if (decal) {
      const d = new THREE.Mesh(this.decalGeo, this.decalMat);
      d.position.copy(point).addScaledVector(normal, 0.01);
      d.lookAt(d.position.clone().add(normal));
      d.rotateZ(Math.random() * 6.28);
      this.scene.add(d);
      this.decals.push(d);
      if (this.decals.length > 150) this.scene.remove(this.decals.shift());
    }
  }

  casing(pos, right) {
    const m = new THREE.Mesh(this.casingGeo, this.casingMat);
    m.position.copy(pos);
    m.castShadow = true;
    const v = right.clone().multiplyScalar(2.2 + Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.2 + Math.random(), (Math.random() - 0.5) * 0.6));
    this.#add(m, 2.5, { vel: v, gravity: 16, spin: new THREE.Vector3(Math.random() * 30, Math.random() * 30, 0), bounce: true });
  }

  shockwave(point) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: HDR(0x6fe3ff, 3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(point);
    m.quaternion.copy(this.camera.quaternion);
    this.#add(m, 0.3, { grow: 9, fadeMat: true });
  }

  number(pos, value, crit) {
    const el = document.createElement('div');
    el.className = 'dmg' + (crit ? ' crit' : '');
    el.textContent = Math.round(value);
    this.numberLayer.appendChild(el);
    this.numbers.push({ el, pos: pos.clone(), life: 0.8, drift: (Math.random() - 0.5) * 0.8 });
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
      p.life -= dt;
      const k = Math.max(0, p.life / p.max);
      if (p.vel) {
        if (p.gravity) p.vel.y -= p.gravity * dt;
        p.obj.position.addScaledVector(p.vel, dt);
        if (p.stretch) p.obj.lookAt(p.obj.position.clone().add(p.vel));
      }
      if (p.spin) {
        p.obj.rotation.x += p.spin.x * dt;
        p.obj.rotation.y += p.spin.y * dt;
      }
      if (p.bounce) {
        const g = this.world.groundAt(p.obj.position.x, p.obj.position.z, p.obj.position.y + 0.2) + 0.01;
        if (p.obj.position.y < g) {
          p.obj.position.y = g;
          p.vel.y = Math.abs(p.vel.y) * 0.35;
          p.vel.x *= 0.5;
          p.vel.z *= 0.5;
          p.spin.multiplyScalar(0.5);
        }
      }
      if (p.grow) p.obj.scale.multiplyScalar(1 + p.grow * dt);
      if (p.fade !== undefined) p.obj.material.opacity = p.fade * k;
      if (p.fadeMat) p.obj.material.opacity = k;
      if (p.life <= 0) {
        this.scene.remove(p.obj);
        if (p.fadeMat || p.fade !== undefined) p.obj.material.dispose();
        this.live.splice(i, 1);
      }
    }
    const w = innerWidth;
    const h = innerHeight;
    const v = new THREE.Vector3();
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.life -= dt;
      n.pos.y += dt * 1.4;
      n.pos.x += n.drift * dt;
      v.copy(n.pos).project(this.camera);
      n.el.style.display = v.z < 1 ? 'block' : 'none';
      const pop = 1 + Math.max(0, n.life - 0.65) * 6;
      n.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%) scale(${pop})`;
      n.el.style.opacity = Math.min(1, n.life * 3);
      if (n.life <= 0) {
        n.el.remove();
        this.numbers.splice(i, 1);
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
