import type { WebContents } from "electron";
import type { Rectangle } from "electron/main";

export type PlayerPageExpandResult = {
  expanded: boolean;
  lyricsClicked: boolean;
  reason: string;
};

type Point = {
  x: number;
  y: number;
};

type InspectResult = {
  isPlaying: boolean;
  isExpanded: boolean;
  reason: string;
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function inspectPlayerPageScript(): string {
  return `
    (() => {
      const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const playPause = document.querySelector("ytmusic-player-bar .play-pause-button, ytmusic-player-bar #play-pause-button");
      const playLabel = clean((playPause?.getAttribute("title") || "") + " " + (playPause?.getAttribute("aria-label") || "")).toLowerCase();
      const video = document.querySelector("video");
      const isPlaying =
        playLabel.includes("pause") ||
        playLabel.includes("\\u66ab\\u505c") ||
        Boolean(video && !video.paused && !video.ended);
      const visibleTabs = Array.from(document.querySelectorAll("ytmusic-player-page tp-yt-paper-tab, ytmusic-player-page ytmusic-tab-renderer, ytmusic-player-page [role='tab']"))
        .filter(visible);
      const isExpanded = visibleTabs.length > 0;
      if (!isPlaying) {
        return { isPlaying, isExpanded, reason: "not-playing" };
      }
      if (isExpanded) {
        return { isPlaying, isExpanded, reason: "already-expanded" };
      }

      const bar = document.querySelector("ytmusic-player-bar");
      if (!visible(bar)) {
        return { isPlaying, isExpanded, reason: "player-bar-not-visible" };
      }
      return { isPlaying, isExpanded, reason: "needs-player-bar-click" };
    })();
  `;
}

function clickLyricsTabScript(): string {
  return `
    (() => {
      const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const active = (element) => {
        const value = clean((element.getAttribute("aria-selected") || "") + " " + (element.getAttribute("aria-current") || ""));
        return /true|page|step/i.test(value) || element.classList.contains("selected") || element.classList.contains("iron-selected");
      };
      const isLyrics = (element) => /lyrics|\\u6b4c\\u8a5e|\\u6b4c\\u8bcd/i.test(clean((element.textContent || "") + " " + (element.getAttribute("aria-label") || "") + " " + (element.getAttribute("title") || "")));
      const tabs = Array.from(document.querySelectorAll("ytmusic-player-page tp-yt-paper-tab, ytmusic-player-page ytmusic-tab-renderer, ytmusic-player-page [role='tab']"))
        .filter((element) => visible(element) && isLyrics(element));
      const target = tabs.find((element) => !active(element)) || null;
      if (!target) {
        return false;
      }
      const clickable = target.closest("tp-yt-paper-tab, ytmusic-tab-renderer, [role='tab']") || target;
      clickable.click();
      return true;
    })();
  `;
}

function refreshLyricsObserverScript(): string {
  return `window.dispatchEvent(new Event("ytmusic-overlay:lyrics-refresh"));`;
}

async function trustedClick(webContents: WebContents, point: Point): Promise<void> {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  webContents.sendInputEvent({ type: "mouseMove", x, y });
  webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

function playerBarClickPoint(bounds: Rectangle): Point {
  return {
    x: Math.round(Math.min(bounds.width - 80, Math.max(180, bounds.width * 0.46))),
    y: Math.round(Math.max(1, bounds.height - 34))
  };
}

// Single owner for player-page expansion. Do not trigger this from observers,
// lyrics publishing, timers, or YouTube Music preload code. The only intended
// caller is the overlay play/pause command after the user presses Play.
export async function openPlayerPageForLyricsOnce(webContents: WebContents, viewBounds: Rectangle): Promise<PlayerPageExpandResult> {
  if (webContents.isDestroyed() || !webContents.getURL().startsWith("https://music.youtube.com")) {
    return { expanded: false, lyricsClicked: false, reason: "not-youtube-music" };
  }

  await wait(250);
  const state = await webContents.executeJavaScript(inspectPlayerPageScript(), true) as InspectResult;
  if (!state.isPlaying) {
    return { expanded: false, lyricsClicked: false, reason: state.reason };
  }

  if (state.isExpanded) {
    const lyricsClicked = await webContents.executeJavaScript(clickLyricsTabScript(), true) as boolean;
    await webContents.executeJavaScript(refreshLyricsObserverScript(), true);
    return { expanded: false, lyricsClicked, reason: state.reason };
  }

  await trustedClick(webContents, playerBarClickPoint(viewBounds));
  await wait(900);
  const lyricsClicked = await webContents.executeJavaScript(clickLyricsTabScript(), true) as boolean;
  await webContents.executeJavaScript(refreshLyricsObserverScript(), true);
  return { expanded: true, lyricsClicked, reason: state.reason };
}
