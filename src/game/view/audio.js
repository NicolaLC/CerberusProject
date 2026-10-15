import arShot from '../../assets/sfx/ar-shot.mp3';
import mgShot from '../../assets/sfx/mg-shot.mp3';
import sniperShot from '../../assets/sfx/sniper-shot.mp3';
import sniperBolt from '../../assets/sfx/sniper-bolt.mp3';
import burstShot from '../../assets/sfx/burst-shot.mp3';
import railShot from '../../assets/sfx/rail-shot.mp3';
import railCharge from '../../assets/sfx/rail-charge.mp3';
import pistolShot from '../../assets/sfx/pistol-shot.mp3';
import mgSpin from '../../assets/sfx/mg-spin.mp3';
import dryFire from '../../assets/sfx/dry-fire.mp3';
import reloadRifle from '../../assets/sfx/reload-rifle.mp3';
import reloadMg from '../../assets/sfx/reload-mg.mp3';
import reloadPerfect from '../../assets/sfx/reload-perfect.mp3';
import reloadJam from '../../assets/sfx/reload-jam.mp3';
import switchGun from '../../assets/sfx/switch.mp3';
import stepWalk1 from '../../assets/sfx/step-walk-1.mp3';
import stepMetal1 from '../../assets/sfx/step-metal-1.mp3';
import stepRobot1 from '../../assets/sfx/step-robot-1.mp3';
import stepWalk2 from '../../assets/sfx/step-walk-2.mp3';
import stepWalk3 from '../../assets/sfx/step-walk-3.mp3';
import stepWalk4 from '../../assets/sfx/step-walk-4.mp3';
import stepMetal2 from '../../assets/sfx/step-metal-2.mp3';
import stepMetal3 from '../../assets/sfx/step-metal-3.mp3';
import stepMetal4 from '../../assets/sfx/step-metal-4.mp3';
import stepRobot2 from '../../assets/sfx/step-robot-2.mp3';
import stepRobot3 from '../../assets/sfx/step-robot-3.mp3';
import stepRobot4 from '../../assets/sfx/step-robot-4.mp3';
import hitBody from '../../assets/sfx/hit-body.mp3';
import hitHead from '../../assets/sfx/hit-head.mp3';
import hitWeak from '../../assets/sfx/hit-weak.mp3';
import killSfx from '../../assets/sfx/kill.mp3';
import lowMag from '../../assets/sfx/low-mag.mp3';
import reloadGood from '../../assets/sfx/reload-good.mp3';
import jetSfx from '../../assets/sfx/jet.mp3';
import landSfx from '../../assets/sfx/land.mp3';
import hurtSfx from '../../assets/sfx/hurt.mp3';
import pickupSfx from '../../assets/sfx/pickup.mp3';
import pickupFull from '../../assets/sfx/pickup-full.mp3';
import enemyShot from '../../assets/sfx/enemy-shot.mp3';
import boltImpact from '../../assets/sfx/bolt-impact.mp3';
import robotDown from '../../assets/sfx/robot-down.mp3';
import explosion from '../../assets/sfx/explosion.mp3';
import alarmSiren from '../../assets/sfx/alarm-siren.mp3';
import bossWake from '../../assets/sfx/boss-wake.mp3';
import bossCharge from '../../assets/sfx/boss-charge.mp3';
import bossStomp from '../../assets/sfx/boss-stomp.mp3';
import bossStep from '../../assets/sfx/boss-step.mp3';
import bossSlam from '../../assets/sfx/boss-slam.mp3';
import bossMortar from '../../assets/sfx/boss-mortar.mp3';
import bossLeg from '../../assets/sfx/boss-leg.mp3';
import bossDeath from '../../assets/sfx/boss-death.mp3';
import bossLoop from '../../assets/sfx/boss-loop.mp3';
import wakeSurge from '../../assets/sfx/wake-surge.mp3';
import wakeCore from '../../assets/sfx/wake-core.mp3';
import wakeRise from '../../assets/sfx/wake-rise.mp3';
import gateOpen from '../../assets/sfx/gate-open.mp3';
import objectiveNew from '../../assets/sfx/objective-new.mp3';
import objectiveDone from '../../assets/sfx/objective-done.mp3';
import gunDiscovered from '../../assets/sfx/gun-discovered.mp3';
import missionComplete from '../../assets/sfx/mission-complete.mp3';
import { VIEW_ABOVE } from '../world/world.js';
import armRetract from '../../assets/sfx/arm-retract.mp3';
import bayHumLoop from '../../assets/sfx/bay-hum-loop.mp3';
import consoleLoop from '../../assets/sfx/console-loop.mp3';
import droneLoop from '../../assets/sfx/drone-loop.mp3';
import ambientLoop from '../../assets/sfx/ambient-loop.mp3';
import combatMusic from '../../assets/sfx/combat-music.mp3';
import bossMusic from '../../assets/sfx/boss-music.mp3';
import menuMusic from '../../assets/sfx/menu-music.mp3';

// SFX: synthesized at runtime, plus recorded samples (ElevenLabs, see credits.md) where one exists.
// A sample replaces its synth sound once decoded; until then (or if loading fails) the synth plays.
// Context is created on first user gesture.
// [url or [takes...], gain, pitch spread (±, playback rate)] per sample id; with takes, one is picked at random. Every play also varies its volume by ±GAIN_SPREAD.
const SAMPLES = {
  rifle: [arShot, 0.6, 0.09], // shots are keyed by gun id
  mg: [mgShot, 0.5, 0.08],
  sniper: [sniperShot, 0.75, 0.06],
  burst: [burstShot, 0.55, 0.09],
  rail: [railShot, 0.7, 0.06],
  pistol: [pistolShot, 0.55, 0.1],
  sniperBolt: [sniperBolt, 0.5, 0.07],
  railCharge: [railCharge, 0.6, 0.04],
  mgSpin: [mgSpin, 0.35, 0], // looped, pitch and volume follow the spin
  dry: [dryFire, 0.5, 0.1],
  reload: [reloadRifle, 0.5, 0.06], // every gun but the MG
  reloadMg: [reloadMg, 0.5, 0.05],
  perfect: [reloadPerfect, 0.5, 0.04],
  jam: [reloadJam, 0.5, 0.06],
  switch: [switchGun, 0.9, 0.1],
  stepWalk: [[stepWalk1, stepWalk2, stepWalk3, stepWalk4], 0.55, 0.1], // player on the floor
  stepMetal: [[stepMetal1, stepMetal2, stepMetal3, stepMetal4], 0.4, 0.1], // player on anything raised (platform, stairs, blocks)
  stepRobot: [[stepRobot1, stepRobot2, stepRobot3, stepRobot4], 0.45, 0.12], // troopers and moving puppets, quieter with distance
  hitBody: [hitBody, 0.55, 0.08], // hit confirms: UI-like, must cut through gunfire
  hitHead: [hitHead, 0.6, 0.05],
  hitWeak: [hitWeak, 0.6, 0.05],
  kill: [killSfx, 0.7, 0.04],
  lowMag: [lowMag, 0.4, 0], // pitched by the rounds left (lowMag())
  reloadGood: [reloadGood, 0.5, 0.06],
  jet: [jetSfx, 0.55, 0.06],
  land: [landSfx, 0.5, 0.1],
  hurt: [hurtSfx, 0.6, 0.08],
  pickup: [pickupSfx, 0.5, 0.04],
  pickupFull: [pickupFull, 0.35, 0.03],
  enemyShot: [enemyShot, 0.35, 0.1], // enemy voices: capped (VOICE_CAP)
  boltImpact: [boltImpact, 0.3, 0.12],
  robotDown: [robotDown, 0.55, 0.1],
  explosion: [explosion, 0.7, 0], // pitched by blast size (blast())
  siren: [alarmSiren, 0.4, 0], // looped (siren()): a low horn blast every ~3 s, gaps between (the old continuous wail grated)
  bossWake: [bossWake, 0.7, 0],
  bossCharge: [bossCharge, 0.55, 0.04],
  bossStomp: [bossStomp, 0.6, 0.05],
  bossStep: [bossStep, 0.55, 0.1],
  bossSlam: [bossSlam, 0.8, 0.05],
  bossMortar: [bossMortar, 0.6, 0.06],
  bossLeg: [bossLeg, 0.75, 0.04],
  bossDeath: [bossDeath, 0.85, 0],
  bossLoop: [bossLoop, 0.25, 0], // looped while the boss is awake (engine())
  wakeSurge: [wakeSurge, 0.7, 0], // intro cinematic (cinematic:wake; else the boot, wake()): power comes back,
  wakeCore: [wakeCore, 0.6, 0], // STEM-00's core lights,
  wakeRise: [wakeRise, 0.6, 0], // it straightens (stretched over wake.rise)
  gateOpen: [gateOpen, 0.6, 0.05],
  objectiveNew: [objectiveNew, 0.4, 0.02],
  objectiveDone: [objectiveDone, 0.5, 0.02],
  gunDiscovered: [gunDiscovered, 0.6, 0.03],
  missionComplete: [missionComplete, 0.7, 0],
  armRetract: [armRetract, 0.5, 0.03], // prop:retract, positional (ARM_RANGE)
  bayHum: [bayHumLoop, 0.2, 0], // looped bed, fades in while the camera is in an interior zone (mood())
  consoleLoop: [consoleLoop, 0.3, 0], // one looped voice, gain by the nearest prop.console (CONSOLE_RANGE)
  droneLoop: [droneLoop, 0.35, 0], // one looped voice, gain by the nearest alive drone (DRONE_RANGE)
  ambient: [ambientLoop, 0.3, 0], // looped from the first gesture on (mood())
  music: [combatMusic, 0.5, 0], // looped while fighting (mood())
  bossMusic: [bossMusic, 0.38, 0], // looped from boss:wake to boss:dead, instead of `music`
  menuMusic: [menuMusic, 0.35, 0], // looped while the start / pause panel is up (engine paused)
};
// Combat music: fades in on a combat signal (COMBAT_ON) and out `hold` s after the last one, sooner when the fight ends
// (COMBAT_OFF). While the boss is awake its own track plays instead (crossfaded). The ambience ducks under the music.
// Fades are time constants (s) for setTargetAtTime. Every track file is a baked seamless loop (its last bar crossfaded
// into its first, see instructions/sfx-prompts.md), so it loops whole.
const MUSIC = { hold: 10, fadeIn: 0.5, fadeOut: 1.3, duck: 0.5 };
const COMBAT_ON = ['bolt:fired', 'player:hurt', 'group:wake', 'encounter:wake', 'boss:wake', 'trooper:flank', 'alarm:on'];
const COMBAT_OFF = ['arena:clear', 'boss:dead', 'mission:complete', 'mission:failed', 'alarm:clear'];
// Wake-up cues. Intro cinematic: the surge on `cinematic:wake`, the core CORE_DELAY s later, the rise stretched to wake.rise.
// Fallback for a level with an `intro.boot` and no cinematic, in s from `intro:start`: the surge, the core right after it;
// the rise (5 s) ends with the intro.
const WAKE = { surge: 2.4, core: 3.4, rise: 5 };
const CORE_DELAY = 1;
const ARM_RANGE = 20; // m from the camera where a folding arm fades out
const CONSOLE_RANGE = 6;
const DRONE_RANGE = 25;
const BED_FADE = 0.5; // s, time constant of the bed loops' gain
const RUN_STEP = { gain: 1.15, rate: 1.08 }; // sprint steps vs walk steps (same takes)
const HIT_SAMPLE = { body: 'hitBody', head: 'hitHead', weak: 'hitWeak' };
const ENEMY_STEP_RANGE = 28; // m from the camera where enemy steps fade out
const GAIN_SPREAD = 0.12;
const BOLT_DELAY = 0.22; // s after a sniper shot before the bolt is worked
// Enemy voices playing at once, per sound id (steps, bolts, blasts). Over the cap a new voice is skipped.
// The player's own sounds are never capped.
const VOICE_CAP = 6;
// Menu UI (ui(kind)): recorded `ui-<kind>.mp3` when present (globbed, so a missing file is fine), else the synth.
// Played on their own bus, outside the game's pause / slow-mo. move / slider are rate-limited (s apart).
const UI_GAIN = 0.8;
const UI_GAP = { move: 0.04, slider: 0.03 };
for (const [path, url] of Object.entries(import.meta.glob('../../assets/sfx/ui-*.mp3', { eager: true, query: '?url', import: 'default' }))) {
  SAMPLES[path.slice(path.lastIndexOf('/') + 1, -4)] = [url, 0.6, 0.03]; // id 'ui-<kind>'
}
// Title music (title(on)): `menuMusic`, its own loop while the title is up (the engine is idle there, so mood() is not called).
const MENU = { gain: 0.35, fadeIn: 1.5, fadeOut: 0.6 };

// Sample bytes. The single-file artifact build inlines samples as base64 data: URLs, which its page's content
// policy won't fetch, so those are decoded here instead.
function bytes(url) {
  if (!url.startsWith('data:')) return fetch(url).then((r) => r.arrayBuffer());
  return new Promise((resolve) => {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    resolve(out.buffer);
  });
}

export class Audio {
  // weapon: read for the gun being reloaded (the reload event carries no gun id)
  // listener: where the ears are (the camera), for distance falloff of enemy steps and the beds
  constructor(weapon, listener, world = null, enemies = null) {
    this.weapon = weapon;
    this.listener = listener;
    this.world = world; // interior zones and console positions, for the beds
    this.enemies = enemies; // the drones, for the drone hum
    this.ctx = null;
    this.samples = {}; // id -> decoded AudioBuffers (one per take)
    this.voice = {}; // id -> playing source that may be cut short (reload, rail charge)
    this.sirenNode = null; // the alarm siren voices, while it plays
    this.sirenWanted = false;
    this.engineLoop = null; // the boss's looped engine, while it is awake
    this.wakeFrom = 0; // performance.now() of the running boot intro, 0 when none
    this.wakeVoices = []; // its scheduled cues, cut on a skip
    this.combatAt = -Infinity; // s (performance clock) of the last combat signal
    this.bossFight = false; // boss:wake .. boss:dead
    this.track = null; // id of the music track (fading) in, null when none
    this.tracks = {}; // id -> its looping source, started on first use and kept running (silent when off)
    this.ambientLoop = null;
    this.titleOn = false; // the title is up (title())
    this.menuLoop = null; // the title music's looping source, started once decoded
    this.beds = {}; // id -> looping source of a bed (bayHum, consoleLoop, droneLoop), started once decoded
    this.bedLevel = {}; // id -> the 0..1 level last sent to its gain
    this.cinema = false; // an intro cinematic ran this run: the boot's wake cues are not scheduled
    this.riseLen = 2; // wake.rise of the cinematic
    this.live = new Map(); // id -> enemy voices still playing (VOICE_CAP)
  }

  // Sound reactions to gameplay events.
  listen(events) {
    events.on('weapon:shot', (s) => {
      if (!this.sample(s.gun)) {
        if (s.gun === 'sniper') this.snipe();
        else if (s.beam) this.rail();
        else this.shot(s.heavy);
      }
      if (s.gun === 'sniper' && this.samples.sniper) this.sample('sniperBolt', BOLT_DELAY);
      if (s.mag <= 0.2) this.lowMag(s.mag); // last rounds: a rising click warns before the mag runs dry
    });
    events.on('weapon:hit', (h) => {
      if (h.killed) this.sample('kill') || this.kill();
      else {
        const kind = h.weak ? 'weak' : h.crit ? 'head' : 'body';
        this.sample(HIT_SAMPLE[kind]) || this.hit(kind);
      }
    });
    events.on('weapon:switch', () => {
      this.#cut('reload');
      this.#cut('railCharge');
      this.sample('switch') || this.click();
    });
    events.on('weapon:charge', (on) => {
      if (!on) this.#cut('railCharge');
      else if (!this.#voice('railCharge')) this.railCharge();
    });
    events.on('weapon:dry', () => this.sample('dry') || this.click());
    events.on('weapon:reload', (kind) => {
      if (kind === 'start') this.#voice(this.weapon?.current === 'mg' ? 'reloadMg' : 'reload') || this.click();
      else if (kind === 'done') this.samples.reload || this.click(); // the reload sample ends on its own click
      else {
        this.#cut('reload'); // good / perfect finish it now; a jam stops it (the reload drags on, silent)
        if (kind === 'perfect') this.sample('perfect') || this.perfect();
        else if (kind === 'jam') this.sample('jam') || this.jam();
        else this.sample('reloadGood') || this.click();
      }
    });
    events.on('puppet:down', () => this.sample('robotDown', 0, 1, true) || this.thud());
    events.on('player:hurt', () => this.sample('hurt') || this.thud());
    events.on('player:shieldBreak', () => this.sample('shieldBreak') || this.zap(0.45));
    events.on('player:jet', () => this.sample('jet') || this.jet());
    events.on('player:land', () => this.sample('land') || this.land());
    events.on('bolt:fired', () => this.sample('enemyShot', 0, 1, true) || this.zap(0.12));
    events.on('bolt:impact', () => this.sample('boltImpact', 0, 1, true));
    events.on('blast', (b) => (b.kind === 'stomp' && this.sample('bossSlam')) || this.blast(Math.min(1.2, 0.4 + b.radius / 6)));
    events.on('boss:leg', () => this.sample('bossLeg') || this.boom(0.8));
    events.on('enemy:plate', () => this.sample('plateOff') || this.sample('bossLeg', 0, 0.6) || this.boom(0.35));
    events.on('boss:dead', () => {
      this.engine(false);
      this.sample('bossDeath') || this.boom(1.4);
    });
    events.on('boss:step', () => this.sample('bossStep', 0, 1, true) || this.thud());
    events.on('boss:charge', () => this.sample('bossCharge') || this.charge());
    events.on('boss:stomp', () => this.sample('bossStomp') || this.charge());
    events.on('boss:mortar', () => this.sample('bossMortar') || this.zap(0.25));
    events.on('boss:wake', () => {
      this.engine(true);
      this.sample('bossWake') || this.charge();
    });
    events.on('pickup:collected', () => this.sample('pickup') || this.pickup());
    events.on('pickup:full', () => this.sample('pickupFull'));
    events.on('gate:open', () => this.sample('gateOpen'));
    events.on('mission:objective', () => this.sample('objectiveNew'));
    events.on('mission:objective:done', (e) => !e.skipped && this.sample('objectiveDone')); // a skipped optional objective is silent
    events.on('weapon:discovered', () => this.sample('gunDiscovered'));
    events.on('mission:complete', () => this.sample('missionComplete'));
    events.on('intro:start', (e) => this.cinema || this.wake(e.duration));
    events.on('cinematic:start', (e) => {
      this.cinema = true;
      this.riseLen = e.wake?.rise ?? 2;
      this.wake(0);
    });
    events.on('cinematic:wake', () => this.#wakeNow());
    events.on('cinematic:done', (e) => e.skipped && this.wake(0));
    events.on('prop:retract', (e) => {
      if (!this.listener) return;
      const f = 1 - this.listener.position.distanceTo(e.pos) / ARM_RANGE;
      if (f > 0.05) this.sample('armRetract', 0, f * f);
    });
    for (const e of COMBAT_ON) events.on(e, () => (this.combatAt = performance.now() / 1000));
    for (const e of COMBAT_OFF) events.on(e, () => (this.combatAt = -Infinity));
    events.on('boss:wake', () => (this.bossFight = true));
    for (const e of COMBAT_OFF) events.on(e, () => (this.bossFight = false)); // boss:dead, or the level ends
    events.on('intro:done', (e) => e.skipped && this.wake(0));
    events.on('alarm:on', (a) => a.siren && this.siren(true));
    events.on('alarm:off', (a) => !a.active && this.siren(false));
    events.on('alarm:clear', () => {
      this.cinema = false; // the level unloads
      this.siren(false);
      this.engine(false); // the level unloads: a boss left awake goes quiet too
    });
    events.on('ui:type', (e) => this.type(e.end));
    events.on('ui:sfx', (e) => this.ui(e?.kind));
    events.on('player:step', (s) => {
      // sprinting reuses the walking takes, a little louder and higher, so the two gaits sound like the same boots
      const src = this.sample(s.raised ? 'stepMetal' : 'stepWalk', 0, s.run && !s.raised ? RUN_STEP.gain : 1);
      if (src && s.run && !s.raised) src.playbackRate.value *= RUN_STEP.rate;
    });
    events.on('enemy:step', (pos) => {
      if (!this.listener) return;
      const f = 1 - this.listener.position.distanceTo(pos) / ENEMY_STEP_RANGE;
      if (f > 0.1) this.sample('stepRobot', 0, f * f, true);
    });
    return this;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume(); // e.g. created from a gamepad press (no user gesture)
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    this.uiBus = this.ctx.createGain();
    this.uiBus.gain.value = UI_GAIN;
    this.uiBus.connect(this.master);
    if (this.sirenWanted) this.siren(true); // an alarm that started before the first gesture
    if (this.wakeFrom) this.#wakeCues(); // an intro that started before it
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    for (const [id, [urls]] of Object.entries(SAMPLES)) {
      for (const url of [urls].flat()) {
        bytes(url)
          .then((b) => this.ctx.decodeAudioData(b))
          .then((buf) => {
            (this.samples[id] ??= []).push(buf);
            if (id === 'menuMusic') this.title(this.titleOn); // the title was up before it decoded
          })
          .catch(() => {}); // keep the synth sound
      }
    }
  }

  // Plays the recorded sample for `id` (slightly detuned each time so repeats don't sound like a loop),
  // `delay` seconds from now, at `volume` times its gain. `enemy` voices count against VOICE_CAP.
  // Returns its source node, or null if there is no sample (yet) or the cap is full: the caller falls back
  // to its synth sound.
  sample(id, delay = 0, volume = 1, enemy = false) {
    const takes = this.ctx && this.samples[id];
    if (!takes) return null;
    if (enemy && !this.#room(id)) return null;
    const [, gain, spread] = SAMPLES[id];
    const src = this.ctx.createBufferSource();
    src.buffer = takes[(Math.random() * takes.length) | 0];
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * spread;
    src.gain = this.ctx.createGain();
    src.gain.gain.value = gain * volume * (1 + (Math.random() * 2 - 1) * GAIN_SPREAD);
    src.connect(src.gain).connect(id.startsWith('ui-') ? this.uiBus : this.master);
    src.start(this.ctx.currentTime + delay);
    if (enemy) this.#hold(id, src);
    return src;
  }

  // Enemy voice cap: #room says whether another voice of `id` may start, #hold counts `node` until it ends.
  // 'ended' (not onended) so it doesn't clash with #voice's handler on the same node.
  #room(id) {
    return (this.live.get(id) ?? 0) < VOICE_CAP;
  }

  #hold(id, node) {
    this.live.set(id, (this.live.get(id) ?? 0) + 1);
    node.addEventListener('ended', () => this.live.set(id, this.live.get(id) - 1));
  }

  // A sample that can be cut short (one per id): the reload clatter, the railgun charge.
  // Key `reload` holds both reload sounds.
  #voice(id) {
    const key = id === 'reloadMg' ? 'reload' : id;
    this.#cut(key);
    const src = this.sample(id);
    if (!src) return null;
    this.voice[key] = src;
    src.onended = () => this.voice[key] === src && delete this.voice[key];
    return src;
  }

  #cut(key) {
    const src = this.voice[key];
    if (!src) return;
    delete this.voice[key];
    const t = this.ctx.currentTime;
    src.gain.gain.setTargetAtTime(0, t, 0.015); // quick fade, no click
    src.stop(t + 0.08);
  }

  #env(node, peak, decay, gainNode = this.ctx.createGain()) {
    const t = this.ctx.currentTime;
    gainNode.gain.setValueAtTime(peak, t);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + decay);
    node.connect(gainNode).connect(this.master);
    return gainNode;
  }

  // Layered gunshot: transient crack (bandpassed noise), body thump (pitch-dropping sine), room tail
  // (lowpassed noise, longer). Small random detune per shot so automatic fire doesn't sound like a loop.
  shot(heavy = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = 0.92 + Math.random() * 0.16;
    const crack = this.ctx.createBufferSource();
    crack.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (heavy ? 1000 : 1700) * v;
    bp.Q.value = 0.9;
    crack.connect(bp);
    this.#env(bp, heavy ? 0.85 : 1.0, heavy ? 0.09 : 0.07);
    crack.start(t, Math.random() * 0.3, 0.1);

    const body = this.ctx.createOscillator();
    body.frequency.setValueAtTime((heavy ? 120 : 175) * v, t);
    body.frequency.exponentialRampToValueAtTime(heavy ? 34 : 48, t + 0.09);
    this.#env(body, heavy ? 1.0 : 0.75, heavy ? 0.15 : 0.11);
    body.start(t);
    body.stop(t + 0.16);

    const tail = this.ctx.createBufferSource();
    tail.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = heavy ? 700 : 1100;
    tail.connect(lp);
    this.#env(lp, heavy ? 0.35 : 0.28, heavy ? 0.42 : 0.32);
    tail.start(t, Math.random() * 0.1, 0.45);

    if (heavy) {
      // mechanical clack of the MG action
      const clack = this.ctx.createOscillator();
      clack.type = 'square';
      clack.frequency.value = 2400 * v;
      this.#env(clack, 0.05, 0.02);
      clack.start(t + 0.012);
      clack.stop(t + 0.04);
    }
  }

  // Sniper: sharper, louder crack, deep boom, long rolling tail, then the bolt worked back and forth.
  snipe() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const crack = this.ctx.createBufferSource();
    crack.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    crack.connect(hp);
    this.#env(hp, 1.3, 0.06);
    crack.start(t, Math.random() * 0.3, 0.08);

    const body = this.ctx.createOscillator();
    body.frequency.setValueAtTime(140, t);
    body.frequency.exponentialRampToValueAtTime(28, t + 0.2);
    this.#env(body, 1.2, 0.26);
    body.start(t);
    body.stop(t + 0.3);

    const tail = this.ctx.createBufferSource();
    tail.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    tail.connect(lp);
    this.#env(lp, 0.5, 0.9);
    tail.start(t, 0, 0.5);

    for (const [at, f] of [[0.38, 1500], [0.55, 1100]]) {
      const bolt = this.ctx.createOscillator();
      bolt.type = 'square';
      bolt.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setValueAtTime(0.06, t + at);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.04);
      bolt.connect(g).connect(this.master);
      bolt.start(t + at);
      bolt.stop(t + at + 0.05);
    }
  }

  lowMag(frac) {
    if (!this.ctx) return;
    const src = this.sample('lowMag');
    if (src) {
      src.playbackRate.value = 1 + (0.2 - frac) * 2.5; // pitch rises as the mag empties
      return;
    }
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 2200 + (0.2 - frac) * 6000; // pitch rises as the mag empties
    this.#env(o, 0.07, 0.04);
    o.start(t + 0.02);
    o.stop(t + 0.07);
  }

  // Machine gun barrel spin, 0..1 (continuous voice, created on first use): the recorded loop once decoded,
  // pitched up with the spin, else a synth whine.
  spin(level) {
    if (level < 0.01) level = 0;
    // small changes are skipped, but reaching 0 never is (else at > 60 fps it could stop on a faint, endless hum)
    if (!this.ctx || (Math.abs(level - (this.spinLevel ?? -1)) < 0.02 && (level > 0 || this.spinLevel === 0))) return;
    this.spinLevel = level;
    if (!this.spinLoop && this.samples.mgSpin) {
      this.spinLoop = this.sample('mgSpin');
      this.spinLoop.loop = true;
      this.spinLoop.playbackRate.value = 0.7;
      this.spinLoop.gain.gain.value = 0;
      if (this.spinGain) this.spinGain.gain.value = 0; // synth whine off for good
    }
    const t = this.ctx.currentTime;
    if (this.spinLoop) {
      this.spinLoop.playbackRate.setTargetAtTime(0.7 + level * 0.4, t, 0.05);
      this.spinLoop.gain.gain.setTargetAtTime(level > 0.01 ? SAMPLES.mgSpin[1] * (0.3 + 0.7 * level) : 0, t, 0.06);
      return;
    }
    if (!this.spinOsc) {
      this.spinOsc = this.ctx.createOscillator();
      this.spinOsc.type = 'sawtooth';
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 2;
      this.spinGain = this.ctx.createGain();
      this.spinGain.gain.value = 0;
      this.spinOsc.connect(f).connect(this.spinGain).connect(this.master);
      this.spinOsc.start();
    }
    this.spinOsc.frequency.setTargetAtTime(180 + level * 520, t, 0.05);
    this.spinGain.gain.setTargetAtTime(level > 0.01 ? 0.03 + level * 0.05 : 0, t, 0.06);
  }

  // Hit confirm: body = dry tick, head = bright double ping, weak spot = higher, sparkly.
  hit(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const tone = (type, f, at, peak, dur) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(peak, t + at);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + dur);
      o.connect(g).connect(this.master);
      o.start(t + at);
      o.stop(t + at + dur + 0.01);
    };
    if (kind === 'body') tone('square', 1300, 0, 0.1, 0.045);
    else if (kind === 'head') {
      tone('triangle', 2100, 0, 0.22, 0.08);
      tone('triangle', 3150, 0.03, 0.14, 0.08);
    } else {
      tone('triangle', 2600, 0, 0.22, 0.07);
      tone('sine', 3900, 0.025, 0.16, 0.1);
      tone('sine', 5200, 0.05, 0.08, 0.1);
    }
  }

  // Kill confirm: low thunk + bright chime, unmistakable over gunfire.
  kill() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    this.#env(o, 0.5, 0.16);
    o.start(t);
    o.stop(t + 0.17);
    for (const [i, f] of [1568, 2349].entries()) {
      const c = this.ctx.createOscillator();
      c.type = 'triangle';
      c.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + 0.03 + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.04 + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3 + i * 0.05);
      c.connect(g).connect(this.master);
      c.start(t + 0.03 + i * 0.05);
      c.stop(t + 0.32 + i * 0.05);
    }
  }

  zap(volume = 0.3) {
    if (!this.ctx || !this.#room('zap')) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    this.#env(o, volume, 0.2);
    o.start(t);
    o.stop(t + 0.2);
    this.#hold('zap', o);
  }

  // Blast (drone, mortar): the recorded explosion, deeper and louder the bigger it is, else the synth boom.
  blast(size) {
    const src = this.sample('explosion', 0, 0.6 + size * 0.4, true);
    if (src) src.playbackRate.value = 1.25 - size * 0.3;
    else this.boom(size);
  }

  // Per frame: starts the ambience once decoded, crossfades the music to the track the moment calls for: the menu track while
  // paused (start / pause panel), the fight's track in combat, none otherwise.
  mood(paused) {
    if (!this.ctx) return;
    this.ambientLoop ??= this.#loop('ambient', 1);
    this.#beds(paused);
    const fighting = !paused && (this.bossFight || performance.now() / 1000 - this.combatAt < MUSIC.hold);
    const want = paused ? 'menuMusic' : fighting ? (this.bossFight ? 'bossMusic' : 'music') : null;
    if (want && !this.tracks[want]) {
      const src = this.#loop(want, 0); // starts silent, faded in below; null until decoded (retried next frame)
      if (!src) return;
      this.tracks[want] = src;
      this.track = undefined; // forces the fade below
    }
    if (want === this.track) return;
    this.track = want;
    const t = this.ctx.currentTime;
    for (const [id, src] of Object.entries(this.tracks)) {
      src.gain.gain.setTargetAtTime(id === want ? SAMPLES[id][1] : 0, t, id === want ? MUSIC.fadeIn : MUSIC.fadeOut);
    }
    this.ambientLoop?.gain.gain.setTargetAtTime(SAMPLES.ambient[1] * (want ? MUSIC.duck : 1), t, 1);
  }

  // The beds (called by mood, no allocations): a bay hum while the camera is in an interior zone, one console voice and one
  // drone voice whose level follows the nearest source (positions cached by the world / the enemies list). All silent on pause.
  #beds(paused) {
    const p = this.listener?.position;
    let bay = 0, con = 0, drone = 0;
    if (p && !paused) {
      if (this.world) {
        bay = this.world.isInterior(p, VIEW_ABOVE) ? 1 : 0;
        let d = CONSOLE_RANGE;
        for (const c of this.world.consoles) d = Math.min(d, c.distanceTo(p));
        con = (1 - d / CONSOLE_RANGE) ** 2;
      }
      if (this.enemies) {
        let d = DRONE_RANGE;
        for (const e of this.enemies.all) if (e.kind === 'drone' && e.alive) d = Math.min(d, e.pos.distanceTo(p));
        drone = (1 - d / DRONE_RANGE) ** 2;
      }
    }
    this.#bed('bayHum', bay);
    this.#bed('consoleLoop', con);
    this.#bed('droneLoop', drone);
  }

  #bed(id, level) {
    this.beds[id] ??= this.#loop(id, 0); // null until decoded (retried next frame)
    const src = this.beds[id];
    if (!src || Math.abs(level - (this.bedLevel[id] ?? -1)) < 0.01) return;
    this.bedLevel[id] = level;
    src.gain.gain.setTargetAtTime(SAMPLES[id][1] * level, this.ctx.currentTime, BED_FADE);
  }

  // The title is up (Shell, on) or play starts (off): the menu music fades in / out; under the title the game's ambience,
  // music and beds are silenced, and mood() fades them back in once play resumes (it does not run while the engine idles).
  title(on) {
    this.titleOn = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (on) {
      this.menuLoop ??= this.#loop('menuMusic', 0);
      for (const src of [this.ambientLoop, ...Object.values(this.tracks), ...Object.values(this.beds)]) src?.gain.gain.setTargetAtTime(0, t, 0.5);
      this.track = undefined; // forces mood()'s music / ambience fade
      this.bedLevel = {}; // and the beds'
    }
    this.menuLoop?.gain.gain.setTargetAtTime(on ? MENU.gain : 0, t, on ? MENU.fadeIn : MENU.fadeOut);
  }

  #loop(id, volume) {
    const src = this.sample(id, 0, volume);
    if (src) src.loop = true;
    return src;
  }

  // Boot intro cues (recorded only): wake(duration) schedules them from now, wake(0) cuts them (intro skipped).
  // Scheduled on the audio clock, so pausing during the intro does not hold them back.
  wake(duration) {
    for (const src of this.wakeVoices) src.stop();
    this.wakeVoices = [];
    this.wakeFrom = duration ? performance.now() : 0;
    this.wakeDuration = duration;
    if (duration) this.#wakeCues();
  }

  // The cinematic's surge: surge now, core CORE_DELAY s on, rise stretched to last wake.rise. A skip cuts them (cinematic:done).
  #wakeNow() {
    this.wake(0);
    for (const [id, delay] of [['wakeSurge', 0], ['wakeCore', CORE_DELAY], ['wakeRise', 0]]) {
      const src = this.sample(id, delay);
      if (!src) continue;
      if (id === 'wakeRise') src.playbackRate.value = Math.min(2, Math.max(0.5, src.buffer.duration / this.riseLen));
      this.wakeVoices.push(src);
    }
  }

  #wakeCues() {
    if (!this.ctx) return; // waits for init()
    const since = (performance.now() - this.wakeFrom) / 1000;
    const riseAt = Math.max(this.wakeDuration - WAKE.rise, WAKE.core);
    for (const [id, at] of [['wakeSurge', WAKE.surge], ['wakeCore', WAKE.core], ['wakeRise', riseAt]]) {
      if (at < since) continue; // already past when the context came up
      const src = this.sample(id, at - since);
      if (src) this.wakeVoices.push(src);
    }
  }

  // The boss's idle engine: a looped rumble from wake to death (recorded only, no synth fallback).
  engine(on) {
    if (on && !this.engineLoop) {
      this.engineLoop = this.sample('bossLoop');
      if (this.engineLoop) this.engineLoop.loop = true;
    } else if (!on && this.engineLoop) {
      const src = this.engineLoop;
      this.engineLoop = null;
      const t = this.ctx.currentTime;
      src.gain.gain.setTargetAtTime(0, t, 0.3);
      src.stop(t + 1.5);
    }
  }

  // Explosion: low noise burst with a long tail plus a sub drop.
  boom(size = 1) {
    if (!this.ctx || !this.#room('boom')) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.6 * size);
    n.connect(f);
    this.#env(f, 1.1 * size, 0.7 * size);
    n.start(t, 0, 0.5);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(25, t + 0.5);
    this.#env(o, 1.0 * size, 0.6);
    o.start(t);
    o.stop(t + 0.7);
    this.#hold('boom', o);
  }

  // Railgun: capacitor whine up to the shot (weapon charge time), then a hard crack and a falling zap.
  railCharge() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(2400, t + 0.45);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.42);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
  }

  rail() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const crack = this.ctx.createBufferSource();
    crack.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    crack.connect(hp);
    this.#env(hp, 1.2, 0.05);
    crack.start(t, Math.random() * 0.3, 0.06);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(2600, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.35);
    this.#env(o, 0.35, 0.38);
    o.start(t);
    o.stop(t + 0.4);
    const body = this.ctx.createOscillator();
    body.frequency.setValueAtTime(110, t);
    body.frequency.exponentialRampToValueAtTime(30, t + 0.25);
    this.#env(body, 1.0, 0.3);
    body.start(t);
    body.stop(t + 0.32);
  }

  // Rising whine: the mech charging its cannons / rearing up.
  charge() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(1100, t + 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.72);
  }

  thud() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    n.connect(f);
    this.#env(f, 0.8, 0.25);
    n.start(t, 0, 0.3);
  }

  // Jetpack burst: fast-attack bandpassed noise whoosh (sweeping down, ~0.35 s) plus a low thump.
  jet() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(1400 + Math.random() * 200, t);
    f.frequency.exponentialRampToValueAtTime(420, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, 0, 0.4);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    this.#env(o, 0.5, 0.22);
    o.start(t);
    o.stop(t + 0.24);
  }

  // Soft landing thud: low noise puff plus a short sub drop.
  land() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 320;
    n.connect(f);
    this.#env(f, 0.45, 0.18);
    n.start(t, 0, 0.2);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    this.#env(o, 0.35, 0.15);
    o.start(t);
    o.stop(t + 0.16);
  }

  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.12);
    this.#env(o, 0.25, 0.18);
    o.start(t);
    o.stop(t + 0.2);
  }

  perfect() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [i, f] of [880, 1320, 1760].entries()) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.045);
      g.gain.exponentialRampToValueAtTime(0.22, t + i * 0.045 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.045 + 0.2);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.045);
      o.stop(t + i * 0.045 + 0.22);
    }
  }

  jam() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
    this.#env(o, 0.3, 0.22);
    o.start(t);
    o.stop(t + 0.24);
  }

  // Alarm siren (env.alarm): the recorded loop once decoded, else a looping two-tone wail, synthesized (a triangle-LFO
  // swept sawtooth through a lowpass); faded in and out.
  // Started before the first user gesture it waits for init().
  siren(on) {
    this.sirenWanted = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const cur = this.sirenNode;
    if (cur && !on) {
      this.sirenNode = null;
      cur.gain.gain.cancelScheduledValues(t);
      cur.gain.gain.setTargetAtTime(0, t, 0.15);
      for (const node of cur.nodes) node.stop(t + 1);
    } else if (on && !cur) {
      const src = this.sample('siren');
      if (src) {
        src.loop = true;
        const peak = src.gain.gain.value;
        src.gain.gain.setValueAtTime(0.001, t);
        src.gain.gain.linearRampToValueAtTime(peak, t + 0.4);
        this.sirenNode = { nodes: [src], gain: src.gain };
        return;
      }
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 700;
      const lfo = this.ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.value = 0.9;
      const depth = this.ctx.createGain();
      depth.gain.value = 240;
      lfo.connect(depth).connect(osc.frequency);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.4);
      osc.connect(lp).connect(gain).connect(this.master);
      osc.start(t);
      lfo.start(t);
      this.sirenNode = { nodes: [osc, lfo], gain };
    }
  }

  // Terminal key tick (boot intro, STEM-00 log): short dry bandpassed noise click, pitch and level jittered; `end` = a
  // lower, softer thunk plus a small blip (carriage return). At most one per 25 ms.
  type(end = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (t - (this.typeAt ?? -1) < 0.025) return;
    this.typeAt = t;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = (end ? 900 : 2200) * (1 + (Math.random() * 2 - 1) * 0.25);
    f.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime((end ? 0.3 : 0.2) * (1 + (Math.random() * 2 - 1) * 0.3), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (end ? 0.07 : 0.02));
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.4);
    n.stop(t + 0.1);
  }

  // Menu UI sound (title, pause menu, sub-pages): move | select | back | open | deny | slider | start | warn.
  // Recorded `ui-<kind>` sample if loaded, else synthesized: metal, relays, servos, hydraulics. No-op before init().
  ui(kind) {
    if (!this.ctx || !kind) return;
    const t = this.ctx.currentTime;
    if (UI_GAP[kind]) {
      if (t - ((this.uiAt ??= {})[kind] ?? -1) < UI_GAP[kind]) return;
      this.uiAt[kind] = t;
    }
    if (this.sample('ui-' + kind)) return;
    // tone: oscillator `type` sweeping f0 -> f1, through a lowpass at `lp`; hit: noise burst through a `ft` filter at f
    const env = (node, at, dur, peak, attack = 0.002) => {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(peak, t + at + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      node.connect(g).connect(this.uiBus);
    };
    const tone = (type, f0, f1, at, dur, peak, lp = 4000, attack) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + at);
      o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      const f = this.ctx.createBiquadFilter();
      f.frequency.value = lp;
      env(o.connect(f), at, dur, peak, attack);
      o.start(t + at);
      o.stop(t + at + dur + 0.02);
    };
    const hit = (ft, f, at, dur, peak, q = 1, attack) => {
      const n = this.ctx.createBufferSource();
      n.buffer = this.noise;
      const fl = this.ctx.createBiquadFilter();
      fl.type = ft;
      fl.frequency.value = f;
      fl.Q.value = q;
      env(n.connect(fl), at, dur, peak, attack);
      n.start(t + at, Math.random() * 0.3);
      n.stop(t + at + dur + 0.02);
      return fl;
    };
    const clunk = (at, f, peak) => {
      tone('sine', f, f * 0.35, at, 0.12, peak);
      hit('lowpass', 1400, at, 0.05, peak * 0.6);
    };
    if (kind === 'move') hit('bandpass', 3000 + Math.random() * 400, 0, 0.018, 0.12, 3);
    else if (kind === 'slider') hit('bandpass', 4200, 0, 0.01, 0.1, 5);
    else if (kind === 'select') {
      hit('bandpass', 2000, 0, 0.012, 0.25, 2); // relay contact
      clunk(0.006, 160, 0.5);
      tone('sawtooth', 260, 420, 0.05, 0.12, 0.04, 900, 0.02); // servo
    } else if (kind === 'back') {
      tone('sawtooth', 420, 220, 0, 0.12, 0.04, 800, 0.02); // servo winding back
      clunk(0.1, 110, 0.35);
    } else if (kind === 'open') {
      const f = hit('highpass', 3500, 0, 0.3, 0.14, 0.7, 0.03); // hydraulic hiss
      f.frequency.exponentialRampToValueAtTime(1200, t + 0.3);
      tone('sawtooth', 70, 55, 0, 0.25, 0.05, 300, 0.04); // panel slide rumble
      hit('bandpass', 1800, 0.26, 0.02, 0.18, 2); // latch
    } else if (kind === 'deny') {
      tone('square', 92, 88, 0, 0.18, 0.08, 500, 0.005);
      tone('square', 97, 93, 0, 0.18, 0.06, 500, 0.005);
    } else if (kind === 'start') {
      tone('sawtooth', 38, 72, 0, 0.9, 0.18, 260, 0.6); // power-up thrum
      tone('sine', 30, 48, 0, 1.0, 0.35, 200, 0.5); // sub
      hit('bandpass', 600, 0, 0.8, 0.06, 0.8, 0.6); // air rush
      hit('bandpass', 2200, 0.72, 0.012, 0.3, 2); // latch relay
      clunk(0.73, 140, 0.6);
    } else if (kind === 'warn') {
      tone('square', 520, 515, 0, 0.13, 0.06, 1400, 0.005);
      tone('square', 390, 386, 0.16, 0.18, 0.06, 1200, 0.005);
    }
  }

  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.value = 2400;
    this.#env(o, 0.08, 0.03);
    o.start(t);
    o.stop(t + 0.04);
  }
}
