const ALARM_NAME = "stretchAlarm";
const WEEKLY_RESET_ALARM = "weeklyStatsReset";
const MEETING_CHECK_ALARM = "meetingCheckAlarm";
const POST_MEETING_ALARM = "postMeetingAlarm";
const POST_MEETING_BUFFER_MINUTES = 5;

/* ---- Water module constants ---- */
const WATER_ALARM_NAME = "waterAlarm";
const WATER_MEETING_CHECK_ALARM = "waterMeetingCheckAlarm";
const WATER_POST_MEETING_ALARM = "waterPostMeetingAlarm";
const WATER_POST_MEETING_BUFFER_MINUTES = 5;

const BACKEND_URL = "https://desk-wellness-pack.vercel.app";

let countdownInterval = null;

const DEFAULT_RUNTIME = {
  stretchReminderState: "inactive",
  pendingDueWhileIdle: false,
  isPausedByIdle: false,
  pausedAt: null,
  remainingMsAtPause: null
};

let runtimeState = { ...DEFAULT_RUNTIME };

let _licenseCache = null;
let _licenseCacheAt = 0;
let _waterLicenseCache = null;
let _waterLicenseCacheAt = 0;

/* ---------------------------------- */
/* STORAGE HELPERS                    */
/* ---------------------------------- */

function getSync(keys) { return new Promise(r => chrome.storage.sync.get(keys, r)); }
function setSync(data) { return new Promise(r => chrome.storage.sync.set(data, r)); }
function removeSync(keys) { return new Promise(r => chrome.storage.sync.remove(keys, r)); }
function getLocal(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
function setLocal(data) { return new Promise(r => chrome.storage.local.set(data, r)); }
function removeLocal(keys) { return new Promise(r => chrome.storage.local.remove(keys, r)); }

async function getRuntimeState() {
  const data = await getLocal(["runtimeState"]);
  return data.runtimeState || { ...DEFAULT_RUNTIME };
}
async function setRuntimeState(nextState) {
  runtimeState = { ...DEFAULT_RUNTIME, ...nextState };
  await setLocal({ runtimeState });
}

function getCurrentHour() { return new Date().getHours(); }
function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

/* ---------------------------------- */
/* WEEK HELPERS                       */
/* ---------------------------------- */

function getMondayKey(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

/* ---------------------------------- */
/* SMART STATS + HISTORY              */
/* ---------------------------------- */

async function getSmartStatsData() {
  const data = await getLocal(["smartStats"]);
  return data.smartStats || { completedCount: 0, skippedCount: 0, snoozedCount: 0, lastResetDate: null };
}
async function setSmartStatsData(stats) { await setLocal({ smartStats: stats }); }
async function getLastWeekStats() {
  const data = await getLocal(["lastWeekStats"]);
  return data.lastWeekStats || { completedCount: 0, skippedCount: 0, snoozedCount: 0, archivedAt: null };
}
async function setLastWeekStats(stats) { await setLocal({ lastWeekStats: stats }); }

async function maybeResetWeeklyStats() {
  const stats = await getSmartStatsData();
  const currentWeekMondayKey = getMondayKey();
  if (!stats.lastResetDate) {
    await setSmartStatsData({ ...stats, lastResetDate: currentWeekMondayKey });
    return;
  }
  if (stats.lastResetDate === currentWeekMondayKey) return;
  await setLastWeekStats({ completedCount: stats.completedCount||0, skippedCount: stats.skippedCount||0, snoozedCount: stats.snoozedCount||0, archivedAt: currentWeekMondayKey });
  await setSmartStatsData({ completedCount: 0, skippedCount: 0, snoozedCount: 0, lastResetDate: currentWeekMondayKey });
}

async function getBehaviorHistory() {
  const data = await getLocal(["behaviorHistory"]);
  return Array.isArray(data.behaviorHistory) ? data.behaviorHistory : [];
}
async function setBehaviorHistory(history) { await setLocal({ behaviorHistory: history }); }
async function getHourlyPatterns() {
  const data = await getLocal(["hourlyPatterns"]);
  return data.hourlyPatterns || {};
}
async function setHourlyPatterns(hourlyPatterns) { await setLocal({ hourlyPatterns }); }

async function recordBehavior(type) {
  await maybeResetWeeklyStats();
  const stats = await getSmartStatsData();
  const history = await getBehaviorHistory();
  const hourlyPatterns = await getHourlyPatterns();
  const hour = String(getCurrentHour());
  if (!hourlyPatterns[hour]) hourlyPatterns[hour] = { completed: 0, skipped: 0, snoozed: 0 };
  if (type === "completed")    { stats.completedCount += 1; hourlyPatterns[hour].completed += 1; }
  else if (type === "skipped") { stats.skippedCount   += 1; hourlyPatterns[hour].skipped   += 1; }
  else if (type === "snoozed") { stats.snoozedCount   += 1; hourlyPatterns[hour].snoozed   += 1; }
  history.push({ type, timestamp: Date.now(), hour: getCurrentHour() });
  await setSmartStatsData(stats);
  await setBehaviorHistory(history.slice(-50));
  await setHourlyPatterns(hourlyPatterns);
}

/* ---------------------------------- */
/* SETTINGS                           */
/* ---------------------------------- */

async function getSettings() {
  const data = await getLocal(["interval","userInterval","startTime","smartModeEnabled","soundEnabled","currentStretchSessionType"]);
  return {
    interval: Number(data.interval || data.userInterval || 30),
    userInterval: Number(data.userInterval || data.interval || 30),
    startTime: data.startTime || null,
    smartModeEnabled: typeof data.smartModeEnabled === "boolean" ? data.smartModeEnabled : true,
    soundEnabled: typeof data.soundEnabled === "boolean" ? data.soundEnabled : true,
    currentStretchSessionType: data.currentStretchSessionType || "standard_stretch"
  };
}

/* ---------------------------------- */
/* SESSION TYPE SMART LOGIC           */
/* ---------------------------------- */

async function chooseSmartSessionType() {
  const settings = await getSettings();
  if (!settings.smartModeEnabled) {
    await setLocal({ currentStretchSessionType: "standard_stretch" });
    return "standard_stretch";
  }
  const history = await getBehaviorHistory();
  const hourlyPatterns = await getHourlyPatterns();
  const hour = String(getCurrentHour());
  const recent = history.slice(-8);
  const recentCompleted = recent.filter(e => e.type === "completed").length;
  const recentSkipped   = recent.filter(e => e.type === "skipped").length;
  const recentSnoozed   = recent.filter(e => e.type === "snoozed").length;
  const hourStats = hourlyPatterns[hour] || { completed: 0, skipped: 0, snoozed: 0 };
  let sessionType = "standard_stretch";
  if (recentSkipped + recentSnoozed >= 4) sessionType = "quick_reset";
  else if (recentSkipped + recentSnoozed >= 2) sessionType = "gentle_stretch";
  if (recentCompleted >= 5 && recentSkipped === 0 && recentSnoozed <= 1) sessionType = "full_reset";
  if ((hourStats.skipped + hourStats.snoozed) >= 3 && hourStats.completed === 0) sessionType = "gentle_stretch";
  await setLocal({ currentStretchSessionType: sessionType });
  return sessionType;
}

/* ---------------------------------- */
/* BADGE LOGIC                        */
/* ---------------------------------- */

function clearBadge() { chrome.action.setBadgeText({ text: "" }); }

function setBadgeMeeting() {
  chrome.action.setBadgeBackgroundColor({ color: "#5aa9ff" });
  chrome.action.setBadgeText({ text: "MTG" });
}

function startBadgeCountdown() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }

  countdownInterval = setInterval(async () => {
    const data = await getLocal(["interval", "startTime"]);
    const currentRuntime = await getRuntimeState();

    if (currentRuntime.stretchReminderState === "shown") { clearBadge(); return; }
    if (currentRuntime.stretchReminderState === "in_meeting") { setBadgeMeeting(); return; }

    if (currentRuntime.stretchReminderState === "post_meeting") {
      const bufferData = await getLocal(["postMeetingStartTime"]);
      if (bufferData.postMeetingStartTime) {
        const elapsed = (Date.now() - bufferData.postMeetingStartTime) / 1000;
        const remaining = Math.max(0, POST_MEETING_BUFFER_MINUTES * 60 - elapsed);
        const minutesLeft = Math.ceil(remaining / 60);
        chrome.action.setBadgeBackgroundColor({ color: "#E53935" });
        chrome.action.setBadgeText({ text: minutesLeft > 0 ? String(minutesLeft) : "0" });
      } else {
        chrome.action.setBadgeBackgroundColor({ color: "#E53935" });
        chrome.action.setBadgeText({ text: "5" });
      }
      return;
    }

    if (!data || !data.interval || !data.startTime) {
      // Stretch not running — check water states
      const waterData = await getLocal(["waterEnabled","waterStartTime","waterInterval","waterMeetingActive","waterPostMeetingStartTime"]);

      // Water meeting active → MTG badge
      if (waterData.waterMeetingActive && waterData.waterEnabled !== false) {
        setBadgeMeeting();
        return;
      }

      // Water running or in post-meeting buffer → 💧 (buffer switches from MTG to 💧)
      if (waterData.waterEnabled !== false && waterData.waterStartTime && waterData.waterInterval) {
        chrome.action.setBadgeBackgroundColor({ color: "#5aa9ff" });
        chrome.action.setBadgeText({ text: "💧" });
        return;
      }

      clearBadge();
      return;
    }

    // Stretch running — show countdown
    const elapsed = (Date.now() - data.startTime) / 1000;
    const total   = Number(data.interval) * 60;
    const remaining = Math.max(0, total - elapsed);
    const minutesLeft = Math.ceil(remaining / 60);
    let badgeColor = "#4CAF50";
    if (minutesLeft <= 5) badgeColor = "#E53935";
    else if (minutesLeft <= 10) badgeColor = "#FDD835";
    chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    chrome.action.setBadgeText({ text: minutesLeft > 0 ? String(minutesLeft) : "0" });

  }, 1000);
}

function stopBadgeCountdown() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  clearBadge();
}

/* ---------------------------------- */
/* SOUND                              */
/* ---------------------------------- */

async function playStretchSound() {
  const settings = await getSettings();
  if (!settings.soundEnabled) return;
  // MV3 service worker audio unreliable — sound playback stays in stretch.js
}

/* ---------------------------------- */
/* WINDOW HELPERS                     */
/* ---------------------------------- */

async function findExistingStretchWindow() {
  const windows = await chrome.windows.getAll({ populate: true });
  for (const win of windows) {
    if (!win.tabs || !win.tabs.length) continue;
    if (win.tabs.some(tab => tab.url && tab.url.includes("stretch.html"))) return win;
  }
  return null;
}

/* ---------------------------------- */
/* TIMER RESUME HELPERS               */
/* ---------------------------------- */

async function resumeMainTimerFromUserInterval() {
  const data = await getLocal(["userInterval"]);
  const userInterval = Number(data.userInterval || 30);
  chrome.alarms.clear(ALARM_NAME, async () => {
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: userInterval, periodInMinutes: userInterval });
    await setLocal({ interval: userInterval, startTime: Date.now() });
    await setRuntimeState({ stretchReminderState: "scheduled", pendingDueWhileIdle: false, isPausedByIdle: false, pausedAt: null, remainingMsAtPause: null });
    startBadgeCountdown();
  });
}

/* ---------------------------------- */
/* PRO LICENSE                        */
/* ---------------------------------- */

async function getInstallationId() {
  const data = await getSync(["installationId"]);
  if (data.installationId) return data.installationId;
  const id = crypto.randomUUID();
  await setSync({ installationId: id });
  return id;
}

function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

async function getLicenseStatus() {
  if (_licenseCache !== null && Date.now() - _licenseCacheAt < 60*60*1000) return _licenseCache;
  try {
    const data = await getSync(["licenseToken","licenseVerifiedAt"]);
    if (!data.licenseToken) { _licenseCache = { isPro: false }; _licenseCacheAt = Date.now(); return _licenseCache; }
    if (data.licenseVerifiedAt && Date.now() - data.licenseVerifiedAt < 24*60*60*1000) {
      _licenseCache = { isPro: true }; _licenseCacheAt = Date.now(); return _licenseCache;
    }
    try {
      const installationId = await getInstallationId();
      const res = await fetchWithTimeout(`${BACKEND_URL}/api/verify-license`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ installationId, licenseToken: data.licenseToken }) }, 5000);
      const json = await res.json();
      if (json.valid) { await setSync({ licenseVerifiedAt: Date.now() }); _licenseCache = { isPro: true }; }
      else { await removeSync(["licenseToken","licenseVerifiedAt"]); _licenseCache = { isPro: false }; }
    } catch (e) { console.warn("License verify error, trusting cached:", e.message); _licenseCache = { isPro: true }; }
  } catch (e) { console.warn("getLicenseStatus error:", e.message); _licenseCache = { isPro: false }; }
  _licenseCacheAt = Date.now();
  return _licenseCache;
}

async function createCheckoutSession() {
  const installationId = await getInstallationId();
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/create-checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ installationId }) }, 10000);
  const json = await res.json();
  await setLocal({ pendingSessionId: json.sessionId });
  return json;
}

async function verifyPayment(sessionId) {
  const installationId = await getInstallationId();
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/verify-payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ installationId, sessionId }) }, 10000);
  const json = await res.json();
  if (json.paid && json.licenseToken) {
    await setSync({ licenseToken: json.licenseToken, licenseVerifiedAt: Date.now() });
    await removeLocal(["pendingSessionId"]);
    _licenseCache = { isPro: true }; _licenseCacheAt = Date.now();
    return { paid: true };
  }
  return { paid: false };
}

/* ---------------------------------- */
/* GOOGLE CALENDAR                    */
/* ---------------------------------- */

async function getGoogleToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) reject(chrome.runtime.lastError?.message || "No token");
      else resolve(token);
    });
  });
}

async function checkCalendar() {
  try {
    const token = await getGoogleToken(false);
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 90*60*1000);
    const res = await fetchWithTimeout("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: now.toISOString(), timeMax: windowEnd.toISOString(), items: [{ id: "primary" }] })
    }, 5000);
    const data = await res.json();
    const busySlots = data?.calendars?.primary?.busy ?? [];
    if (busySlots.length === 0) return { inMeeting: false, meetingEndTime: null };
    const twoMinsFromNow = now.getTime() + 2*60*1000;
    const currentSlot = busySlots.find(slot => {
      const slotStart = new Date(slot.start).getTime();
      const slotEnd   = new Date(slot.end).getTime();
      return slotStart <= twoMinsFromNow && slotEnd > now.getTime();
    });
    if (!currentSlot) return { inMeeting: false, meetingEndTime: null };
    return { inMeeting: true, meetingEndTime: new Date(currentSlot.end).getTime() };
  } catch (e) {
    console.warn("Calendar check failed, allowing stretch:", e.message);
    return { inMeeting: false, meetingEndTime: null };
  }
}

async function handleCalendarCheck() {
  const { inMeeting, meetingEndTime } = await checkCalendar();
  if (!inMeeting) return false;
  await setRuntimeState({ stretchReminderState: "in_meeting", pendingDueWhileIdle: false, isPausedByIdle: false, pausedAt: null, remainingMsAtPause: null });
  if (meetingEndTime) await setLocal({ meetingEndTime });
  setBadgeMeeting();
  if (!countdownInterval) startBadgeCountdown();
  let minutesUntilCheck = 1;
  if (meetingEndTime) minutesUntilCheck = Math.max(1, Math.ceil((meetingEndTime - Date.now()) / 60000));
  chrome.alarms.clear(MEETING_CHECK_ALARM, () => {
    chrome.alarms.create(MEETING_CHECK_ALARM, { delayInMinutes: minutesUntilCheck });
  });
  console.log(`Meeting in progress. Stretch deferred. Checking again in ${minutesUntilCheck} min.`);
  return true;
}

/* ---------------------------------- */
/* WINDOW OPEN                        */
/* ---------------------------------- */

async function openStretchWindow() {
  try {
    const existingStretchWindow = await findExistingStretchWindow();
    if (existingStretchWindow) {
      await chrome.windows.update(existingStretchWindow.id, { focused: true });
      await setRuntimeState({ stretchReminderState: "shown", pendingDueWhileIdle: false, isPausedByIdle: false, pausedAt: null, remainingMsAtPause: null });
      stopBadgeCountdown();
      return;
    }
    await chooseSmartSessionType();
    await chrome.windows.create({ url: "stretch.html", type: "popup", width: 760, height: 820, focused: true });
    setTimeout(() => { playStretchSound().catch(() => {}); }, 1000);
    await setRuntimeState({ stretchReminderState: "shown", pendingDueWhileIdle: false, isPausedByIdle: false, pausedAt: null, remainingMsAtPause: null });
    stopBadgeCountdown();
  } catch (error) { console.error("openStretchWindow error:", error); }
}

async function openExtensionPopupWindow() {
  try {
    await chrome.windows.create({ url: "popup.html", type: "popup", width: 460, height: 820, focused: true });
  } catch (error) { console.error("openExtensionPopupWindow error:", error); }
}

async function openStretchIfActive() { await openStretchWindow(); }

/* ---------------------------------- */
/* TIMER CONTROL                      */
/* ---------------------------------- */

function createAlarm(minutes) {
  const safeMinutes = Math.max(1, Number(minutes || 30));
  chrome.alarms.clear(ALARM_NAME, async () => {
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: safeMinutes, periodInMinutes: safeMinutes });
    await setLocal({ interval: safeMinutes, userInterval: safeMinutes, startTime: Date.now() });
    await setRuntimeState({ stretchReminderState: "scheduled", pendingDueWhileIdle: false, isPausedByIdle: false, pausedAt: null, remainingMsAtPause: null });
    startBadgeCountdown();
  });
}

async function stopTimer() {
  chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.clear(MEETING_CHECK_ALARM);
  chrome.alarms.clear(POST_MEETING_ALARM);
  await removeLocal(["startTime","interval","meetingEndTime","postMeetingStartTime"]);
  await setRuntimeState({ stretchReminderState: "inactive", pendingDueWhileIdle: false, isPausedByIdle: false, pausedAt: null, remainingMsAtPause: null });

  // If water still running, restart badge so 💧 reappears
  const { waterEnabled, waterStartTime, waterInterval } = await getLocal(["waterEnabled","waterStartTime","waterInterval"]);
  if (waterEnabled === true && waterStartTime && waterInterval) {
    startBadgeCountdown();
  } else {
    stopBadgeCountdown();
  }
}

async function snoozeTimer() {
  await recordBehavior("snoozed");
  chrome.alarms.clear(ALARM_NAME, async () => {
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: 5 });
    await setLocal({ interval: 5, startTime: Date.now() });
    await setRuntimeState({ stretchReminderState: "scheduled", pendingDueWhileIdle: false, isPausedByIdle: false, pausedAt: null, remainingMsAtPause: null });
    startBadgeCountdown();
  });
}

/* ---------------------------------- */
/* RECOVER MISSED STRETCH AFTER SLEEP */
/* ---------------------------------- */

async function recoverMissedStretch() {
  const data = await getLocal(["interval","startTime"]);
  const currentRuntime = await getRuntimeState();
  if (currentRuntime.stretchReminderState === "shown") { stopBadgeCountdown(); return; }
  if (currentRuntime.stretchReminderState === "in_meeting") { setBadgeMeeting(); startBadgeCountdown(); return; }
  if (currentRuntime.stretchReminderState === "post_meeting") { startBadgeCountdown(); return; }
  if (!data || !data.interval || !data.startTime) { stopBadgeCountdown(); return; }
  const elapsed = (Date.now() - data.startTime) / 1000;
  const total   = Number(data.interval) * 60;
  if (elapsed >= total) {
    await openStretchIfActive();
  } else {
    startBadgeCountdown();
    if (currentRuntime.stretchReminderState === "inactive") {
      await setRuntimeState({ stretchReminderState: "scheduled", pendingDueWhileIdle: false, isPausedByIdle: false, pausedAt: null, remainingMsAtPause: null });
    }
  }
}

/* ---------------------------------- */
/* WATER MODULE                       */
/* ---------------------------------- */

async function getWaterSettings() {
  const data = await getLocal([
    "waterInterval","waterGoal","waterSoundEnabled",
    "waterGlassesToday","waterGlassesDate","waterStartTime","waterEnabled",
    "waterMeetingActive","waterMeetingEndTime","waterCalendarEnabled"
  ]);
  return {
    waterInterval:        Number(data.waterInterval || 30),
    waterGoal:            Number(data.waterGoal || 8),
    waterSoundEnabled:    typeof data.waterSoundEnabled === "boolean" ? data.waterSoundEnabled : true,
    waterGlassesToday:    Number(data.waterGlassesToday || 0),
    waterGlassesDate:     data.waterGlassesDate || null,
    waterStartTime:       data.waterStartTime || null,
    waterEnabled:         typeof data.waterEnabled === "boolean" ? data.waterEnabled : false,
    waterMeetingActive:   !!data.waterMeetingActive,
    waterMeetingEndTime:  data.waterMeetingEndTime || null,
    waterCalendarEnabled: !!data.waterCalendarEnabled
  };
}

async function resetWaterGlassesIfNewDay() {
  const today = getTodayKey();
  const data  = await getLocal(["waterGlassesDate","waterGlassesToday"]);
  if (data.waterGlassesDate !== today) {
    await setLocal({ waterGlassesToday: 0, waterGlassesDate: today });
    return 0;
  }
  return Number(data.waterGlassesToday || 0);
}

async function getWaterLicenseStatus() {
  if (_waterLicenseCache !== null && Date.now() - _waterLicenseCacheAt < 60*60*1000) return _waterLicenseCache;
  try {
    const data = await getSync(["waterLicenseToken","waterLicenseVerifiedAt"]);
    if (!data.waterLicenseToken) { _waterLicenseCache = { isPro: false }; _waterLicenseCacheAt = Date.now(); return _waterLicenseCache; }
    if (data.waterLicenseVerifiedAt && Date.now() - data.waterLicenseVerifiedAt < 24*60*60*1000) {
      _waterLicenseCache = { isPro: true }; _waterLicenseCacheAt = Date.now(); return _waterLicenseCache;
    }
    try {
      const installationId = await getInstallationId();
      const res = await fetchWithTimeout(`${BACKEND_URL}/api/verify-water-license`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ installationId, licenseToken: data.waterLicenseToken }) }, 5000);
      const json = await res.json();
      if (json.valid) { await setSync({ waterLicenseVerifiedAt: Date.now() }); _waterLicenseCache = { isPro: true }; }
      else { await removeSync(["waterLicenseToken","waterLicenseVerifiedAt"]); _waterLicenseCache = { isPro: false }; }
    } catch (e) { console.warn("Water license verify error, trusting cached:", e.message); _waterLicenseCache = { isPro: true }; }
  } catch (e) { console.warn("getWaterLicenseStatus error:", e.message); _waterLicenseCache = { isPro: false }; }
  _waterLicenseCacheAt = Date.now();
  return _waterLicenseCache;
}

async function createWaterCheckoutSession() {
  const installationId = await getInstallationId();
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/create-water-checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ installationId }) }, 10000);
  const json = await res.json();
  await setLocal({ waterPendingSessionId: json.sessionId });
  return json;
}

async function verifyWaterPaymentSession(sessionId) {
  const installationId = await getInstallationId();
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/verify-water-payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ installationId, sessionId }) }, 10000);
  const json = await res.json();
  if (json.paid && json.licenseToken) {
    await setSync({ waterLicenseToken: json.licenseToken, waterLicenseVerifiedAt: Date.now() });
    await removeLocal(["waterPendingSessionId"]);
    _waterLicenseCache = { isPro: true }; _waterLicenseCacheAt = Date.now();
    return { paid: true };
  }
  return { paid: false };
}

async function findExistingWaterWindow() {
  const windows = await chrome.windows.getAll({ populate: true });
  for (const win of windows) {
    if (!win.tabs || !win.tabs.length) continue;
    if (win.tabs.some(tab => tab.url && tab.url.includes("water.html"))) return win;
  }
  return null;
}

async function openWaterWindow() {
  try {
    const existing = await findExistingWaterWindow();
    if (existing) { await chrome.windows.update(existing.id, { focused: true }); return; }
    await chrome.windows.create({ url: "water.html", type: "popup", width: 500, height: 760, focused: true });
  } catch (error) { console.error("openWaterWindow error:", error); }
}

function scheduleWaterAlarm(minutes) {
  const safeMinutes = Math.max(1, Number(minutes || 30));
  chrome.alarms.clear(WATER_ALARM_NAME, async () => {
    chrome.alarms.create(WATER_ALARM_NAME, { delayInMinutes: safeMinutes });
    await setLocal({ waterStartTime: Date.now(), waterInterval: safeMinutes });
  });
}

async function stopWaterAlarm() {
  chrome.alarms.clear(WATER_ALARM_NAME);
  chrome.alarms.clear(WATER_MEETING_CHECK_ALARM);
  chrome.alarms.clear(WATER_POST_MEETING_ALARM);
  await removeLocal(["waterStartTime","waterMeetingActive","waterMeetingEndTime","waterPostMeetingStartTime"]);
}

/* ---------------------------------- */
/* WEEKLY RESET ALARM                 */
/* ---------------------------------- */

function ensureWeeklyResetAlarm() {
  chrome.alarms.create(WEEKLY_RESET_ALARM, { periodInMinutes: 60 * 24 });
}

/* ---------------------------------- */
/* INSTALLED / STARTUP                */
/* ---------------------------------- */

chrome.runtime.onInstalled.addListener(async () => {
  await removeLocal(["startTime","interval","meetingEndTime"]);
  await maybeResetWeeklyStats();
  ensureWeeklyResetAlarm();
  await setRuntimeState({ ...DEFAULT_RUNTIME });
  stopBadgeCountdown();

  // Water: disabled by default — only starts when user clicks Start
  const today = getTodayKey();
  await setLocal({
    waterEnabled:      false,
    waterInterval:     30,
    waterGoal:         8,
    waterSoundEnabled: true,
    waterGlassesToday: 0,
    waterGlassesDate:  today
  });

  chrome.windows.create({ url: "welcome.html", type: "popup", width: 520, height: 600, focused: true });
});

chrome.runtime.onStartup.addListener(async () => {
  runtimeState = { ...DEFAULT_RUNTIME, ...(await getRuntimeState()) };
  await maybeResetWeeklyStats();
  ensureWeeklyResetAlarm();
  await recoverMissedStretch();

  // Only restore water if user had explicitly started it
  const { waterEnabled, waterStartTime } = await getLocal(["waterEnabled","waterStartTime"]);
  if (waterEnabled === true && waterStartTime) {
    await resetWaterGlassesIfNewDay();
    const alarms = await new Promise(resolve => chrome.alarms.getAll(resolve));
    if (!alarms.some(a => a.name === WATER_ALARM_NAME)) {
      const ws = await getWaterSettings();
      scheduleWaterAlarm(ws.waterInterval);
    }
    startBadgeCountdown();
  }
});

/* ---------------------------------- */
/* ALARM HANDLER                      */
/* ---------------------------------- */

chrome.alarms.onAlarm.addListener(async (alarm) => {

  /* ---- Water alarms ---- */

  if (alarm.name === WATER_ALARM_NAME) {
    await resetWaterGlassesIfNewDay();
    const { isPro: isWaterPro } = await getWaterLicenseStatus();
    const { waterCalendarEnabled } = await getLocal(["waterCalendarEnabled"]);

    if (isWaterPro && waterCalendarEnabled) {
      const { inMeeting, meetingEndTime } = await checkCalendar();
      if (inMeeting) {
        await setLocal({ waterMeetingActive: true, waterMeetingEndTime: meetingEndTime || null });
        const minutesUntilCheck = meetingEndTime ? Math.max(1, Math.ceil((meetingEndTime - Date.now()) / 60000)) : 1;
        chrome.alarms.clear(WATER_MEETING_CHECK_ALARM, () => {
          chrome.alarms.create(WATER_MEETING_CHECK_ALARM, { delayInMinutes: minutesUntilCheck });
        });
        startBadgeCountdown(); // will show MTG for water
        return;
      }
    }

    // No meeting — clear any stale meeting state, open water window
    await removeLocal(["waterMeetingActive","waterMeetingEndTime"]);
    await setLocal({ waterStartTime: Date.now() });
    await openWaterWindow();
    return;
  }

  if (alarm.name === WATER_MEETING_CHECK_ALARM) {
    const { isPro: isWaterPro } = await getWaterLicenseStatus();
    const { waterCalendarEnabled } = await getLocal(["waterCalendarEnabled"]);

    if (isWaterPro && waterCalendarEnabled) {
      const { inMeeting, meetingEndTime } = await checkCalendar();
      if (inMeeting) {
        await setLocal({ waterMeetingActive: true, waterMeetingEndTime: meetingEndTime || null });
        const minutesUntilCheck = meetingEndTime ? Math.max(1, Math.ceil((meetingEndTime - Date.now()) / 60000)) : 1;
        chrome.alarms.create(WATER_MEETING_CHECK_ALARM, { delayInMinutes: minutesUntilCheck });
        return;
      }
    }

    // Meeting ended — start 5-min buffer, switch badge from MTG → 💧
    await setLocal({ waterMeetingActive: false, waterMeetingEndTime: null, waterPostMeetingStartTime: Date.now() });
    chrome.alarms.create(WATER_POST_MEETING_ALARM, { delayInMinutes: WATER_POST_MEETING_BUFFER_MINUTES });
    startBadgeCountdown(); // badge loop checks waterMeetingActive (now false) → shows 💧
    return;
  }

  if (alarm.name === WATER_POST_MEETING_ALARM) {
    await removeLocal(["waterPostMeetingStartTime"]);
    await setLocal({ waterStartTime: Date.now() });
    const ws = await getWaterSettings();
    scheduleWaterAlarm(ws.waterInterval);
    await openWaterWindow();
    return;
  }

  /* ---- Stretch alarms ---- */

  if (alarm.name === WEEKLY_RESET_ALARM) {
    await maybeResetWeeklyStats();
    return;
  }

  if (alarm.name === ALARM_NAME) {
    const currentRuntime = await getRuntimeState();
    if (currentRuntime.stretchReminderState === "shown") return;
    const { isPro } = await getLicenseStatus();
    const { calendarEnabled } = await getLocal(["calendarEnabled"]);
    if (isPro && calendarEnabled) {
      const deferred = await handleCalendarCheck();
      if (deferred) return;
    }
    await openStretchIfActive();
    return;
  }

  if (alarm.name === MEETING_CHECK_ALARM) {
    const currentRuntime = await getRuntimeState();
    if (currentRuntime.stretchReminderState !== "in_meeting") return;
    const { isPro } = await getLicenseStatus();
    const { calendarEnabled } = await getLocal(["calendarEnabled"]);
    if (isPro && calendarEnabled) {
      const { inMeeting, meetingEndTime } = await checkCalendar();
      if (inMeeting) {
        if (meetingEndTime) await setLocal({ meetingEndTime });
        const minutesUntilCheck = meetingEndTime ? Math.max(1, Math.ceil((meetingEndTime - Date.now()) / 60000)) : 1;
        chrome.alarms.create(MEETING_CHECK_ALARM, { delayInMinutes: minutesUntilCheck });
        return;
      }
    }
    // Meeting ended — start post-meeting buffer
    await setRuntimeState({ stretchReminderState: "post_meeting", pendingDueWhileIdle: false, isPausedByIdle: false, pausedAt: null, remainingMsAtPause: null });
    await setLocal({ postMeetingStartTime: Date.now() });
    chrome.alarms.create(POST_MEETING_ALARM, { delayInMinutes: POST_MEETING_BUFFER_MINUTES });
    startBadgeCountdown();
    return;
  }

  if (alarm.name === POST_MEETING_ALARM) {
    await removeLocal(["postMeetingStartTime"]);
    await setRuntimeState({ stretchReminderState: "inactive", pendingDueWhileIdle: false, isPausedByIdle: false, pausedAt: null, remainingMsAtPause: null });
    await openStretchIfActive();
    return;
  }
});

/* ---------------------------------- */
/* MESSAGE HANDLER                    */
/* ---------------------------------- */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {

      if (request.type === "getSettings") {
        const settings = await getSettings();
        const runtime  = await getRuntimeState();
        const local    = await getLocal(["calendarEnabled","meetingEndTime","postMeetingStartTime"]);
        sendResponse({
          ok: true,
          stretchInterval:      settings.interval,
          startTime:            settings.startTime,
          smartModeEnabled:     settings.smartModeEnabled,
          soundEnabled:         settings.soundEnabled,
          stretchReminderState: runtime.stretchReminderState,
          meetingEndTime:       local.meetingEndTime || null,
          postMeetingStartTime: local.postMeetingStartTime || null,
          calendarEnabled:      !!local.calendarEnabled
        });
        return;
      }

      if (request.type === "getLicenseStatus") {
        const { isPro } = await getLicenseStatus();
        sendResponse({ ok: true, isPro });
        return;
      }

      if (request.type === "getIntegrationSettings") {
        const data = await getLocal(["calendarEnabled"]);
        sendResponse({ ok: true, calendarEnabled: !!data.calendarEnabled });
        return;
      }

      if (request.type === "getSmartStats") {
        const stats        = await getSmartStatsData();
        const lastWeekStats = await getLastWeekStats();
        sendResponse({ ok: true, stats, lastWeekStats });
        return;
      }

      if (request.type === "startTimer") {
        createAlarm(request.minutes);
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "stopTimer") {
        await stopTimer();
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "snoozeTimer") {
        await snoozeTimer();
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "setStretchInterval") {
        const minutes = Math.max(1, Number(request.minutes || 30));
        const data = await getLocal(["startTime"]);
        if (data.startTime) createAlarm(minutes);
        else await setLocal({ userInterval: minutes });
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "setSmartMode") {
        await setLocal({ smartModeEnabled: !!request.enabled });
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "setSound") {
        await setLocal({ soundEnabled: !!request.enabled });
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "setCalendarEnabled") {
        await setLocal({ calendarEnabled: !!request.enabled });
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "stretchCompleted") {
        await recordBehavior("completed");
        await resumeMainTimerFromUserInterval();
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "stretchSkipped") {
        await recordBehavior("skipped");
        await resumeMainTimerFromUserInterval();
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "startCheckout") {
        try {
          const { checkoutUrl } = await createCheckoutSession();
          chrome.tabs.create({ url: checkoutUrl });
          sendResponse({ ok: true });
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
        return;
      }

      if (request.type === "verifyPayment") {
        try {
          const data = await getLocal(["pendingSessionId"]);
          const sessionId = request.sessionId || data.pendingSessionId;
          if (!sessionId) { sendResponse({ ok: false, paid: false }); return; }
          const result = await verifyPayment(sessionId);
          sendResponse({ ok: true, ...result });
        } catch (e) { sendResponse({ ok: false, paid: false, error: String(e) }); }
        return;
      }

      /* ---- Water messages ---- */

      if (request.type === "getWaterSettings") {
        const ws = await getWaterSettings();
        const { isPro: isWaterPro } = await getWaterLicenseStatus();
        const extra = await getLocal(["waterCalendarEnabled","waterPendingSessionId","waterPostMeetingStartTime"]);
        await resetWaterGlassesIfNewDay();
        const fresh = await getLocal(["waterGlassesToday"]);
        sendResponse({
          ok: true,
          waterInterval:             ws.waterInterval,
          waterGoal:                 ws.waterGoal,
          waterSoundEnabled:         ws.waterSoundEnabled,
          waterGlassesToday:         Number(fresh.waterGlassesToday || 0),
          waterStartTime:            ws.waterStartTime,
          waterEnabled:              ws.waterEnabled,
          waterMeetingActive:        ws.waterMeetingActive,
          waterMeetingEndTime:       ws.waterMeetingEndTime,
          waterPostMeetingStartTime: extra.waterPostMeetingStartTime || null,
          isWaterPro,
          waterCalendarEnabled:      !!extra.waterCalendarEnabled,
          hasPendingWaterSession:    !!extra.waterPendingSessionId
        });
        return;
      }

      if (request.type === "getWaterLicenseStatus") {
        const { isPro } = await getWaterLicenseStatus();
        sendResponse({ ok: true, isPro });
        return;
      }

      if (request.type === "startWaterTimer") {
        const minutes = Math.max(1, Number(request.minutes || 30));
        await setLocal({ waterEnabled: true, waterInterval: minutes });
        scheduleWaterAlarm(minutes);
        startBadgeCountdown(); // 💧 appears immediately
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "stopWaterTimer") {
        await setLocal({ waterEnabled: false });
        await stopWaterAlarm();
        // Only kill badge if stretch is also not running
        const currentRuntime = await getRuntimeState();
        if (currentRuntime.stretchReminderState === "inactive") {
          stopBadgeCountdown();
        }
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "logGlass") {
        await resetWaterGlassesIfNewDay();
        const data = await getLocal(["waterGlassesToday"]);
        const newCount = Number(data.waterGlassesToday || 0) + 1;
        await setLocal({ waterGlassesToday: newCount });
        const ws = await getWaterSettings();
        if (ws.waterEnabled) scheduleWaterAlarm(ws.waterInterval);
        sendResponse({ ok: true, waterGlassesToday: newCount });
        return;
      }

      if (request.type === "skipWater") {
        const ws = await getWaterSettings();
        if (ws.waterEnabled) scheduleWaterAlarm(ws.waterInterval);
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "setWaterInterval") {
        const minutes = Math.max(1, Number(request.minutes || 30));
        await setLocal({ waterInterval: minutes });
        const { waterEnabled } = await getLocal(["waterEnabled"]);
        if (waterEnabled !== false) scheduleWaterAlarm(minutes);
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "setWaterGoal") {
        const goal = Math.max(1, Math.min(20, Number(request.goal || 8)));
        await setLocal({ waterGoal: goal });
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "setWaterSound") {
        await setLocal({ waterSoundEnabled: !!request.enabled });
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "setWaterCalendarEnabled") {
        await setLocal({ waterCalendarEnabled: !!request.enabled });
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "startWaterCheckout") {
        try {
          const { checkoutUrl } = await createWaterCheckoutSession();
          chrome.tabs.create({ url: checkoutUrl });
          sendResponse({ ok: true });
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
        return;
      }

      if (request.type === "verifyWaterPayment") {
        try {
          const data = await getLocal(["waterPendingSessionId"]);
          const sessionId = request.sessionId || data.waterPendingSessionId;
          if (!sessionId) { sendResponse({ ok: false, paid: false, error: "No pending water session" }); return; }
          const result = await verifyWaterPaymentSession(sessionId);
          sendResponse({ ok: true, ...result });
        } catch (e) { sendResponse({ ok: false, paid: false, error: String(e) }); }
        return;
      }

      sendResponse({ ok: false, error: "Unknown message type" });

    } catch (err) {
      console.error("Message handler error:", err);
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true; // keep message channel open for async response
});

/* ---------------------------------- */
/* BOOTSTRAP                          */
/* ---------------------------------- */

(async () => {
  try {
    runtimeState = { ...DEFAULT_RUNTIME, ...(await getRuntimeState()) };
    await maybeResetWeeklyStats();
    ensureWeeklyResetAlarm();
    await recoverMissedStretch();

    // Only restore water if user had explicitly started it
    const { waterEnabled, waterStartTime } = await getLocal(["waterEnabled","waterStartTime"]);
    if (waterEnabled === true && waterStartTime) {
      await resetWaterGlassesIfNewDay();
      const alarms = await new Promise(resolve => chrome.alarms.getAll(resolve));
      if (!alarms.some(a => a.name === WATER_ALARM_NAME)) {
        const ws = await getWaterSettings();
        scheduleWaterAlarm(ws.waterInterval);
      }
      startBadgeCountdown();
    }
  } catch (error) {
    console.error("Bootstrap error:", error);
  }
})();