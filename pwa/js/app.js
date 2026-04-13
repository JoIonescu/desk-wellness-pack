/**
 * app.js — PWA entry point
 * - Registers the service worker
 * - Manages screen routing
 * - Bootstraps the app on load
 */

import storage from './storage.js';

// ── Screen IDs ────────────────────────────────────────────────────
const SCREENS = {
  WELCOME: 'screenWelcome',
  HOME:    'screenHome',
  STRETCH: 'screenStretch',
  WATER:   'screenWater',
};

// ── State ─────────────────────────────────────────────────────────
let currentScreen = null;

// ── Service Worker Registration ───────────────────────────────────
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[app] Service workers not supported');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
    });
    console.log('[app] SW registered, scope:', reg.scope);
  } catch (err) {
    console.error('[app] SW registration failed:', err);
  }
}

// ── Router ────────────────────────────────────────────────────────

/** Show a screen by ID, hide all others. */
function showScreen(screenId) {
  for (const id of Object.values(SCREENS)) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id === screenId);
  }
  currentScreen = screenId;
  // Dispatch so individual screen modules can react
  document.dispatchEvent(new CustomEvent('screenchange', { detail: { screen: screenId } }));
}

/** Navigate to a screen. Called by other modules. */
function navigate(screenId) {
  showScreen(screenId);
}

// ── Boot sequence ─────────────────────────────────────────────────

function boot() {
  // 1. Initialise storage
  const isFirstLaunch = storage.initDefaults();

  // 2. Decide first screen
  const hasSeenWelcome = storage.get('hasSeenWelcome');

  if (!hasSeenWelcome || isFirstLaunch) {
    showScreen(SCREENS.WELCOME);
  } else {
    // Check if a notification launched us to a specific screen
    const launchTarget = getLaunchTarget();
    showScreen(launchTarget || SCREENS.HOME);
  }

  // 3. Fade out loading screen
  const loading = document.getElementById('loadingScreen');
  if (loading) {
    loading.classList.add('fade-out');
    setTimeout(() => loading.remove(), 350);
  }
}

/**
 * If opened via a notification, the URL may contain ?screen=stretch or ?screen=water.
 * Returns the matching SCREENS constant or null.
 */
function getLaunchTarget() {
  const params = new URLSearchParams(window.location.search);
  const target = params.get('screen');
  if (target === 'stretch') return SCREENS.STRETCH;
  if (target === 'water')   return SCREENS.WATER;
  return null;
}

// ── Init ──────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  boot();
});

// Export for use by other modules
export { navigate, SCREENS, currentScreen };
