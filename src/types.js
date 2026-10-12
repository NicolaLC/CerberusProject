// JSDoc typedefs only (editor IntelliSense, no runtime code, nothing imports this file).
// Event payloads: instructions/architecture.md "Events". Payloads marked "reused" are module-level objects: copy what you keep.
// Use in a file with: /** @type {import('./types.js').WeaponHit} */

/** @typedef {import('three').Vector3} Vector3 */

/** @typedef {'pre' | 'simulate' | 'late' | 'present' | 'render'} Phase */

/**
 * What `engine.add()` schedules. Defaults filled by `add`: phase 'simulate', whilePaused false, fails 0, disabled false.
 * A system that throws is counted in `fails`; at `engine.t.failLimit` it is `disabled` and 'engine:systemFailed' fires.
 * @typedef {object} System
 * @property {string} name key in `engine.timings`
 * @property {(dt: number, engine: any) => void} update
 * @property {Phase} [phase]
 * @property {boolean} [whilePaused] runs while the start panel is up
 * @property {boolean} [disabled]
 * @property {number} [fails] consecutive failures
 */

/** 'weapon:shot' (reused) @typedef {{ from: Vector3, to: Vector3, dir: Vector3, right: Vector3, heavy: boolean, beam: boolean, gun: string, flash: number, mag: number }} WeaponShot */
/** 'weapon:hit' (reused) @typedef {{ point: Vector3, normal: Vector3, dir: Vector3, zone: string, amount: number, crit: boolean, weak: boolean, killed: boolean, distance: number }} WeaponHit */
/** 'weapon:impact', 'bolt:impact' (reused) @typedef {{ point: Vector3, normal: Vector3 }} Impact */
/** 'weapon:reload' @typedef {'start' | 'done' | 'good' | 'perfect' | 'jam'} ReloadEvent */
/** 'blast', 'boss:leg', 'boss:dead' (reused; blast kind: mortar, stomp, drone) @typedef {{ point: Vector3, radius: number, kind: string }} Blast */
/** 'boss:step' (reused) @typedef {{ point: Vector3, big: boolean }} BossStep */
/** 'player:hurt' (reused) @typedef {{ amount: number, dir: Vector3 }} PlayerHurt */
/** 'player:jet' (reused; nozzle point, exhaust direction) @typedef {{ point: Vector3, dir: Vector3 }} PlayerJet */
/** 'player:step' (reused) @typedef {{ run: boolean, raised: boolean }} PlayerStep */
/** 'player:coverRun' (reused) @typedef {{ to: Vector3, type: string, collider: any }} CoverRun */
/** 'player:coverCorner' (reused) @typedef {{ kind: string }} CoverCorner */
/** 'player:vaultRefused' (reused) @typedef {{ collider: any, blocker: any }} VaultRefused */
/** 'player:land' @typedef {'vault' | 'jet'} LandKind */
/** 'player:vault' @typedef {'hop' | 'slide'} VaultKind */
/** 'trigger:fired' @typedef {{ id: string, event: string }} TriggerFired */
/** 'checkpoint:reached' @typedef {{ id: string, pos: number[], yaw: number }} Checkpoint */
/** 'group:wake' ({ group }) and 'group:spawn' ({ group, count }) @typedef {{ group: string, count?: number }} GroupEvent */
/** 'mission:objective', 'mission:objective:done' (fresh object) @typedef {{ index: number, total: number, id: string, kind: string, text: string }} MissionObjective */
/** 'mission:complete' @typedef {{ total: number }} MissionComplete */
/** 'mission:failed' @typedef {{ index: number, id: string, reason: string }} MissionFailed */
/** 'engine:resize' @typedef {{ width: number, height: number, pixelRatio: number }} EngineResize */
/** 'engine:systemFailed' @typedef {{ name: string, error: unknown }} SystemFailed */

/**
 * Event name -> payload. Position-only payloads are a Vector3; actor payloads are the actor object.
 * 'weapon:switch' is a gun id; 'weapon:charge' a boolean; 'pickup:collected' a toast label; 'encounter:wake' / 'encounter:spawn' a group name.
 * Events with no payload: weapon:dry, player:coverSlam, pickup:full, arena:clear, engine:contextLost, engine:contextRestored.
 * @typedef {object} EventMap
 * @property {WeaponShot} weapon:shot
 * @property {WeaponHit} weapon:hit
 * @property {Impact} weapon:impact
 * @property {ReloadEvent} weapon:reload
 * @property {string} weapon:switch
 * @property {boolean} weapon:charge
 * @property {any} weapon:armored enemy
 * @property {any} boss:wake boss
 * @property {any} boss:down boss
 * @property {any} boss:charge boss
 * @property {any} boss:stomp boss
 * @property {Vector3} boss:mortar
 * @property {BossStep} boss:step
 * @property {Blast} blast
 * @property {Blast} boss:leg
 * @property {Blast} boss:dead
 * @property {PlayerHurt} player:hurt
 * @property {LandKind} player:land
 * @property {PlayerJet} player:jet
 * @property {VaultKind} player:vault
 * @property {CoverRun} player:coverRun
 * @property {CoverCorner} player:coverCorner
 * @property {VaultRefused} player:vaultRefused
 * @property {PlayerStep} player:step
 * @property {Vector3} enemy:step
 * @property {any} puppet:down puppet
 * @property {any} trooper:flank trooper
 * @property {TriggerFired} trigger:fired
 * @property {Checkpoint} checkpoint:reached
 * @property {GroupEvent} group:wake
 * @property {GroupEvent} group:spawn
 * @property {string} encounter:wake
 * @property {string} encounter:spawn
 * @property {MissionObjective} mission:objective
 * @property {MissionObjective} mission:objective:done
 * @property {MissionComplete} mission:complete
 * @property {MissionFailed} mission:failed
 * @property {Vector3} bolt:fired
 * @property {Impact} bolt:impact
 * @property {string} pickup:collected
 * @property {EngineResize} engine:resize
 * @property {SystemFailed} engine:systemFailed
 */

export {}; // marks this file as a module so the typedefs can be imported
