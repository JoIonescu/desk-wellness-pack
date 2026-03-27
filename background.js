const ALARM_NAME = "stretchAlarm";
const WEEKLY_RESET_ALARM = "weeklyStatsReset";
const MEETING_CHECK_ALARM = "meetingCheckAlarm";
const POST_MEETING_ALARM = "postMeetingAlarm";
const POST_MEETING_BUFFER_MINUTES = 5;

/* ---- Water module constants ---- */
const WATER_ALARM_NAME = "waterAlarm";

// Replace with your deployed Vercel URL
const BACKEND_URL = "https://smart-stretch-backend.vercel.app";

let countdownInterval = null;

const DEFAULT_RUNTIME = {
  stretchReminderState: "inactive", // inactive | scheduled | in_meeting | post_meeting | shown
  pendingDueWhileIdle: false,
  isPausedByIdle: false,
  pausedAt: null,
  remainingMsAtPause: null
};

let runtimeState = { ...DEFAULT_RUNTIME };

// In-memory license cache — resets when service worker sleeps
let _licenseCache = null;
let _licenseCacheAt = 0;

// Water license cache
let _waterLicenseCache = null;
let _waterLicenseCacheAt = 0;

/* ---------------------------------- */
/* SYNC STORAGE — license keys only   */
/* Stats, settings and timer state    */
/* stay in local storage deliberately */
/* ---------------------------------- */

function getSync(keys) {
  return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
}

function setSync(data) {
  return new Promise((resolve) => chrome.storage.sync.set(data, resolve));
}

function removeSync(keys) {
  return new Promise((resolve) => chrome.storage.sync.remove(keys, resolve));
}

/* ---------------------------------- */
/* STORAGE HELPERS                    */
/* ---------------------------------- */

function getLocal(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setLocal(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

function removeLocal(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

async function getRuntimeState() {
  const data = await getLocal(["runtimeState"]);
  return data.runtimeState || { ...DEFAULT_RUNTIME };
}

async function setRuntimeState(nextState) {
  runtimeState = { ...DEFAULT_RUNTIME, ...nextState };
  await setLocal({ runtimeState });
}

function getCurrentHour() {
  return new Date().getHours();
}

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------------------------------- */
/* WEEK HELPERS (MONDAY-BASED WEEK)   */
/* ---------------------------------- */

function getMondayKey(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------------------------------- */
/* SMART STATS + HISTORY              */
/* ---------------------------------- */

async function getSmartStatsData() {
  const data = await getLocal(["smartStats"]);
  return data.smartStats || {
    completedCount: 0,
    skippedCount: 0,
    snoozedCount: 0,
    lastResetDate: null
  };
}

async function setSmartStatsData(stats) {
  await setLocal({ smartStats: stats });
}

async function getLastWeekStats() {
  const data = await getLocal(["lastWeekStats"]);
  return data.lastWeekStats || {
    completedCount: 0,
    skippedCount: 0,
    snoozedCount: 0,
    archivedAt: null
  };
}

async function setLastWeekStats(stats) {
  await setLocal({ lastWeekStats: stats });
}

async function maybeResetWeeklyStats() {
  const stats = await getSmartStatsData();
  const currentWeekMondayKey = getMondayKey();

  if (!stats.lastResetDate) {
    await setSmartStatsData({
      completedCount: stats.completedCount || 0,
      skippedCount: stats.skippedCount || 0,
      snoozedCount: stats.snoozedCount || 0,
      lastResetDate: currentWeekMondayKey
    });
    return;
  }

  if (stats.lastResetDate === currentWeekMondayKey) return;

  await setLastWeekStats({
    completedCount: stats.completedCount || 0,
    skippedCount: stats.skippedCount || 0,
    snoozedCount: stats.snoozedCount || 0,
    archivedAt: currentWeekMondayKey
  });

  await setSmartStatsData({
    completedCount: 0,
    skippedCount: 0,
    snoozedCount: 0,
    lastResetDate: currentWeekMondayKey
  });
}

async function getBehaviorHistory() {
  const data = await getLocal(["behaviorHistory"]);
  return Array.isArray(data.behaviorHistory) ? data.behaviorHistory : [];
}

async function setBehaviorHistory(history) {
  await setLocal({ behaviorHistory: history });
}

async function getHourlyPatterns() {
  const data = await getLocal(["hourlyPatterns"]);
  return data.hourlyPatterns || {};
}

async function setHourlyPatterns(hourlyPatterns) {
  await setLocal({ hourlyPatterns });
}

async function recordBehavior(type) {
  await maybeResetWeeklyStats();

  const stats = await getSmartStatsData();
  const history = await getBehaviorHistory();
  const hourlyPatterns = await getHourlyPatterns();
  const hour = String(getCurrentHour());

  if (!hourlyPatterns[hour]) {
    hourlyPatterns[hour] = { completed: 0, skipped: 0, snoozed: 0 };
  }

  if (type === "completed") {
    stats.completedCount += 1;
    hourlyPatterns[hour].completed += 1;
  } else if (type === "skipped") {
    stats.skippedCount += 1;
    hourlyPatterns[hour].skipped += 1;
  } else if (type === "snoozed") {
    stats.snoozedCount += 1;
    hourlyPatterns[hour].snoozed += 1;
  }

  history.push({ type, timestamp: Date.now(), hour: getCurrentHour() });
  const trimmed = history.slice(-50);

  await setSmartStatsData(stats);
  await setBehaviorHistory(trimmed);
  await setHourlyPatterns(hourlyPatterns);
}

/* ---------------------------------- */
/* SETTINGS                           */
/* ---------------------------------- */

async function getSettings() {
  const data = await getLocal([
    "interval",
    "userInterval",
    "startTime",
    "smartModeEnabled",
    "soundEnabled",
    "currentStretchSessionType"
  ]);
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
  const recentCompleted = recent.filter((e) => e.type === "completed").length;
  const recentSkipped = recent.filter((e) => e.type === "skipped").length;
  const recentSnoozed = recent.filter((e) => e.type === "snoozed").length;
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

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

function setBadgeMeeting() {
  chrome.action.setBadgeBackgroundColor({ color: "#5aa9ff" }); // blue
  chrome.action.setBadgeText({ text: "MTG" });
}

function startBadgeCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  countdownInterval = setInterval(async () => {
    const data = await getLocal(["interval", "startTime"]);
    const currentRuntime = await getRuntimeState();

    if (currentRuntime.stretchReminderState === "shown") {
      clearBadge();
      return;
    }

    // Show meeting badge — frozen, no countdown
    if (currentRuntime.stretchReminderState === "in_meeting") {
      setBadgeMeeting();
      return;
    }

    // Post-meeting buffer — show countdown in yellow
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
      // Stretch not running — check if water timer is active before clearing
      const waterData = await getLocal(["waterEnabled", "waterStartTime", "waterInterval"]);
      if (waterData.waterEnabled !== false && waterData.waterStartTime && waterData.waterInterval) {
        chrome.action.setBadgeBackgroundColor({ color: "#5aa9ff" });
        chrome.action.setBadgeText({ text: "💧" });
      } else {
        clearBadge();
      }
      return;
    }

    const elapsed = (Date.now() - data.startTime) / 1000;
    const total = Number(data.interval) * 60;
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
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  clearBadge();
}

/* ---------------------------------- */
/* SOUND                              */
/* ---------------------------------- */

async function playStretchSound() {
  const settings = await getSettings();
  if (!settings.soundEnabled) return;
  // MV3 service worker audio is unreliable. Real sound playback stays in stretch.js.
}

/* ---------------------------------- */
/* WINDOW HELPERS                     */
/* ---------------------------------- */

async function findExistingStretchWindow() {
  const windows = await chrome.windows.getAll({ populate: true });
  for (const win of windows) {
    if (!win.tabs || !win.tabs.length) continue;
    const hasStretchTab = win.tabs.some((tab) => tab.url && tab.url.includes("stretch.html"));
    if (hasStretchTab) return win;
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
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: userInterval,
      periodInMinutes: userInterval
    });

    await setLocal({ interval: userInterval, startTime: Date.now() });

    await setRuntimeState({
      stretchReminderState: "scheduled",
      pendingDueWhileIdle: false,
      isPausedByIdle: false,
      pausedAt: null,
      remainingMsAtPause: null
    });

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

// Fetch with a hard timeout — prevents service worker stalling
function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

async function getLicenseStatus() {
  // Return in-memory cache if fresh (1 hour)
  if (_licenseCache !== null && Date.now() - _licenseCacheAt < 60 * 60 * 1000) {
    return _licenseCache;
  }

  try {
    const data = await getSync(["licenseToken", "licenseVerifiedAt"]);

    if (!data.licenseToken) {
      _licenseCache = { isPro: false };
      _licenseCacheAt = Date.now();
      return _licenseCache;
    }

    // Trust local cache if verified within last 24 hours — no network needed
    if (data.licenseVerifiedAt && Date.now() - data.licenseVerifiedAt < 24 * 60 * 60 * 1000) {
      _licenseCache = { isPro: true };
      _licenseCacheAt = Date.now();
      return _licenseCache;
    }

    // Re-verify — 5 second timeout so alarm handler never stalls
    try {
      const installationId = await getInstallationId();
      const res = await fetchWithTimeout(
        `${BACKEND_URL}/api/verify-license`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ installationId, licenseToken: data.licenseToken })
        },
        5000
      );
      const json = await res.json();

      if (json.valid) {
        await setSync({ licenseVerifiedAt: Date.now() });
        _licenseCache = { isPro: true };
      } else {
        await removeSync(["licenseToken", "licenseVerifiedAt"]);
        _licenseCache = { isPro: false };
      }
    } catch (e) {
      // Network error or timeout — fail open so offline users are not locked out
      console.warn("License verify network error, trusting cached token:", e.message);
      _licenseCache = { isPro: true };
    }
  } catch (e) {
    // Storage error — fail safe, assume not pro
    console.warn("getLicenseStatus storage error:", e.message);
    _licenseCache = { isPro: false };
  }

  _licenseCacheAt = Date.now();
  return _licenseCache;
}

async function createCheckoutSession() {
  const installationId = await getInstallationId();
  const res = await fetchWithTimeout(
    `${BACKEND_URL}/api/create-checkout`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId })
    },
    10000
  );
  const json = await res.json();
  await setLocal({ pendingSessionId: json.sessionId });
  return json;
}

async function verifyPayment(sessionId) {
  const installationId = await getInstallationId();
  const res = await fetchWithTimeout(
    `${BACKEND_URL}/api/verify-payment`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId, sessionId })
    },
    10000
  );
  const json = await res.json();

  if (json.paid && json.licenseToken) {
    await setSync({ licenseToken: json.licenseToken, licenseVerifiedAt: Date.now() });
    await removeLocal(["pendingSessionId"]);
    _licenseCache = { isPro: true };
    _licenseCacheAt = Date.now();
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
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError?.message || "No token");
      } else {
        resolve(token);
      }
    });
  });
}

/**
 * Returns { inMeeting: boolean, meetingEndTime: number|null }
 * meetingEndTime is a JS timestamp (ms) when the current meeting ends.
 * Always fails open — if anything goes wrong, inMeeting = false.
 */
async function checkCalendar() {
  try {
    const token = await getGoogleToken(false); // silent — never prompt mid-session
    const now = new Date();
    // Check a 90-minute window — catches ongoing meetings and ones starting imminently
    const windowEnd = new Date(now.getTime() + 90 * 60 * 1000);

    const res = await fetchWithTimeout(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          timeMin: now.toISOString(),
          timeMax: windowEnd.toISOString(),
          items: [{ id: "primary" }]
        })
      },
      5000
    );

    const data = await res.json();
    const busySlots = data?.calendars?.primary?.busy ?? [];

    if (busySlots.length === 0) {
      return { inMeeting: false, meetingEndTime: null };
    }

    // Find the slot that covers right now or starts within 2 minutes
    const twoMinsFromNow = now.getTime() + 2 * 60 * 1000;
    const currentSlot = busySlots.find((slot) => {
      const slotStart = new Date(slot.start).getTime();
      const slotEnd = new Date(slot.end).getTime();
      // Slot covers now, or starts very soon
      return slotStart <= twoMinsFromNow && slotEnd > now.getTime();
    });

    if (!currentSlot) {
      return { inMeeting: false, meetingEndTime: null };
    }

    const meetingEndTime = new Date(currentSlot.end).getTime();
    return { inMeeting: true, meetingEndTime };

  } catch (e) {
    // Any error (no token, network, timeout) → fail open, allow stretch
    console.warn("Calendar check failed, allowing stretch:", e.message);
    return { inMeeting: false, meetingEndTime: null };
  }
}

/**
 * Checks calendar and handles the meeting state.
 * Returns true if stretch was deferred (meeting), false if stretch should fire.
 */
async function handleCalendarCheck() {
  const { inMeeting, meetingEndTime } = await checkCalendar();

  if (!inMeeting) return false;

  // Enter meeting state
  await setRuntimeState({
    stretchReminderState: "in_meeting",
    pendingDueWhileIdle: false,
    isPausedByIdle: false,
    pausedAt: null,
    remainingMsAtPause: null
  });

  // Store meeting end time for popup display
  if (meetingEndTime) {
    await setLocal({ meetingEndTime });
  }

  // Set badge to meeting state
  setBadgeMeeting();
  // Keep badge interval running so it stays as MTG
  if (!countdownInterval) startBadgeCountdown();

  // Schedule check for when meeting ends
  // Chrome alarms minimum is 1 minute
  let minutesUntilCheck = 1;
  if (meetingEndTime) {
    const msUntilEnd = meetingEndTime - Date.now();
    minutesUntilCheck = Math.max(1, Math.ceil(msUntilEnd / 60000));
  }

  chrome.alarms.clear(MEETING_CHECK_ALARM, () => {
    chrome.alarms.create(MEETING_CHECK_ALARM, { delayInMinutes: minutesUntilCheck });
  });

  console.log(`Meeting in progress. Stretch deferred. Checking again in ${minutesUntilCheck} min.`);
  return true; // stretch deferred
}

/* ---------------------------------- */
/* WINDOW OPEN                        */
/* ---------------------------------- */

async function openStretchWindow() {
  try {
    const existingStretchWindow = await findExistingStretchWindow();
    if (existingStretchWindow) {
      await chrome.windows.update(existingStretchWindow.id, { focused: true });
      await setRuntimeState({
        stretchReminderState: "shown",
        pendingDueWhileIdle: false,
        isPausedByIdle: false,
        pausedAt: null,
        remainingMsAtPause: null
      });
      stopBadgeCountdown();
      return;
    }

    await chooseSmartSessionType();

    await chrome.windows.create({
      url: "stretch.html",
      type: "popup",
      width: 760,
      height: 820,
      focused: true
    });

    setTimeout(() => {
      playStretchSound().catch(() => {});
    }, 1000);

    await setRuntimeState({
      stretchReminderState: "shown",
      pendingDueWhileIdle: false,
      isPausedByIdle: false,
      pausedAt: null,
      remainingMsAtPause: null
    });

    stopBadgeCountdown();
  } catch (error) {
    console.error("openStretchWindow error:", error);
  }
}

/* ---------------------------------- */
/* OPEN EXTENSION POPUP               */
/* ---------------------------------- */

async function openExtensionPopupWindow() {
  try {
    await chrome.windows.create({
      url: "popup.html",
      type: "popup",
      width: 460,
      height: 820,
      focused: true
    });
  } catch (error) {
    console.error("openExtensionPopupWindow error:", error);
  }
}

/* ---------------------------------- */
/* IDLE-AWARE DELIVERY                */
/* ---------------------------------- */

async function openStretchIfActive() {
  await openStretchWindow();
}

/* ---------------------------------- */
/* TIMER CONTROL                      */
/* ---------------------------------- */

function createAlarm(minutes) {
  const safeMinutes = Math.max(1, Number(minutes || 30));
  chrome.alarms.clear(ALARM_NAME, async () => {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: safeMinutes,
      periodInMinutes: safeMinutes
    });

    await setLocal({
      interval: safeMinutes,
      userInterval: safeMinutes,
      startTime: Date.now()
    });

    await setRuntimeState({
      stretchReminderState: "scheduled",
      pendingDueWhileIdle: false,
      isPausedByIdle: false,
      pausedAt: null,
      remainingMsAtPause: null
    });

    startBadgeCountdown();
  });
}

async function stopTimer() {
  chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.clear(MEETING_CHECK_ALARM);
  chrome.alarms.clear(POST_MEETING_ALARM);
  await removeLocal(["startTime", "interval", "meetingEndTime", "postMeetingStartTime"]);
  await setRuntimeState({
    stretchReminderState: "inactive",
    pendingDueWhileIdle: false,
    isPausedByIdle: false,
    pausedAt: null,
    remainingMsAtPause: null
  });
  stopBadgeCountdown();
}

async function snoozeTimer() {
  await recordBehavior("snoozed");

  chrome.alarms.clear(ALARM_NAME, async () => {
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: 5 });

    await setLocal({ interval: 5, startTime: Date.now() });

    await setRuntimeState({
      stretchReminderState: "scheduled",
      pendingDueWhileIdle: false,
      isPausedByIdle: false,
      pausedAt: null,
      remainingMsAtPause: null
    });

    startBadgeCountdown();
  });
}

/* ---------------------------------- */
/* RECOVER MISSED STRETCH AFTER SLEEP */
/* ---------------------------------- */

async function recoverMissedStretch() {
  const data = await getLocal(["interval", "startTime"]);
  const currentRuntime = await getRuntimeState();

  if (currentRuntime.stretchReminderState === "shown") {
    stopBadgeCountdown();
    return;
  }

  // If we were in a meeting state, restore badge
  if (currentRuntime.stretchReminderState === "in_meeting") {
    setBadgeMeeting();
    startBadgeCountdown();
    return;
  }

  // If we were in post-meeting buffer, restore badge countdown
  if (currentRuntime.stretchReminderState === "post_meeting") {
    startBadgeCountdown();
    return;
  }

  if (!data || !data.interval || !data.startTime) {
    stopBadgeCountdown();
    return;
  }

  const elapsed = (Date.now() - data.startTime) / 1000;
  const total = Number(data.interval) * 60;

  if (elapsed >= total) {
    await openStretchIfActive();
  } else {
    startBadgeCountdown();
    if (currentRuntime.stretchReminderState === "inactive") {
      await setRuntimeState({
        stretchReminderState: "scheduled",
        pendingDueWhileIdle: false,
        isPausedByIdle: false,
        pausedAt: null,
        remainingMsAtPause: null
      });
    }
  }
}

/* ---------------------------------- */
/* WATER MODULE                       */
/* ---------------------------------- */

async function getWaterSettings() {
  const data = await getLocal([
    "waterInterval", "waterGoal", "waterSoundEnabled",
    "waterGlassesToday", "waterGlassesDate", "waterStartTime", "waterEnabled"
  ]);
  return {
    waterInterval:     Number(data.waterInterval || 30),
    waterGoal:         Number(data.waterGoal || 8),
    waterSoundEnabled: typeof data.waterSoundEnabled === "boolean" ? data.waterSoundEnabled : true,
    waterGlassesToday: Number(data.waterGlassesToday || 0),
    waterGlassesDate:  data.waterGlassesDate || null,
    waterStartTime:    data.waterStartTime || null,
    waterEnabled:      typeof data.waterEnabled === "boolean" ? data.waterEnabled : true
  };
}

async function resetWaterGlassesIfNewDay() {
  const today = getTodayKey();
  const data  = await getLocal(["waterGlassesDate", "waterGlassesToday"]);
  if (data.waterGlassesDate !== today) {
    await setLocal({ waterGlassesToday: 0, waterGlassesDate: today });
    return 0;
  }
  return Number(data.waterGlassesToday || 0);
}

async function getWaterLicenseStatus() {
  if (_waterLicenseCache !== null && Date.now() - _waterLicenseCacheAt < 60 * 60 * 1000) {
    return _waterLicenseCache;
  }

  try {
    const data = await getSync(["waterLicenseToken", "waterLicenseVerifiedAt"]);

    if (!data.waterLicenseToken) {
      _waterLicenseCache = { isPro: false };
      _waterLicenseCacheAt = Date.now();
      return _waterLicenseCache;
    }

    if (data.waterLicenseVerifiedAt && Date.now() - data.waterLicenseVerifiedAt < 24 * 60 * 60 * 1000) {
      _waterLicenseCache = { isPro: true };
      _waterLicenseCacheAt = Date.now();
      return _waterLicenseCache;
    }

    try {
      const installationId = await getInstallationId();
      const res = await fetchWithTimeout(
        `${BACKEND_URL}/api/verify-water-license`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ installationId, licenseToken: data.waterLicenseToken })
        },
        5000
      );
      const json = await res.json();

      if (json.valid) {
        await setSync({ waterLicenseVerifiedAt: Date.now() });
        _waterLicenseCache = { isPro: true };
      } else {
        await removeSync(["waterLicenseToken", "waterLicenseVerifiedAt"]);
        _waterLicenseCache = { isPro: false };
      }
    } catch (e) {
      console.warn("Water license verify error, trusting cached:", e.message);
      _waterLicenseCache = { isPro: true };
    }
  } catch (e) {
    console.warn("getWaterLicenseStatus error:", e.message);
    _waterLicenseCache = { isPro: false };
  }

  _waterLicenseCacheAt = Date.now();
  return _waterLicenseCache;
}

async function createWaterCheckoutSession() {
  const installationId = await getInstallationId();
  const res = await fetchWithTimeout(
    `${BACKEND_URL}/api/create-water-checkout`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId })
    },
    10000
  );
  const json = await res.json();
  await setLocal({ waterPendingSessionId: json.sessionId });
  return json;
}

async function verifyWaterPaymentSession(sessionId) {
  const installationId = await getInstallationId();
  const res = await fetchWithTimeout(
    `${BACKEND_URL}/api/verify-water-payment`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId, sessionId })
    },
    10000
  );
  const json = await res.json();

  if (json.paid && json.licenseToken) {
    await setSync({ waterLicenseToken: json.licenseToken, waterLicenseVerifiedAt: Date.now() });
    await removeLocal(["waterPendingSessionId"]);
    _waterLicenseCache = { isPro: true };
    _waterLicenseCacheAt = Date.now();
    return { paid: true };
  }

  return { paid: false };
}

async function findExistingWaterWindow() {
  const windows = await chrome.windows.getAll({ populate: true });
  for (const win of windows) {
    if (!win.tabs || !win.tabs.length) continue;
    const hasWater = win.tabs.some(tab => tab.url && tab.url.includes("water.html"));
    if (hasWater) return win;
  }
  return null;
}

async function openWaterWindow() {
  try {
    const existing = await findExistingWaterWindow();
    if (existing) {
      await chrome.windows.update(existing.id, { focused: true });
      return;
    }
    await chrome.windows.create({
      url: "water.html",
      type: "popup",
      width: 500,
      height: 620,
      focused: true
    });
  } catch (error) {
    console.error("openWaterWindow error:", error);
  }
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
  await removeLocal(["waterStartTime"]);
}

/* ---------------------------------- */
/* WEEKLY RESET ALARM                 */
/* ---------------------------------- */

function ensureWeeklyResetAlarm() {
  chrome.alarms.create(WEEKLY_RESET_ALARM, { periodInMinutes: 60 * 24 });
}

/* ---------------------------------- */
/* INSTALL / UPDATE HOOK              */
/* ---------------------------------- */

chrome.runtime.onInstalled.addListener(async () => {
  await removeLocal(["startTime", "interval", "meetingEndTime"]);
  await maybeResetWeeklyStats();
  ensureWeeklyResetAlarm();
  await setRuntimeState({ ...DEFAULT_RUNTIME });
  stopBadgeCountdown();

  // Initialize water module defaults — disabled until user presses Start
  const today = getTodayKey();
  await setLocal({
    waterEnabled:      false,
    waterInterval:     30,
    waterGoal:         8,
    waterSoundEnabled: true,
    waterGlassesToday: 0,
    waterGlassesDate:  today
  });
  // Do NOT call scheduleWaterAlarm here — water only starts when user clicks Start

  chrome.windows.create({
    url: "welcome.html",
    type: "popup",
    width: 520,
    height: 680,
    focused: true
  });
});

/* ---------------------------------- */
/* CHROME STARTUP                     */
/* ---------------------------------- */

chrome.runtime.onStartup.addListener(async () => {
  runtimeState = {
    ...DEFAULT_RUNTIME,
    ...(await getRuntimeState())
  };
  await maybeResetWeeklyStats();
  ensureWeeklyResetAlarm();
  await recoverMissedStretch();

  // Only restore water alarm if user had explicitly started it
  const { waterEnabled, waterStartTime } = await getLocal(["waterEnabled", "waterStartTime"]);
  if (waterEnabled === true && waterStartTime) {
    await resetWaterGlassesIfNewDay();
    const alarms = await new Promise(resolve => chrome.alarms.getAll(resolve));
    const hasWaterAlarm = alarms.some(a => a.name === WATER_ALARM_NAME);
    if (!hasWaterAlarm) {
      const ws = await getWaterSettings();
      scheduleWaterAlarm(ws.waterInterval);
    }
    startBadgeCountdown();
  }
});

/* ---------------------------------- */
/* IDLE LISTENER                      */
/* ---------------------------------- */

chrome.idle.onStateChanged.addListener(async () => {
  // No idle-based gating for stretch delivery.
});

/* ---------------------------------- */
/* ALARM TRIGGER                      */
/* ---------------------------------- */

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === ALARM_NAME) {
      // Check Google Calendar — Pro only, only if enabled
      // This is the ONLY gate before opening the stretch window
      const { isPro } = await getLicenseStatus();
      const { calendarEnabled } = await getLocal(["calendarEnabled"]);

      if (isPro && calendarEnabled) {
        const deferred = await handleCalendarCheck();
        if (deferred) return; // meeting detected — stretch deferred
      }

      // No meeting or calendar not enabled — open stretch as normal
      await openStretchIfActive();
      return;
    }

    if (alarm.name === MEETING_CHECK_ALARM) {
      // Meeting check alarm fired — re-check calendar
      const { isPro } = await getLicenseStatus();
      const { calendarEnabled } = await getLocal(["calendarEnabled"]);

      if (isPro && calendarEnabled) {
        const deferred = await handleCalendarCheck();
        if (deferred) return; // still in meeting — another check scheduled
      }

      // Meeting ended — start 5-minute post-meeting buffer
      await setLocal({ postMeetingStartTime: Date.now() });
      await removeLocal(["meetingEndTime"]);

      await setRuntimeState({
        stretchReminderState: "post_meeting",
        pendingDueWhileIdle: false,
        isPausedByIdle: false,
        pausedAt: null,
        remainingMsAtPause: null
      });

      startBadgeCountdown();

      chrome.alarms.create(POST_MEETING_ALARM, {
        delayInMinutes: POST_MEETING_BUFFER_MINUTES
      });

      return;
    }

    if (alarm.name === POST_MEETING_ALARM) {
      // Buffer expired — open stretch now
      await removeLocal(["postMeetingStartTime"]);
      await openStretchIfActive();
      return;
    }

    if (alarm.name === WATER_ALARM_NAME) {
      // Reset glasses if new day
      await resetWaterGlassesIfNewDay();

      // Check calendar for water Pro users
      const { isPro: isWaterPro } = await getWaterLicenseStatus();
      const { waterCalendarEnabled } = await getLocal(["waterCalendarEnabled"]);

      if (isWaterPro && waterCalendarEnabled) {
        const { inMeeting, meetingEndTime } = await checkCalendar();
        if (inMeeting) {
          // Reschedule water for when meeting ends
          let minutesUntilEnd = 1;
          if (meetingEndTime) {
            const ms = meetingEndTime - Date.now();
            minutesUntilEnd = Math.max(1, Math.ceil(ms / 60000));
          }
          chrome.alarms.clear(WATER_ALARM_NAME, () => {
            chrome.alarms.create(WATER_ALARM_NAME, { delayInMinutes: minutesUntilEnd });
          });
          console.log(`Water: meeting detected, rescheduling in ${minutesUntilEnd} min`);
          return;
        }
      }

      // Open water screen
      await openWaterWindow();
      return;
    }

    if (alarm.name === WEEKLY_RESET_ALARM) {
      await maybeResetWeeklyStats();
      return;
    }
  } catch (error) {
    // Safety net — if anything throws, still try to open stretch
    console.error("Alarm handler error:", error);
    try {
      await openStretchIfActive();
    } catch (e) {
      console.error("Fallback openStretch also failed:", e);
    }
  }
});

/* ---------------------------------- */
/* MESSAGE HANDLER                    */
/* ---------------------------------- */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {

      // ---- Original message types ----

      if (request.type === "startTimer") {
        await createAlarm(request.minutes);
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

      if (request.type === "skipStretch") {
        await recordBehavior("skipped");
        await resumeMainTimerFromUserInterval();
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "stretchCompleted") {
        await recordBehavior("completed");
        await resumeMainTimerFromUserInterval();
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "getSmartStats") {
        await maybeResetWeeklyStats();
        const stats = await getSmartStatsData();
        const lastWeekStats = await getLastWeekStats();
        sendResponse({ ok: true, stats, lastWeekStats });
        return;
      }

      if (request.type === "getSettings") {
        const settings = await getSettings();
        const currentRuntime = await getRuntimeState();
        const meetingData = await getLocal(["meetingEndTime", "postMeetingStartTime"]);
        sendResponse({
          ok: true,
          stretchInterval: settings.interval,
          userInterval: settings.userInterval,
          startTime: settings.startTime,
          smartModeEnabled: settings.smartModeEnabled,
          soundEnabled: settings.soundEnabled,
          currentStretchSessionType: settings.currentStretchSessionType,
          stretchReminderState: currentRuntime.stretchReminderState,
          meetingEndTime: meetingData.meetingEndTime || null,
          postMeetingStartTime: meetingData.postMeetingStartTime || null
        });
        return;
      }

      if (request.type === "setStretchInterval") {
        const minutes = Math.max(1, Number(request.minutes || 30));
        const current = await getLocal(["startTime", "interval"]);
        const currentRuntime = await getRuntimeState();

        await setLocal({ userInterval: minutes });

        if (
          current.startTime &&
          current.interval &&
          currentRuntime.stretchReminderState === "scheduled"
        ) {
          await createAlarm(minutes);
        }

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

      if (request.type === "openStretchNow") {
        await openStretchWindow();
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "openPopupPanel") {
        await openExtensionPopupWindow();
        sendResponse({ ok: true });
        return;
      }

      // ---- Pro: Calendar ----

      if (request.type === "calendarAuthResult") {
        // Forwarded from oauth.js — if auth failed, disable calendar setting
        if (!request.success) {
          await setLocal({ calendarEnabled: false });
        }
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "setCalendarEnabled") {
        await setLocal({ calendarEnabled: !!request.enabled });
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "getIntegrationSettings") {
        const data = await getLocal(["calendarEnabled"]);
        sendResponse({
          ok: true,
          calendarEnabled: !!data.calendarEnabled
        });
        return;
      }

      // ---- Pro: License ----

      if (request.type === "getLicenseStatus") {
        const { isPro } = await getLicenseStatus();
        sendResponse({ ok: true, isPro });
        return;
      }

      if (request.type === "startCheckout") {
        try {
          const { checkoutUrl, sessionId } = await createCheckoutSession();
          chrome.tabs.create({ url: checkoutUrl });
          sendResponse({ ok: true, sessionId });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        return;
      }

      if (request.type === "verifyPayment") {
        try {
          const data = await getLocal(["pendingSessionId"]);
          const sessionId = request.sessionId || data.pendingSessionId;
          if (!sessionId) {
            sendResponse({ ok: false, paid: false, error: "No pending session" });
            return;
          }
          const result = await verifyPayment(sessionId);
          sendResponse({ ok: true, ...result });
        } catch (e) {
          sendResponse({ ok: false, paid: false, error: String(e) });
        }
        return;
      }

      // ---- Water module messages ----

      if (request.type === "getWaterSettings") {
        const ws = await getWaterSettings();
        const { isPro: isWaterPro } = await getWaterLicenseStatus();
        const extra = await getLocal(["waterCalendarEnabled", "waterPendingSessionId"]);
        await resetWaterGlassesIfNewDay();
        const fresh = await getLocal(["waterGlassesToday"]);
        sendResponse({
          ok: true,
          waterInterval:     ws.waterInterval,
          waterGoal:         ws.waterGoal,
          waterSoundEnabled: ws.waterSoundEnabled,
          waterGlassesToday: Number(fresh.waterGlassesToday || 0),
          waterStartTime:    ws.waterStartTime,
          waterEnabled:      ws.waterEnabled,
          isWaterPro,
          waterCalendarEnabled:    !!extra.waterCalendarEnabled,
          hasPendingWaterSession:  !!extra.waterPendingSessionId
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
        startBadgeCountdown(); // kick off badge loop so 💧 appears
        sendResponse({ ok: true });
        return;
      }

      if (request.type === "stopWaterTimer") {
        await setLocal({ waterEnabled: false });
        await stopWaterAlarm();
        // Only clear badge if stretch is also not running
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
        // Reschedule next water alarm from now
        const ws = await getWaterSettings();
        if (ws.waterEnabled) scheduleWaterAlarm(ws.waterInterval);
        sendResponse({ ok: true, waterGlassesToday: newCount });
        return;
      }

      if (request.type === "skipWater") {
        // Reschedule from now
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
          const { checkoutUrl, sessionId } = await createWaterCheckoutSession();
          chrome.tabs.create({ url: checkoutUrl });
          sendResponse({ ok: true, sessionId });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        return;
      }

      if (request.type === "verifyWaterPayment") {
        try {
          const data = await getLocal(["waterPendingSessionId"]);
          const sessionId = request.sessionId || data.waterPendingSessionId;
          if (!sessionId) {
            sendResponse({ ok: false, paid: false, error: "No pending water session" });
            return;
          }
          const result = await verifyWaterPaymentSession(sessionId);
          sendResponse({ ok: true, ...result });
        } catch (e) {
          sendResponse({ ok: false, paid: false, error: String(e) });
        }
        return;
      }

      sendResponse({ ok: false, error: "Unknown message type" });
    } catch (error) {
      console.error("Message handler error:", error);
      sendResponse({ ok: false, error: String(error) });
    }
  })();
  return true;
});

/* ---------------------------------- */
/* BOOTSTRAP ON SERVICE WORKER LOAD   */
/* ---------------------------------- */

(async () => {
  try {
    runtimeState = {
      ...DEFAULT_RUNTIME,
      ...(await getRuntimeState())
    };
    await maybeResetWeeklyStats();
    ensureWeeklyResetAlarm();
    await recoverMissedStretch();

    // Only restore water alarm if user had explicitly started it
    const { waterEnabled: wEnabled, waterStartTime: wStartTime } = await getLocal(["waterEnabled", "waterStartTime"]);
    if (wEnabled === true && wStartTime) {
      await resetWaterGlassesIfNewDay();
      const alarms = await new Promise(resolve => chrome.alarms.getAll(resolve));
      const hasWaterAlarm = alarms.some(a => a.name === WATER_ALARM_NAME);
      if (!hasWaterAlarm) {
        const ws = await getWaterSettings();
        scheduleWaterAlarm(ws.waterInterval);
      }
      startBadgeCountdown();
    }
  } catch (error) {
    console.error("Bootstrap error:", error);
  }
})();