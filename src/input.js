import { settings } from './settings.js';

// Keyboard + mouse/trackpad state with pointer lock. Edge-triggered presses are consumed per frame.
// Game code reads intent through aiming() / firing() / firePressed(), never raw buttons.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false };
    this.locked = false;
    this.free = false; // pointer lock unavailable (e.g. sandboxed iframe): use raw mouse while hovering
    this.aimToggled = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (e.code === 'KeyE') this.aimToggled = !this.aimToggled;
      if (e.code === 'ShiftLeft') this.aimToggled = false;
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked && !this.free) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked && !this.free) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) {
        this.mouse.right = true;
        if (settings.trackpad) this.aimToggled = !this.aimToggled;
      }
    });
    // trackpad: two-finger swipe looks around
    addEventListener(
      'wheel',
      (e) => {
        if (!settings.trackpad || (!this.locked && !this.free)) return;
        e.preventDefault();
        const k = e.deltaMode === 1 ? 16 : 1;
        this.mouse.dx += e.deltaX * k;
        this.mouse.dy += e.deltaY * k;
      },
      { passive: false },
    );
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.mouse.left = this.mouse.right = this.aimToggled = false;
    });
  }

  lock() {
    // falls back to free-mouse mode when the browser refuses pointer lock
    const fail = () => {
      if (!this.locked) {
        this.free = true;
        document.dispatchEvent(new Event('pointerlockchange'));
      }
    };
    document.addEventListener('pointerlockerror', fail, { once: true });
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(fail);
      else if (!this.canvas.requestPointerLock) fail();
    } catch {
      fail();
    }
    setTimeout(fail, 600);
  }

  down(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  aiming() {
    return this.aimToggled || (!settings.trackpad && this.mouse.right);
  }

  firing() {
    return this.mouse.left || this.down('KeyF');
  }

  firePressed() {
    return this.mouse.leftPressed || this.wasPressed('KeyF');
  }

  axis() {
    const x = (this.down('KeyD') ? 1 : 0) - (this.down('KeyA') ? 1 : 0);
    const y = (this.down('KeyW') ? 1 : 0) - (this.down('KeyS') ? 1 : 0);
    return { x, y };
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.leftPressed = false;
  }
}
