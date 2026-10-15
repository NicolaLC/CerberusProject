// Page-side helpers shared by the Prologue suites (prologue, prologue-purge, prologue-exit, prologue-warden): pass `prologueHelpers`
// to page.evaluate after the suite has set up window.T with `step(s)` and `press(code)`. Not a suite (no .browser.mjs).
// The chain is walked the way a player would end each step: the player is put where the step is done (reach / interact / the
// rack guns), kills go through damage(), moves the tests cannot steer by keys in a few frames (cover slam, vault, slide, cover
// run) are their player:* events, cuts are skipped with a fire press. Nothing calls into Mission directly.
export function prologueHelpers() {
  const g = window.game;
  const { engine } = g;
  const T = window.T;
  const V = g.player.pos.constructor;
  T.cur = () => g.mission.current?.oid ?? g.mission.state;
  T.group = (n) => g.enemies.all.filter((e) => e.squad === (typeof n === 'number' ? `purge-${n}` : n));
  T.awake = () => [...new Set(g.enemies.all.filter((e) => e.alive && e.awake && e.squad != null).map((e) => e.squad))].sort();
  T.kill = (e) => {
    if (e.legs) {
      const dir = new V(0, 0, -1);
      for (const l of e.legs) e.damage(500, l.foot, dir, 'weak', l.knee);
      for (let i = 0; i < 30 && e.alive; i++) e.damage(100, e.pos, dir, 'weak', e.core);
    } else for (let i = 0; i < 80 && e.alive; i++) e.damage(100, e.pos.clone().setY(1), new V(0, 0, -1), 'body');
  };
  T.killGroup = (n) => T.group(n).forEach(T.kill);
  T.put = (x, y, z, s = 0.1) => {
    g.player.pos.set(x, y, z);
    g.player.vel?.set(0, 0, 0);
    T.step(s);
  };
  T.go = (x, z, s = 0.1) => T.put(x, 0, z, s);
  // a cinematic (intro or cut) or the boot overlay is up: fire presses (after their 0.3 s guard) until all are gone
  T.skipScripted = () => {
    for (let i = 0; i < 40 && (g.cinematic.active || g.boot.active); i++) {
      T.step(0.4);
      T.press('Mouse0');
    }
    T.step(0.2);
  };
  T.skipIntro = () => {
    T.step(1 / 60);
    T.skipScripted();
  };
  // fires the held gun until `done()` (or 4 s): semi-autos need a press edge per shot
  T.fireUntil = (done) => {
    engine.input.keys.add('Mouse0');
    for (let i = 0; i < 240 && !done(); i++) {
      engine.input.pressed.add('Mouse0');
      T.step(1 / 60);
    }
    engine.input.keys.delete('Mouse0');
  };
  // Ends the current objective. `rifle`: walk past the landing KR-7 on the way out of the range (false: around it). `rack`: take an
  // optional interact (G); false: walk into its skipOn trigger instead (the armoury skipped, nothing granted).
  T.finish = ({ rifle = true, rack = true } = {}) => {
    const r = g.mission.current;
    if (!r) return;
    const id = r.oid;
    const moved = () => g.mission.current !== r;
    const { x, y, z } = r.pos;
    if (r.obj === 'reach' && r.params.trigger != null) {
      // a cut waits for its end: let it start, then skip it
      T.step(0.2);
      T.skipScripted();
    } else if (r.obj === 'reach') {
      if (id === 'leave-bay') {
        T.go(-48.8, 28.3, 0.2); // the range-return doorway (takes the range guns back), clear of the landing KR-7
        if (rifle) T.go(-48.2, 26.5, 0.6);
      }
      T.put(x, y, z, 0.2);
    } else if (r.obj === 'interact' && !rack && r.params.skipOn != null) {
      const t = g.level.pieces.find((q) => q.id === 'trigger.volume' && q.name === r.params.skipOn);
      T.put(t.pos[0], t.pos[1], t.pos[2], 0.2);
    } else if (r.obj === 'interact') {
      T.put(x, y, z, 0.1);
      T.press('KeyG');
      T.step(0.1);
    } else if (r.obj === 'destroy') {
      if (r.params.group != null) T.killGroup(r.params.group);
      T.step(0.2);
    } else if (r.obj === 'action') {
      const a = r.params.action;
      if (a === 'fire') {
        // a rack gun of that ammo class: walking onto it takes and raises it
        const it = g.pickups.items.find((i) => i.gun && i.pos.x < -51 && GUN_AMMO[i.gun] === r.params.ammo); // a rack in the range (x < -51), not the landing KR-7
        // stand 0.9 m in front of it, toward the middle of the range (the rack is against a wall)
        const dx = -61 - it.pos.x;
        const dz = 31 - it.pos.z;
        const k = 0.9 / Math.hypot(dx, dz);
        T.go(it.pos.x + dx * k, it.pos.z + dz * k, 1.2);
        T.fireUntil(moved);
      } else {
        T.put(x, y, z, 0.1);
        const ev = { cover: ['player:coverSlam'], vault: ['player:vault', 'hop'], slide: ['player:vault', 'slide'], coverRun: ['player:coverRun', {}], jet: ['player:jet', {}] }[a];
        for (let i = 0; i < (r.params.count ?? 1); i++) engine.events.emit(...ev);
        T.step(0.1);
      }
    }
    if (g.mission.current === r) throw new Error(`T.finish: ${id} did not end`);
  };
  const GUN_AMMO = { rifle: 'light', mg: 'light', burst: 'light', sniper: 'heavy', rail: 'heavy' };
  // finishes objectives until `oid` is current (or the mission ended)
  T.advanceTo = (oid, opts) => {
    for (let i = 0; i < 40 && g.mission.state === 'active' && T.cur() !== oid; i++) T.finish(opts);
    if (T.cur() !== oid) throw new Error(`T.advanceTo: stopped at ${T.cur()}, wanted ${oid}`);
  };
}
