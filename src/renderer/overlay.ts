type LyricsStatus =
  | "booting"
  | "ready"
  | "not-youtube-music"
  | "not-playing"
  | "lyrics-closed"
  | "no-lyrics"
  | "static-lyrics";

interface LyricLine {
  text: string;
  active: boolean;
}

interface LyricsPayload {
  status: LyricsStatus;
  title: string;
  artist: string;
  album?: string;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  lines: LyricLine[];
  activeIndex: number;
  message: string;
  updatedAt: number;
}

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
  clickThrough: boolean;
  locked: boolean;
  showAdjacentLines: boolean;
  compactMode: boolean;
  hideBackgroundUntilHover: boolean;
  useChineseInterface: boolean;
}

const fallbackSettings: OverlaySettings = {
  opacity: 0.82,
  fontSize: 34,
  width: 920,
  backgroundBlur: 18,
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
  clickThrough: false,
  locked: false,
  showAdjacentLines: true,
  compactMode: false,
  hideBackgroundUntilHover: false,
  useChineseInterface: false
};

let settings: OverlaySettings = { ...fallbackSettings };
let latestPayload: LyricsPayload | null = null;
let lastRenderedSignature = "";
let titleBarInteractive = false;
let volumeSyncHoldUntil = 0;
let volumeEditing = false;

const root = document.documentElement;
const trackTitle = document.querySelector<HTMLElement>("#trackTitle");
const trackArtist = document.querySelector<HTMLElement>("#trackArtist");
const lyrics = document.querySelector<HTMLElement>("#lyrics");
const settingsToggle = document.querySelector<HTMLButtonElement>("#settingsToggle");
const compactToggle = document.querySelector<HTMLButtonElement>("#compactToggle");
const previousButton = document.querySelector<HTMLButtonElement>("#previousButton");
const playPauseButton = document.querySelector<HTMLButtonElement>("#playPauseButton");
const nextButton = document.querySelector<HTMLButtonElement>("#nextButton");
const volumeInput = document.querySelector<HTMLInputElement>("#volumeInput");
const volumeControl = document.querySelector<HTMLElement>("#volumeControl");
const volumeIcon = document.querySelector<HTMLElement>("#volumeIcon");
const dragStrip = document.querySelector<HTMLElement>(".drag-strip");
const controls = document.querySelector<HTMLElement>(".controls");
let lastAudibleVolume = Number(volumeInput?.value ?? 80);

const overlayLabels = {
  en: {
    waiting: "Waiting for YouTube Music",
    notYoutubeMusic: "Not on YouTube Music",
    notPlaying: "Not playing",
    lyricsClosed: "Open the Lyrics tab",
    noLyrics: "No visible lyrics",
    staticLyrics: "Static lyrics",
    synced: "Synced",
    noVisibleLyrics: "No visible lyrics.",
    failedStart: "Overlay failed to start.",
    compact: "Compact mode",
    exitCompact: "Exit compact mode",
    settings: "Settings",
    previous: "Previous track",
    playPause: "Play / Pause",
    next: "Next track",
    volume: "Volume"
  },
  zh: {
    waiting: "等待 YouTube Music",
    notYoutubeMusic: "目前不是 YouTube Music",
    notPlaying: "尚未播放",
    lyricsClosed: "請開啟歌詞分頁",
    noLyrics: "沒有可見歌詞",
    staticLyrics: "靜態歌詞",
    synced: "同步中",
    noVisibleLyrics: "沒有可見歌詞。",
    failedStart: "Overlay 啟動失敗。",
    compact: "精簡模式",
    exitCompact: "離開精簡模式",
    settings: "設定",
    previous: "上一首",
    playPause: "播放 / 暫停",
    next: "下一首",
    volume: "音量"
  }
} as const;

function label(key: keyof typeof overlayLabels.en): string {
  return (settings.useChineseInterface ? overlayLabels.zh : overlayLabels.en)[key];
}

function setButtonLabel(button: HTMLButtonElement | null, text: string): void {
  if (!button) return;
  button.title = text;
  button.setAttribute("aria-label", text);
}

function hexToRgbTriplet(hex: string): string {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallbackSettings.backgroundColor;
  const value = Number.parseInt(normalized.slice(1), 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

function applySettings(next: Partial<OverlaySettings>): void {
  settings = { ...fallbackSettings, ...next };
  root.style.setProperty("--panel-opacity", String(settings.opacity));
  root.style.setProperty("--font-size", `${settings.fontSize}px`);
  root.style.setProperty("--adjacent-scale", String(settings.adjacentScale));
  root.style.setProperty("--blur", `${settings.backgroundBlur}px`);
  root.style.setProperty("--shadow", String(settings.textShadow));
  root.style.setProperty("--background-color", hexToRgbTriplet(settings.backgroundColor));
  root.style.setProperty("--text-color", settings.textColor);
  root.style.setProperty("--inactive-text-color", settings.inactiveTextColor);
  root.style.setProperty("--accent-color", settings.accentColor);
  root.style.setProperty("--border-color", settings.borderColor);
  root.style.setProperty("--radius", `${settings.borderRadius}px`);
  root.style.setProperty("--vertical-padding", `${settings.verticalPadding}px`);
  root.style.setProperty("--horizontal-padding", `${settings.horizontalPadding}px`);
  root.style.setProperty("--line-gap", `${settings.lineGap}px`);
  root.classList.toggle("compact-mode", settings.compactMode);
  root.classList.toggle("hover-background", settings.hideBackgroundUntilHover);
  root.classList.toggle("fully-transparent", settings.opacity <= 0);

  if (compactToggle) {
    compactToggle.classList.toggle("active", settings.compactMode);
    setButtonLabel(compactToggle, settings.compactMode ? label("exitCompact") : label("compact"));
  }
  setButtonLabel(settingsToggle, label("settings"));
  setButtonLabel(previousButton, label("previous"));
  setButtonLabel(playPauseButton, label("playPause"));
  setButtonLabel(nextButton, label("next"));
  document.querySelector<HTMLElement>(".volume-control")?.setAttribute("title", label("volume"));

  window.overlayApi.setMouseEvents(settings.clickThrough && !titleBarInteractive);

  if (latestPayload) {
    renderLyrics(latestPayload, true);
  }
}

function visibleLineIndices(payload: LyricsPayload): number[] {
  if (isInstrumentalPayload(payload)) {
    return [0];
  }

  if (payload.status === "static-lyrics") {
    return payload.lines.map((_line, index) => index);
  }

  const activeIndex = payload.activeIndex >= 0 ? payload.activeIndex : 0;
  if (settings.compactMode) {
    return [activeIndex];
  }

  return settings.showAdjacentLines
    ? [activeIndex - 1, activeIndex, activeIndex + 1]
    : [activeIndex];
}

function isInstrumentalPayload(payload: LyricsPayload): boolean {
  return payload.lines.length === 1 && /^[♪♫♬]+$/.test(payload.lines[0]?.text.trim() ?? "");
}

function renderSignature(payload: LyricsPayload): string {
  return JSON.stringify({
    status: payload.status,
    title: payload.title,
    artist: payload.artist,
    album: payload.album ?? "",
    message: payload.message,
    isPlaying: payload.isPlaying,
    volume: payload.volume,
    muted: payload.muted,
    activeIndex: payload.activeIndex,
    compactMode: settings.compactMode,
    hideBackgroundUntilHover: settings.hideBackgroundUntilHover,
    useChineseInterface: settings.useChineseInterface,
    lines: visibleLineIndices(payload).map((index) => payload.lines[index]?.text ?? "")
  });
}

function trackDetail(payload: LyricsPayload): string {
  const parts = [payload.artist, payload.album].map((part) => (part ?? "").trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(" • ") : statusLabel(payload);
}

function renderLyrics(payload: LyricsPayload, force = false): void {
  latestPayload = payload;
  const signature = renderSignature(payload);
  if (!force && signature === lastRenderedSignature) {
    return;
  }
  lastRenderedSignature = signature;

  if (trackTitle) {
    trackTitle.textContent = payload.title || "YT Music Overlay";
  }
  if (trackArtist) {
    trackArtist.textContent = trackDetail(payload);
  }
  playPauseButton?.classList.toggle("is-playing", payload.isPlaying);
  syncVolumeUi(payload);
  if (!lyrics) {
    return;
  }

  lyrics.replaceChildren();
  const instrumental = isInstrumentalPayload(payload);
  lyrics.classList.toggle("static-list", payload.status === "static-lyrics" && !instrumental);
  lyrics.classList.toggle("instrumental-list", instrumental);
  lyrics.classList.toggle("compact-list", settings.compactMode && payload.status !== "static-lyrics");

  if (payload.status !== "ready" && payload.status !== "static-lyrics") {
    lyrics.append(messageNode(settings.useChineseInterface ? statusLabel(payload) : payload.message || statusLabel(payload)));
    return;
  }

  if (payload.lines.length === 0) {
    lyrics.append(messageNode(settings.useChineseInterface ? label("noVisibleLyrics") : payload.message || label("noVisibleLyrics")));
    return;
  }

  const activeIndex = payload.activeIndex >= 0 ? payload.activeIndex : 0;
  for (const index of visibleLineIndices(payload)) {
    const line = payload.lines[index];
    if (!line) {
      continue;
    }

    const element = document.createElement("p");
    element.className = `line ${index === activeIndex ? "active" : index < activeIndex ? "previous" : "next"}`;
    element.textContent = line.text;
    lyrics.append(element);
  }
}

function messageNode(message: string): HTMLParagraphElement {
  const node = document.createElement("p");
  node.className = "message";
  node.textContent = message;
  return node;
}

function statusLabel(payload: LyricsPayload): string {
  const labels: Record<LyricsStatus, string> = {
    booting: label("waiting"),
    "not-youtube-music": label("notYoutubeMusic"),
    "not-playing": label("notPlaying"),
    "lyrics-closed": label("lyricsClosed"),
    "no-lyrics": label("noLyrics"),
    "static-lyrics": label("staticLyrics"),
    ready: label("synced")
  };
  return labels[payload.status] ?? label("synced");
}

function updateMousePassthrough(event: MouseEvent): void {
  const target = event.target;
  const overControls = target instanceof Element && Boolean(target.closest(".controls"));
  if (overControls === titleBarInteractive) {
    return;
  }

  titleBarInteractive = overControls;
  window.overlayApi.setMouseEvents(settings.clickThrough && !titleBarInteractive);
}

document.addEventListener("mousemove", updateMousePassthrough);
document.addEventListener("mouseleave", () => {
  titleBarInteractive = false;
  window.overlayApi.setMouseEvents(settings.clickThrough);
});

function syncVolumeUi(payload: LyricsPayload): void {
  if (!volumeInput || volumeEditing || Date.now() < volumeSyncHoldUntil) {
    return;
  }

  const volumePercent = Math.round(Math.max(0, Math.min(1, payload.volume ?? 0.8)) * 100);
  const muted = Boolean(payload.muted || volumePercent <= 0);
  volumeInput.value = String(muted ? 0 : volumePercent);
  volumeControl?.classList.toggle("is-muted", muted);
  if (!muted && volumePercent > 0) {
    lastAudibleVolume = volumePercent;
  }
}

settingsToggle?.addEventListener("click", () => {
  const rect = settingsToggle.getBoundingClientRect();
  window.overlayApi.toggleSettingsPanel({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  });
});

compactToggle?.addEventListener("click", () => {
  window.overlayApi.updateSettings({
    ...settings,
    compactMode: !settings.compactMode
  });
});

previousButton?.addEventListener("click", () => window.overlayApi.musicCommand("previous"));
playPauseButton?.addEventListener("click", () => window.overlayApi.musicCommand("play-pause"));
nextButton?.addEventListener("click", () => window.overlayApi.musicCommand("next"));

volumeInput?.addEventListener("input", () => {
  const nextVolume = Number(volumeInput.value);
  if (nextVolume > 0) {
    lastAudibleVolume = nextVolume;
  }
  volumeControl?.classList.toggle("is-muted", nextVolume === 0);
  volumeSyncHoldUntil = Date.now() + 700;
  window.overlayApi.musicCommand("volume", nextVolume / 100);
});

volumeInput?.addEventListener("pointerdown", () => {
  volumeEditing = true;
});

volumeInput?.addEventListener("pointerup", () => {
  volumeEditing = false;
  volumeSyncHoldUntil = Date.now() + 500;
});

volumeInput?.addEventListener("change", () => {
  volumeEditing = false;
  volumeSyncHoldUntil = Date.now() + 500;
});

volumeIcon?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!volumeInput) {
    return;
  }

  const currentlyMuted = Number(volumeInput.value) === 0;
  const nextVolume = currentlyMuted ? Math.max(1, lastAudibleVolume) : 0;
  if (!currentlyMuted && Number(volumeInput.value) > 0) {
    lastAudibleVolume = Number(volumeInput.value);
  }
  volumeInput.value = String(nextVolume);
  volumeControl?.classList.toggle("is-muted", nextVolume === 0);
  volumeSyncHoldUntil = Date.now() + 700;
  window.overlayApi.musicCommand("volume", nextVolume / 100);
});

volumeControl?.addEventListener("mouseleave", () => {
  volumeInput?.blur();
});

controls?.addEventListener("mouseleave", () => {
  const active = document.activeElement;
  if (active instanceof HTMLElement && controls.contains(active)) {
    active.blur();
  }
});

for (const element of [dragStrip, controls]) {
  element?.addEventListener("mouseenter", () => root.classList.add("toolbar-hover"));
  element?.addEventListener("mouseleave", () => root.classList.remove("toolbar-hover"));
}

async function bootOverlay(): Promise<void> {
  const state = await window.overlayApi.getState();
  applySettings(state.settings);
  renderLyrics(await window.overlayApi.getLatestLyrics());
  window.overlayApi.onSettings(applySettings);
  window.overlayApi.onLyrics(renderLyrics);
}

bootOverlay().catch((error) => {
  console.error("Overlay boot failed", error);
  lyrics?.replaceChildren(messageNode(label("failedStart")));
});
