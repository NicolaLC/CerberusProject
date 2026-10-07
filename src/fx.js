import * as THREE from 'three';

// Pooled, light-count-stable visual effects (never add/remove lights at runtime: it recompiles shaders).
export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.tracers = [];
    this.sparks = [];
    this.decals = [];
    this.numbers = [];
    this.numberLayer = document.getElementById('numbers');

    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe2a8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.sparkGeo = new THREE.BoxGeometry(0.035, 0.035, 0.035);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc070, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.decalGeo = new THREE.PlaneGeometry(0.12, 0.12);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });

    // muzzle flash: permanent light + sprite, toggled by intensity / visibility
    this.flashLight = new THREE.PointLight(0xffb060, 0, 9, 2);
    scene.add(this.flashLight);
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.45, 0.45),
      new THREE.MeshBasicMaterial({ map: flashTexture(), color: 0xffc080, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashTime = 0;
  }

  muzzleFlash(pos, dir) {
    this.flashTime = 0.05;
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 12;
    this.flash.position.copy(pos).addScaledVector(dir, 0.1);
    this.flash.quaternion.copy(this.camera.quaternion);
    this.flash.rotateZ(Math.random() * Math.PI);
    this.flash.scale.setScalar(0.7 + Math.random() * 0.6);
    this.flash.visible = true;
  }

  tracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(geo, this.tracerMat.clone());
    this.scene.add(line);
    this.tracers.push({ obj: line, life: 0.06, max: 0.06 });
  }

  impact(point, normal, color = 0xffc070, count = 8, decal = true) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      m.material = this.sparkMat;
      m.position.copy(point);
      const v = normal.clone().multiplyScalar(2 + Math.random() * 3);
      v.x += (Math.random() - 0.5) * 4;
      v.y += Math.random() * 3;
      v.z += (Math.random() - 0.5) * 4;
      this.scene.add(m);
      this.sparks.push({ obj: m, vel: v, life: 0.25 + Math.random() * 0.25 });
    }
    if (color !== 0xffc070) this.sparks.slice(-count).forEach((s) => (s.obj.material = colored(color)));
    if (decal) {
      const d = new THREE.Mesh(this.decalGeo, this.decalMat);
      d.position.copy(point).addScaledVector(normal, 0.01);
      d.lookAt(d.position.clone().add(normal));
      d.rotateZ(Math.random() * 6.28);
      this.scene.add(d);
      this.decals.push(d);
      if (this.decals.length > 120) this.scene.remove(this.decals.shift());
    }
  }

  number(pos, value, crit) {
    const el = document.createElement('div');
    el.className = 'dmg' + (crit ? ' crit' : '');
    el.textContent = Math.round(value);
    this.numberLayer.appendChild(el);
    this.numbers.push({ el, pos: pos.clone(), life: 0.8, drift: (Math.random() - 0.5) * 0.6 });
  }

  update(dt) {
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.obj.material.opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) {
        this.scene.remove(t.obj);
        t.obj.geometry.dispose();
        t.obj.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.vel.y -= 14 * dt;
      s.obj.position.addScaledVector(s.vel, dt);
      if (s.life <= 0) {
        this.scene.remove(s.obj);
        this.sparks.splice(i, 1);
      }
    }
    const w = innerWidth;
    const h = innerHeight;
    const v = new THREE.Vector3();
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.life -= dt;
      n.pos.y += dt * 1.2;
      n.pos.x += n.drift * dt;
      v.copy(n.pos).project(this.camera);
      const visible = v.z < 1;
      n.el.style.display = visible ? 'block' : 'none';
      n.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
      n.el.style.opacity = Math.min(1, n.life * 3);
      if (n.life <= 0) {
        n.el.remove();
        this.numbers.splice(i, 1);
      }
    }
  }
}

const colorCache = new Map();
function colored(c) {
  if (!colorCache.has(c)) colorCache.set(c, new THREE.MeshBasicMaterial({ color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  return colorCache.get(c);
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
