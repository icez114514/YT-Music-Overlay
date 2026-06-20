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

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
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

function collectPayload(): LyricsPayload {
  if (!location.hostname.endsWith("music.youtube.com")) {
    return makePayload("not-youtube-music", [], -1, "This page is not YouTube Music.");
  }

  const isPlaying = getPlaybackState();
  const container = findLyricsContainer();
  const lines = collectLyricLines(container);
  const activeIndex = lines.findIndex((line) => line.active);
  let status: LyricsStatus = "ready";
  let message = "";

  if (!isPlaying && !firstText(["ytmusic-player-bar .title", "ytmusic-player-bar yt-formatted-string.title"])) {
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
  const observer = new MutationObserver(() => schedulePublish());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-current", "aria-selected", "title", "aria-label"]
  });

  window.setInterval(() => schedulePublish(0), 1500);
});
