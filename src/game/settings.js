import { loadJSON, saveJSON } from '../engine/storage.js';

// Per-player settings, remembered in this browser when storage is available.
const KEY = 'cerberus.settings';
const DEFAULTS = {
  sensitivity: 1, // multiplier on look speed
  trackpad: false, // E toggles aim, two-finger swipe looks, stronger aim assist
  aimAssist: true,
  padInvertY: false, // controller right stick
  quality: 'high', // graphics preset (view/quality.js)
  // Accessibility settings
  colorBlindMode: 'none', // 'none', 'deuteranopia', 'protanopia', 'tritanopia', 'achromatopsia'
  subtitleSize: 'medium', // 'small', 'medium', 'large'
  subtitleBackground: true,
  subtitleSpeakerNames: true,
  reduceMotion: false,
  reduceMotionStrength: 0.5,
  highContrast: false,
  bindings: {}, // Custom key bindings
};

export const settings = { ...DEFAULTS, ...loadJSON(KEY) };

export const saveSettings = () => saveJSON(KEY, settings);

// Wires the controls in the start/pause panel. onQuality(name) applies a graphics preset.
export function bindSettingsUI({ onQuality } = {}) {
  const $ = (id) => document.getElementById(id);
  const sens = $('sens');
  const sensOut = $('sens-out');
  const pad = $('trackpad');
  const assist = $('assist');
  const invert = $('invert');
  const quality = $('quality');
  const colorblind = $('colorblind-mode');
  const subtitleSize = $('subtitle-size');
  const subtitleBg = $('subtitle-background');
  const subtitleSpeaker = $('subtitle-speaker');
  const reduceMotion = $('reduce-motion');
  const reduceMotionStrength = $('reduce-motion-strength');
  const highContrast = $('high-contrast');
  
  const sync = () => {
    sens.value = settings.sensitivity;
    sensOut.textContent = `${Number(settings.sensitivity).toFixed(1)}\u00d7`;
    pad.checked = settings.trackpad;
    assist.checked = settings.aimAssist;
    invert.checked = settings.padInvertY;
    quality.value = settings.quality;
    
    // Accessibility settings
    if (colorblind) colorblind.value = settings.colorBlindMode || 'none';
    if (subtitleSize) subtitleSize.value = settings.subtitleSize || 'medium';
    if (subtitleBg) subtitleBg.checked = settings.subtitleBackground !== false;
    if (subtitleSpeaker) subtitleSpeaker.checked = settings.subtitleSpeakerNames !== false;
    if (reduceMotion) reduceMotion.checked = settings.reduceMotion || false;
    if (reduceMotionStrength) reduceMotionStrength.value = settings.reduceMotionStrength ?? 0.5;
    if (highContrast) highContrast.checked = settings.highContrast || false;
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
  
  // Accessibility settings listeners
  if (colorblind) {
    colorblind.addEventListener('change', () => {
      settings.colorBlindMode = colorblind.value;
      saveSettings();
      // Reapply immediately
      const root = document.documentElement;
      const palette = getCurrentPalette();
      root.style.setProperty('--color-crosshair-default', palette.crosshairDefault);
      root.style.setProperty('--color-crosshair-aim', palette.crosshairAim);
      root.style.setProperty('--color-crosshair-enemy', palette.crosshairEnemy);
      root.style.setProperty('--color-crosshair-weak', palette.crosshairWeak);
      root.style.setProperty('--color-crosshair-blocked', palette.crosshairBlocked);
      root.style.setProperty('--color-weak-spot', palette.weakSpot);
      root.style.setProperty('--color-weak-spot-text', palette.weakSpotText);
      root.style.setProperty('--color-health-low', palette.health.low);
      root.style.setProperty('--color-health-high', palette.health.high);
      root.style.setProperty('--color-shield-low', palette.shield.low);
      root.style.setProperty('--color-shield-high', palette.shield.high);
      root.style.setProperty('--color-shield-glow', palette.shield.glow);
      root.style.setProperty('--color-boss-health-low', palette.bossHealth.low);
      root.style.setProperty('--color-boss-health-high', palette.bossHealth.high);
      root.style.setProperty('--color-boss-health-glow', palette.bossHealth.glow);
      root.style.setProperty('--color-hitmarker-normal', palette.hitmarker.normal);
      root.style.setProperty('--color-hitmarker-crit', palette.hitmarker.crit);
      root.style.setProperty('--color-hitmarker-kill', palette.hitmarker.kill);
      root.style.setProperty('--color-threat-meter', palette.threatMeter);
    });
  }
  
  if (subtitleSize) {
    subtitleSize.addEventListener('change', () => {
      settings.subtitleSize = subtitleSize.value;
      saveSettings();
      // Reapply immediately
      const style = SUBTITLE_STYLES[settings.subtitleSize] || SUBTITLE_STYLES.medium;
      const root = document.documentElement;
      root.style.setProperty('--subtitle-font-size', style.fontSize);
      root.style.setProperty('--subtitle-line-height', style.lineHeight);
    });
  }
  
  if (subtitleBg) {
    subtitleBg.addEventListener('change', () => {
      settings.subtitleBackground = subtitleBg.checked;
      saveSettings();
      // Reapply immediately
      document.documentElement.style.setProperty('--subtitle-background-opacity', settings.subtitleBackground ? '0.7' : '0');
    });
  }
  
  if (subtitleSpeaker) {
    subtitleSpeaker.addEventListener('change', () => {
      settings.subtitleSpeakerNames = subtitleSpeaker.checked;
      saveSettings();
    });
  }
  
  if (reduceMotion) {
    reduceMotion.addEventListener('change', () => {
      settings.reduceMotion = reduceMotion.checked;
      saveSettings();
    });
  }
  
  if (reduceMotionStrength) {
    reduceMotionStrength.addEventListener('input', () => {
      settings.reduceMotionStrength = parseFloat(reduceMotionStrength.value);
      saveSettings();
    });
  }
  
  if (highContrast) {
    highContrast.addEventListener('change', () => {
      settings.highContrast = highContrast.checked;
      saveSettings();
      // Reapply immediately
      const root = document.documentElement;
      if (settings.highContrast) {
        root.classList.add('high-contrast');
      } else {
        root.classList.remove('high-contrast');
      }
    });
  }
  
  sync();
}

// Import for re-export (circular dependency safe - these are only used in settings UI)
import { getCurrentPalette, SUBTITLE_STYLES } from './accessibility.js';

export { getCurrentPalette, SUBTITLE_STYLES };
