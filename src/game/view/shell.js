import { SCENES, CAMPAIGN, loadProgress, saveProgress, clearProgress } from '../scenes.js';
import { bindSettingsUI } from '../settings.js';
import { applyQuality } from './quality.js';
import { MenuScene } from './menu-scene.js';

// The DOM shell around the game: main menu (title) and pause menu with their sub-pages (`#overlay .page`), pointer lock,
// scene buttons, keyboard / controller navigation of the menus. Built by game.js with the objects it needs; knows nothing else.
//   host: { engine, audio, controls, debug, systems (what applyQuality reads), editing(): bool, sceneName(): string|null, loadScene(key), unloadScene() }
// Menu items: `data-go="<page>"` opens a sub-page, `data-act="<name>"` runs `#act`. A page's `data-back` is where Esc / B go
// ('root' = the title or the pause page, whichever opened it).
const STICK = 0.5; // left stick tilt that counts as one up / down step in a menu
export class Shell {
  constructor(host) {
    this.host = host;
    this.padPlay = false; // started from a controller (or the editor): runs without pointer lock
    this.padStatus = '';
    this.inGame = !!host.debug; // false = the title is the root menu, true = the pause menu
    this.padClick = false; // the item being clicked was chosen with a controller (no pointer lock)
    this.stickY = 0;
    const { engine, systems } = host;
    const { input } = engine;
    this.overlay = document.getElementById('overlay');
    this.pages = [...this.overlay.querySelectorAll('.page')];
    bindSettingsUI({ onQuality: (q) => applyQuality(q, systems) });
    // desktop build (desktop/preload.cjs): quit items
    const desktop = window.cerberusDesktop;
    for (const q of this.overlay.querySelectorAll('[data-act="quit"]')) q.hidden = !desktop;
    this.glyph = this.overlay.querySelector('.glyph');
    for (const b of this.overlay.querySelectorAll('.item, #quit')) {
      b.addEventListener('click', () => {
        if (b.dataset.go) {
          this.#ui('open');
          this.show(b.dataset.go);
        } else this.#act(b.dataset.act, this.padClick);
      });
      b.addEventListener('mouseenter', () => this.#focus(b)); // the selection bar follows the mouse
    }
    // scene buttons (Development page): load the scene, keep ?scene= in the URL so a reload stays there, deploy
    this.sceneButtons = document.getElementById('scenes');
    for (const [key, level] of Object.entries(SCENES)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.scene = key;
      b.textContent = level.title ?? key;
      b.addEventListener('click', () => {
        this.#ui('start');
        host.loadScene(key);
        const url = new URL(location.href);
        url.searchParams.set('scene', host.sceneName());
        history.replaceState(null, '', url);
        saveProgress(host.sceneName());
        this.#play(this.padClick);
      });
      this.sceneButtons.append(b);
    }
    // settings controls: a step on a slider / list, a tick on a checkbox
    for (const el of this.overlay.querySelectorAll('.settings input, .settings select')) el.addEventListener('change', () => this.#ui(el.type === 'checkbox' ? 'select' : 'slider'));
    // sounds work from the first menu move: the audio context starts on the first key / click on the menu
    if (!host.debug) for (const ev of ['keydown', 'pointerdown']) addEventListener(ev, () => host.audio.init(), { once: true, capture: true });
    this.markScene();
    if (host.debug) document.body.classList.remove('title'); // index.html starts in the title state (no flash of game UI)
    this.setRunning(host.debug);
    document.addEventListener('pointerlockchange', () => this.setRunning(input.locked || input.free || this.padPlay || host.debug));
    addEventListener('keydown', (e) => {
      if (!engine.paused) {
        // Esc pauses in free-mouse mode (pointer lock handles it otherwise)
        if (e.code === 'Escape' && input.free) {
          input.free = false;
          this.setRunning(false);
        }
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        this.#step(e.code === 'ArrowUp' ? -1 : 1);
      } else if (e.code === 'Escape') this.#back();
      else if (e.code === 'Enter' && document.activeElement?.type === 'checkbox') document.activeElement.click();
    });
  }

  setRunning(running) {
    const { engine } = this.host;
    const { input, canvas } = engine;
    const opening = !running && !engine.paused;
    if (opening && this.inGame) this.#ui('open'); // the pause menu opens
    engine.paused = !running;
    this.overlay.style.display = running ? 'none' : 'flex';
    canvas.style.cursor = input.free && running ? 'crosshair' : '';
    if (running) document.activeElement?.blur?.(); // keys go back to the game
    else if (opening || !this.page) this.show('root');
  }

  // Shows a menu page ('root' = title or pause) and focuses its first item.
  show(name) {
    if (name === 'root') name = this.inGame ? 'pause' : 'title';
    this.page = this.overlay.dataset.page = name;
    if (name === 'title') {
      const p = loadProgress();
      document.getElementById('continue').hidden = !p;
      document.getElementById('save-info').textContent = p ? `LAST SAVE: ${SCENES[p.scene].title ?? p.scene}${p.checkpoint ? ` · CHECKPOINT ${p.checkpoint}` : ''}` : 'NO SAVE DATA';
    }
    for (const p of this.pages) p.hidden = p.dataset.page !== name;
    this.#idle(!this.inGame); // the title and its sub-pages: no scene behind, nothing simulated or drawn
    this.#items()[0]?.focus();
  }

  // highlights the current scene's button in the Development page
  markScene() {
    const name = this.host.sceneName();
    for (const b of this.sceneButtons?.children ?? []) b.classList.toggle('on', b.dataset.scene === name);
  }

  // Controller in the menus: d-pad / left stick up-down select, left-right change a slider or a list, A confirm, B back,
  // Menu resumes from the pause menu; while playing, Menu pauses. The settings page shows the connected pad.
  update() {
    const { host } = this;
    const { engine, controls } = host;
    if (engine.idle) this.backdrop?.render(engine.realDt); // the title's own set (menu-scene.js), never the level
    const input = engine.input;
    if (!engine.paused) {
      if (controls.pressed('pause')) {
        this.padPlay = false;
        if (input.locked) document.exitPointerLock();
        input.free = false;
        this.setRunning(false);
      }
      return;
    }
    const status = input.pad.connected ? `Controller: ${input.pad.id.replace(/\s*\(.*$/, '').slice(0, 40)} ✓` : 'Controller: press any button to connect.';
    if (this.padStatus !== status) {
      this.padStatus = status;
      for (const el of this.overlay.querySelectorAll('.pad-status')) el.textContent = status;
    }
    this.glyph.textContent = input.device === 'pad' ? 'B' : 'Esc';
    const ly = input.pad.ly;
    const stick = Math.abs(ly) > STICK && Math.abs(this.stickY) <= STICK ? Math.sign(ly) : 0;
    this.stickY = ly;
    if (input.wasPressed('Pad0') || input.wasPressed('Pad1') || input.wasPressed('Pad12') || input.wasPressed('Pad13') || stick) host.audio.init(); // a pad press is not a user gesture: init resumes the context when allowed
    if (input.wasPressed('Pad12') || stick < 0) this.#step(-1);
    if (input.wasPressed('Pad13') || stick > 0) this.#step(1);
    const lr = input.wasPressed('Pad14') ? -1 : input.wasPressed('Pad15') ? 1 : 0;
    if (lr) this.#nudge(document.activeElement, lr);
    if (input.wasPressed('Pad1')) this.#back();
    if (controls.pressed('pause') && this.page === 'pause') this.#act('resume', true);
    else if (input.wasPressed('Pad0') && this.overlay.contains(document.activeElement)) {
      this.padClick = true;
      document.activeElement.click();
      this.padClick = false;
    }
  }

  #act(name, pad) {
    const { host } = this;
    if (name === 'continue') {
      const p = loadProgress();
      if (!p) return this.show('title');
      this.#ui('start');
      host.loadScene(p.scene); // the scene from its start: mission state is not saved (scenes.js)
      saveProgress(p.scene);
      this.#play(pad);
    } else if (name === 'new') {
      if (loadProgress()) {
        this.#ui('warn');
        this.show('confirm');
      } else this.#act('new-confirm', pad);
    } else if (name === 'new-confirm') {
      this.#ui('start');
      clearProgress();
      host.loadScene(CAMPAIGN[0]);
      saveProgress(CAMPAIGN[0]);
      this.#play(pad);
    } else if (name === 'resume') {
      this.#ui('select');
      this.#play(pad);
    } else if (name === 'title') {
      this.#ui('back');
      this.inGame = false;
      host.unloadScene(); // the main menu is its own scene: the level goes, the menu set (menu-scene.js) shows
      this.show('title');
    } else if (name === 'back') this.#back();
    else if (name === 'quit') {
      if (!window.cerberusDesktop) return this.#ui('deny');
      this.#ui('select');
      window.cerberusDesktop.quit();
    }
  }

  // Starts / resumes play: pointer lock (needs this click / key press), or no lock from a controller or the editor.
  #play(pad) {
    const { audio, editing, engine } = this.host;
    audio.init();
    this.inGame = true;
    this.#idle(false);
    if (pad || editing()) {
      this.padPlay = true;
      this.setRunning(true);
    } else engine.input.lock();
  }

  // The title (and its sub-pages) is its own scene: no level is loaded (game.js loads one on NEW GAME / CONTINUE / a
  // Development pick, unloads it on QUIT TO MAIN MENU), the engine idles (input only, nothing simulated or drawn) and the
  // canvas shows the menu set (menu-scene.js, built on the first title, rendered from update()). `body.title` hides every
  // game / editor / Gym panel (style.css, and index.html's first-paint style).
  #idle(on) {
    const { engine } = this.host;
    if (on) this.backdrop ??= new MenuScene(engine.renderer);
    engine.idle = on;
    this.host.audio.title?.(on);
    this.overlay.classList.toggle('idle', on);
    document.body.classList.toggle('title', on);
  }

  #back() {
    const back = this.overlay.querySelector(`.page[data-page="${this.page}"]`)?.dataset.back;
    if (back) {
      this.#ui('back');
      this.show(back);
    } else if (this.page === 'title') this.#act('quit'); // Esc / B on the title: quit to desktop (desktop build only)
  }

  // menu sound (audio.ui: move, select, back, open, deny, slider, start, warn)
  #ui(kind) {
    this.host.audio.ui?.(kind);
  }

  // focus an item; a change of selection ticks
  #focus(el) {
    if (document.activeElement !== el) this.#ui('move');
    el.focus();
  }

  // what Up / Down move through on the current page: its items, settings controls and scene buttons
  #items() {
    const page = this.overlay.querySelector(`.page[data-page="${this.page}"]`);
    return [...(page?.querySelectorAll('button, input, select') ?? [])].filter((el) => !el.hidden);
  }

  #step(dir) {
    const items = this.#items();
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    this.#focus(items[i < 0 ? 0 : (i + dir + items.length) % items.length]);
  }

  // controller left / right on a slider or a list
  #nudge(el, dir) {
    if (el?.type === 'range') dir > 0 ? el.stepUp() : el.stepDown();
    else if (el?.tagName === 'SELECT') el.selectedIndex = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + dir));
    else return;
    if (el.type === 'range') el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change')); // the 'slider' tick
  }
}
