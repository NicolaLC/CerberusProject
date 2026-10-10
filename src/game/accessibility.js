// Accessibility settings and utilities
// Handles: remapping, subtitles, color-blind modes, reduced motion

import { settings, saveSettings } from './settings.js';
import { 
  loadBindings, 
  getAllBindings, 
  initBindings,
  getCodeName, 
  getActionName, 
  ACTION_CATEGORIES, 
  DEFAULT_BINDINGS 
} from './controls/remap.js';

// Default accessibility settings
const ACCESSIBILITY_DEFAULTS = {
  // Color blind modes
  colorBlindMode: 'none', // 'none', 'deuteranopia', 'protanopia', 'tritanopia', 'achromatopsia'
  
  // Subtitle settings
  subtitleSize: 'medium', // 'small', 'medium', 'large'
  subtitleBackground: true, // Show background behind subtitles
  subtitleSpeakerNames: true, // Show who is speaking
  
  // Reduced motion
  reduceMotion: false, // Reduce camera shake and flashes
  reduceMotionStrength: 0.5, // 0 = no reduction, 1 = full reduction (use ?? 0.5 for default)
  
  // High contrast mode
  highContrast: false,
  
  // Bindings (loaded separately)
};

// Initialize accessibility settings
function initAccessibilitySettings() {
  // Merge with existing settings
  for (const [key, value] of Object.entries(ACCESSIBILITY_DEFAULTS)) {
    if (settings[key] === undefined) {
      settings[key] = value;
    }
  }
  
  // Load bindings
  if (!settings.bindings) {
    settings.bindings = {};
  }
  
  return { ...settings };
}

// Save accessibility settings
function saveAccessibilitySettings() {
  saveSettings();
}

// ============================================
// Color Blind Mode Utilities
// ============================================

// Color blind safe palettes
const COLOR_BLIND_PALETTES = {
  none: {
    weakSpot: '#ff6af0',
    weakSpotText: '#ff6af0',
    crosshairDefault: '#e8f4ff',
    crosshairAim: '#7fe8ff',
    crosshairEnemy: '#ff4a3a',
    crosshairWeak: '#ff6af0',
    crosshairBlocked: 'rgba(190, 200, 210, 0.45)',
    health: { low: '#d82a2a', high: '#ff6a4a' },
    shield: { low: '#2aa8ff', high: '#7fe8ff', glow: '#3ac0ff' },
    bossHealth: { low: '#ff5a1a', high: '#ffb04a', glow: 'rgba(255, 110, 40, 0.8)' },
    hitmarker: { normal: '#fff', crit: '#ffd23a', kill: '#ff3a3a' },
    threatMeter: '#ff4a3a',
  },
  
  // Deuteranopia (red-green, most common)
  deuteranopia: {
    weakSpot: '#00ffff',
    weakSpotText: '#00ffff',
    crosshairDefault: '#ffffff',
    crosshairAim: '#00ffff',
    crosshairEnemy: '#00ffff',
    crosshairWeak: '#ffff00',
    crosshairBlocked: 'rgba(150, 150, 150, 0.45)',
    health: { low: '#00aaff', high: '#00ffff' },
    shield: { low: '#ffff00', high: '#ffffaa', glow: '#ffff00' },
    bossHealth: { low: '#ff6a00', high: '#ffaa4a', glow: 'rgba(255, 165, 0, 0.8)' },
    hitmarker: { normal: '#ffffff', crit: '#ffff00', kill: '#ff6a00' },
    threatMeter: '#00ffff',
  },
  
  // Protanopia (red-weak)
  protanopia: {
    weakSpot: '#00ff00',
    weakSpotText: '#00ff00',
    crosshairDefault: '#ffffff',
    crosshairAim: '#00ff00',
    crosshairEnemy: '#00ff00',
    crosshairWeak: '#00ffff',
    crosshairBlocked: 'rgba(150, 150, 150, 0.45)',
    health: { low: '#00ff00', high: '#4aff4a' },
    shield: { low: '#00aaff', high: '#4a88ff', glow: '#00aaff' },
    bossHealth: { low: '#00aa00', high: '#4aff4a', glow: 'rgba(0, 170, 0, 0.8)' },
    hitmarker: { normal: '#ffffff', crit: '#00ff00', kill: '#00aa00' },
    threatMeter: '#00ff00',
  },
  
  // Tritanopia (blue-yellow)
  tritanopia: {
    weakSpot: '#ff00ff',
    weakSpotText: '#ff00ff',
    crosshairDefault: '#ffffff',
    crosshairAim: '#ff0000',
    crosshairEnemy: '#ff0000',
    crosshairWeak: '#ffff00',
    crosshairBlocked: 'rgba(150, 150, 150, 0.45)',
    health: { low: '#ff0000', high: '#ff4a4a' },
    shield: { low: '#00ffff', high: '#4affff', glow: '#00ffff' },
    bossHealth: { low: '#ff4a00', high: '#ff8a4a', glow: 'rgba(255, 74, 0, 0.8)' },
    hitmarker: { normal: '#ffffff', crit: '#ffff00', kill: '#ff0000' },
    threatMeter: '#ff0000',
  },
  
  // Achromatopsia (monochromacy)
  achromatopsia: {
    weakSpot: '#ffffff',
    weakSpotText: '#ffffff',
    crosshairDefault: '#ffffff',
    crosshairAim: '#ffffff',
    crosshairEnemy: '#ffffff',
    crosshairWeak: '#ffffff',
    crosshairBlocked: 'rgba(100, 100, 100, 0.45)',
    health: { low: '#ffffff', high: '#aaaaaa' },
    shield: { low: '#ffffff', high: '#aaaaaa', glow: '#ffffff' },
    bossHealth: { low: '#ffffff', high: '#aaaaaa', glow: 'rgba(255, 255, 255, 0.8)' },
    hitmarker: { normal: '#ffffff', crit: '#ffffff', kill: '#ffffff' },
    threatMeter: '#ffffff',
  },
};

// Get current palette based on color blind mode
function getCurrentPalette() {
  const mode = settings.colorBlindMode || 'none';
  return COLOR_BLIND_PALETTES[mode] || COLOR_BLIND_PALETTES.none;
}

// Apply color blind palette to CSS variables
function applyColorBlindPalette() {
  const palette = getCurrentPalette();
  const root = document.documentElement;
  
  // Crosshair colors
  root.style.setProperty('--color-crosshair-default', palette.crosshairDefault);
  root.style.setProperty('--color-crosshair-aim', palette.crosshairAim);
  root.style.setProperty('--color-crosshair-enemy', palette.crosshairEnemy);
  root.style.setProperty('--color-crosshair-weak', palette.crosshairWeak);
  root.style.setProperty('--color-crosshair-blocked', palette.crosshairBlocked);
  
  // Health and shield colors
  root.style.setProperty('--color-health-low', palette.health.low);
  root.style.setProperty('--color-health-high', palette.health.high);
  root.style.setProperty('--color-shield-low', palette.shield.low);
  root.style.setProperty('--color-shield-high', palette.shield.high);
  root.style.setProperty('--color-shield-glow', palette.shield.glow);
  
  // Boss health
  root.style.setProperty('--color-boss-health-low', palette.bossHealth.low);
  root.style.setProperty('--color-boss-health-high', palette.bossHealth.high);
  root.style.setProperty('--color-boss-health-glow', palette.bossHealth.glow);
  
  // Hitmarker colors
  root.style.setProperty('--color-hitmarker-normal', palette.hitmarker.normal);
  root.style.setProperty('--color-hitmarker-crit', palette.hitmarker.crit);
  root.style.setProperty('--color-hitmarker-kill', palette.hitmarker.kill);
  
  // Weak spot colors
  root.style.setProperty('--color-weak-spot', palette.weakSpot);
  root.style.setProperty('--color-weak-spot-text', palette.weakSpotText);
  
  // Threat meter
  root.style.setProperty('--color-threat-meter', palette.threatMeter);
}

// ============================================
// Subtitle Utilities
// ============================================

// Subtitle styles
const SUBTITLE_STYLES = {
  small: { fontSize: '12px', lineHeight: '1.2' },
  medium: { fontSize: '14px', lineHeight: '1.3' },
  large: { fontSize: '18px', lineHeight: '1.5' },
};

// Apply subtitle settings
function applySubtitleSettings() {
  const style = SUBTITLE_STYLES[settings.subtitleSize] || SUBTITLE_STYLES.medium;
  const root = document.documentElement;
  
  root.style.setProperty('--subtitle-font-size', style.fontSize);
  root.style.setProperty('--subtitle-line-height', style.lineHeight);
  root.style.setProperty('--subtitle-background-opacity', settings.subtitleBackground ? '0.7' : '0');
}

// Format subtitle text with HTML escaping
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatSubtitle(text, speaker = null) {
  let result = escapeHtml(text);
  if (settings.subtitleSpeakerNames && speaker) {
    result = `<span class="subtitle-speaker">${escapeHtml(speaker)}:</span> ${result}`;
  }
  return result;
}

// ============================================
// Reduced Motion Utilities
// ============================================

// Reduced motion tuning values (parallel to juice.js TUNING)
const REDUCED_MOTION_TUNING = {
  hitstopKill: 0.035,
  hitstopHead: 0.0125,
  killTrauma: 0.11,
  hurtTrauma: 0.19,
  coverTrauma: 0.08,
  landTrauma: 0.1,
  jetTrauma: 0.025,
  jetLandTrauma: 0.03,
  // FOV punch values
  killPunch: 1.5,
  perfectReloadPunch: 1.25,
  coverDip: 0.45,
  jetDip: -0.175,
  jetLandDip: 0.35,
};

// Get motion reduction factor (0-1)
function getMotionReductionFactor() {
  if (!settings.reduceMotion) return 1.0;
  return 1.0 - (settings.reduceMotionStrength ?? 0.5);
}

// Check if reduced motion is enabled
function isReducedMotionEnabled() {
  return settings.reduceMotion;
}

// Get reduced trauma value by key name
function getReducedTraumaValue(key) {
  if (!isReducedMotionEnabled()) return null;
  const factor = getMotionReductionFactor();
  const reducedKey = key.replace('Trauma', 'TraumaReduced').replace('hitstop', 'hitstopReduced');
  if (REDUCED_MOTION_TUNING[reducedKey] !== undefined) {
    return REDUCED_MOTION_TUNING[reducedKey] * factor;
  }
  return null;
}

// Get reduced hitstop value by key name
function getReducedHitstopValue(key) {
  if (!isReducedMotionEnabled()) return null;
  const factor = getMotionReductionFactor();
  const reducedKey = key.replace('hitstop', 'hitstopReduced');
  if (REDUCED_MOTION_TUNING[reducedKey] !== undefined) {
    return REDUCED_MOTION_TUNING[reducedKey] * factor;
  }
  return null;
}

// Get reduced punch/dip value by key name
function getReducedMotionValue(key) {
  if (!isReducedMotionEnabled()) return null;
  const factor = getMotionReductionFactor();
  const reducedKey = key.replace('Punch', 'PunchReduced').replace('Dip', 'DipReduced');
  if (REDUCED_MOTION_TUNING[reducedKey] !== undefined) {
    return REDUCED_MOTION_TUNING[reducedKey] * factor;
  }
  return null;
}

// Get current motion factor for juice system
function getCurrentMotionFactor() {
  return getMotionReductionFactor();
}

// ============================================
// High Contrast Mode
// ============================================

// Apply high contrast settings
function applyHighContrast() {
  const root = document.documentElement;
  const enabled = settings.highContrast || false;
  
  if (enabled) {
    root.classList.add('high-contrast');
  } else {
    root.classList.remove('high-contrast');
  }
}

// ============================================
// Full Initialization
// ============================================

// Initialize all accessibility features
function initAccessibility() {
  // Load settings
  initAccessibilitySettings();
  
  // Initialize bindings
  initBindings();
  
  // Apply color blind palette
  applyColorBlindPalette();
  
  // Apply subtitle settings
  applySubtitleSettings();
  
  // Apply high contrast
  applyHighContrast();
}

// Reapply all accessibility settings (call after settings change)
function reapplyAccessibility() {
  applyColorBlindPalette();
  applySubtitleSettings();
  applyHighContrast();
}

// ============================================
// UI Binding for Settings Panel
// ============================================

// Bind accessibility settings to UI panel
function bindAccessibilityUI() {
  const $ = (id) => document.getElementById(id);
  
  // Color blind mode selector
  const colorBlindSelect = $('colorblind-mode');
  if (colorBlindSelect) {
    colorBlindSelect.value = settings.colorBlindMode || 'none';
    colorBlindSelect.addEventListener('change', () => {
      settings.colorBlindMode = colorBlindSelect.value;
      saveAccessibilitySettings();
      applyColorBlindPalette();
    });
  }
  
  // Subtitle size selector
  const subtitleSizeSelect = $('subtitle-size');
  if (subtitleSizeSelect) {
    subtitleSizeSelect.value = settings.subtitleSize || 'medium';
    subtitleSizeSelect.addEventListener('change', () => {
      settings.subtitleSize = subtitleSizeSelect.value;
      saveAccessibilitySettings();
      applySubtitleSettings();
    });
  }
  
  // Subtitle background toggle
  const subtitleBgCheckbox = $('subtitle-background');
  if (subtitleBgCheckbox) {
    subtitleBgCheckbox.checked = settings.subtitleBackground !== false;
    subtitleBgCheckbox.addEventListener('change', () => {
      settings.subtitleBackground = subtitleBgCheckbox.checked;
      saveAccessibilitySettings();
      applySubtitleSettings();
    });
  }
  
  // Subtitle speaker names toggle
  const subtitleSpeakerCheckbox = $('subtitle-speaker');
  if (subtitleSpeakerCheckbox) {
    subtitleSpeakerCheckbox.checked = settings.subtitleSpeakerNames !== false;
    subtitleSpeakerCheckbox.addEventListener('change', () => {
      settings.subtitleSpeakerNames = subtitleSpeakerCheckbox.checked;
      saveAccessibilitySettings();
    });
  }
  
  // Reduced motion toggle
  const reduceMotionCheckbox = $('reduce-motion');
  if (reduceMotionCheckbox) {
    reduceMotionCheckbox.checked = settings.reduceMotion || false;
    reduceMotionCheckbox.addEventListener('change', () => {
      settings.reduceMotion = reduceMotionCheckbox.checked;
      saveAccessibilitySettings();
    });
  }
  
  // Reduced motion strength slider
  const reduceMotionSlider = $('reduce-motion-strength');
  if (reduceMotionSlider) {
    reduceMotionSlider.value = settings.reduceMotionStrength ?? 0.5;
    reduceMotionSlider.addEventListener('input', () => {
      settings.reduceMotionStrength = parseFloat(reduceMotionSlider.value);
      saveAccessibilitySettings();
    });
  }
  
  // High contrast toggle
  const highContrastCheckbox = $('high-contrast');
  if (highContrastCheckbox) {
    highContrastCheckbox.checked = settings.highContrast || false;
    highContrastCheckbox.addEventListener('change', () => {
      settings.highContrast = highContrastCheckbox.checked;
      saveAccessibilitySettings();
      applyHighContrast();
    });
  }
}

// Get binding display info for UI
function getBindingDisplayInfo() {
  const bindings = getAllBindings();
  const categories = {};
  
  for (const [category, actions] of Object.entries(ACTION_CATEGORIES)) {
    categories[category] = actions.map(action => ({
      name: getActionName(action),
      action: action,
      codes: (bindings[action] || []).map(code => getCodeName(code)),
    }));
  }
  
  return categories;
}

// Reset a specific action to default
function resetActionToDefault(action) {
  if (DEFAULT_BINDINGS[action]) {
    settings.bindings = settings.bindings || {};
    settings.bindings[action] = structuredClone(DEFAULT_BINDINGS[action]);
    // Also update in-memory copy
    currentBindings[action] = structuredClone(DEFAULT_BINDINGS[action]);
    saveAccessibilitySettings();
    return true;
  }
  return false;
}

// Reset all bindings to defaults
function resetAllBindings() {
  settings.bindings = {};
  // Also update in-memory copy
  currentBindings = structuredClone(DEFAULT_BINDINGS);
  saveAccessibilitySettings();
}

// Get current bindings (for Controls)
function getCurrentBindings() {
  return getAllBindings();
}

export {
  // Initialization
  initAccessibility,
  initBindings,
  reapplyAccessibility,
  
  // Color blind
  getCurrentPalette,
  applyColorBlindPalette,
  COLOR_BLIND_PALETTES,
  
  // Subtitles
  formatSubtitle,
  applySubtitleSettings,
  SUBTITLE_STYLES,
  
  // Reduced motion
  getMotionReductionFactor,
  isReducedMotionEnabled,
  getReducedTraumaValue,
  getReducedHitstopValue,
  getReducedMotionValue,
  getCurrentMotionFactor,
  REDUCED_MOTION_TUNING,
  
  // High contrast
  applyHighContrast,
  
  // UI
  bindAccessibilityUI,
  
  // Bindings helpers
  getBindingDisplayInfo,
  getCurrentBindings,
  resetActionToDefault,
  resetAllBindings,
  
  // Settings
  ACCESSIBILITY_DEFAULTS,
  
  // Re-export from remap.js
  loadBindings,
};
