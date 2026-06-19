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
  hideBackgroundUntilHover: false
};

let settings: OverlaySettings = { ...fallbackSettings };
let latestPayload: LyricsPayload | null = null;
let lastRenderedSignature = "";
let titleBarInteractive = false;

const root = document.documentElement;
const trackTitle = document.querySelector<HTMLElement>("#trackTitle");
const trackArtist = document.querySelector<HTMLElement>("#trackArtist");
const lyrics = document.querySelector<HTMLElement>("#lyrics");
const settingsToggle = document.querySelector<HTMLButtonElement>("#settingsToggle");
const compactToggle = document.querySelector<HTMLButtonElement>("#compactToggle");

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

  if (compactToggle) {
    compactToggle.classList.toggle("active", settings.compactMode);
    compactToggle.title = settings.compactMode ? "Exit compact mode" : "Compact mode";
  }

  window.overlayApi.setMouseEvents(settings.clickThrough && !titleBarInteractive);

  if (latestPayload) {
    renderLyrics(latestPayload, true);
  }
}

function visibleLineIndices(payload: LyricsPayload): number[] {
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

function renderSignature(payload: LyricsPayload): string {
  return JSON.stringify({
    status: payload.status,
    title: payload.title,
    artist: payload.artist,
    album: payload.album ?? "",
    message: payload.message,
    activeIndex: payload.activeIndex,
    compactMode: settings.compactMode,
    hideBackgroundUntilHover: settings.hideBackgroundUntilHover,
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
  if (!lyrics) {
    return;
  }

  lyrics.replaceChildren();
  lyrics.classList.toggle("static-list", payload.status === "static-lyrics");
  lyrics.classList.toggle("compact-list", settings.compactMode && payload.status !== "static-lyrics");

  if (payload.status !== "ready" && payload.status !== "static-lyrics") {
    lyrics.append(messageNode(payload.message || statusLabel(payload)));
    return;
  }

  if (payload.lines.length === 0) {
    lyrics.append(messageNode(payload.message || "No visible lyrics."));
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
    booting: "Waiting for YouTube Music",
    "not-youtube-music": "Not on YouTube Music",
    "not-playing": "Not playing",
    "lyrics-closed": "Open the Lyrics tab",
    "no-lyrics": "No visible lyrics",
    "static-lyrics": "Static lyrics",
    ready: "Synced"
  };
  return labels[payload.status] ?? "Synced";
}

function updateMousePassthrough(event: MouseEvent): void {
  const target = event.target;
  const overTitleBar = target instanceof Element && Boolean(target.closest(".drag-strip"));
  if (overTitleBar === titleBarInteractive) {
    return;
  }

  titleBarInteractive = overTitleBar;
  window.overlayApi.setMouseEvents(settings.clickThrough && !titleBarInteractive);
}

document.addEventListener("mousemove", updateMousePassthrough);
document.addEventListener("mouseleave", () => {
  titleBarInteractive = false;
  window.overlayApi.setMouseEvents(settings.clickThrough);
});

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

async function bootOverlay(): Promise<void> {
  const state = await window.overlayApi.getState();
  applySettings(state.settings);
  renderLyrics(await window.overlayApi.getLatestLyrics());
  window.overlayApi.onSettings(applySettings);
  window.overlayApi.onLyrics(renderLyrics);
}

bootOverlay().catch((error) => {
  console.error("Overlay boot failed", error);
  lyrics?.replaceChildren(messageNode("Overlay failed to start."));
});
