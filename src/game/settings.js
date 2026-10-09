import { loadJSON, saveJSON } from '../engine/storage.js';

// Per-player settings, remembered in this browser when storage is available.
const KEY = 'cerberus.settings';
const DEFAULTS = {
  sensitivity: 1, // multiplier on look speed
  trackpad: false, // E toggles aim, two-finger swipe looks, stronger aim assist
  aimAssist: true,
  padInvertY: false, // controller right stick
  quality: 'high', // graphics preset (view/quality.js)
  renderer: 'auto', // 'auto': WebGPU where available, else WebGL 2; 'webgl': always WebGL 2 (applies on reload)
};

export const settings = { ...DEFAULTS, ...loadJSON(KEY) };

export const saveSettings = () => saveJSON(KEY, settings);

// Wires the controls in the start/pause panel. onQuality(name) applies a graphics preset; onRenderer() after
// the renderer choice is saved (it needs a reload).
export function bindSettingsUI({ onQuality, onRenderer } = {}) {
  const $ = (id) => document.getElementById(id);
  const sens = $('sens');
  const sensOut = $('sens-out');
  const pad = $('trackpad');
  const assist = $('assist');
  const invert = $('invert');
  const quality = $('quality');
  const renderer = $('renderer');
  const sync = () => {
    sens.value = settings.sensitivity;
    sensOut.textContent = `${Number(settings.sensitivity).toFixed(1)}×`;
    pad.checked = settings.trackpad;
    assist.checked = settings.aimAssist;
    invert.checked = settings.padInvertY;
    quality.value = settings.quality;
    renderer.value = settings.renderer;
  };
  sens.addEventListener('input', () => {
    settings.sensitivity = Number(sens.value);
    sync();
    saveSettings();
  });
  pad.addEventListener('change', () => {
    settings.trackpad = pad.checked;
    if (pad.checked) settings.aimAssist = true;
    sync();
    saveSettings();
  });
  assist.addEventListener('change', () => {
    settings.aimAssist = assist.checked;
    saveSettings();
  });
  invert.addEventListener('change', () => {
    settings.padInvertY = invert.checked;
    saveSettings();
  });
  quality.addEventListener('change', () => {
    settings.quality = quality.value;
    onQuality?.(settings.quality);
    saveSettings();
  });
  renderer.addEventListener('change', () => {
    settings.renderer = renderer.value;
    saveSettings();
    onRenderer?.(settings.renderer);
  });
  sync();
}
