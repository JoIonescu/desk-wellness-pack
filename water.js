document.addEventListener("DOMContentLoaded", async () => {

  /* ── Storage helper ── */
  function getLocal(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  function sendMessage(msg) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(msg, response => {
        if (chrome.runtime.lastError) resolve({ ok: false });
        else resolve(response || { ok: false });
      });
    });
  }

  function formatRemaining(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  /* ── DOM ── */
  const waterFill        = document.getElementById("waterFill");
  const glassCount       = document.getElementById("glassCount");
  const glassGoalLabel   = document.getElementById("glassGoalLabel");
  const dotsContainer    = document.getElementById("dotsContainer");
  const nextReminderTime = document.getElementById("nextReminderTime"); // ← was missing
  const drinkBtn         = document.getElementById("drinkBtn");
  const skipBtn          = document.getElementById("skipBtn");
  const successOverlay   = document.getElementById("successOverlay");
  const successSub       = document.getElementById("successSub");
  const goalBanner       = document.getElementById("goalBanner");

  /* ── State ── */
  let glasses = 0;
  let goal    = 8;
  let timerInterval = null;

  /* ── Render ── */
  function renderDots() {
    dotsContainer.innerHTML = "";
    for (let i = 0; i < goal; i++) {
      const d = document.createElement("div");
      d.className = "dot";
      if (i < glasses) {
        d.classList.add("filled");
        if (i === goal - 1 && glasses >= goal) d.classList.add("goal-dot");
      }
      dotsContainer.appendChild(d);
    }
  }

  function renderGlass() {
    const pct = goal > 0 ? Math.min(glasses / goal, 1) : 0;
    waterFill.style.height = `${Math.max(pct * 96, 3)}%`;
    glassCount.innerHTML = `${glasses} <span id="glassGoalLabel">/ ${goal}</span>`;
    renderDots();
    goalBanner.classList.toggle("show", glasses >= goal);
  }

  function startReminderCountdown(startTime, intervalMinutes) {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (!nextReminderTime) return;
    if (!startTime || !intervalMinutes) {
      nextReminderTime.textContent = "–:––";
      return;
    }

    const render = () => {
      const totalMs   = intervalMinutes * 60 * 1000;
      const elapsed   = Date.now() - startTime;
      const remaining = totalMs - elapsed;
      if (remaining <= 0) {
        nextReminderTime.textContent = "0:00";
        if (timerInterval) clearInterval(timerInterval);
        return;
      }
      nextReminderTime.textContent = formatRemaining(remaining);
    };

    render();
    timerInterval = setInterval(render, 1000);
  }

  /* ── Sound ── */
  async function playWaterSound() {
    const data = await getLocal(["waterSoundEnabled"]);
    if (data.waterSoundEnabled === false) return;

    // water-chime.wav is the dedicated water sound
    const paths = [
      "water-chime.wav",
      "water-chime.mp3",
      "stretch-chime.wav",
      "stretch-chime.mp3"
    ];

    setTimeout(async () => {
      for (const path of paths) {
        try {
          const audio = new Audio(chrome.runtime.getURL(path));
          audio.volume = 0.8;
          await audio.play();
          return;
        } catch (e) { /* try next */ }
      }
    }, 500);
  }

  /* ── Load state ── */
  async function loadState() {
    const data = await sendMessage({ type: "getWaterSettings" });
    if (!data?.ok) return;

    glasses = data.waterGlassesToday || 0;
    goal    = data.waterGoal || 8;

    renderGlass();

    // Wire up the next-reminder countdown — was missing before
    startReminderCountdown(data.waterStartTime, data.waterInterval);
  }

  /* ── Drink handler ── */
  drinkBtn.addEventListener("click", async () => {
    drinkBtn.disabled = true;

    const res = await sendMessage({ type: "logGlass" });
    if (res?.ok) {
      glasses = res.waterGlassesToday;
      renderGlass();

      const isGoalReached = glasses >= goal;
      successSub.textContent = isGoalReached
        ? `🎉 You've reached your daily goal of ${goal} glasses!`
        : `Keep it up — your body thanks you.`;

      successOverlay.classList.add("show");

      setTimeout(() => {
        successOverlay.classList.remove("show");
        drinkBtn.disabled = false;
        setTimeout(() => {
          try { window.close(); } catch (e) {}
        }, 300);
      }, isGoalReached ? 3000 : 2000);
    } else {
      drinkBtn.disabled = false;
    }
  });

  /* ── Skip handler ── */
  skipBtn.addEventListener("click", async () => {
    await sendMessage({ type: "skipWater" });
    try { window.close(); } catch (e) {}
  });

  /* ── Init ── */
  await loadState();
  await playWaterSound();
});