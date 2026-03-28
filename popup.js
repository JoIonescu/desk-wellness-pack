let timerInterval = null;
let waterTimerInterval = null;
let popupRefreshInterval = null;
const POST_MEETING_BUFFER_MINUTES = 5;
const WATER_POST_MEETING_BUFFER_MINUTES = 5;
let currentTab = "stretch"; // "stretch" | "water"

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function setTimerInactive() {
  const el = document.getElementById("timerDisplay");
  if (el) el.textContent = "Timer Inactive";
}

function stopPopupTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/* ---- Stats carousel (original) ---- */

function updateCarouselDots() {
  const carousel = document.getElementById("statsCarousel");
  const dot0 = document.getElementById("dot0");
  const dot1 = document.getElementById("dot1");
  if (!carousel || !dot0 || !dot1) return;

  const slideIndex = Math.round(carousel.scrollLeft / carousel.clientWidth);
  dot0.classList.toggle("active", slideIndex === 0);
  dot1.classList.toggle("active", slideIndex >= 1);
}

function scrollToStatsSlide(index) {
  const carousel = document.getElementById("statsCarousel");
  if (!carousel) return;

  carousel.scrollTo({ left: carousel.clientWidth * index, behavior: "smooth" });

  const dot0 = document.getElementById("dot0");
  const dot1 = document.getElementById("dot1");
  if (dot0 && dot1) {
    dot0.classList.toggle("active", index === 0);
    dot1.classList.toggle("active", index === 1);
  }
}

function initStatsCarousel() {
  const carousel = document.getElementById("statsCarousel");
  const dot0 = document.getElementById("dot0");
  const dot1 = document.getElementById("dot1");
  if (!carousel) return;

  requestAnimationFrame(() => {
    carousel.scrollLeft = carousel.clientWidth;
    updateCarouselDots();
  });

  carousel.addEventListener("scroll", updateCarouselDots);
  dot0?.addEventListener("click", () => scrollToStatsSlide(0));
  dot1?.addEventListener("click", () => scrollToStatsSlide(1));
}

async function loadStats() {
  const res = await sendMessage({ type: "getSmartStats" });
  if (!res?.ok) return;

  const stats = res.stats || {};
  const lastWeekStats = res.lastWeekStats || {};

  const completedCount = document.getElementById("completedCount");
  const snoozedCount   = document.getElementById("snoozedCount");
  const skippedCount   = document.getElementById("skippedCount");

  if (completedCount) completedCount.textContent = stats.completedCount ?? 0;
  if (snoozedCount)   snoozedCount.textContent   = stats.snoozedCount   ?? 0;
  if (skippedCount)   skippedCount.textContent   = stats.skippedCount   ?? 0;

  const lastCompleted = document.getElementById("lastCompletedCount");
  const lastSnoozed   = document.getElementById("lastSnoozedCount");
  const lastSkipped   = document.getElementById("lastSkippedCount");

  if (lastCompleted) lastCompleted.textContent = lastWeekStats.completedCount ?? 0;
  if (lastSnoozed)   lastSnoozed.textContent   = lastWeekStats.snoozedCount   ?? 0;
  if (lastSkipped)   lastSkipped.textContent   = lastWeekStats.skippedCount   ?? 0;
}

/* ---- Timer ---- */

async function startPopupTimerFromState(settings) {
  stopPopupTimer();

  const timerDisplay = document.getElementById("timerDisplay");
  const timerLabel   = document.getElementById("timerLabel");
  if (!timerDisplay) return;

  // Meeting in progress — show meeting state, no countdown
  if (settings.stretchReminderState === "in_meeting") {
    if (timerLabel) timerLabel.textContent = "Meeting in progress";
    if (settings.meetingEndTime) {
      timerDisplay.textContent = `Until ${formatTime(settings.meetingEndTime)}`;
    } else {
      timerDisplay.textContent = "Stretch paused";
    }
    timerDisplay.style.color = "var(--blue)";
    return;
  }

  // Post-meeting buffer — show countdown to stretch
  if (settings.stretchReminderState === "post_meeting") {
    if (timerLabel) timerLabel.textContent = "Meeting ended — stretch starting in";
    timerDisplay.style.color = "var(--yellow)";

    const bufferMs = POST_MEETING_BUFFER_MINUTES * 60 * 1000;
    const elapsed  = settings.postMeetingStartTime ? Date.now() - settings.postMeetingStartTime : bufferMs;
    const remaining = Math.max(0, bufferMs - elapsed);

    const renderBuffer = () => {
      const totalMs    = POST_MEETING_BUFFER_MINUTES * 60 * 1000;
      const elapsedNow = settings.postMeetingStartTime ? Date.now() - settings.postMeetingStartTime : totalMs;
      const rem        = Math.max(0, totalMs - elapsedNow);
      if (rem <= 0) { timerDisplay.textContent = "0:00"; return; }
      timerDisplay.textContent = formatRemaining(rem);
    };

    renderBuffer();
    timerInterval = setInterval(renderBuffer, 1000);
    return;
  }

  // Reset label and colour for normal states
  if (timerLabel) timerLabel.textContent = "Next stretch break";
  timerDisplay.style.color = "var(--yellow)";

  if (
    settings.stretchReminderState === "shown"
  ) {
    setTimerInactive();
    return;
  }

  if (!settings.startTime || !settings.stretchInterval) {
    setTimerInactive();
    return;
  }

  const render = () => {
    const totalMs   = settings.stretchInterval * 60 * 1000;
    const elapsed   = Date.now() - settings.startTime;
    const remaining = totalMs - elapsed;
    if (remaining <= 0) { timerDisplay.textContent = "0:00"; return; }
    timerDisplay.textContent = formatRemaining(remaining);
  };

  render();
  timerInterval = setInterval(render, 1000);
}

async function loadSettings() {
  const res = await sendMessage({ type: "getSettings" });
  if (!res?.ok) return;

  const intervalSelect  = document.getElementById("intervalSelect");
  const smartModeToggle = document.getElementById("smartModeToggle");
  const soundToggle     = document.getElementById("soundToggle");

  if (intervalSelect)  intervalSelect.value   = String(res.stretchInterval || 30);
  if (smartModeToggle) smartModeToggle.checked = !!res.smartModeEnabled;
  if (soundToggle)     soundToggle.checked     = !!res.soundEnabled;

  // Sync custom dropdown label to match loaded value
  const customLabel = document.getElementById("customSelectLabel");
  const optionEls   = document.querySelectorAll(".custom-select-option");
  const strVal      = String(res.stretchInterval || 30);
  optionEls.forEach((el) => {
    const isSelected = el.dataset.value === strVal;
    el.classList.toggle("selected", isSelected);
    if (isSelected && customLabel) customLabel.textContent = el.textContent;
  });

  await startPopupTimerFromState(res);
}

/* ---- Pro license UI ---- */

async function loadLicenseStatus() {
  const res = await sendMessage({ type: "getLicenseStatus" });
  const isPro = res?.isPro || false;

  const stretchProBadge     = document.getElementById("stretchProBadge");
  const upgradeCard         = document.getElementById("upgradeCard");
  const proIntegrationsCard = document.getElementById("proIntegrationsCard");

  if (isPro) {
    if (stretchProBadge)     stretchProBadge.style.display     = "block";
    if (upgradeCard)         upgradeCard.style.display         = "none";
    if (proIntegrationsCard) proIntegrationsCard.style.display = "block";
  } else {
    if (stretchProBadge)     stretchProBadge.style.display     = "none";
    if (upgradeCard)         upgradeCard.style.display         = "block";
    if (proIntegrationsCard) proIntegrationsCard.style.display = "none";
  }

  return isPro;
}

async function loadIntegrationSettings() {
  const res = await sendMessage({ type: "getIntegrationSettings" });
  if (!res?.ok) return;

  const calendarToggle = document.getElementById("calendarToggle");
  const calendarStatus = document.getElementById("calendarStatus");

  if (calendarToggle) calendarToggle.checked      = !!res.calendarEnabled;
  if (calendarStatus) calendarStatus.style.display = res.calendarEnabled ? "block" : "none";
}

function showPendingState() {
  const verifyBtn   = document.getElementById("verifyBtn");
  const pendingNote = document.getElementById("pendingNote");
  const upgradeBtn  = document.getElementById("upgradeBtn");

  if (verifyBtn)   verifyBtn.style.display  = "block";
  if (pendingNote) pendingNote.style.display = "block";
  if (upgradeBtn)  upgradeBtn.textContent    = "Upgrade — €3.00 ↗";
}

/* ---- Tab switching ---- */

function switchTab(tab) {
  currentTab = tab;

  const sStretch = document.getElementById("sectionStretch");
  const sWater   = document.getElementById("sectionWater");
  const tStretch = document.getElementById("tabStretch");
  const tWater   = document.getElementById("tabWater");

  if (tab === "stretch") {
    if (sStretch) sStretch.style.display = "";
    if (sWater)   sWater.style.display   = "none";
    if (tStretch) {
      tStretch.style.background = "rgba(255,212,0,0.10)";
      tStretch.style.color      = "var(--yellow)";
      tStretch.style.border     = "1px solid rgba(255,212,0,0.20)";
    }
    if (tWater) {
      tWater.style.background = "transparent";
      tWater.style.color      = "var(--muted)";
      tWater.style.border     = "1px solid transparent";
    }
  } else {
    if (sStretch) sStretch.style.display = "none";
    if (sWater)   sWater.style.display   = "";
    if (tWater) {
      tWater.style.background = "rgba(90,169,255,0.10)";
      tWater.style.color      = "var(--blue)";
      tWater.style.border     = "1px solid rgba(90,169,255,0.20)";
    }
    if (tStretch) {
      tStretch.style.background = "transparent";
      tStretch.style.color      = "var(--muted)";
      tStretch.style.border     = "1px solid transparent";
    }
  }
}

// Wire tab clicks via event listeners
const tabStretch = document.getElementById("tabStretch");
const tabWater   = document.getElementById("tabWater");
tabStretch?.addEventListener("click", () => switchTab("stretch"));
tabWater?.addEventListener("click",   () => switchTab("water"));

/* ---- Water timer display ---- */

function stopWaterTimer() {
  if (waterTimerInterval) { clearInterval(waterTimerInterval); waterTimerInterval = null; }
}

function setWaterTimerInactive() {
  const el = document.getElementById("waterTimerDisplay");
  if (el) el.textContent = "Timer Inactive";
}

function renderWaterDots(glasses, goal) {
  const container = document.getElementById("waterDotsContainer");
  if (!container) return;
  container.innerHTML = "";
  for (let i = 0; i < goal; i++) {
    const d = document.createElement("div");
    d.style.cssText = `height:7px;border-radius:4px;flex:1;min-width:18px;max-width:28px;
      border:1px solid rgba(255,255,255,0.07);transition:all 0.3s ease;
      ${i < glasses
        ? "background:var(--blue);border-color:#3d8fe0;box-shadow:0 0 5px rgba(90,169,255,0.35);"
        : "background:rgba(255,255,255,0.09);"}`;
    container.appendChild(d);
  }
}

function renderWaterMiniGlass(glasses, goal) {
  const fill = document.getElementById("waterMiniGlassFill");
  if (!fill) return;
  const pct = goal > 0 ? Math.min(glasses / goal, 1) : 0;
  fill.style.height = `${Math.max(pct * 90, 2)}%`;
}

async function loadWaterSettings() {
  const res = await sendMessage({ type: "getWaterSettings" });
  if (!res?.ok) return;

  const waterIntervalSelect = document.getElementById("waterIntervalSelect");
  const waterSoundToggle    = document.getElementById("waterSoundToggle");
  const waterGlassCount     = document.getElementById("waterGlassCount");
  const waterGoalDisplay    = document.getElementById("waterGoalDisplay");
  const waterGoalValue      = document.getElementById("waterGoalValue");
  const waterTimerDisplay   = document.getElementById("waterTimerDisplay");
  const waterTimerLabel     = document.getElementById("waterTimerLabel");

  const glasses  = res.waterGlassesToday || 0;
  const goal     = res.waterGoal || 8;
  const isWaterPro = res.isWaterPro || false;

  if (waterIntervalSelect)  waterIntervalSelect.value = String(res.waterInterval || 30);
  if (waterSoundToggle)     waterSoundToggle.checked  = !!res.waterSoundEnabled;
  if (waterGlassCount)      waterGlassCount.textContent = String(glasses);
  if (waterGoalDisplay)     waterGoalDisplay.textContent = String(goal);
  if (waterGoalValue)       waterGoalValue.textContent = String(goal);

  // Sync custom water dropdown label
  const wLabel   = document.getElementById("waterCustomSelectLabel");
  const wOptions = document.querySelectorAll("#waterCustomSelectOptions .custom-select-option");
  const strVal   = String(res.waterInterval || 30);
  wOptions.forEach(el => {
    const isSel = el.dataset.value === strVal;
    el.classList.toggle("selected", isSel);
    if (isSel && wLabel) wLabel.textContent = el.textContent;
  });

  renderWaterDots(glasses, goal);
  renderWaterMiniGlass(glasses, goal);

  // Timer countdown — meeting-aware
  stopWaterTimer();

  const waterMeetingNote = document.getElementById("waterMeetingNote");

  if (res.waterMeetingActive) {
    // Meeting in progress — show pause message + resume time
    if (waterTimerLabel) waterTimerLabel.textContent = "Meeting in progress";
    if (waterTimerDisplay) {
      waterTimerDisplay.style.color = "var(--blue)";
      if (res.waterMeetingEndTime) {
        const resumeTime = new Date(res.waterMeetingEndTime + WATER_POST_MEETING_BUFFER_MINUTES * 60 * 1000);
        const h = resumeTime.getHours();
        const m = String(resumeTime.getMinutes()).padStart(2, "0");
        const ampm = h >= 12 ? "PM" : "AM";
        const h12 = h % 12 || 12;
        waterTimerDisplay.textContent = `Resumes ~${h12}:${m} ${ampm}`;
      } else {
        waterTimerDisplay.textContent = "Paused";
      }
    }
    if (waterMeetingNote) {
      waterMeetingNote.style.display = "block";
      waterMeetingNote.textContent = "Water intake will resume 5 min after meeting ends";
    }
  } else if (res.waterPostMeetingStartTime) {
    // Post-meeting buffer — live countdown, same pattern as stretch
    if (waterTimerLabel) waterTimerLabel.textContent = "Meeting ended — water break starting in";
    if (waterTimerDisplay) waterTimerDisplay.style.color = "var(--blue)";
    if (waterMeetingNote) waterMeetingNote.style.display = "none";
    const bufferMs = WATER_POST_MEETING_BUFFER_MINUTES * 60 * 1000;
    const renderBuffer = () => {
      const elapsed = Date.now() - res.waterPostMeetingStartTime;
      const rem = Math.max(0, bufferMs - elapsed);
      if (!waterTimerDisplay) return;
      if (rem <= 0) { waterTimerDisplay.textContent = "0:00"; return; }
      const s = Math.max(0, Math.ceil(rem / 1000));
      const min = Math.floor(s / 60);
      const sec = s % 60;
      waterTimerDisplay.textContent = `${min}:${String(sec).padStart(2, "0")}`;
    };
    renderBuffer();
    waterTimerInterval = setInterval(renderBuffer, 1000);
  } else if (res.waterEnabled !== false && res.waterStartTime && res.waterInterval) {
    // Normal countdown
    if (waterTimerLabel) waterTimerLabel.textContent = "Next water reminder";
    if (waterTimerDisplay) waterTimerDisplay.style.color = "var(--blue)";
    if (waterMeetingNote) waterMeetingNote.style.display = "none";
    const render = () => {
      const totalMs   = res.waterInterval * 60 * 1000;
      const elapsed   = Date.now() - res.waterStartTime;
      const remaining = totalMs - elapsed;
      if (!waterTimerDisplay) return;
      if (remaining <= 0) { waterTimerDisplay.textContent = "0:00"; return; }
      const s = Math.max(0, Math.ceil(remaining / 1000));
      const min = Math.floor(s / 60);
      const sec = s % 60;
      waterTimerDisplay.textContent = `${min}:${String(sec).padStart(2, "0")}`;
    };
    render();
    waterTimerInterval = setInterval(render, 1000);
  } else {
    if (waterMeetingNote) waterMeetingNote.style.display = "none";
    setWaterTimerInactive();
  }

  // Pro / free UI
  const waterUpgradeCard = document.getElementById("waterUpgradeCard");
  const waterProCard     = document.getElementById("waterProCard");
  const waterGoalStepper = document.getElementById("waterGoalStepper");
  const waterGoalLockIcon = document.getElementById("waterGoalLockIcon");
  const waterGoalSubLabel = document.getElementById("waterGoalSubLabel");
  const waterCalendarToggle = document.getElementById("waterCalendarToggle");
  const waterCalendarStatus = document.getElementById("waterCalendarStatus");

  if (isWaterPro) {
    if (waterUpgradeCard) waterUpgradeCard.style.display = "none";
    if (waterProCard)     waterProCard.style.display     = "block";
    // Show water Pro badge inside the water timer card
    const waterProBadge = document.getElementById("waterProBadge");
    if (waterProBadge) waterProBadge.style.display = "block";
    // Unlock goal stepper
    if (waterGoalStepper) {
      waterGoalStepper.style.opacity       = "1";
      waterGoalStepper.style.pointerEvents = "auto";
    }
    if (waterGoalLockIcon) waterGoalLockIcon.style.display = "none";
    if (waterGoalSubLabel) waterGoalSubLabel.textContent   = "Set your personal daily target";
    if (waterCalendarToggle) waterCalendarToggle.checked   = !!res.waterCalendarEnabled;
    if (waterCalendarStatus) {
      waterCalendarStatus.style.display = res.waterCalendarEnabled ? "block" : "none";
    }
  } else {
    if (waterUpgradeCard) waterUpgradeCard.style.display = "block";
    if (waterProCard)     waterProCard.style.display     = "none";
  }

  // Pending payment
  if (!isWaterPro && res.hasPendingWaterSession) {
    const waterVerifyBtn  = document.getElementById("waterVerifyBtn");
    const waterPendingNote = document.getElementById("waterPendingNote");
    if (waterVerifyBtn)   waterVerifyBtn.style.display   = "block";
    if (waterPendingNote) waterPendingNote.style.display = "block";
  }
}

/* ---- Init ---- */

async function init() {
  initStatsCarousel();
  await loadSettings();
  await loadStats();

  const isPro = await loadLicenseStatus();

  if (!isPro) {
    const pending = await new Promise((resolve) => {
      chrome.storage.local.get(["pendingSessionId"], (d) => resolve(d.pendingSessionId || null));
    });
    if (pending) showPendingState();
  }

  if (isPro) {
    await loadIntegrationSettings();
  }

  await loadWaterSettings();

  /* ---- Custom interval dropdown ---- */

  const customTrigger = document.getElementById("customSelectTrigger");
  const customOptions = document.getElementById("customSelectOptions");
  const customLabel   = document.getElementById("customSelectLabel");
  const optionEls     = customOptions?.querySelectorAll(".custom-select-option");

  function setCustomDropdownValue(value) {
    const strVal = String(value);
    optionEls?.forEach((el) => {
      const isSelected = el.dataset.value === strVal;
      el.classList.toggle("selected", isSelected);
      if (isSelected && customLabel) customLabel.textContent = el.textContent;
    });
    if (intervalSelect) intervalSelect.value = strVal;
  }

  function closeCustomDropdown() {
    customTrigger?.classList.remove("open");
    customOptions?.classList.remove("open");
  }

  customTrigger?.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = customOptions?.classList.contains("open");
    if (isOpen) {
      closeCustomDropdown();
    } else {
      customTrigger.classList.add("open");
      customOptions?.classList.add("open");
    }
  });

  optionEls?.forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const value = el.dataset.value;
      setCustomDropdownValue(value);
      closeCustomDropdown();
      const minutes = Number(value);
      await sendMessage({ type: "setStretchInterval", minutes });
      await loadSettings();
    });
  });

  // Close when clicking outside
  document.addEventListener("click", () => closeCustomDropdown());

  /* ---- Original button handlers ---- */

  const startBtn        = document.getElementById("startBtn");
  const stopBtn         = document.getElementById("stopBtn");
  const intervalSelect  = document.getElementById("intervalSelect");
  const smartModeToggle = document.getElementById("smartModeToggle");
  const soundToggle     = document.getElementById("soundToggle");

  startBtn?.addEventListener("click", async () => {
    const minutes = Number(intervalSelect?.value || 30);
    const res = await sendMessage({ type: "startTimer", minutes });
    if (res?.ok) await loadSettings();
  });

  stopBtn?.addEventListener("click", async () => {
    const res = await sendMessage({ type: "stopTimer" });
    if (res?.ok) { stopPopupTimer(); setTimerInactive(); }
  });

  intervalSelect?.addEventListener("change", async () => {
    const minutes = Number(intervalSelect.value || 30);
    await sendMessage({ type: "setStretchInterval", minutes });
    await loadSettings();
  });

  smartModeToggle?.addEventListener("change", async () => {
    await sendMessage({ type: "setSmartMode", enabled: smartModeToggle.checked });
  });

  soundToggle?.addEventListener("change", async () => {
    await sendMessage({ type: "setSound", enabled: soundToggle.checked });
  });

  /* ---- Upgrade button ---- */

  const upgradeBtn = document.getElementById("upgradeBtn");
  upgradeBtn?.addEventListener("click", async () => {
    upgradeBtn.textContent = "Opening checkout…";
    upgradeBtn.disabled    = true;

    const res = await sendMessage({ type: "startCheckout" });

    upgradeBtn.disabled = false;

    if (res?.ok) {
      showPendingState();
    } else {
      upgradeBtn.textContent = "Upgrade — €3.00";
      alert("Could not open checkout. Please try again.");
    }
  });

  /* ---- Verify payment button ---- */

  const verifyBtn = document.getElementById("verifyBtn");
  verifyBtn?.addEventListener("click", async () => {
    verifyBtn.textContent = "Verifying…";
    verifyBtn.disabled    = true;

    const res = await sendMessage({ type: "verifyPayment" });

    if (res?.paid) {
      await loadLicenseStatus();
      await loadIntegrationSettings();
    } else {
      verifyBtn.textContent = "✓ I've paid — Verify Payment";
      verifyBtn.disabled    = false;
      const pendingNote = document.getElementById("pendingNote");
      if (pendingNote) {
        pendingNote.textContent = "Payment not found yet. Complete checkout in the other tab, then try again.";
      }
    }
  });

  /* ---- Calendar toggle ---- */

  const calendarToggle = document.getElementById("calendarToggle");
  const calendarStatus = document.getElementById("calendarStatus");

  calendarToggle?.addEventListener("change", async () => {
    if (calendarToggle.checked) {
      // Save the intent first
      await sendMessage({ type: "setCalendarEnabled", enabled: true });

      // Open dedicated OAuth window — popup cannot handle interactive
      // auth because it closes on focus loss, killing the callback
      chrome.windows.create({
        url: chrome.runtime.getURL("oauth.html"),
        type: "popup",
        width: 380,
        height: 260,
        focused: true
      });

      // Listen for result from oauth.js
      const handleAuthResult = (msg) => {
        if (msg.type !== "calendarAuthResult") return;
        chrome.runtime.onMessage.removeListener(handleAuthResult);

        if (msg.success) {
          if (calendarStatus) calendarStatus.style.display = "block";
        } else {
          // Auth failed — revert toggle and setting
          calendarToggle.checked = false;
          sendMessage({ type: "setCalendarEnabled", enabled: false });
          if (calendarStatus) calendarStatus.style.display = "none";
        }
      };
      chrome.runtime.onMessage.addListener(handleAuthResult);

    } else {
      await sendMessage({ type: "setCalendarEnabled", enabled: false });
      if (calendarStatus) calendarStatus.style.display = "none";
    }
  });

  /* ---- Water button handlers ---- */

  const waterStartBtn = document.getElementById("waterStartBtn");
  const waterStopBtn  = document.getElementById("waterStopBtn");
  const waterSoundToggle = document.getElementById("waterSoundToggle");

  waterStartBtn?.addEventListener("click", async () => {
    const waterIntervalSelect = document.getElementById("waterIntervalSelect");
    const minutes = Number(waterIntervalSelect?.value || 30);
    await sendMessage({ type: "startWaterTimer", minutes });
    await loadWaterSettings();
  });

  waterStopBtn?.addEventListener("click", async () => {
    await sendMessage({ type: "stopWaterTimer" });
    stopWaterTimer();
    setWaterTimerInactive();
  });

  waterSoundToggle?.addEventListener("change", async () => {
    await sendMessage({ type: "setWaterSound", enabled: waterSoundToggle.checked });
  });

  /* ---- Water custom dropdown ---- */
  const waterTrigger = document.getElementById("waterCustomSelectTrigger");
  const waterOptions = document.getElementById("waterCustomSelectOptions");
  const waterLabel   = document.getElementById("waterCustomSelectLabel");
  const waterOptEls  = waterOptions?.querySelectorAll(".custom-select-option");

  function closeWaterDropdown() {
    waterTrigger?.classList.remove("open");
    waterOptions?.classList.remove("open");
  }

  waterTrigger?.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = waterOptions?.classList.contains("open");
    if (isOpen) { closeWaterDropdown(); }
    else { waterTrigger.classList.add("open"); waterOptions?.classList.add("open"); }
  });

  waterOptEls?.forEach(el => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const value = el.dataset.value;
      waterOptEls.forEach(o => o.classList.toggle("selected", o.dataset.value === value));
      if (waterLabel) waterLabel.textContent = el.textContent;
      const waterIntervalSelect = document.getElementById("waterIntervalSelect");
      if (waterIntervalSelect) waterIntervalSelect.value = value;
      closeWaterDropdown();
      await sendMessage({ type: "setWaterInterval", minutes: Number(value) });
      await loadWaterSettings();
    });
  });

  document.addEventListener("click", () => closeWaterDropdown());

  /* ---- Water goal stepper ---- */
  let waterGoalLocal = 8;

  document.getElementById("waterGoalMinus")?.addEventListener("click", async () => {
    if (waterGoalLocal <= 1) return;
    waterGoalLocal -= 1;
    const el = document.getElementById("waterGoalValue");
    if (el) el.textContent = String(waterGoalLocal);
    await sendMessage({ type: "setWaterGoal", goal: waterGoalLocal });
    await loadWaterSettings();
  });

  document.getElementById("waterGoalPlus")?.addEventListener("click", async () => {
    if (waterGoalLocal >= 20) return;
    waterGoalLocal += 1;
    const el = document.getElementById("waterGoalValue");
    if (el) el.textContent = String(waterGoalLocal);
    await sendMessage({ type: "setWaterGoal", goal: waterGoalLocal });
    await loadWaterSettings();
  });

  /* ---- Water upgrade ---- */
  const waterUpgradeBtn = document.getElementById("waterUpgradeBtn");
  waterUpgradeBtn?.addEventListener("click", async () => {
    waterUpgradeBtn.textContent = "Opening checkout…";
    waterUpgradeBtn.disabled    = true;
    const res = await sendMessage({ type: "startWaterCheckout" });
    waterUpgradeBtn.disabled = false;
    if (res?.ok) {
      const waterVerifyBtn   = document.getElementById("waterVerifyBtn");
      const waterPendingNote = document.getElementById("waterPendingNote");
      if (waterVerifyBtn)   waterVerifyBtn.style.display   = "block";
      if (waterPendingNote) waterPendingNote.style.display = "block";
      waterUpgradeBtn.textContent = "Upgrade — €5.00 ↗";
    } else {
      waterUpgradeBtn.textContent = "Upgrade — €5.00";
      alert("Could not open checkout. Please try again.");
    }
  });

  const waterVerifyBtn = document.getElementById("waterVerifyBtn");
  waterVerifyBtn?.addEventListener("click", async () => {
    waterVerifyBtn.textContent = "Verifying…";
    waterVerifyBtn.disabled    = true;
    const res = await sendMessage({ type: "verifyWaterPayment" });
    if (res?.paid) {
      await loadWaterSettings();
    } else {
      waterVerifyBtn.textContent = "✓ I've paid — Verify Payment";
      waterVerifyBtn.disabled    = false;
      const waterPendingNote = document.getElementById("waterPendingNote");
      if (waterPendingNote) waterPendingNote.textContent = "Payment not found yet. Complete checkout in the other tab, then try again.";
    }
  });

  /* ---- Water calendar toggle ---- */
  const waterCalendarToggle = document.getElementById("waterCalendarToggle");
  const waterCalendarStatus = document.getElementById("waterCalendarStatus");

  waterCalendarToggle?.addEventListener("change", async () => {
    if (waterCalendarToggle.checked) {
      await sendMessage({ type: "setWaterCalendarEnabled", enabled: true });
      chrome.windows.create({
        url: chrome.runtime.getURL("oauth.html"),
        type: "popup", width: 380, height: 260, focused: true
      });
      const handleAuthResult = (msg) => {
        if (msg.type !== "calendarAuthResult") return;
        chrome.runtime.onMessage.removeListener(handleAuthResult);
        if (msg.success) {
          if (waterCalendarStatus) waterCalendarStatus.style.display = "block";
        } else {
          waterCalendarToggle.checked = false;
          sendMessage({ type: "setWaterCalendarEnabled", enabled: false });
          if (waterCalendarStatus) waterCalendarStatus.style.display = "none";
        }
      };
      chrome.runtime.onMessage.addListener(handleAuthResult);
    } else {
      await sendMessage({ type: "setWaterCalendarEnabled", enabled: false });
      if (waterCalendarStatus) waterCalendarStatus.style.display = "none";
    }
  });

  /* ---- Periodic refresh (original) ---- */

  if (popupRefreshInterval) clearInterval(popupRefreshInterval);

  popupRefreshInterval = setInterval(async () => {
    await loadSettings();
    await loadStats();
    await loadWaterSettings();
  }, 3000);
}

/* ---- Info button — wired immediately, no async dependency ---- */

document.addEventListener("DOMContentLoaded", () => {
  const infoBtn   = document.getElementById("infoBtn");
  const infoPanel = document.getElementById("infoPanel");
  if (infoBtn && infoPanel) {
    infoBtn.addEventListener("click", () => {
      const isOpen = infoPanel.classList.toggle("open");
      infoBtn.classList.toggle("active", isOpen);
    });
  }

  // Water info button — same pattern
  const waterInfoBtn   = document.getElementById("waterInfoBtn");
  const waterInfoPanel = document.getElementById("waterInfoPanel");
  if (waterInfoBtn && waterInfoPanel) {
    waterInfoBtn.addEventListener("click", () => {
      const isOpen = waterInfoPanel.classList.toggle("open");
      waterInfoBtn.classList.toggle("active", isOpen);
    });
  }

  init();
});