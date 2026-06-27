import { ipcRenderer } from "electron";
import { LyricsPayload, LyricLine, LyricsStatus, PlayerState } from "../shared/types";

const ACTIVE_LINE_HINTS = [
  "selected",
  "active",
  "current",
  "highlight",
  "playing",
  "focused"
];

let lastSignature = "";
let lastPlayerStateSignature = "";
let lastTrackKey = "";
let trackSettlingUntil = 0;
let trackLoadingUntil = 0;
let publishTimer: number | null = null;
let playerStateTimer: number | null = null;

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isInstrumentalText(text: string): boolean {
  return /^(?:[\u266a\u266b\u266c]+|instrumental|\u9593\u594f|\u7eaf\u97f3\u4e50|\u7d14\u97f3\u6a02)$/i.test(text.trim());
}

function isInstrumentalElement(_element: Element, text: string): boolean {
  return isInstrumentalText(cleanText(text));
}

function hasEmptyInstrumentalClass(element: Element, text: string): boolean {
  if (cleanText(text)) {
    return false;
  }

  return Array.from(element.classList).some((className) => {
    const normalized = className.toLowerCase();
    return normalized.includes("instrumental") && !normalized.includes("non-instrumental");
  });
}

function readBetterLyricsTime(element: Element): number | undefined {
  const timedElement = element.hasAttribute("data-time")
    ? element
    : element.querySelector("[data-time]");
  const rawValue = timedElement?.getAttribute("data-time");
  if (!rawValue) {
    return undefined;
  }

  const value = Number(rawValue);
  return Number.isFinite(value) ? value : undefined;
}

function currentMediaTime(): number {
  const media = document.querySelector<HTMLMediaElement>("video, audio");
  return media && Number.isFinite(media.currentTime) ? media.currentTime : 0;
}

function isBeforeFirstTimedLine(lines: LyricLine[]): boolean {
  const firstTime = lines
    .map((line) => line.time)
    .filter((time): time is number => typeof time === "number")
    .sort((left, right) => left - right)[0];

  return typeof firstTime === "number" && currentMediaTime() + 0.05 < firstTime;
}

function extractBetterLyricsText(element: Element): string {
  const wordNodes = Array.from(element.querySelectorAll<HTMLElement>(".blyrics--word"));
  if (wordNodes.length > 0) {
    const words = wordNodes
      .map((node) => cleanText(node.textContent || node.getAttribute("data-content")))
      .filter(Boolean);
    return cleanText(words.reduce((result, word) => {
      if (!result) {
        return word;
      }
      const needsSpace = /[A-Za-z0-9]$/.test(result) && /^[A-Za-z0-9]/.test(word);
      return `${result}${needsSpace ? " " : ""}${word}`;
    }, ""));
  }

  const pieces: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      pieces.push(node.textContent ?? "");
      return;
    }

    if (!(node instanceof Element)) {
      return;
    }

    const className = String(node.getAttribute("class") ?? "");
    const beforeLength = pieces.length;
    for (const child of Array.from(node.childNodes)) {
      walk(child);
    }

    if (className.includes("blyrics--has-trailing-space") && pieces.length > beforeLength) {
      pieces.push(" ");
    }
  };

  walk(element);
  return cleanText(pieces.join(""));
}

function firstText(selectors: string[]): string {
  for (const selector of selectors) {
    const text = cleanText(document.querySelector(selector)?.textContent);
    if (text) {
      return text;
    }
  }
  return "";
}

function normalizeTrackText(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function sameTrackText(left: string, right: string): boolean {
  const normalizedLeft = normalizeTrackText(left);
  const normalizedRight = normalizeTrackText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const shorter = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = normalizedLeft.length > normalizedRight.length ? normalizedLeft : normalizedRight;
  return shorter.length >= 6 && longer.includes(shorter);
}

function titleContainsTrackText(left: string, right: string): boolean {
  const normalizedLeft = normalizeTrackText(left);
  const normalizedRight = normalizeTrackText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  const shorter = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = normalizedLeft.length > normalizedRight.length ? normalizedLeft : normalizedRight;
  return longer.includes(shorter);
}

function splitSubtitle(value: string): string[] {
  return cleanText(value)
    .split(/\s*[\u2022\u00b7]\s*/)
    .map((part) => cleanText(part))
    .filter(Boolean);
}

function readTrackInfo(): {
  title: string;
  artist: string;
  album: string;
  betterTitle: string;
  playerTitle: string;
  betterArtist: string;
  playerArtist: string;
} {
  const betterTitle = firstText(["#blyrics-title", ".blyrics-title"]);
  const playerTitle = firstText([
    "ytmusic-player-bar .title",
    "ytmusic-player-bar yt-formatted-string.title",
    ".content-info-wrapper .title"
  ]);
  const subtitle = firstText([
    "ytmusic-player-bar .subtitle",
    "ytmusic-player-bar .subtitle yt-formatted-string",
    ".content-info-wrapper .subtitle"
  ]);
  const subtitleParts = splitSubtitle(subtitle);
  const betterArtist = firstText(["#blyrics-artist", ".blyrics-artist"]);
  const betterAlbum = firstText(["#blyrics-album", ".blyrics-album"]);

  return {
    title: playerTitle || betterTitle,
    artist: subtitleParts[0] || betterArtist,
    album: subtitleParts.slice(1).join(" \u2022 ") || betterAlbum,
    betterTitle,
    playerTitle,
    betterArtist,
    playerArtist: subtitleParts[0] || ""
  };
}

function isBetterLyricsTrackStale(
  container: Element | null,
  track: { betterTitle: string; playerTitle: string; betterArtist: string; playerArtist: string }
): boolean {
  const hasBetterLyrics = Boolean(container?.matches(".blyrics-container") || container?.querySelector(".blyrics-container"));
  if (!hasBetterLyrics || !track.playerTitle || !track.betterTitle) {
    return false;
  }

  if (titleContainsTrackText(track.betterTitle, track.playerTitle)) {
    return false;
  }

  return true;
}

function trackKey(track: { title: string; artist: string }): string {
  return `${track.title}\n${track.artist}`
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function updateTrackSettlingWindow(track: { title: string; artist: string }): boolean {
  const key = trackKey(track);
  if (!key) {
    return false;
  }

  if (key !== lastTrackKey) {
    lastTrackKey = key;
    lastSignature = "";
    trackSettlingUntil = Date.now() + 3000;
    trackLoadingUntil = Date.now() + 12000;
    return true;
  }

  return Date.now() < trackSettlingUntil;
}

function isTrackLoadingWindow(track: { title: string }): boolean {
  return Boolean(track.title) && Date.now() < trackLoadingUntil;
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function hasActiveHint(element: Element): boolean {
  const text = `${element.className} ${element.getAttribute("aria-current") ?? ""} ${element.getAttribute("aria-selected") ?? ""}`.toLowerCase();
  return ACTIVE_LINE_HINTS.some((hint) => text.includes(hint));
}

function isBetterLyricsActive(element: Element): boolean {
  if (element.matches(".blyrics--line.blyrics--animating")) {
    return true;
  }

  if (element.matches(".blyrics--line.blyrics--pre-animating")) {
    return false;
  }

  const activeSelector = ".blyrics--active";
  if (element.matches(activeSelector) || element.querySelector(activeSelector)) {
    return true;
  }

  let current: Element | null = element;
  while (current) {
    const className = String(current.className).toLowerCase();
    if (className.includes("blyrics--line") && className.includes("blyrics--animating")) {
      return true;
    }
    if (className.includes("blyrics--line") && className.includes("blyrics--pre-animating")) {
      return false;
    }
    if (className.includes("blyrics--active")) {
      return true;
    }
    if (className.includes("blyrics-wrapper") || className.includes("blyrics-container")) {
      return false;
    }
    current = current.parentElement;
  }
  return false;
}

function findLyricsContainer(): Element | null {
  const candidates = [
    "#blyrics-wrapper",
    ".blyrics-wrapper",
    ".blyrics-container",
    "ytmusic-lyrics-renderer",
    "ytmusic-description-shelf-renderer",
    "ytmusic-tab-renderer[page-type='MUSIC_PAGE_TYPE_TRACK_LYRICS']",
    "#lyrics",
    "[data-testid*='lyrics' i]",
    "[aria-label*='lyrics' i]",
    "[aria-label*='歌詞' i]"
  ];

  for (const selector of candidates) {
    const element = document.querySelector(selector);
    if (element && isVisible(element)) {
      return element;
    }
  }

  const tabText = Array.from(document.querySelectorAll("tp-yt-paper-tab, yt-formatted-string, div"))
    .find((element) => /lyrics|歌詞/i.test(cleanText(element.textContent)) && hasActiveHint(element));

  return tabText ? document.querySelector("ytmusic-player-page") : null;
}

function collectBetterLyricsLines(container: Element): LyricLine[] {
  const betterLyricsContainer = container.matches(".blyrics-container")
    ? container
    : container.querySelector(".blyrics-container");
  if (!betterLyricsContainer) {
    return [];
  }

  const candidates = Array.from(betterLyricsContainer.children)
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
    .filter((element) => isVisible(element));

  const lines: LyricLine[] = [];
  let emptyInstrumentalVisible = false;

  for (const element of candidates) {
    const className = String(element.className).toLowerCase();
    if (
      className.includes("blyrics--word") ||
      className.includes("blyrics-footer") ||
      className.includes("blyrics-modal") ||
      className.includes("blyrics-loader") ||
      className.includes("blyrics-hidden") ||
      element.closest(".blyrics-footer, .blyrics-modal, .blyrics-loader")
    ) {
      continue;
    }

    const text = extractBetterLyricsText(element);
    if (isInstrumentalElement(element, text)) {
      return [{ text: "\u266a", active: true }];
    }
    emptyInstrumentalVisible = emptyInstrumentalVisible || hasEmptyInstrumentalClass(element, text);

    if (!text || text.length > 220) {
      continue;
    }

    const active = isBetterLyricsActive(element);
    lines.push({
      text,
      active,
      time: readBetterLyricsTime(element)
    });
  }

  if (lines.some((line) => line.active)) {
    return lines;
  }

  if (emptyInstrumentalVisible) {
    return [{ text: "\u266a", active: true }];
  }

  const activeElement = betterLyricsContainer.querySelector<HTMLElement>(".blyrics--line.blyrics--animating") ??
    Array.from(betterLyricsContainer.querySelectorAll<HTMLElement>(".blyrics--active"))
      .find((element) => !element.matches(".blyrics--pre-animating") && !element.querySelector(".blyrics--pre-animating"));
  const activeLineElement = activeElement?.closest<HTMLElement>(
    ".blyrics-container > div"
  );
  const activeText = activeLineElement ? extractBetterLyricsText(activeLineElement) : activeElement ? extractBetterLyricsText(activeElement) : "";
  if (activeLineElement && isInstrumentalElement(activeLineElement, activeText)) {
    return [{ text: "\u266a", active: true }];
  }
  if (activeLineElement && hasEmptyInstrumentalClass(activeLineElement, activeText)) {
    return [{ text: "\u266a", active: true }];
  }
  if (activeText) {
    const index = lines.findIndex((line) => line.text === activeText || activeText.includes(line.text));
    if (index >= 0) {
      lines[index].active = true;
    } else {
      lines.push({ text: activeText, active: true, time: activeLineElement ? readBetterLyricsTime(activeLineElement) : undefined });
    }
  }

  return lines.slice(0, 120);
}

function collectLyricLines(container: Element | null): LyricLine[] {
  if (!container) {
    return [];
  }

  const betterLyricsLines = collectBetterLyricsLines(container);
  if (betterLyricsLines.length > 0) {
    return betterLyricsLines;
  }

  const nodes = Array.from(
    container.querySelectorAll("yt-formatted-string, div, span, p")
  ).filter((element) => isVisible(element));

  const lines: LyricLine[] = [];
  let emptyInstrumentalVisible = false;

  for (const element of nodes) {
    const text = cleanText(element.textContent);
    if (isInstrumentalElement(element, text)) {
      return [{ text: "\u266a", active: true }];
    }
    emptyInstrumentalVisible = emptyInstrumentalVisible || hasEmptyInstrumentalClass(element, text);

    if (!text || text.length > 220) {
      continue;
    }

    const role = element.getAttribute("role") ?? "";
    if (/button|tab/i.test(role)) {
      continue;
    }

    lines.push({
      text,
      active: hasActiveHint(element) || hasActiveHint(element.parentElement ?? element)
    });
  }

  if (lines.length === 0 && emptyInstrumentalVisible) {
    return [{ text: "\u266a", active: true }];
  }

  return lines.slice(0, 120);
}

function getPlaybackState(): boolean {
  const playPause = document.querySelector(
    "ytmusic-player-bar tp-yt-paper-icon-button.play-pause-button, ytmusic-player-bar .play-pause-button"
  );
  const label = `${playPause?.getAttribute("title") ?? ""} ${playPause?.getAttribute("aria-label") ?? ""}`.toLowerCase();
  if (label.includes("pause") || label.includes("暫停")) {
    return true;
  }
  if (label.includes("play") || label.includes("播放")) {
    return false;
  }

  const video = document.querySelector("video");
  return Boolean(video && !video.paused && !video.ended);
}

function getPlayerState(): PlayerState {
  const media = document.querySelector<HTMLMediaElement>("video, audio");
  const slider = document.querySelector<HTMLElement>(
    "ytmusic-player-bar tp-yt-paper-slider#volume-slider, ytmusic-player-bar #volume-slider, ytmusic-player-bar tp-yt-paper-slider"
  );
  const sliderLike = slider as unknown as { value?: number; immediateValue?: number } | null;
  const rawSliderValue =
    slider?.getAttribute("aria-valuenow") ??
    slider?.getAttribute("value") ??
    String(sliderLike?.immediateValue ?? sliderLike?.value ?? "");
  const sliderValue = Number(rawSliderValue);
  const mediaVolume = media ? media.volume : NaN;
  const volume = Number.isFinite(sliderValue)
    ? Math.max(0, Math.min(1, sliderValue > 1 ? sliderValue / 100 : sliderValue))
    : Number.isFinite(mediaVolume)
      ? Math.max(0, Math.min(1, mediaVolume))
      : 0.8;

  return {
    isPlaying: getPlaybackState(),
    volume,
    muted: Boolean(media?.muted || volume <= 0),
    updatedAt: Date.now()
  };
}

function publishPlayerState(): void {
  const state = getPlayerState();
  const signature = JSON.stringify({
    isPlaying: state.isPlaying,
    volume: state.volume,
    muted: state.muted
  });

  if (signature === lastPlayerStateSignature) {
    return;
  }

  lastPlayerStateSignature = signature;
  ipcRenderer.send("ytmusic:player-state", state);
}

function schedulePlayerStatePublish(delay = 80): void {
  if (playerStateTimer !== null) {
    return;
  }
  playerStateTimer = window.setTimeout(() => {
    playerStateTimer = null;
    publishPlayerState();
  }, delay);
}

function eventTouchesPlayerControl(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest(
    [
      "video",
      "audio",
      "ytmusic-player-bar .volume",
      "ytmusic-player-bar #volume-slider",
      "ytmusic-player-bar tp-yt-paper-slider",
      "ytmusic-player-bar .play-pause-button",
      "ytmusic-player-bar #play-pause-button",
      "ytmusic-player-bar .previous-button",
      "ytmusic-player-bar .next-button"
    ].join(", ")
  ));
}

function bindPlayerStateEvents(): void {
  for (const eventName of ["volumechange", "play", "pause", "playing", "ended"]) {
    document.addEventListener(eventName, () => schedulePlayerStatePublish(), true);
  }

  for (const eventName of ["input", "change", "click", "pointerup", "keyup"]) {
    document.addEventListener(eventName, (event) => {
      if (eventTouchesPlayerControl(event)) {
        schedulePlayerStatePublish();
      }
    }, true);
  }

  window.setTimeout(() => schedulePlayerStatePublish(0), 300);
  window.setTimeout(() => schedulePlayerStatePublish(0), 1800);
}

function collectPayload(): LyricsPayload {
  if (!location.hostname.endsWith("music.youtube.com")) {
    return makePayload("not-youtube-music", [], -1, "This page is not YouTube Music.");
  }

  const track = readTrackInfo();
  const isPlaying = getPlaybackState();
  const container = findLyricsContainer();
  updateTrackSettlingWindow(track);
  const staleBetterLyrics = isBetterLyricsTrackStale(container, track);
  const lines = staleBetterLyrics ? [] : collectLyricLines(container);
  const activeIndex = lines.findIndex((line) => line.active);
  const hasVisibleLines = lines.length > 0;
  const beforeFirstTimedLine = !staleBetterLyrics && activeIndex < 0 && isBeforeFirstTimedLine(lines);
  const loadingTimedOut = Boolean(track.title) && Date.now() > trackLoadingUntil;
  const shouldHoldLyrics = !loadingTimedOut && (
    staleBetterLyrics ||
    (!hasVisibleLines && isTrackLoadingWindow(track))
  );
  let status: LyricsStatus = "ready";
  let message = "";
  let outputLines = shouldHoldLyrics ? [] : lines;
  let outputActiveIndex = shouldHoldLyrics ? -1 : activeIndex;

  if (beforeFirstTimedLine && !shouldHoldLyrics) {
    outputLines = [{ text: "\u266a", active: true }];
    outputActiveIndex = 0;
  }

  if (!isPlaying && !track.title) {
    status = "not-playing";
    message = "Play a song in YouTube Music.";
  } else if (shouldHoldLyrics) {
    status = "loading-lyrics";
    message = "Waiting for Better Lyrics to update.";
  } else if (!container) {
    status = "lyrics-closed";
    message = "Open the Lyrics tab in YouTube Music.";
  } else if (outputLines.length === 0) {
    status = "no-lyrics";
    message = "No lyrics are visible for this song.";
  } else if (outputActiveIndex < 0) {
    status = "static-lyrics";
    message = "Lyrics are visible, but no synced line is highlighted.";
  }

  return makePayload(status, outputLines, outputActiveIndex, message, track);
}

function makePayload(
  status: LyricsStatus,
  lines: LyricLine[],
  activeIndex: number,
  message: string,
  track = readTrackInfo()
): LyricsPayload {
  return {
    status,
    title: track.title,
    artist: track.artist,
    album: track.album,
    isPlaying: getPlaybackState(),
    volume: 0.8,
    muted: false,
    lines,
    activeIndex,
    message,
    updatedAt: Date.now()
  };
}

function publish(): void {
  const payload = collectPayload();
  const signature = JSON.stringify({
    status: payload.status,
    title: payload.title,
    artist: payload.artist,
    isPlaying: payload.isPlaying,
    activeIndex: payload.activeIndex,
    lineCount: payload.lines.length,
    activeText: payload.lines[payload.activeIndex]?.text ?? "",
    message: payload.message
  });

  if (signature === lastSignature) {
    return;
  }

  lastSignature = signature;
  ipcRenderer.send("ytmusic:lyrics", payload);
}

function schedulePublish(delay = 150): void {
  if (publishTimer !== null) {
    return;
  }
  publishTimer = window.setTimeout(() => {
    publishTimer = null;
    publish();
  }, delay);
}

window.addEventListener("DOMContentLoaded", () => {
  publish();
  bindPlayerStateEvents();
  const observer = new MutationObserver(() => schedulePublish());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "aria-current", "aria-selected", "title", "aria-label"]
  });

  window.setInterval(() => schedulePublish(0), 1500);
});
