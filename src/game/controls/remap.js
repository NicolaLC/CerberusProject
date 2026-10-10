// Remapping system for keyboard, mouse and gamepad controls.
// Provides UI and logic to rebind actions to different input codes.

import { DEFAULT_BINDINGS } from './bindings.js';
import { settings, saveSettings } from '../settings.js';

// Merge user bindings with defaults
function mergeBindings(savedBindings) {
  const result = structuredClone(DEFAULT_BINDINGS);
  if (savedBindings) {
    for (const [action, codes] of Object.entries(savedBindings)) {
      if (action in result) {
        result[action] = [...new Set([...codes, ...result[action]])];
      }
    }
  }
  return result;
}

// Get clean user bindings (only what differs from defaults)
function getUserBindings(currentBindings) {
  const userBindings = {};
  for (const [action, codes] of Object.entries(currentBindings)) {
    const defaultCodes = DEFAULT_BINDINGS[action] || [];
    const different = codes.some(code => !defaultCodes.includes(code)) ||
                     defaultCodes.some(code => !codes.includes(code));
    if (different) {
      userBindings[action] = codes;
    }
  }
  return userBindings;
}

// Input codes that are valid for binding
const VALID_CODES = new Set([
  // Keyboard
  'KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyI', 'KeyJ', 'KeyK', 'KeyL',
  'KeyM', 'KeyN', 'KeyO', 'KeyP', 'KeyQ', 'KeyR', 'KeyS', 'KeyT', 'KeyU', 'KeyV', 'KeyW', 'KeyX',
  'KeyY', 'KeyZ', 'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
  'Digit7', 'Digit8', 'Digit9', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Space', 'Enter', 'Tab', 'Escape',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Home', 'End',
  'PageUp', 'PageDown', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Semicolon', 'Quote', 'Comma',
  'Period', 'Slash', 'Backslash',
  // Mouse
  'Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4',
  // Gamepad (W3C standard)
  'Pad0', 'Pad1', 'Pad2', 'Pad3', 'Pad4', 'Pad5', 'Pad6', 'Pad7', 'Pad8', 'Pad9',
  'Pad10', 'Pad11', 'Pad12', 'Pad13', 'Pad14', 'Pad15', 'Pad16',
]);

// Human-readable names for input codes
const CODE_NAMES = {
  // Keyboard
  'KeyA': 'A', 'KeyB': 'B', 'KeyC': 'C', 'KeyD': 'D', 'KeyE': 'E', 'KeyF': 'F',
  'KeyG': 'G', 'KeyH': 'H', 'KeyI': 'I', 'KeyJ': 'J', 'KeyK': 'K', 'KeyL': 'L',
  'KeyM': 'M', 'KeyN': 'N', 'KeyO': 'O', 'KeyP': 'P', 'KeyQ': 'Q', 'KeyR': 'R',
  'KeyS': 'S', 'KeyT': 'T', 'KeyU': 'U', 'KeyV': 'V', 'KeyW': 'W', 'KeyX': 'X',
  'KeyY': 'Y', 'KeyZ': 'Z',
  'Digit0': '0', 'Digit1': '1', 'Digit2': '2', 'Digit3': '3', 'Digit4': '4',
  'Digit5': '5', 'Digit6': '6', 'Digit7': '7', 'Digit8': '8', 'Digit9': '9',
  'ShiftLeft': 'Left Shift', 'ShiftRight': 'Right Shift',
  'ControlLeft': 'Left Ctrl', 'ControlRight': 'Right Ctrl',
  'AltLeft': 'Left Alt', 'AltRight': 'Right Alt',
  'Space': 'Space', 'Enter': 'Enter', 'Tab': 'Tab', 'Escape': 'Esc',
  'ArrowUp': '\u2191', 'ArrowDown': '\u2193', 'ArrowLeft': '\u2190', 'ArrowRight': '\u2192',
  'Backspace': 'Backspace', 'Delete': 'Delete',
  'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5', 'F6': 'F6',
  'Backquote': '`', 'Minus': '-', 'Equal': '=', 'BracketLeft': '[', 'BracketRight': ']',
  'Semicolon': ';', 'Quote': "'", 'Comma': ',', 'Period': '.', 'Slash': '/', 'Backslash': '\\',
  // Mouse
  'Mouse0': 'Left Click', 'Mouse1': 'Right Click', 'Mouse2': 'Middle Click',
  'Mouse3': 'Mouse 4', 'Mouse4': 'Mouse 5',
  // Gamepad
  'Pad0': 'A', 'Pad1': 'B', 'Pad2': 'X', 'Pad3': 'Y',
  'Pad4': 'LB', 'Pad5': 'RB', 'Pad6': 'LT', 'Pad7': 'RT',
  'Pad8': 'View/Back', 'Pad9': 'Menu/Start', 'Pad10': 'L3', 'Pad11': 'R3',
  'Pad12': '\u2191 D-pad', 'Pad13': '\u2193 D-pad', 'Pad14': '\u2190 D-pad', 'Pad15': '\u2192 D-pad',
  'Pad16': 'Pad 16',
};

// Human-readable names for actions
const ACTION_NAMES = {
  forward: 'Move Forward',
  back: 'Move Back',
  left: 'Move Left',
  right: 'Move Right',
  run: 'Sprint',
  padSprint: 'Sprint (Gamepad)',
  aim: 'Aim',
  aimToggle: 'Aim Toggle',
  fire: 'Fire',
  reload: 'Reload',
  jump: 'Jump / Vault',
  shoulder: 'Swap Shoulder',
  nextGun: 'Next Weapon',
  slot1: 'Weapon Slot 1',
  slot2: 'Weapon Slot 2',
  slot3: 'Weapon Slot 3',
  slot4: 'Weapon Slot 4',
  slot5: 'Weapon Slot 5',
  slot6: 'Weapon Slot 6',
  pause: 'Pause',
  lookLeft: 'Look Left',
  lookRight: 'Look Right',
  lookUp: 'Look Up',
  lookDown: 'Look Down',
  skeleton: 'Show Skeletons',
  stats: 'Show Stats',
};

// Get display name for a code
function getCodeName(code) {
  return CODE_NAMES[code] || code;
}

// Get display name for an action
function getActionName(action) {
  return ACTION_NAMES[action] || action;
}

// Group actions by category for UI
const ACTION_CATEGORIES = {
  'Movement': ['forward', 'back', 'left', 'right', 'run', 'padSprint', 'jump'],
  'Combat': ['aim', 'aimToggle', 'fire', 'reload', 'shoulder', 'nextGun'],
  'Weapons': ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'],
  'Camera': ['lookLeft', 'lookRight', 'lookUp', 'lookDown'],
  'System': ['pause', 'skeleton', 'stats'],
};

// Current bindings state - initialized with defaults, will be updated with saved bindings
let currentBindings = structuredClone(DEFAULT_BINDINGS);
let remapInProgress = null;
let remapCallback = null;

// Load bindings from settings
function loadBindings() {
  if (settings.bindings) {
    currentBindings = mergeBindings(settings.bindings);
  } else {
    currentBindings = structuredClone(DEFAULT_BINDINGS);
  }
  return currentBindings;
}

// Save bindings to settings
function saveBindings() {
  settings.bindings = getUserBindings(currentBindings);
  saveSettings();
}

// Get all current bindings (merged with user customizations)
function getAllBindings() {
  return currentBindings;
}

// Start remapping an action
function startRemap(action, callback) {
  remapInProgress = action;
  remapCallback = callback;
  return true;
}

// Cancel remapping
function cancelRemap() {
  remapInProgress = null;
  remapCallback = null;
}

// Complete remapping with a new code
function completeRemap(code) {
  if (!remapInProgress || !VALID_CODES.has(code)) return false;
  
  // Add the new code to the action's bindings
  if (!currentBindings[remapInProgress]) {
    currentBindings[remapInProgress] = [];
  }
  
  // Avoid duplicates
  if (!currentBindings[remapInProgress].includes(code)) {
    currentBindings[remapInProgress].push(code);
  }
  
  // Remove this code from other actions to avoid conflicts
  for (const [action, codes] of Object.entries(currentBindings)) {
    if (action !== remapInProgress) {
      const index = codes.indexOf(code);
      if (index !== -1) {
        codes.splice(index, 1);
      }
    }
  }
  
  saveBindings();
  const result = { action: remapInProgress, code };
  remapInProgress = null;
  const cb = remapCallback;
  remapCallback = null;
  cb?.(result);
  return true;
}

// Remove a binding from an action
function removeBinding(action, code) {
  if (!currentBindings[action]) return false;
  const index = currentBindings[action].indexOf(code);
  if (index !== -1) {
    currentBindings[action].splice(index, 1);
    saveBindings();
    return true;
  }
  return false;
}

// Reset an action to defaults
function resetAction(action) {
  if (DEFAULT_BINDINGS[action]) {
    currentBindings[action] = structuredClone(DEFAULT_BINDINGS[action]);
    saveBindings();
    return true;
  }
  return false;
}

// Reset all bindings to defaults
function resetAll() {
  currentBindings = structuredClone(DEFAULT_BINDINGS);
  settings.bindings = {};
  saveSettings();
}

// Check if currently waiting for input
function isRemapping() {
  return remapInProgress !== null;
}

// Get the action being remapped
function getRemapAction() {
  return remapInProgress;
}

// Handle input event for remapping
function handleInputForRemap(code) {
  if (isRemapping() && VALID_CODES.has(code)) {
    return completeRemap(code);
  }
  return false;
}

// Initialize bindings - call this before creating Controls
function initBindings() {
  if (!settings.bindings) {
    settings.bindings = {};
  }
  currentBindings = mergeBindings(settings.bindings);
}

export {
  DEFAULT_BINDINGS,
  loadBindings,
  saveBindings,
  getAllBindings,
  initBindings,
  startRemap,
  cancelRemap,
  completeRemap,
  removeBinding,
  resetAction,
  resetAll,
  isRemapping,
  getRemapAction,
  handleInputForRemap,
  getCodeName,
  getActionName,
  ACTION_CATEGORIES,
  VALID_CODES,
  CODE_NAMES,
  ACTION_NAMES,
};
