/**
 * home.js — Home screen (replaces popup.js)
 *
 * Handles:
 * - Start/stop stretch + water timers (via storage, no chrome.runtime)
 * - Interval selectors
 * - Toggle settings
 * - Tab switching (Stretch ↔ Water)
 * - Stats display
 * - Upgrade card (links to Vercel backend)
 */

import storage from './storage.js';
import { navigate, SCREENS } from './app.js';
import { scheduleStretch, cancelStretch, scheduleWater, cancelWater } from './notifications.js';

const BACKEND_URL = 'https://desk-wellness-pack.vercel.app';

// ── Initialise home screen ────────────────────────────────────────
export function initHome() {
  loadState();
  bindTabs();
  bindStretch();
  bindWater();
  bindUpgrade();
  renderStats();
  startCountdownTick();
}

// ── Tab switching ─────────────────────────────────────────────────
function bindTabs() {
  document.getElementById('tabStretch')?.addEventListener('click', () => activateTab('stretch'));
  document.getElementById('tabWater')?.addEventListener('click', () => activateTab('water'));
}

function activateTab(tab) {
  const isStretch = tab === 'stretch';
  document.getElementById('tabStretch')?.classList.toggle('tab-active', isStretch);
  document.getElementById('tabWater')?.classList.toggle('tab-active', !isStretch);
  document.getElementById('sectionStretch')?.classList.toggle('hidden', !isStretch);
  document.getElementById('sectionWater')?.classList.toggle('hidden', isStretch);
}

// ── Load state from storage → UI ─────────────────────────────────
function loadState() {
  // Stretch
  const stretchEnabled = storage.get('stretchEnabled') ?? false;
  const stretchInterval = storage.get('stretchInterval') ?? 30;
  const smartMode       = storage.get('smartMode') ?? true;
  const stretchSound    = storage.get('stretchSound') ?? true;
  const licenseToken    = storage.get('licenseToken');
  const calEnabled      = storage.get('calendarEnabled') ?? false;
  const calToken        = storage.get('calendarToken');

  setToggle('smartModeToggle', smartMode);
  setToggle('soundToggle', stretchSound);
  setSelectValue('customSelectWrap', stretchInterval);
  updateStretchUI(stretchEnabled);
  updateStretchPro(!!licenseToken, calEnabled, !!calToken);

  // Water
  const waterEnabled    = storage.get('waterEnabled') ?? false;
  const waterInterval   = storage.get('waterInterval') ?? 30;
  const waterSound      = storage.get('waterSound') ?? true;
  const waterGlassCount = storage.get('waterGlassCount') ?? 0;
  const waterGoal       = storage.get('waterGoal') ?? 8;
  const waterLicense    = storage.get('waterLicenseToken');
  const waterCalEnabled = storage.get('waterCalendarEnabled') ?? false;
  const waterCalToken   = storage.get('waterCalendarToken');

  setToggle('waterSoundToggle', waterSound);
  setSelectValue('waterCustomSelectWrap', waterInterval);
  updateWaterUI(waterEnabled);
  updateWaterGlasses(waterGlassCount, waterGoal);
  updateWaterPro(!!waterLicense, waterCalEnabled, !!waterCalToken, waterGoal);
}

// ── Stretch bindings ──────────────────────────────────────────────
function bindStretch() {
  document.getElementById('startBtn')?.addEventListener('click', startStretch);
  document.getElementById('stopBtn')?.addEventListener('click', stopStretch);

  document.getElementById('smartModeToggle')?.addEventListener('change', (e) => {
    storage.set('smartMode', e.target.checked);
  });
  document.getElementById('soundToggle')?.addEventListener('change', (e) => {
    storage.set('stretchSound', e.target.checked);
  });
  document.getElementById('calendarToggle')?.addEventListener('change', (e) => {
    handleCalendarToggle('stretch', e.target.checked);
  });

  bindCustomSelect('customSelectWrap', 'intervalSelect', (val) => {
    storage.set('stretchInterval', Number(val));
    if (storage.get('stretchEnabled')) {
      // Reschedule — handled by notifications.js (Day 3-4)
      document.dispatchEvent(new CustomEvent('stretchReschedule', { detail: { interval: Number(val) } }));
    }
  });
}

function startStretch() {
  storage.set('stretchEnabled', true);
  const interval = storage.get('stretchInterval') ?? 30;
  updateStretchUI(true);
  scheduleStretch(interval);
  document.dispatchEvent(new CustomEvent('stretchStart', { detail: { interval } }));
}

function stopStretch() {
  storage.set('stretchEnabled', false);
  updateStretchUI(false);
  cancelStretch();
  document.dispatchEvent(new CustomEvent('stretchStop'));
}

function updateStretchUI(enabled) {
  const startBtn = document.getElementById('startBtn');
  const stopBtn  = document.getElementById('stopBtn');
  if (startBtn) startBtn.disabled = enabled;
  if (stopBtn)  stopBtn.disabled  = !enabled;

  if (!enabled) {
    const el = document.getElementById('timerDisplay');
    if (el) el.textContent = 'Timer Inactive';
    const lbl = document.getElementById('timerLabel');
    if (lbl) lbl.textContent = 'Next stretch break';
  }
}

function updateStretchPro(isPro, calEnabled, calConnected) {
  const upgradeCard    = document.getElementById('upgradeCard');
  const proCard        = document.getElementById('proIntegrationsCard');
  const proBadge       = document.getElementById('stretchProBadge');

  if (upgradeCard) upgradeCard.classList.toggle('hidden', isPro);
  if (proCard)     proCard.classList.toggle('hidden', !isPro);
  if (proBadge)    proBadge.classList.toggle('hidden', !isPro);

  if (isPro) {
    setToggle('calendarToggle', calEnabled);
    const status = document.getElementById('calendarStatus');
    if (status) status.style.display = calConnected ? 'block' : 'none';
  }
}

// ── Water bindings ────────────────────────────────────────────────
function bindWater() {
  document.getElementById('waterStartBtn')?.addEventListener('click', startWater);
  document.getElementById('waterStopBtn')?.addEventListener('click', stopWater);

  document.getElementById('waterSoundToggle')?.addEventListener('change', (e) => {
    storage.set('waterSound', e.target.checked);
  });
  document.getElementById('waterCalendarToggle')?.addEventListener('change', (e) => {
    handleCalendarToggle('water', e.target.checked);
  });
  document.getElementById('waterGoalMinus')?.addEventListener('click', () => changeWaterGoal(-1));
  document.getElementById('waterGoalPlus')?.addEventListener('click',  () => changeWaterGoal(+1));

  bindCustomSelect('waterCustomSelectWrap', 'waterIntervalSelect', (val) => {
    storage.set('waterInterval', Number(val));
    if (storage.get('waterEnabled')) {
      document.dispatchEvent(new CustomEvent('waterReschedule', { detail: { interval: Number(val) } }));
    }
  });
}

function startWater() {
  storage.set('waterEnabled', true);
  const interval = storage.get('waterInterval') ?? 30;
  updateWaterUI(true);
  scheduleWater(interval);
  document.dispatchEvent(new CustomEvent('waterStart', { detail: { interval } }));
}

function stopWater() {
  storage.set('waterEnabled', false);
  updateWaterUI(false);
  cancelWater();
  document.dispatchEvent(new CustomEvent('waterStop'));
}

function updateWaterUI(enabled) {
  const startBtn = document.getElementById('waterStartBtn');
  const stopBtn  = document.getElementById('waterStopBtn');
  if (startBtn) startBtn.disabled = enabled;
  if (stopBtn)  stopBtn.disabled  = !enabled;

  if (!enabled) {
    const el = document.getElementById('waterTimerDisplay');
    if (el) el.textContent = 'Timer Inactive';
    const lbl = document.getElementById('waterTimerLabel');
    if (lbl) lbl.textContent = 'Next water reminder';
  }
}

function updateWaterPro(isPro, calEnabled, calConnected, goal) {
  const upgradeCard = document.getElementById('waterUpgradeCard');
  const proCard     = document.getElementById('waterProCard');
  const proBadge    = document.getElementById('waterProBadge');
  const lockIcon    = document.getElementById('waterGoalLockIcon');
  const goalStepper = document.getElementById('waterGoalStepper');
  const goalSubLabel = document.getElementById('waterGoalSubLabel');

  if (upgradeCard) upgradeCard.classList.toggle('hidden', isPro);
  if (proCard)     proCard.classList.toggle('hidden', !isPro);
  if (proBadge)    proBadge.classList.toggle('hidden', !isPro);

  // Unlock goal stepper for Pro
  if (goalStepper) {
    goalStepper.style.opacity = isPro ? '1' : '0.4';
    goalStepper.style.pointerEvents = isPro ? 'auto' : 'none';
  }
  if (lockIcon) lockIcon.style.display = isPro ? 'none' : 'inline';
  if (goalSubLabel) goalSubLabel.textContent = isPro
    ? 'Your daily hydration target'
    : 'Upgrade to Pro to set your own goal';

  if (isPro) {
    setToggle('waterCalendarToggle', calEnabled);
    const status = document.getElementById('waterCalendarStatus');
    if (status) status.style.display = calConnected ? 'block' : 'none';
  }
}

function updateWaterGlasses(count, goal) {
  const countEl = document.getElementById('waterGlassCount');
  const goalEl  = document.getElementById('waterGoalDisplay');
  const goalVal = document.getElementById('waterGoalValue');
  const fillEl  = document.getElementById('waterMiniGlassFill');
  const dotsEl  = document.getElementById('waterDotsContainer');

  if (countEl) countEl.textContent = count;
  if (goalEl)  goalEl.textContent  = goal;
  if (goalVal) goalVal.textContent = goal;

  const pct = Math.min(100, Math.round((count / goal) * 100));
  if (fillEl) fillEl.style.height = pct + '%';

  if (dotsEl) {
    dotsEl.innerHTML = '';
    for (let i = 0; i < goal; i++) {
      const dot = document.createElement('div');
      dot.style.cssText = `
        width: 10px; height: 10px; border-radius: 50%;
        background: ${i < count ? 'var(--blue)' : 'rgba(90,169,255,0.2)'};
        transition: background 0.3s ease;
      `;
      dotsEl.appendChild(dot);
    }
  }
}

function changeWaterGoal(delta) {
  const current = storage.get('waterGoal') ?? 8;
  const next = Math.max(1, Math.min(20, current + delta));
  storage.set('waterGoal', next);
  updateWaterGlasses(storage.get('waterGlassCount') ?? 0, next);
}

// ── Upgrade ───────────────────────────────────────────────────────
function bindUpgrade() {
  document.getElementById('upgradeBtn')?.addEventListener('click', () => openUpgrade('stretch'));
  document.getElementById('verifyBtn')?.addEventListener('click', () => verifyPayment('stretch'));
  document.getElementById('waterUpgradeBtn')?.addEventListener('click', () => openUpgrade('water'));
  document.getElementById('waterVerifyBtn')?.addEventListener('click', () => verifyPayment('water'));
}

async function openUpgrade(module) {
  const installationId = storage.get('installationId') || generateId();
  storage.set('installationId', installationId);

  const endpoint = module === 'water'
    ? `${BACKEND_URL}/api/create-water-checkout`
    : `${BACKEND_URL}/api/create-checkout`;

  try {
    const resp = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId }),
    });
    const data = await resp.json();
    if (data.url) {
      window.open(data.url, '_blank');
      // Show verify button
      const verifyBtn   = document.getElementById(module === 'water' ? 'waterVerifyBtn'   : 'verifyBtn');
      const pendingNote = document.getElementById(module === 'water' ? 'waterPendingNote' : 'pendingNote');
      if (verifyBtn)   verifyBtn.style.display   = 'flex';
      if (pendingNote) pendingNote.style.display = 'block';
    }
  } catch (err) {
    console.error('[home] upgrade error', err);
    alert('Could not connect to payment server. Check your connection and try again.');
  }
}

async function verifyPayment(module) {
  const installationId = storage.get('installationId');
  if (!installationId) return;

  const endpoint = module === 'water'
    ? `${BACKEND_URL}/api/verify-water-payment`
    : `${BACKEND_URL}/api/verify-payment`;

  try {
    const resp = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId }),
    });
    const data = await resp.json();
    if (data.token) {
      const key = module === 'water' ? 'waterLicenseToken' : 'licenseToken';
      storage.set(key, data.token);
      loadState(); // re-render
    } else {
      alert('Payment not found yet — complete the checkout and try again.');
    }
  } catch (err) {
    console.error('[home] verify error', err);
    alert('Could not verify payment. Check your connection and try again.');
  }
}

// ── Calendar OAuth ────────────────────────────────────────────────
function handleCalendarToggle(module, enabled) {
  if (!enabled) {
    if (module === 'water') {
      storage.set('waterCalendarEnabled', false);
      storage.set('waterCalendarToken', null);
    } else {
      storage.set('calendarEnabled', false);
      storage.set('calendarToken', null);
    }
    return;
  }
  // Open Google OAuth — same dedicated page approach as extension's oauth.html
  // For PWA, this is a dedicated /oauth.html page we'll build in Week 3
  const oauthUrl = `/oauth.html?module=${module}`;
  const win = window.open(oauthUrl, 'oauth', 'width=500,height=600');
  if (!win) {
    alert('Please allow popups for Google Calendar sign-in.');
  }
}

// ── Stats ─────────────────────────────────────────────────────────
function renderStats() {
  const fields = ['completedCount', 'snoozedCount', 'skippedCount',
                  'lastCompletedCount', 'lastSnoozedCount', 'lastSkippedCount'];
  for (const f of fields) {
    const el = document.getElementById(f);
    if (el) el.textContent = storage.get(f) ?? 0;
  }
}

// ── Countdown tick ────────────────────────────────────────────────
// Reads nextStretchTime / nextWaterTime from storage and counts down.
// notifications.js (Day 3-4) will write these on schedule.
function startCountdownTick() {
  setInterval(tick, 1000);
  tick();
}

function tick() {
  tickTimer('nextStretchTime', 'timerDisplay', 'timerLabel',
            'stretchEnabled', 'Next stretch in', 'var(--yellow)');
  tickTimer('nextWaterTime',   'waterTimerDisplay', 'waterTimerLabel',
            'waterEnabled',   'Next water in', 'var(--blue)');
}

function tickTimer(storageKey, displayId, labelId, enabledKey, labelText, color) {
  const enabled = storage.get(enabledKey);
  const display = document.getElementById(displayId);
  const label   = document.getElementById(labelId);
  if (!display) return;

  if (!enabled) {
    display.textContent = 'Timer Inactive';
    display.style.color = color;
    if (label) label.textContent = displayId.startsWith('water') ? 'Next water reminder' : 'Next stretch break';
    return;
  }

  const nextTime = storage.get(storageKey);
  if (!nextTime) {
    display.textContent = 'Starting…';
    display.style.color = color;
    return;
  }

  const remaining = nextTime - Date.now();
  if (remaining <= 0) {
    display.textContent = '00:00';
    display.style.color = color;
    return;
  }

  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  display.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  display.style.color = color;
  if (label) label.textContent = labelText;
}

// ── Helpers ───────────────────────────────────────────────────────
function setToggle(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

function setSelectValue(wrapId, value) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const options = wrap.querySelectorAll('.custom-select-option');
  const trigger = wrap.querySelector('.custom-select-trigger span');
  options.forEach((opt) => {
    const selected = Number(opt.dataset.value) === Number(value);
    opt.classList.toggle('selected', selected);
    if (selected && trigger) trigger.textContent = opt.textContent;
  });
}

function bindCustomSelect(wrapId, nativeId, onChange) {
  const wrap    = document.getElementById(wrapId);
  const trigger = wrap?.querySelector('.custom-select-trigger');
  const options = wrap?.querySelectorAll('.custom-select-options');
  const optList = wrap?.querySelector('.custom-select-options');

  if (!wrap || !trigger) return;

  trigger.addEventListener('click', () => {
    trigger.classList.toggle('open');
    if (optList) optList.classList.toggle('open');
  });

  wrap.querySelectorAll('.custom-select-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      const val = opt.dataset.value;
      const label = trigger.querySelector('span');
      if (label) label.textContent = opt.textContent;
      wrap.querySelectorAll('.custom-select-option').forEach((o) =>
        o.classList.toggle('selected', o === opt)
      );
      trigger.classList.remove('open');
      if (optList) optList.classList.remove('open');
      if (onChange) onChange(val);
    });
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      trigger.classList.remove('open');
      if (optList) optList.classList.remove('open');
    }
  });
}

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function generateId() {
  return 'pwa-' + Math.random().toString(36).substring(2, 15);
}
