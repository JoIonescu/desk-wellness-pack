document.addEventListener("DOMContentLoaded", () => {
  const openPopupBtn = document.getElementById("openPopupBtn");

  if (openPopupBtn) {
    openPopupBtn.addEventListener("click", () => {
      const popupUrl = chrome.runtime.getURL("popup.html");

      // Mark welcome as seen and ensure water defaults are set
      chrome.storage.local.get(
        ["waterInterval", "waterGoal", "waterSoundEnabled", "waterEnabled"],
        (existing) => {
          const defaults = {};
          if (existing.waterInterval === undefined) defaults.waterInterval = 30;
          if (existing.waterGoal === undefined) defaults.waterGoal = 8;
          if (existing.waterSoundEnabled === undefined) defaults.waterSoundEnabled = true;
          if (existing.waterEnabled === undefined) defaults.waterEnabled = true;
          defaults.deskWellnessWelcomeSeen = true;

          chrome.storage.local.set(defaults, () => {
            try {
              const width = 460;
              const height = 820;
              const left = Math.max(0, Math.round((screen.availWidth - width) / 2));
              const top  = Math.max(0, Math.round((screen.availHeight - height) / 2));
              window.open(
                popupUrl,
                "DeskWellnessPopup",
                `width=${width},height=${height},left=${left},top=${top},resizable=no,scrollbars=yes`
              );
              window.close();
            } catch (e) {
              window.location.href = popupUrl;
            }
          });
        }
      );
    });
  }
});