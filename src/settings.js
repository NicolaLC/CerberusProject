// Per-player settings, remembered in this browser when storage is available.
const KEY = 'cerberus.settings';
const DEFAULTS = {
  sensitivity: 1, // multiplier on look speed
  trackpad: false, // aim toggles, two-finger swipe looks, stronger aim assist
  aimAssist: true,
};

export const settings = { ...DEFAULTS, ...load() };

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage blocked: settings last for this session only
  }
}

// Wires the controls in the start/pause panel.
export function bindSettingsUI() {
  const sens = document.getElementById('sens');
  const sensOut = document.getElementById('sens-out');
  const pad = document.getElementById('trackpad');
  const assist = document.getElementById('assist');
  const sync = () => {
    sens.value = settings.sensitivity;
    sensOut.textContent = `${Number(settings.sensitivity).toFixed(1)}×`;
    pad.checked = settings.trackpad;
    assist.checked = settings.aimAssist;
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
  sync();
}
