chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "playStretchSound") {
    try {
      const audio = new Audio(chrome.runtime.getURL("sounds/chime.mp3"));
      audio.volume = 0.9;

      audio.play()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          console.warn("Offscreen audio play failed:", error);
          sendResponse({ ok: false, error: String(error) });
        });

      return true;
    } catch (error) {
      console.warn("Offscreen audio error:", error);
      sendResponse({ ok: false, error: String(error) });
      return true;
    }
  }
});