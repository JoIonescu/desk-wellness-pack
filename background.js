const ALARM_NAME = "stretchAlarm";
const WEEKLY_RESET_ALARM = "weeklyStatsReset";

// Replace with your deployed Vercel URL after deployment
const BACKEND_URL = "https://smart-stretch-backend-3s9c5lnw0-ioanaelionescu-3621s-projects.vercel.app";;

let countdownInterval = null;

const DEFAULT_RUNTIME = {
  stretchReminderState: "inactive", // inactive | scheduled | waiting_for_user_active | shown
  pendingDueWhileIdle: false,
  isPausedByIdle: false,
  pausedAt: null,
  remainingMsAtPause: null
};

let runtimeState = { ...DEFAULT_RUNTIME };

// In-memory license cache — avoids hitting backend on every alarm
let _licenseCache = null;
let _licenseCacheAt = 0;

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

function startBadgeCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  countdownInterval = setInterval(async () => {
    const data = await getLocal(["interval", "startTime"]);
    const currentRuntime = await getRuntimeState();

    if (currentRuntime.stretchReminderState === "shown") { clearBadge(); return; }
    if (currentRuntime.stretchReminderState === "waiting_for_user_active") { clearBadge(); return; }
    if (!data || !data.interval || !data.startTime) { clearBadge(); return; }

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
  const data = await getLocal(["installationId"]);
  if (data.installationId) return data.installationId;
  const id = crypto.randomUUID();
  await setLocal({ installationId: id });
  return id;
}

async function getLicenseStatus() {
  // Return in-memory cache if fresh (1 hour)
  if (_licenseCache !== null && Date.now() - _licenseCacheAt < 60 * 60 * 1000) {
    return _licenseCache;
  }

  const data = await getLocal(["licenseToken", "licenseVerifiedAt"]);

  if (!data.licenseToken) {
    _licenseCache = { isPro: false };
    _licenseCacheAt = Date.now();
    return _licenseCache;
  }

  // Trust storage cache if verified within last 24 hours
  if (data.licenseVerifiedAt && Date.now() - data.licenseVerifiedAt < 24 * 60 * 60 * 1000) {
    _licenseCache = { isPro: true };
    _licenseCacheAt = Date.now();
    return _licenseCache;
  }

  // Re-verify against backend
  try {
    const installationId = await getInstallationId();
    const res = await fetch(`${BACKEND_URL}/api/verify-license`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId, licenseToken: data.licenseToken })
    });
    const json = await res.json();

    if (json.valid) {
      await setLocal({ licenseVerifiedAt: Date.now() });
      _licenseCache = { isPro: true };
    } else {
      await removeLocal(["licenseToken", "licenseVerifiedAt"]);
      _licenseCache = { isPro: false };
    }
  } catch (e) {
    // Network error — fail open so offline users are not locked out
    console.warn("License re-verify failed (network), trusting cached token:", e);
    _licenseCache = { isPro: true };
  }

  _licenseCacheAt = Date.now();
  return _licenseCache;
}

async function createCheckoutSession() {
  const installationId = await getInstallationId();
  const res = await fetch(`${BACKEND_URL}/api/create-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ installationId })
  });
  const json = await res.json();
  await setLocal({ pendingSessionId: json.sessionId });
  return json; // { checkoutUrl, sessionId }
}

async function verifyPayment(sessionId) {
  const installationId = await getInstallationId();
  const res = await fetch(`${BACKEND_URL}/api/verify-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ installationId, sessionId })
  });
  const json = await res.json();

  if (json.paid && json.licenseToken) {
    await setLocal({
      licenseToken: json.licenseToken,
      licenseVerifiedAt: Date.now()
    });
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

async function isUserInMeeting() {
  try {
    const token = await getGoogleToken(false); // silent — never prompt mid-session
    const now = new Date();
    const tenMinLater = new Date(now.getTime() + 10 * 60 * 1000);

    const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        timeMin: now.toISOString(),
        timeMax: tenMinLater.toISOString(),
        items: [{ id: "primary" }]
      })
    });

    const data = await res.json();
    const busySlots = data?.calendars?.primary?.busy ?? [];
    return busySlots.length > 0;
  } catch (e) {
    // Fail open — if the check fails, don't block the stretch
    console.warn("Calendar check failed, allowing stretch:", e);
    return false;
  }
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
  await removeLocal(["startTime", "interval"]);
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

  if (
    currentRuntime.stretchReminderState === "shown" ||
    currentRuntime.stretchReminderState === "waiting_for_user_active"
  ) {
    stopBadgeCountdown();
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
/* WEEKLY RESET ALARM                 */
/* ---------------------------------- */

function ensureWeeklyResetAlarm() {
  chrome.alarms.create(WEEKLY_RESET_ALARM, { periodInMinutes: 60 * 24 });
}

/* ---------------------------------- */
/* INSTALL / UPDATE HOOK              */
/* ---------------------------------- */

chrome.runtime.onInstalled.addListener(async () => {
  await removeLocal(["startTime", "interval"]);
  await maybeResetWeeklyStats();
  ensureWeeklyResetAlarm();
  await setRuntimeState({ ...DEFAULT_RUNTIME });
  stopBadgeCountdown();

  chrome.windows.create({
    url: "welcome.html",
    type: "popup",
    width: 520,
    height: 620,
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

      // Check Google Calendar — Pro only
      const { isPro } = await getLicenseStatus();
      const { calendarEnabled } = await getLocal(["calendarEnabled"]);

      if (isPro && calendarEnabled) {
        const inMeeting = await isUserInMeeting();
        if (inMeeting) {
          // Silently reschedule — does not count as a skip
          console.log("Stretch skipped — user is in a meeting.");
          await resumeMainTimerFromUserInterval();
          return;
        }
      }

      await openStretchIfActive();
      return;
    }

    if (alarm.name === WEEKLY_RESET_ALARM) {
      await maybeResetWeeklyStats();
      return;
    }
  } catch (error) {
    console.error("Alarm handler error:", error);
  }
});

/* ---------------------------------- */
/* MESSAGE HANDLER                    */
/* ---------------------------------- */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {

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
        sendResponse({
          ok: true,
          stretchInterval: settings.interval,
          userInterval: settings.userInterval,
          startTime: settings.startTime,
          smartModeEnabled: settings.smartModeEnabled,
          soundEnabled: settings.soundEnabled,
          currentStretchSessionType: settings.currentStretchSessionType,
          stretchReminderState: currentRuntime.stretchReminderState
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

      if (request.type === "setCalendarEnabled") {
        await setLocal({ calendarEnabled: !!request.enabled });
        if (request.enabled) {
          // Trigger Google OAuth consent screen now so it doesn't interrupt a stretch
          getGoogleToken(true).catch((e) => console.warn("Google auth:", e));
        }
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
  } catch (error) {
    console.error("Bootstrap error:", error);
  }
})();
