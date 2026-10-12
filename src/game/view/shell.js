import { SCENES } from '../scenes.js';
import { bindSettingsUI } from '../settings.js';
import { applyQuality } from './quality.js';

// The DOM shell around the game: start / pause overlay, pointer lock, scene buttons, controller navigation of the panel.
// Built by game.js with the objects it needs; knows nothing else about the game.
//   host: { engine, audio, controls, debug, systems (what applyQuality reads), editing(): bool, sceneName(): string, loadScene(key) }
export class Shell {
  constructor(host) {
    this.host = host;
    this.padPlay = false; // started from a controller (or the editor): runs without pointer lock
    this.padStatus = '';
    const { engine, audio, systems, debug } = host;
    const { input } = engine;
    this.overlay = document.getElementById('overlay');
    bindSettingsUI({ onQuality: (q) => applyQuality(q, systems) });
    this.setRunning(debug);
    document.getElementById('start').addEventListener('click', () => {
      audio.init();
      if (host.editing()) {
        this.padPlay = true; // the editor needs the cursor: run without pointer lock
        this.setRunning(true);
      } else input.lock();
    });
    // scene buttons (top of the start / pause panel): switch at once and keep ?scene= in the URL so a reload stays there
    this.sceneButtons = document.getElementById('scenes');
    for (const [key, level] of Object.entries(SCENES)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.scene = key;
      b.textContent = level.title ?? key;
      b.addEventListener('click', () => {
        host.loadScene(key);
        const url = new URL(location.href);
        url.searchParams.set('scene', host.sceneName());
        history.replaceState(null, '', url);
        b.blur(); // keys go back to the game
      });
      this.sceneButtons.append(b);
    }
    this.markScene();
    // desktop build (desktop/preload.cjs): quit button in the panel
    const desktop = window.cerberusDesktop;
    const quit = document.getElementById('quit');
    quit.hidden = !desktop;
    quit.addEventListener('click', () => desktop?.quit());
    document.addEventListener('pointerlockchange', () => this.setRunning(input.locked || input.free || this.padPlay || debug));
    addEventListener('keydown', (e) => {
      // Esc pauses in free-mouse mode (pointer lock handles it otherwise)
      if (e.code === 'Escape' && input.free && !engine.paused) {
        input.free = false;
        this.setRunning(false);
      }
    });
  }

  setRunning(running) {
    const { engine } = this.host;
    const { input, canvas } = engine;
    engine.paused = !running;
    this.overlay.style.display = running ? 'none' : 'flex';
    canvas.style.cursor = input.free && running ? 'crosshair' : '';
  }

  // highlights the current scene's button in the panel
  markScene() {
    const name = this.host.sceneName();
    for (const b of this.sceneButtons?.children ?? []) b.classList.toggle('on', b.dataset.scene === name);
  }

  // Controller: A / Menu deploys from the start panel, Menu pauses; the panel shows the connected pad.
  update() {
    const { engine, controls, audio } = this.host;
    const input = engine.input;
    if (engine.paused) {
      const status = input.pad.connected ? `Controller: ${input.pad.id.replace(/\s*\(.*$/, '').slice(0, 40)} ✓` : 'Controller: press any button to connect.';
      if (this.padStatus !== status) document.getElementById('pad-status').textContent = this.padStatus = status;
      if (controls.pressed('pause') || (input.device === 'pad' && input.wasPressed('Pad0'))) {
        audio.init();
        this.padPlay = true;
        this.setRunning(true);
      }
    } else if (controls.pressed('pause')) {
      this.padPlay = false;
      if (input.locked) document.exitPointerLock();
      input.free = false;
      this.setRunning(false);
    }
  }
}
