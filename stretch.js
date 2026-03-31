document.addEventListener("DOMContentLoaded", async () => {

  // -----------------------------
  // DOM
  // -----------------------------
  const stretchScreen   = document.getElementById("stretchScreen");
  const successScreen   = document.getElementById("successScreen");
  const stretchTop      = document.getElementById("stretchTop");
  const stretchContent  = document.getElementById("stretchContent");
  const stretchActions  = document.getElementById("stretchActions");
  const titleEl         = document.getElementById("sessionTitle");
  const subtitleEl      = document.getElementById("sessionSubtitle");
  const exerciseNameEl  = document.getElementById("exerciseName");
  const stretchTextEl   = document.getElementById("exerciseInstruction");
  const stretchIconEl   = document.getElementById("exerciseIcon");
  const timerEl         = document.getElementById("timeRemaining");
  const progressCircle  = document.getElementById("ringProgress");
  const snoozeBtn       = document.getElementById("snoozeBtn");
  const skipBtn         = document.getElementById("skipBtn");
  const confettiCanvas  = document.getElementById("confettiCanvas");

  // -----------------------------
  // CONFIG
  // -----------------------------
  const SUCCESS_AUTO_CLOSE_MS = 4500;

  const SESSION_CONFIG = {
    quick_reset: {
      durationSeconds: 30,
      title: "Quick Reset",
      subtitle: "A short guided stretch to reset your posture and energy.",
      exerciseName: "Shoulder Reset",
      icon: "🫶",
      instructions: [
        "🌬 Take a deep breath and relax your shoulders.",
        "✋ Shake out your hands and wrists.",
        "🧘 Roll your shoulders slowly.",
        "👀 Look away from the screen and relax your eyes.",
        "🤲 Interlace your fingers and stretch your arms forward.",
        "😮‍💨 Exhale slowly and drop your jaw to release tension.",
        "👁️ Blink slowly 10 times to reset your eyes.",
        "🫁 Breathe in for 4 counts, hold for 4, out for 4."
      ]
    },
    gentle_stretch: {
      durationSeconds: 45,
      title: "Gentle Stretch",
      subtitle: "A calming break to loosen tension and restore focus.",
      exerciseName: "Gentle Flow",
      icon: "🧘",
      instructions: [
        "🧠 Stretch your neck gently left and right.",
        "🌬 Take a deep breath and relax your shoulders.",
        "✋ Shake out your hands and wrists.",
        "👀 Look away from the screen and relax your eyes.",
        "🫶 Gently squeeze your shoulder blades together and release.",
        "🤸 Slowly tilt your head toward each shoulder and hold.",
        "💆 Massage the back of your neck with your fingertips.",
        "🖐️ Spread your fingers wide, hold for 5 seconds, then relax."
      ]
    },
    standard_stretch: {
      durationSeconds: 60,
      title: "Time to Stretch!",
      subtitle: "A short guided stretch to reset your posture and energy.",
      exerciseName: "Desk Reset",
      icon: "🙆",
      instructions: [
        "🙆 Stand up and reach your arms overhead.",
        "💪 Stretch your back and open your chest.",
        "🧠 Stretch your neck gently left and right.",
        "🚶 Walk around the room for a moment.",
        "🔄 Roll your ankles in slow circles, both directions.",
        "🧍 Stand tall, feet hip-width apart, and breathe deeply.",
        "🤾 Reach one arm across your chest and hold for 10 seconds each side.",
        "🦵 Stand on one foot for 10 seconds, then switch."
      ]
    },
    full_reset: {
      durationSeconds: 90,
      title: "Full Reset",
      subtitle: "A longer reset to fully release upper-body tension.",
      exerciseName: "Full Body Reset",
      icon: "💪",
      instructions: [
        "💪 Stretch your back and open your chest.",
        "🚶 Walk around the room for a moment.",
        "🙆 Stand up and reach your arms overhead.",
        "🧘 Roll your shoulders slowly.",
        "🧎 Do 5 slow squats to wake up your legs.",
        "🔁 Rotate your torso gently left and right while seated.",
        "🫸 Place both hands on your lower back and lean gently backward.",
        "🦾 Clasp your hands behind your back and open your chest wide."
      ]
    }
  };

  // -----------------------------
  // STATE
  // -----------------------------
  let countdownInterval = null;
  let remainingSeconds  = 60;
  let totalDuration     = 60;
  let soundEnabled      = true;

  const radius        = 52;
  const circumference = 2 * Math.PI * radius;

  if (progressCircle) {
    progressCircle.style.strokeDasharray  = `${circumference}`;
    progressCircle.style.strokeDashoffset = `0`;
  }

  // -----------------------------
  // HELPERS
  // -----------------------------
  function getRandomItem(items, sessionType) {
    if (!Array.isArray(items) || !items.length) return "";
    if (items.length === 1) return items[0];
    const storageKey = `lastInstruction_${sessionType}`;
    const last       = sessionStorage.getItem(storageKey);
    const candidates = items.filter(item => item !== last);
    const pool       = candidates.length > 0 ? candidates : items;
    const chosen     = pool[Math.floor(Math.random() * pool.length)];
    sessionStorage.setItem(storageKey, chosen);
    return chosen;
  }

  function formatSeconds(seconds) { return `${Math.max(0, seconds)}`; }

  function showStretchScreen() {
    if (stretchTop)     stretchTop.style.display     = "";
    if (stretchContent) stretchContent.style.display = "";
    if (stretchActions) stretchActions.style.display = "flex";
    successScreen.classList.remove("show");
  }

  function showSuccessScreenUI() {
    if (stretchTop)     stretchTop.style.display     = "none";
    if (stretchContent) stretchContent.style.display = "none";
    if (stretchActions) stretchActions.style.display = "none";
    successScreen.classList.add("show");
  }

  function safeCloseWindow(delay = 0) {
    setTimeout(() => {
      try { window.close(); } catch (e) { console.warn("Could not close window:", e); }
    }, delay);
  }

  function stopCountdown() {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  }

  function updateProgressCircle() {
    if (!progressCircle || totalDuration <= 0) return;
    const progressRatio = remainingSeconds / totalDuration;
    const offset = circumference * (1 - progressRatio);
    progressCircle.style.strokeDasharray  = `${circumference}`;
    progressCircle.style.strokeDashoffset = `${offset}`;
  }

  function updateTimerUI() {
    if (timerEl) timerEl.textContent = formatSeconds(remainingSeconds);
    updateProgressCircle();
  }

  async function getStorageLocal(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  async function sendMessage(message) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          console.warn("stretch.js message error:", chrome.runtime.lastError.message);
          resolve({ ok: false });
          return;
        }
        resolve(response || { ok: false });
      });
    });
  }

  async function loadSessionType() {
    const localData = await getStorageLocal(["currentStretchSessionType"]);
    if (localData.currentStretchSessionType && SESSION_CONFIG[localData.currentStretchSessionType]) {
      return localData.currentStretchSessionType;
    }
    return "standard_stretch";
  }

  async function loadSoundPreference() {
    const localData = await getStorageLocal(["soundEnabled"]);
    if (typeof localData.soundEnabled === "boolean") return localData.soundEnabled;
    return true;
  }

  async function playStartSoundIfEnabled() {
    if (!soundEnabled) return;
    const possiblePaths = [
      "stretch-chime.mp3",
      "stretch-chime.wav",
      "assets/stretch-chime.mp3",
      "assets/stretch-chime.wav",
      "assets/notification.mp3",
      "assets/notification.wav",
      "chime.mp3"
    ];
    setTimeout(async () => {
      for (const path of possiblePaths) {
        try {
          const audio = new Audio(chrome.runtime.getURL(path));
          audio.volume = 0.9;
          await audio.play();
          return;
        } catch (e) { /* try next path */ }
      }
      console.warn("Stretch sound could not be played. Check audio file path in manifest and assets.");
    }, 1000);
  }

  function applySessionUI(sessionType) {
    const config = SESSION_CONFIG[sessionType] || SESSION_CONFIG.standard_stretch;
    totalDuration    = config.durationSeconds;
    remainingSeconds = config.durationSeconds;
    if (titleEl)        titleEl.textContent        = config.title;
    if (subtitleEl)     subtitleEl.textContent     = config.subtitle;
    if (exerciseNameEl) exerciseNameEl.textContent = config.exerciseName;
    if (stretchTextEl)  stretchTextEl.textContent  = getRandomItem(config.instructions, sessionType);
    if (stretchIconEl)  stretchIconEl.textContent  = config.icon || "🙆";
    updateTimerUI();
  }

  function startCountdown() {
    stopCountdown();
    countdownInterval = setInterval(async () => {
      remainingSeconds -= 1;
      updateTimerUI();
      if (remainingSeconds <= 0) {
        stopCountdown();
        remainingSeconds = 0;
        updateTimerUI();
        await handleStretchComplete();
      }
    }, 1000);
  }

  async function handleStretchComplete() {
    showSuccessScreenUI();
    await sendMessage({ type: "stretchCompleted" });
    setTimeout(() => { launchCelebration(); }, 120);
    safeCloseWindow(SUCCESS_AUTO_CLOSE_MS);
  }

  function launchCelebration() {
    if (typeof confetti === "function") {
      const duration     = 1800;
      const animationEnd = Date.now() + duration;
      const defaults     = { startVelocity: 28, spread: 360, ticks: 80, zIndex: 9999 };
      const interval = setInterval(() => {
        const timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) { clearInterval(interval); return; }
        const particleCount = 22;
        confetti({ ...defaults, particleCount, origin: { x: Math.random() * 0.3 + 0.1, y: Math.random() * 0.8 + 0.1 } });
        confetti({ ...defaults, particleCount, origin: { x: Math.random() * 0.3 + 0.6, y: Math.random() * 0.8 + 0.1 } });
        confetti({ ...defaults, particleCount: 16, origin: { x: 0.5, y: 0.2 } });
      }, 220);
      return;
    }
    launchCanvasConfettiFallback();
  }

  function launchCanvasConfettiFallback() {
    if (!confettiCanvas) return;
    const ctx  = confettiCanvas.getContext("2d");
    if (!ctx) return;
    const rect = confettiCanvas.getBoundingClientRect();
    confettiCanvas.width  = Math.max(300, Math.floor(rect.width));
    confettiCanvas.height = Math.max(140, Math.floor(rect.height));
    const pieces = Array.from({ length: 70 }).map(() => ({
      x:     Math.random() * confettiCanvas.width,
      y:     Math.random() * (confettiCanvas.height * 0.35),
      w:     6 + Math.random() * 6,
      h:     8 + Math.random() * 8,
      vx:   -1.8 + Math.random() * 3.6,
      vy:    1.8 + Math.random() * 3.8,
      rot:   Math.random() * Math.PI,
      vr:   -0.18 + Math.random() * 0.36,
      color: ["#FFD400","#FF7A00","#60A5FA","#34D399","#F472B6"][Math.floor(Math.random() * 5)]
    }));
    let frames = 0;
    function draw() {
      ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      for (const p of pieces) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      frames++;
      if (frames < 120) { requestAnimationFrame(draw); }
      else { ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height); }
    }
    draw();
  }

  // -----------------------------
  // BUTTONS
  // -----------------------------
  snoozeBtn?.addEventListener("click", async () => {
    stopCountdown();
    await sendMessage({ type: "snoozeTimer" });
    safeCloseWindow(150);
  });

  skipBtn?.addEventListener("click", async () => {
    stopCountdown();
    await sendMessage({ type: "stretchSkipped" }); // FIX: was "skipStretch" — no handler existed for that in background.js
    safeCloseWindow(150);
  });

  // -----------------------------
  // INIT
  // -----------------------------
  showStretchScreen();
  soundEnabled = await loadSoundPreference();
  const sessionType = await loadSessionType();
  applySessionUI(sessionType);
  await playStartSoundIfEnabled();
  startCountdown();
});