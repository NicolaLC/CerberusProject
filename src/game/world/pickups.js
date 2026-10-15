import * as THREE from 'three';
import { GUNS } from '../combat/guns.js';
import { disposeTree } from '../../engine/dispose.js';
import { SUPPLY } from './props.js';

// Ammo pickups ("thermal clips"): fixed crates that respawn (level data; the Prologue has none: supply points only). Enemies drop no clips.
// Supply points (supply.ammo / supply.repair, props.js) are used here too: prompt + interact.
// Two ammo classes (guns.js `ammo`): light (cyan: AR, MG, BR) and heavy (orange: SR, RG); the pistol is infinite. A pickup only
// refills its own class. Walk over one to collect it; every gun of the class full = not collected.
// Emits 'pickup:collected' / 'pickup:full'. A gun pickup (pickup.gun) gives a gun the player doesn't own yet (weapon.grant:
// 'weapon:discovered', auto-switch), or that gun's ammo if it is owned; it never respawns.
// Destroyed enemies drop no ammo (owner, 2026-10-14: ammo comes from supply points and placed crates only); `dropGun` drops stay.
const TUNING = {
  respawn: 15,
  radius: 1.1,
};

// Pickup pieces (registry ids, a public contract: instructions/level.md). Data: { id, pos } for a respawning crate
// of that ammo class. Spots live in the level file (7 light, 3 heavy in the arena).
// pickup rings float this far over the pickup's floor: interior floors are 0.02 skins over the ground, so +0.02 z-fought
const RING_Y = 0.05;

export const PICKUP_PIECES = {
  'pickup.light': { example: { params: {} }, label: `light ammo (AR MG BR) | respawns in ${TUNING.respawn} s`, build: (pickups, d) => pickups.addCrate(d.pos, 'light') },
  'pickup.heavy': { example: { params: {} }, label: `heavy ammo (SR RG) | respawns in ${TUNING.respawn} s`, build: (pickups, d) => pickups.addCrate(d.pos, 'heavy') },
  // params: gun (key of GUNS), ammo? (rounds into the reserve, default the gun's crate refill), rack? (lies on a prop.gunRack shelf at pos:
  // no stand, no ring). `yaw` turns it.
  'pickup.gun': {
    example: { params: { gun: 'rifle' } },
    label: 'gun on a stand (or a rack): discovers it, else gives its ammo | no respawn',
    fields: [{ key: 'gun', type: 'enum', options: Object.keys(GUNS) }, { key: 'ammo', type: 'number', min: 0, optional: true }, { key: 'rack', type: 'bool', def: false }],
    build: (pickups, d) => pickups.addGun(d.pos, d.params ?? {}, d.yaw, !d.params?.rack, !!d.params?.rack),
  },
};

export class Pickups {
  // Permanent: shared geometry and materials. Per level (load / unload): the crates and dropped clips (items).
  constructor({ scene, events, registry, world }) {
    this.scene = scene;
    this.world = world; // gun display models (world.gunModel, shared materials in world.keep)
    this.events = events;
    this.registry = registry;
    this.t = TUNING;
    this.items = [];
    this.dropped = new Set(); // guns already dropped by an enemy this level (dropGun with dropOnce)
    this.time = 0;
    this.fullCooldown = 0;
    this.prompt = { label: '', at: null }; // the supply point in reach (HUD interact prompt), see supplyPrompt()
    this.near = null;

    const caseMat = new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.6, roughness: 0.4 });
    caseMat.userData.shared = true; // gun stands use it too: disposeTree leaves it alone
    const hex = { light: 0x38d8ff, heavy: 0xffa11c };
    const looks = {
      light: { glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: hex.light, emissiveIntensity: 3 }), body: [0.34, 0.2, 0.22], band: [0.36, 0.05, 0.24], bandY: [0] },
      // heavy: taller, chunkier case with two bands
      heavy: { glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: hex.heavy, emissiveIntensity: 4 }), body: [0.3, 0.34, 0.3], band: [0.33, 0.05, 0.33], bandY: [-0.08, 0.08] },
    };
    for (const l of Object.values(looks)) {
      l.bodyGeo = new THREE.BoxGeometry(...l.body);
      l.bandGeo = new THREE.BoxGeometry(...l.band);
    }
    this.makeModel = (scale, type) => {
      const l = looks[type];
      const g = new THREE.Group();
      const body = new THREE.Mesh(l.bodyGeo, caseMat);
      body.castShadow = true;
      g.add(body);
      for (const y of l.bandY) {
        const band = new THREE.Mesh(l.bandGeo, l.glow);
        band.position.y = y;
        g.add(band);
      }
      g.scale.setScalar(scale);
      return g;
    };
    this.ringGeo = new THREE.RingGeometry(0.45, 0.55, 32).rotateX(-Math.PI / 2);
    const ringMat = (c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2), transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.ringMats = { light: ringMat(hex.light), heavy: ringMat(hex.heavy), gun: ringMat(0xeaf6fa) };
    this.standMat = caseMat;
  }

  // Builds the crates of a level file (registry pieces owned by 'pickups'). Unloads the current items first.
  load(level) {
    this.unload();
    for (const piece of this.registry.piecesOf(level, 'pickups')) this.registry.build('pickups', this, piece);
    return this;
  }

  // Removes every crate, dropped clip and gun stand. Shared geometry and materials stay; gun models are freed (#free).
  unload() {
    for (const it of this.items) this.#free(it);
    this.items.length = 0;
    this.dropped.clear();
    this.time = 0;
    this.fullCooldown = 0;
  }

  // a fixed crate that respawns after it is collected
  addCrate(pos, type) {
    return this.#spawn(new THREE.Vector3(...pos), { crate: true, type });
  }

  // a gun on a stand (pickup.gun). Stand and gun geometry are the item's own, freed with it: a shared stand geometry would
  // upload on the first gun stand drawn and break the exact GPU memory check in scenes.browser.mjs.
  // `stand: false` lays the bare gun on the floor (an enemy drop).
  addGun(pos, { gun, ammo }, yaw = 0, stand = true, rack = false) {
    if (ammo != null && !(typeof ammo === 'number' && ammo >= 0)) throw new Error(`pickup.gun: ammo must be a number >= 0, got ${JSON.stringify(ammo)}`);
    const gunModel = this.world.gunModel(gun, 'pickup.gun');
    gunModel.position.set(0, 0.82, -0.45);
    gunModel.traverse((o) => (o.castShadow = o.isMesh));
    if (stand) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.8, 1.0).translate(0, 0.4, 0), this.standMat); // waist-high, the gun lies along +Z
      post.castShadow = true;
      gunModel.add(post);
      post.position.set(0, -0.82, 0.45);
    } else gunModel.position.y = rack ? 0.1 : 0.3; // rack: lying on the shelf at pos
    const model = new THREE.Group().add(gunModel);
    model.position.set(...pos);
    model.rotation.y = yaw;
    const ring = new THREE.Mesh(this.ringGeo, this.ringMats.gun);
    ring.position.set(pos[0], pos[1] + RING_Y, pos[2]);
    ring.scale.setScalar(1.5);
    ring.visible = !rack; // the rack's class band marks it
    this.scene.add(model, ring);
    const item = { pos: new THREE.Vector3(...pos), model, ring, gunModel, gun, ammo: ammo ?? GUNS[gun].pickup?.crate ?? 0, crate: false, active: true, trial: rack };
    this.items.push(item);
    return item;
  }

  // A gun an enemy leaves behind (enemy params dropGun, dropAmmo, dropOnce): `drop` = { gun, ammo?, once? }. Nothing if the player
  // already owns the gun, or if `once` (default true) and a gun of this id was already dropped in this level. Returns the item or null.
  dropGun(pos, { gun, ammo, once = true }, owned) {
    if (owned.has(gun) || (once && this.dropped.has(gun))) return null;
    this.dropped.add(gun);
    return this.addGun([pos.x, pos.y, pos.z], { gun, ammo: ammo ?? GUNS[gun].pickup?.drop }, 0, false);
  }

  #spawn(pos, { crate, type }) {
    const model = this.makeModel(crate ? 1.3 : 0.9, type);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMats[type]);
    ring.position.copy(pos).y += RING_Y;
    model.position.copy(pos);
    this.scene.add(model, ring);
    const item = { pos: pos.clone(), model, ring, crate, type, active: true, timer: 0, phase: Math.random() * 6 };
    this.items.push(item);
    return item;
  }

  update(dt, player, weapon, interact = false) {
    this.time += dt;
    this.fullCooldown -= dt;
    this.#supplies(dt, player, weapon, interact);
    this.ringMats.gun.opacity = 0.35 + 0.25 * Math.sin(this.time * 1.6); // slow highlight on every gun stand

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.active) {
        it.timer -= dt;
        if (it.timer <= 0) {
          it.active = true;
          it.model.visible = it.ring.visible = true;
        }
        continue;
      }
      if (it.gun) {
        if (this.#reached(player, it)) this.#takeGun(i, it, weapon);
        continue;
      }
      it.model.position.y = it.pos.y + 0.45 + Math.sin(this.time * 2.5 + it.phase) * 0.08;
      it.model.rotation.y += dt * 1.5;

      if (!this.#reached(player, it)) continue;
      const got = weapon.addAmmo(it.crate ? 'crate' : 'drop', it.type);
      if (!got) {
        if (this.fullCooldown <= 0) this.events.emit('pickup:full');
        this.fullCooldown = 1.4;
        continue;
      }
      this.events.emit('pickup:collected', got);
      if (it.crate) {
        it.active = false;
        it.timer = this.t.respawn;
        it.model.visible = it.ring.visible = false;
      } else {
        this.#remove(i);
      }
    }
  }

  // Supply points (props.js supply.ammo / supply.repair, world.supplies): the nearest one in reach sets the HUD prompt; interact uses it.
  // Ammo refills the owned guns of its classes to max (weapon.refill), repair restores health and shields; both toast and play the
  // pickup sound (pickup:collected), nothing to do = pickup:full ("AMMO FULL") / "SYSTEMS NOMINAL".
  #supplies(dt, player, weapon, interact) {
    this.near = null;
    let best = SUPPLY.reach ** 2;
    for (const o of this.world.supplies) {
      const s = o.userData.supply;
      s.cool -= dt;
      const dx = player.pos.x - o.position.x;
      const dz = player.pos.z - o.position.z;
      const d = dx * dx + dz * dz;
      if (d <= best && Math.abs(player.pos.y - o.position.y) < 1.5) {
        best = d;
        this.near = s;
      }
    }
    const s = this.near;
    if (!s || player.dead || !interact || s.cool > 0) return;
    s.cool = SUPPLY.cooldown;
    if (s.kind === 'ammo') {
      const got = weapon.refill(s.ammo);
      if (got) this.events.emit('pickup:collected', got);
      else this.events.emit('pickup:full');
    } else {
      const hp = player.t.maxHealth - player.health + player.t.maxShields - player.shields;
      if (hp < 1) return void this.events.emit('pickup:collected', 'SYSTEMS NOMINAL');
      player.health = player.t.maxHealth;
      player.shields = player.t.maxShields;
      this.events.emit('pickup:collected', `REPAIRED  +${Math.round(hp)}`);
      this.events.emit('player:repaired');
    }
  }

  // The HUD interact prompt for the supply point in reach, else null (reused object).
  supplyPrompt(player) {
    if (!this.near || player.dead) return null;
    this.prompt.label = this.near.prompt;
    this.prompt.at = this.near.at;
    return this.prompt;
  }

  #reached(player, it) {
    const dx = player.pos.x - it.pos.x;
    const dz = player.pos.z - it.pos.z;
    return !player.dead && dx * dx + dz * dz <= this.t.radius ** 2 && Math.abs(player.pos.y - it.pos.y) <= 1.2;
  }

  // A new gun is granted and raised; an owned one only takes the ammo (stays while that gun is full).
  #takeGun(i, it, weapon) {
    if (weapon.owned.has(it.gun)) {
      const got = weapon.grant(it.gun, { ammo: it.ammo });
      if (!got) {
        if (this.fullCooldown <= 0) this.events.emit('pickup:full');
        this.fullCooldown = 1.4;
        return;
      }
      this.events.emit('pickup:collected', `${GUNS[it.gun].short} AMMO  +${got}`);
    } else {
      weapon.grant(it.gun, { ammo: it.ammo, trial: it.trial });
      weapon.switchTo(it.gun);
    }
    this.#remove(i);
  }

  // Removes one item built by addCrate() / addGun() (tools); dropped clips use #remove.
  despawn(item) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.#remove(i);
  }

  #remove(i) {
    this.#free(this.items[i]);
    this.items.splice(i, 1);
  }

  // Detaches an item; a gun stand's geometry (gun model + stand) is its own and is freed (crate and ring geometry are shared).
  #free(it) {
    if (it.gunModel) disposeTree(it.gunModel, { keep: this.world.keep });
    this.scene.remove(it.model, it.ring);
  }
}
