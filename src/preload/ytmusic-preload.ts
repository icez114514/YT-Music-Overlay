import { ipcRenderer } from "electron";
import { LyricsPayload, LyricLine, LyricsStatus } from "../shared/types";

const ACTIVE_LINE_HINTS = [
  "selected",
  "active",
  "current",
  "highlight",
  "playing",
  "focused"
];

let lastSignature = "";
let publishTimer: number | null = null;
let lastAutoLyricsClickAt = 0;
let lastAutoLyricsTitle = "";
let lyricsTabRetryTimer: number | null = null;
const MUSIC_STATE_SELECTOR = [
  "ytmusic-player-page",
  "ytmusic-player-bar",
  "ytmusic-player",
  "tp-yt-paper-tab",
  ".blyrics-container"
].join(",");

function clickElementAtCenter(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const x = Math.max(1, Math.min(window.innerWidth - 2, rect.left + rect.width / 2));
  const y = Math.max(1, Math.min(window.innerHeight - 2, rect.top + rect.height / 2));
  element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }));
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y }));
  element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
  element.click();
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isInstrumentalText(text: string): boolean {
  return /^(?:[\u266a\u266b\u266c]+|instrumental|\u9593\u594f|\u7eaf\u97f3\u4e50|\u7d14\u97f3\u6a02)$/i.test(text.trim());
}

function isInstrumentalElement(element: Element, text: string): boolean {
  const className = String(element.className).toLowerCase();
  return isInstrumentalText(text) || (className.includes("instrumental") && text.length <= 32);
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

function splitSubtitle(value: string): string[] {
  return cleanText(value)
    .split(/\s*[•·]\s*/)
    .map((part) => cleanText(part))
    .filter(Boolean);
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

  const seen = new Set<string>();
  const lines: LyricLine[] = [];

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
    if (!text || text.length > 220 || seen.has(text)) {
      continue;
    }

    const active = isBetterLyricsActive(element);
    if (active && isInstrumentalElement(element, text)) {
      return [{ text: "\u266a", active: true }];
    }
    seen.add(text);
    lines.push({
      text,
      active
    });
  }

  const activeIndex = lines.findIndex((line) => line.active);
  if (activeIndex >= 0) {
    return lines;
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
  if (activeText) {
    const index = lines.findIndex((line) => line.text === activeText || activeText.includes(line.text));
    if (index >= 0) {
      lines[index].active = true;
    } else {
      lines.push({ text: activeText, active: true });
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

  const seen = new Set<string>();
  const lines: LyricLine[] = [];

  for (const element of nodes) {
    const text = cleanText(element.textContent);
    if (!text || text.length > 220 || seen.has(text)) {
      continue;
    }

    const role = element.getAttribute("role") ?? "";
    if (/button|tab/i.test(role)) {
      continue;
    }

    seen.add(text);
    lines.push({
      text,
      active: hasActiveHint(element) || hasActiveHint(element.parentElement ?? element)
    });
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

function getVolumeState(): { volume: number; muted: boolean } {
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
    volume,
    muted: Boolean(media?.muted || volume <= 0)
  };
}

function isLyricsTabElement(element: Element): boolean {
  const text = cleanText(element.textContent);
  const label = cleanText(`${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""}`);
  return /lyrics|歌詞|歌词/i.test(`${text} ${label}`);
}

function isLyricsTabActive(element: Element): boolean {
  if (hasActiveHint(element)) {
    return true;
  }
  const tab = element.closest("tp-yt-paper-tab, ytmusic-tab-renderer, [role='tab']");
  return Boolean(tab && hasActiveHint(tab));
}

function visibleLyricsTabs(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "ytmusic-player-page tp-yt-paper-tab, ytmusic-player-page ytmusic-tab-renderer, ytmusic-player-page [role='tab']"
    )
  )
    .filter(isLyricsTabElement)
    .filter((element) => isVisible(element));
}

function isPlayerPageExpanded(): boolean {
  return visibleLyricsTabs().length > 0 || Array.from(
    document.querySelectorAll<HTMLElement>("ytmusic-player-page tp-yt-paper-tab, ytmusic-player-page [role='tab']")
  ).some(isVisible);
}

function autoExpandPlayerPage(): boolean {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "ytmusic-player-bar .expand-button",
        "ytmusic-player-bar #expand-button",
        "ytmusic-player-bar tp-yt-paper-icon-button[title*='Expand' i]",
        "ytmusic-player-bar tp-yt-paper-icon-button[aria-label*='Expand' i]",
        "ytmusic-player-bar tp-yt-paper-icon-button[title*='展開' i]",
        "ytmusic-player-bar tp-yt-paper-icon-button[aria-label*='展開' i]",
        "ytmusic-player-bar tp-yt-paper-icon-button[title*='展开' i]",
        "ytmusic-player-bar tp-yt-paper-icon-button[aria-label*='展开' i]"
      ].join(", ")
    )
  ).filter(isVisible);

  const button = candidates[0];
  if (!button) {
    return false;
  }

  button.click();
  return true;
}

function robustAutoExpandPlayerPage(): boolean {
  ipcRenderer.send("ytmusic:trusted-click-player-bar");
  return true;

  /*
  const explicitButton = document.querySelector<HTMLElement>(
    [
      "ytmusic-player-bar yt-icon-button.toggle-player-page-button",
      "ytmusic-player-bar .toggle-player-page-button button",
      "ytmusic-player-bar button[aria-label*='開啟播放器頁面']",
      "ytmusic-player-bar button[aria-label*='打开播放器页面']",
      "ytmusic-player-bar button[aria-label*='Open player page' i]",
      "ytmusic-player-bar #expand-player-page-button",
      "ytmusic-player-bar .expand-player-page-button",
      "ytmusic-player-bar .toggle-player-page-button"
    ].join(", ")
  );
  if (explicitButton && isVisible(explicitButton)) {
    clickElementAtCenter(explicitButton);
    return true;
  }

  const bar = document.querySelector<HTMLElement>("ytmusic-player-bar");
  if (bar && isVisible(bar)) {
    const rect = bar.getBoundingClientRect();
    const target = document.elementFromPoint(rect.right - 34, rect.top + rect.height / 2) as HTMLElement | null;
    const button = target?.closest<HTMLElement>("button, tp-yt-paper-icon-button, yt-icon-button, [role='button']");
    if (button && bar.contains(button)) {
      clickElementAtCenter(button);
      return true;
    }

    clickElementAtCenter(bar);
    return true;
  }

  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "ytmusic-player-bar #expand-player-page-button",
        "ytmusic-player-bar .expand-player-page-button",
        "ytmusic-player-bar .toggle-player-page-button",
        "ytmusic-player-bar button[aria-label*='開啟播放器頁面']",
        "ytmusic-player-bar button[aria-label*='打开播放器页面']",
        "ytmusic-player-bar [icon='yt-icons:expand-less']",
        "ytmusic-player-bar [icon='expand_less']",
        "ytmusic-player-bar button",
        "ytmusic-player-bar tp-yt-paper-icon-button",
        "ytmusic-player-bar yt-icon-button",
        "ytmusic-player-bar [role='button']"
      ].join(", ")
    )
  ).filter(isVisible);
  const expandWords = /expand|open player|show player|full player|展開|展开|開啟播放器|打开播放器|顯示播放器|显示播放器/i;
  const iconWords = /expand_less|keyboard_arrow_up|arrow_drop_up|unfold_more/i;
  const button = buttons.find((candidate) => {
    const text = cleanText(candidate.textContent);
    const label = cleanText(
      `${candidate.id} ${candidate.className} ${candidate.getAttribute("title") ?? ""} ${candidate.getAttribute("aria-label") ?? ""} ${candidate.getAttribute("icon") ?? ""}`
    );
    return expandWords.test(`${text} ${label}`) || iconWords.test(`${text} ${label}`);
  }) ?? buttons
    .filter((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width >= 24 && rect.height >= 24;
    })
    .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];

  if (!button) {
    return false;
  }

  clickElementAtCenter(button);
  return true;
  */
}

function autoOpenLyricsTab(title: string, isPlaying: boolean, expandedAttempted = false): void {
  if (!isPlaying || !title) {
    return;
  }

  const now = Date.now();
  if (!expandedAttempted && title === lastAutoLyricsTitle && now - lastAutoLyricsClickAt < 8000) {
    return;
  }

  const hasLyricsSurface = Boolean(findLyricsContainer());

  if (!expandedAttempted && !hasLyricsSurface) {
    if (robustAutoExpandPlayerPage() || autoExpandPlayerPage()) {
      lastAutoLyricsClickAt = now;
      lastAutoLyricsTitle = title;
      scheduleLyricsTabRetry(title);
    }
    return;
  }

  const candidates = visibleLyricsTabs();

  if (candidates.length === 0) {
    return;
  }

  const target = candidates.find((element) => !isLyricsTabActive(element));
  const clickable = target?.closest<HTMLElement>("tp-yt-paper-tab, ytmusic-tab-renderer, [role='tab']") ?? target;
  if (!clickable) {
    return;
  }

  lastAutoLyricsClickAt = now;
  lastAutoLyricsTitle = title;
  clickable.click();
}

function scheduleLyricsTabRetry(title: string): void {
  if (lyricsTabRetryTimer !== null) {
    window.clearTimeout(lyricsTabRetryTimer);
    lyricsTabRetryTimer = null;
  }

  let attempts = 0;
  const retry = () => {
    lyricsTabRetryTimer = null;
    attempts += 1;
    autoOpenLyricsTab(title, getPlaybackState(), true);
    if (attempts < 5 && visibleLyricsTabs().length === 0 && getPlaybackState()) {
      lyricsTabRetryTimer = window.setTimeout(retry, 700);
    }
  };

  lyricsTabRetryTimer = window.setTimeout(retry, 900);
}

function collectPayload(): LyricsPayload {
  if (!location.hostname.endsWith("music.youtube.com")) {
    return makePayload("not-youtube-music", [], -1, "This page is not YouTube Music.");
  }

  const isPlaying = getPlaybackState();
  const title = firstText([
    "#blyrics-title",
    ".blyrics-title",
    "ytmusic-player-bar .title",
    "ytmusic-player-bar yt-formatted-string.title",
    ".content-info-wrapper .title"
  ]);
  autoOpenLyricsTab(title, isPlaying);
  const container = findLyricsContainer();
  const lines = collectLyricLines(container);
  const activeIndex = lines.findIndex((line) => line.active);
  let status: LyricsStatus = "ready";
  let message = "";

  if (!isPlaying && !title) {
    status = "not-playing";
    message = "Play a song in YouTube Music.";
  } else if (!container) {
    status = "lyrics-closed";
    message = "Open the Lyrics tab in YouTube Music.";
  } else if (lines.length === 0) {
    status = "no-lyrics";
    message = "No lyrics are visible for this song.";
  } else if (activeIndex < 0) {
    status = "static-lyrics";
    message = "Lyrics are visible, but no synced line is highlighted.";
  }

  return makePayload(status, lines, activeIndex, message);
}

function makePayload(status: LyricsStatus, lines: LyricLine[], activeIndex: number, message: string): LyricsPayload {
  const volumeState = getVolumeState();
  const subtitle = firstText([
    "ytmusic-player-bar .subtitle",
    "ytmusic-player-bar .subtitle yt-formatted-string",
    ".content-info-wrapper .subtitle"
  ]);
  const subtitleParts = splitSubtitle(subtitle);
  const artist = firstText(["#blyrics-artist", ".blyrics-artist"]) || subtitleParts[0] || "";
  const album = firstText(["#blyrics-album", ".blyrics-album"]) || subtitleParts.slice(1).join(" • ");

  return {
    status,
    title: firstText([
      "#blyrics-title",
      ".blyrics-title",
      "ytmusic-player-bar .title",
      "ytmusic-player-bar yt-formatted-string.title",
      ".content-info-wrapper .title"
    ]),
    artist,
    album,
    isPlaying: getPlaybackState(),
    volume: volumeState.volume,
    muted: volumeState.muted,
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
    volume: payload.volume,
    muted: payload.muted,
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

function mutationTouchesMusicState(mutations: MutationRecord[]): boolean {
  return mutations.some((mutation) => {
    const target = mutation.target;
    if (target instanceof Element && target.closest(MUSIC_STATE_SELECTOR)) {
      return true;
    }

    for (const node of Array.from(mutation.addedNodes)) {
      if (
        node instanceof Element &&
        (node.matches(MUSIC_STATE_SELECTOR) || Boolean(node.querySelector(MUSIC_STATE_SELECTOR)))
      ) {
        return true;
      }
    }

    return false;
  });
}

window.addEventListener("DOMContentLoaded", () => {
  publish();
  const observer = new MutationObserver((mutations) => {
    if (mutationTouchesMusicState(mutations)) {
      schedulePublish();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-current", "aria-selected", "title", "aria-label"]
  });

  window.setInterval(() => schedulePublish(0), 1500);
});
