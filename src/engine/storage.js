// localStorage wrapper that never throws (private windows, sandboxed iframes, blocked storage).
export function loadJSON(key, fallback = {}) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // storage blocked: the value lasts for this session only
  }
}
