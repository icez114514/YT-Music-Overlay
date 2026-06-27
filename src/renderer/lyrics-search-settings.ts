const lyricsSearchSettingsForm = document.querySelector<HTMLFormElement>("#lyricsSearchSettingsForm");
const sitesInput = document.querySelector<HTMLTextAreaElement>("#sitesInput");
const siteCount = document.querySelector<HTMLElement>("#siteCount");
const lyricsSearchCloseButton = document.querySelector<HTMLButtonElement>("#closeButton");
const cancelButton = document.querySelector<HTMLButtonElement>("#cancelButton");
const saveButton = document.querySelector<HTMLButtonElement>("#saveButton");

const lyricsSearchSettingsLabels = {
  en: {
    title: "Lyrics search sites",
    description: "Add one website per line. These sites will be included in the Codex prompt.",
    close: "Close",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving...",
    site: "site",
    sites: "sites"
  },
  zh: {
    title: "\u540c\u6b65\u6b4c\u8a5e\u641c\u5c0b\u7db2\u7ad9",
    description: "\u6bcf\u884c\u8f38\u5165\u4e00\u500b\u7db2\u7ad9\uff0c\u9019\u4e9b\u7db2\u7ad9\u6703\u81ea\u52d5\u52a0\u5165 Codex Prompt\u3002",
    close: "\u95dc\u9589",
    cancel: "\u53d6\u6d88",
    save: "\u5132\u5b58",
    saving: "\u5132\u5b58\u4e2d...",
    site: "\u500b\u7db2\u7ad9",
    sites: "\u500b\u7db2\u7ad9"
  }
} as const;

let useChineseInterfaceForLyricsSearch = false;

function readSites(): string[] {
  const sites = (sitesInput?.value ?? "")
    .split(/\r?\n/)
    .map((site) => site.trim())
    .filter(Boolean);
  return [...new Set(sites)];
}

function currentDictionary() {
  return useChineseInterfaceForLyricsSearch ? lyricsSearchSettingsLabels.zh : lyricsSearchSettingsLabels.en;
}

function updateSiteCount(): void {
  if (!siteCount) {
    return;
  }
  const count = readSites().length;
  const dictionary = currentDictionary();
  siteCount.textContent = `${count} ${count === 1 ? dictionary.site : dictionary.sites}`;
}

function applyLanguage(): void {
  const dictionary = currentDictionary();
  document.documentElement.lang = useChineseInterfaceForLyricsSearch ? "zh-Hant" : "en";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n as keyof typeof lyricsSearchSettingsLabels.en | undefined;
    if (key && dictionary[key]) {
      element.textContent = dictionary[key];
    }
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((element) => {
    const key = element.dataset.i18nTitle as keyof typeof lyricsSearchSettingsLabels.en | undefined;
    if (key && dictionary[key]) {
      element.title = dictionary[key];
    }
  });
  updateSiteCount();
}

function closeWindow(): void {
  window.playerApi.closeLyricsSearchSettings();
}

sitesInput?.addEventListener("input", updateSiteCount);
lyricsSearchCloseButton?.addEventListener("click", closeWindow);
cancelButton?.addEventListener("click", closeWindow);

lyricsSearchSettingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!saveButton) {
    return;
  }
  saveButton.disabled = true;
  saveButton.textContent = currentDictionary().saving;
  try {
    await window.playerApi.updateLyricsSearchSites(readSites());
    closeWindow();
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = currentDictionary().save;
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeWindow();
  }
});

async function bootLyricsSearchSettings(): Promise<void> {
  const persistedState = await window.playerApi.getState();
  useChineseInterfaceForLyricsSearch = Boolean(persistedState.settings.useChineseInterface);
  if (sitesInput) {
    sitesInput.value = persistedState.settings.lyricsSearchSites.join("\n");
  }
  applyLanguage();
  sitesInput?.focus();
}

bootLyricsSearchSettings().catch((error) => console.error("Lyrics search settings boot failed", error));
