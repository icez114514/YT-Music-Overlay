const statusText = document.querySelector<HTMLElement>("#statusText");
const backButton = document.querySelector<HTMLButtonElement>("#backButton");
const forwardButton = document.querySelector<HTMLButtonElement>("#forwardButton");
const reloadButton = document.querySelector<HTMLButtonElement>("#reloadButton");
const overlayToggle = document.querySelector<HTMLInputElement>("#overlayToggle");

interface OverlaySettings {
  useChineseInterface: boolean;
}

const playerLabels = {
  en: {
    overlay: "Overlay",
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    toggleOverlay: "Toggle overlay"
  },
  zh: {
    overlay: "Overlay",
    back: "上一頁",
    forward: "下一頁",
    reload: "重新整理",
    toggleOverlay: "顯示 Overlay"
  }
} as const;

let useChineseInterface = false;

function applyPlayerLanguage(settings: Partial<OverlaySettings>): void {
  useChineseInterface = Boolean(settings.useChineseInterface);
  const dictionary = useChineseInterface ? playerLabels.zh : playerLabels.en;
  document.documentElement.lang = useChineseInterface ? "zh-Hant" : "en";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n as keyof typeof playerLabels.en | undefined;
    if (key && dictionary[key]) {
      element.textContent = dictionary[key];
    }
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((element) => {
    const key = element.dataset.i18nTitle as keyof typeof playerLabels.en | undefined;
    if (key && dictionary[key]) {
      element.title = dictionary[key];
    }
  });
}

function setStatus(message: string): void {
  if (statusText) {
    statusText.textContent = message;
  }
}

async function boot(): Promise<void> {
  const state = await window.playerApi.getState();
  applyPlayerLanguage(state.settings);
  const extensionStatus = await window.playerApi.getExtensionStatus();
  setStatus(extensionStatus);
  window.playerApi.onSettings(applyPlayerLanguage);
  window.playerApi.onStatus(setStatus);
}

backButton?.addEventListener("click", () => {
  window.playerApi.command("back");
});

forwardButton?.addEventListener("click", () => {
  window.playerApi.command("forward");
});

reloadButton?.addEventListener("click", () => window.playerApi.command("reload"));

overlayToggle?.addEventListener("change", () => {
  window.playerApi.command(overlayToggle.checked ? "show-overlay" : "hide-overlay");
});

boot();
