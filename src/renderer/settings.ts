interface OverlaySettings {
  opacity: number;
  fontSize: number;
  width: number;
  backgroundBlur: number;
  textShadow: number;
  backgroundColor: string;
  textColor: string;
  inactiveTextColor: string;
  accentColor: string;
  borderColor: string;
  borderRadius: number;
  verticalPadding: number;
  horizontalPadding: number;
  lineGap: number;
  adjacentScale: number;
  locked: boolean;
  showAdjacentLines: boolean;
  compactMode: boolean;
  hideBackgroundUntilHover: boolean;
  useChineseInterface: boolean;
  lyricsSearchSites: string[];
}

const fallbackSettingsForPanel: OverlaySettings = {
  opacity: 0.82,
  fontSize: 34,
  width: 920,
  backgroundBlur: 0,
  textShadow: 80,
  backgroundColor: "#101010",
  textColor: "#fffaf3",
  inactiveTextColor: "#fffaf3",
  accentColor: "#ff2938",
  borderColor: "#ffffff",
  borderRadius: 8,
  verticalPadding: 18,
  horizontalPadding: 28,
  lineGap: 10,
  adjacentScale: 0.62,
  locked: false,
  showAdjacentLines: true,
  compactMode: false,
  hideBackgroundUntilHover: false,
  useChineseInterface: false,
  lyricsSearchSites: [
    "https://lrclib.net",
    "https://www.musixmatch.com",
    "https://genius.com"
  ]
};

let panelSettings: OverlaySettings = { ...fallbackSettingsForPanel };

const settingsRoot = document.documentElement;
const closeButton = document.querySelector<HTMLButtonElement>("#closeButton");
const opacityInput = document.querySelector<HTMLInputElement>("#opacityInput");
const fontSizeInput = document.querySelector<HTMLInputElement>("#fontSizeInput");
const blurInput = document.querySelector<HTMLInputElement>("#blurInput");
const shadowInput = document.querySelector<HTMLInputElement>("#shadowInput");
const textColorInput = document.querySelector<HTMLInputElement>("#textColorInput");
const inactiveTextColorInput = document.querySelector<HTMLInputElement>("#inactiveTextColorInput");
const backgroundColorInput = document.querySelector<HTMLInputElement>("#backgroundColorInput");
const accentColorInput = document.querySelector<HTMLInputElement>("#accentColorInput");
const borderColorInput = document.querySelector<HTMLInputElement>("#borderColorInput");
const radiusInput = document.querySelector<HTMLInputElement>("#radiusInput");
const verticalPaddingInput = document.querySelector<HTMLInputElement>("#verticalPaddingInput");
const horizontalPaddingInput = document.querySelector<HTMLInputElement>("#horizontalPaddingInput");
const lineGapInput = document.querySelector<HTMLInputElement>("#lineGapInput");
const adjacentScaleInput = document.querySelector<HTMLInputElement>("#adjacentScaleInput");
const adjacentInput = document.querySelector<HTMLInputElement>("#adjacentInput");
const lockedInput = document.querySelector<HTMLInputElement>("#lockedInput");
const hoverBackgroundInput = document.querySelector<HTMLInputElement>("#hoverBackgroundInput");
const chineseInterfaceInput = document.querySelector<HTMLInputElement>("#chineseInterfaceInput");

const translations = {
  en: {
    settingsTitle: "Overlay Settings",
    close: "Close",
    textColor: "Text color",
    inactiveTextColor: "Inactive text",
    backgroundColor: "Background",
    accentColor: "Accent",
    borderColor: "Border",
    opacity: "Opacity",
    fontSize: "Font size",
    adjacentScale: "Adjacent scale",
    blur: "Blur",
    shadow: "Shadow",
    radius: "Radius",
    lineGap: "Line gap",
    verticalPadding: "Vertical padding",
    horizontalPadding: "Horizontal padding",
    showAdjacent: "Show adjacent lines",
    lockSize: "Lock size",
    hoverBackground: "Show background on hover",
    chineseInterface: "中文介面"
  },
  zh: {
    settingsTitle: "Overlay 設定",
    close: "關閉",
    textColor: "文字顏色",
    inactiveTextColor: "非當前歌詞顏色",
    backgroundColor: "背景顏色",
    accentColor: "重點色",
    borderColor: "邊框顏色",
    opacity: "透明度",
    fontSize: "字體大小",
    adjacentScale: "上下句縮放",
    blur: "背景模糊",
    shadow: "文字陰影",
    radius: "圓角",
    lineGap: "歌詞間距",
    verticalPadding: "垂直內距",
    horizontalPadding: "水平內距",
    showAdjacent: "顯示上下句歌詞",
    lockSize: "鎖定大小",
    hoverBackground: "滑鼠移上時顯示背景",
    chineseInterface: "中文介面"
  }
} as const;

type TranslationKey = keyof typeof translations.en;

function applyLanguageToPanel(): void {
  const dictionary = panelSettings.useChineseInterface ? translations.zh : translations.en;
  document.documentElement.lang = panelSettings.useChineseInterface ? "zh-Hant" : "en";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n as TranslationKey | undefined;
    if (key && dictionary[key]) {
      element.textContent = dictionary[key];
    }
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((element) => {
    const key = element.dataset.i18nTitle as TranslationKey | undefined;
    if (key && dictionary[key]) {
      element.title = dictionary[key];
    }
  });
}

function hexToRgbTripletForPanel(hex: string): string {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallbackSettingsForPanel.backgroundColor;
  const value = Number.parseInt(normalized.slice(1), 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

function applySettingsToPanel(next: Partial<OverlaySettings>): void {
  panelSettings = { ...fallbackSettingsForPanel, ...next };
  settingsRoot.style.setProperty("--panel-opacity", String(Math.min(0.98, panelSettings.opacity + 0.12)));
  settingsRoot.style.setProperty("--background-color", hexToRgbTripletForPanel(panelSettings.backgroundColor));
  settingsRoot.style.setProperty("--text-color", panelSettings.textColor);
  settingsRoot.style.setProperty("--accent-color", panelSettings.accentColor);
  settingsRoot.style.setProperty("--border-color", panelSettings.borderColor);

  if (opacityInput) opacityInput.value = String(panelSettings.opacity);
  if (fontSizeInput) fontSizeInput.value = String(panelSettings.fontSize);
  if (blurInput) blurInput.value = String(panelSettings.backgroundBlur);
  if (shadowInput) shadowInput.value = String(panelSettings.textShadow);
  if (textColorInput) textColorInput.value = panelSettings.textColor;
  if (inactiveTextColorInput) inactiveTextColorInput.value = panelSettings.inactiveTextColor;
  if (backgroundColorInput) backgroundColorInput.value = panelSettings.backgroundColor;
  if (accentColorInput) accentColorInput.value = panelSettings.accentColor;
  if (borderColorInput) borderColorInput.value = panelSettings.borderColor;
  if (radiusInput) radiusInput.value = String(panelSettings.borderRadius);
  if (verticalPaddingInput) verticalPaddingInput.value = String(panelSettings.verticalPadding);
  if (horizontalPaddingInput) horizontalPaddingInput.value = String(panelSettings.horizontalPadding);
  if (lineGapInput) lineGapInput.value = String(panelSettings.lineGap);
  if (adjacentScaleInput) adjacentScaleInput.value = String(panelSettings.adjacentScale);
  if (adjacentInput) adjacentInput.checked = panelSettings.showAdjacentLines;
  if (lockedInput) lockedInput.checked = panelSettings.locked;
  if (hoverBackgroundInput) hoverBackgroundInput.checked = panelSettings.hideBackgroundUntilHover;
  if (chineseInterfaceInput) chineseInterfaceInput.checked = panelSettings.useChineseInterface;
  applyLanguageToPanel();
}

function pushPanelSettings(): void {
  const next: OverlaySettings = {
    ...panelSettings,
    opacity: Number(opacityInput?.value ?? panelSettings.opacity),
    fontSize: Number(fontSizeInput?.value ?? panelSettings.fontSize),
    backgroundBlur: Number(blurInput?.value ?? panelSettings.backgroundBlur),
    textShadow: Number(shadowInput?.value ?? panelSettings.textShadow),
    backgroundColor: backgroundColorInput?.value ?? panelSettings.backgroundColor,
    textColor: textColorInput?.value ?? panelSettings.textColor,
    inactiveTextColor: inactiveTextColorInput?.value ?? panelSettings.inactiveTextColor,
    accentColor: accentColorInput?.value ?? panelSettings.accentColor,
    borderColor: borderColorInput?.value ?? panelSettings.borderColor,
    borderRadius: Number(radiusInput?.value ?? panelSettings.borderRadius),
    verticalPadding: Number(verticalPaddingInput?.value ?? panelSettings.verticalPadding),
    horizontalPadding: Number(horizontalPaddingInput?.value ?? panelSettings.horizontalPadding),
    lineGap: Number(lineGapInput?.value ?? panelSettings.lineGap),
    adjacentScale: Number(adjacentScaleInput?.value ?? panelSettings.adjacentScale),
    showAdjacentLines: Boolean(adjacentInput?.checked),
    locked: Boolean(lockedInput?.checked),
    hideBackgroundUntilHover: Boolean(hoverBackgroundInput?.checked),
    useChineseInterface: Boolean(chineseInterfaceInput?.checked)
  };

  applySettingsToPanel(next);
  window.overlayApi.updateSettings(next);
}

for (const input of [
  opacityInput,
  fontSizeInput,
  blurInput,
  shadowInput,
  textColorInput,
  inactiveTextColorInput,
  backgroundColorInput,
  accentColorInput,
  borderColorInput,
  radiusInput,
  verticalPaddingInput,
  horizontalPaddingInput,
  lineGapInput,
  adjacentScaleInput,
  adjacentInput,
  lockedInput,
  hoverBackgroundInput,
  chineseInterfaceInput
]) {
  input?.addEventListener("input", pushPanelSettings);
  input?.addEventListener("change", pushPanelSettings);
}

closeButton?.addEventListener("click", () => window.overlayApi.closeSettingsPanel());

async function bootSettingsPanel(): Promise<void> {
  const state = await window.overlayApi.getState();
  applySettingsToPanel(state.settings);
  window.overlayApi.onSettings(applySettingsToPanel);
}

bootSettingsPanel().catch((error) => console.error("Settings panel boot failed", error));
