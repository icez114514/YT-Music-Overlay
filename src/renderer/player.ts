const statusText = document.querySelector<HTMLElement>("#statusText");
const backButton = document.querySelector<HTMLButtonElement>("#backButton");
const forwardButton = document.querySelector<HTMLButtonElement>("#forwardButton");
const reloadButton = document.querySelector<HTMLButtonElement>("#reloadButton");
const overlayToggle = document.querySelector<HTMLInputElement>("#overlayToggle");
const debugExportButton = document.querySelector<HTMLButtonElement>("#debugExportButton");
const copyLyricsPromptButton = document.querySelector<HTMLButtonElement>("#copyLyricsPromptButton");
const lyricsPromptSettingsButton = document.querySelector<HTMLButtonElement>("#lyricsPromptSettingsButton");

interface OverlaySettings {
  useChineseInterface: boolean;
}

const playerLabels = {
  en: {
    overlay: "Overlay",
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    toggleOverlay: "Toggle overlay",
    exportDebug: "Export debug state",
    exportDebugDone: "Debug state exported",
    exportDebugFailed: "Debug export failed",
    copyLyricsPrompt: "Copy lyrics search prompt",
    copyLyricsPromptDone: "Lyrics search prompt copied",
    copyLyricsPromptFailed: "Unable to copy lyrics search prompt",
    lyricsPromptSettings: "Lyrics search settings"
  },
  zh: {
    overlay: "Overlay",
    back: "\u4e0a\u4e00\u9801",
    forward: "\u4e0b\u4e00\u9801",
    reload: "\u91cd\u65b0\u8f09\u5165",
    toggleOverlay: "\u5207\u63db Overlay",
    exportDebug: "\u532f\u51fa\u9664\u932f\u72c0\u614b",
    exportDebugDone: "\u5df2\u532f\u51fa\u9664\u932f\u72c0\u614b",
    exportDebugFailed: "\u532f\u51fa\u5931\u6557",
    copyLyricsPrompt: "\u8907\u88fd\u540c\u6b65\u6b4c\u8a5e\u641c\u5c0b Prompt",
    copyLyricsPromptDone: "\u5df2\u8907\u88fd\u540c\u6b65\u6b4c\u8a5e\u641c\u5c0b Prompt",
    copyLyricsPromptFailed: "\u7121\u6cd5\u8907\u88fd\u540c\u6b65\u6b4c\u8a5e\u641c\u5c0b Prompt",
    lyricsPromptSettings: "\u540c\u6b65\u6b4c\u8a5e\u641c\u5c0b\u8a2d\u5b9a"
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
  if (overlayToggle) {
    overlayToggle.checked = await window.playerApi.getOverlayVisibility();
  }
  const extensionStatus = await window.playerApi.getExtensionStatus();
  setStatus(extensionStatus);
  window.playerApi.onSettings(applyPlayerLanguage);
  window.playerApi.onStatus(setStatus);
  window.playerApi.onOverlayVisibility((visible) => {
    if (overlayToggle) {
      overlayToggle.checked = visible;
    }
  });
}

backButton?.addEventListener("click", () => {
  window.playerApi.command("back");
});

forwardButton?.addEventListener("click", () => {
  window.playerApi.command("forward");
});

reloadButton?.addEventListener("click", () => window.playerApi.command("reload"));

copyLyricsPromptButton?.addEventListener("click", async () => {
  copyLyricsPromptButton.disabled = true;
  const dictionary = useChineseInterface ? playerLabels.zh : playerLabels.en;
  try {
    const result = await window.playerApi.copyLyricsSearchPrompt();
    const message = result.ok ? dictionary.copyLyricsPromptDone : dictionary.copyLyricsPromptFailed;
    copyLyricsPromptButton.title = message;
    copyLyricsPromptButton.setAttribute("aria-label", message);
    copyLyricsPromptButton.classList.toggle("copied", result.ok);
    setStatus(result.ok && result.title ? `${message}: ${result.title}` : `${message}${result.error ? `: ${result.error}` : ""}`);
  } catch (error) {
    copyLyricsPromptButton.title = dictionary.copyLyricsPromptFailed;
    copyLyricsPromptButton.setAttribute("aria-label", dictionary.copyLyricsPromptFailed);
    setStatus(`${dictionary.copyLyricsPromptFailed}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    copyLyricsPromptButton.disabled = false;
    window.setTimeout(() => {
      const nextDictionary = useChineseInterface ? playerLabels.zh : playerLabels.en;
      copyLyricsPromptButton.classList.remove("copied");
      copyLyricsPromptButton.title = nextDictionary.copyLyricsPrompt;
      copyLyricsPromptButton.setAttribute("aria-label", nextDictionary.copyLyricsPrompt);
    }, 1800);
  }
});

lyricsPromptSettingsButton?.addEventListener("click", () => {
  const rect = lyricsPromptSettingsButton.getBoundingClientRect();
  window.playerApi.toggleLyricsSearchSettings({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  });
});

debugExportButton?.addEventListener("click", async () => {
  debugExportButton.disabled = true;
  debugExportButton.classList.add("exporting");
  try {
    const result = await window.playerApi.exportDebugState();
    const dictionary = useChineseInterface ? playerLabels.zh : playerLabels.en;
    debugExportButton.title = result.ok ? dictionary.exportDebugDone : dictionary.exportDebugFailed;
    debugExportButton.setAttribute("aria-label", debugExportButton.title);
    if (result.ok && result.path) {
      setStatus(`${dictionary.exportDebugDone}: ${result.path}`);
    } else if (result.error) {
      setStatus(`${dictionary.exportDebugFailed}: ${result.error}`);
    }
  } catch (error) {
    const dictionary = useChineseInterface ? playerLabels.zh : playerLabels.en;
    debugExportButton.title = dictionary.exportDebugFailed;
    debugExportButton.setAttribute("aria-label", dictionary.exportDebugFailed);
    setStatus(`${dictionary.exportDebugFailed}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    debugExportButton.classList.remove("exporting");
    debugExportButton.disabled = false;
    window.setTimeout(() => {
      const dictionary = useChineseInterface ? playerLabels.zh : playerLabels.en;
      debugExportButton.title = dictionary.exportDebug;
      debugExportButton.setAttribute("aria-label", dictionary.exportDebug);
    }, 1800);
  }
});

overlayToggle?.addEventListener("change", () => {
  window.playerApi.command(overlayToggle.checked ? "show-overlay" : "hide-overlay");
});

boot();
