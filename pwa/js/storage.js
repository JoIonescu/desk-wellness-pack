/**
 * storage.js — PWA storage layer
 *
 * Mirrors chrome.storage.local key names from the extension exactly.
 * This means if we ever add sync/export between extension and PWA,
 * the data shapes match.
 *
 * All reads/writes are synchronous localStorage. If we need
 * IndexedDB later for larger data, swap the internals here only.
 */

const storage = (() => {

  /** Get a value. Returns null if key doesn't exist. */
  function get(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[storage] get error', key, e);
      return null;
    }
  }

  /** Set a value. */
  function set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('[storage] set error', key, e);
    }
  }

  /** Remove a key. */
  function remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn('[storage] remove error', key, e);
    }
  }

  /** Get multiple keys at once. Returns an object. */
  function getMulti(keys) {
    const result = {};
    for (const key of keys) {
      result[key] = get(key);
    }
    return result;
  }

  /** Set multiple keys at once. */
  function setMulti(obj) {
    for (const [key, value] of Object.entries(obj)) {
      set(key, value);
    }
  }

  // ----------------------------------------------------------------
  // Default state — matches extension defaults exactly
  // ----------------------------------------------------------------

  const STRETCH_DEFAULTS = {
    stretchEnabled: false,          // timer running
    stretchInterval: 30,            // minutes
    smartMode: true,
    stretchSound: true,
    // stats — current week
    completedCount: 0,
    snoozedCount: 0,
    skippedCount: 0,
    // stats — last week
    lastCompletedCount: 0,
    lastSnoozedCount: 0,
    lastSkippedCount: 0,
    // Pro
    licenseToken: null,
    calendarEnabled: false,
    calendarToken: null,
  };

  const WATER_DEFAULTS = {
    waterEnabled: false,            // timer running
    waterInterval: 30,              // minutes
    waterSound: true,
    waterGlassCount: 0,
    waterGoal: 8,
    waterGoalResetDate: null,
    // Pro
    waterLicenseToken: null,
    waterCalendarEnabled: false,
    waterCalendarToken: null,
  };

  const APP_DEFAULTS = {
    installDate: null,
    hasSeenWelcome: false,
    notificationPermission: 'default', // 'granted' | 'denied' | 'default'
  };

  /** Initialise storage with defaults on first launch. */
  function initDefaults() {
    const isNew = get('installDate') === null;
    if (isNew) {
      setMulti({
        ...STRETCH_DEFAULTS,
        ...WATER_DEFAULTS,
        ...APP_DEFAULTS,
        installDate: new Date().toISOString(),
      });
    }
    return isNew;
  }

  return { get, set, remove, getMulti, setMulti, initDefaults, STRETCH_DEFAULTS, WATER_DEFAULTS };
})();

export default storage;
