// Default key bindings for the game.
// This file has NO imports to avoid circular dependencies.
// Gamepad buttons use the W3C standard layout (Xbox names):
// Pad0 A, Pad1 B, Pad2 X, Pad3 Y, Pad4 LB, Pad5 RB,
// Pad6 LT, Pad7 RT, Pad8 View/Back, Pad9 Menu/Start, Pad10 L3, Pad11 R3, Pad12-15 d-pad up/down/left/right.

export const DEFAULT_BINDINGS = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  run: ['ShiftLeft', 'ShiftRight'],
  padSprint: ['Pad10'], // L3 click: sprint until the stick is released
  aim: ['Mouse2', 'Pad6'], // hold (mouse, LT), always
  aimToggle: ['KeyE'], // trackpad mode only
  fire: ['Mouse0', 'KeyF', 'Pad7'],
  reload: ['KeyR', 'Pad2'],
  jump: ['Space', 'Pad0'], // jetpack burst, or vault over low cover
  shoulder: ['KeyQ', 'Pad4'],
  nextGun: ['Pad3', 'Pad5'],
  slot1: ['Digit1', 'Pad14'],
  slot2: ['Digit2', 'Pad12'],
  slot3: ['Digit3', 'Pad15'],
  slot4: ['Digit4'],
  slot5: ['Digit5'],
  slot6: ['Digit6', 'Pad13'], // d-pad down: sidearm
  pause: ['Pad9'],
  lookLeft: ['ArrowLeft'],
  lookRight: ['ArrowRight'],
  lookUp: ['ArrowUp'],
  lookDown: ['ArrowDown'],
  skeleton: ['KeyH'],
  stats: ['F3', 'Backquote', 'Pad8'],
};
