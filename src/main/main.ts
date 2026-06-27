import { app, BrowserView, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, session, shell } from "electron";
import type { MessageBoxOptions } from "electron";
import type { Rectangle } from "electron";
import { get } from "node:https";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultLyricsPayload,
  defaultPlayerState,
  LyricsPayload,
  OverlayBounds,
  OverlaySettings,
  PlayerState,
  PersistedState
} from "../shared/types";
import { openPlayerPageForLyricsOnce } from "./player-page-expander";
import { loadState, saveState } from "./state-store";

let playerWindow: BrowserWindow | null = null;
let musicView: BrowserView | null = null;
let overlayWindow: BrowserWindow | null = null;
let lyricsWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let lyricsSearchSettingsWindow: BrowserWindow | null = null;
let state: PersistedState;
let latestLyrics: LyricsPayload = defaultLyricsPayload;
let latestPlayerState: PlayerState = defaultPlayerState;
let extensionStatus = "Better Lyrics extension is not loaded yet.";
let lyricsPollTimer: NodeJS.Timeout | null = null;
let betterLyricsFallbackTimer: NodeJS.Timeout | null = null;
let betterLyricsFallbackInjecting = false;
let latestLyricsSignature = "";
let latestSettingsAnchor: { x: number; y: number; width: number; height: number } | null = null;
let settingsWindowOffset: { x: number; y: number } | null = null;
let isClosingApp = false;
let applyingOverlayBounds = false;
let overlayDragWasResizable = false;
let overlayDragStartBounds: Rectangle | null = null;
let overlayDragStartPoint: { x: number; y: number } | null = null;
let persistTimer: NodeJS.Timeout | null = null;

type RuntimeStoragePaths = {
  userData: string;
  sessionData: string;
  ytmusicPartition: string;
  diskCache: string;
  gpuCache: string;
  legacyMovedSessionData: string;
};

const rendererPath = (...parts: string[]) => join(__dirname, "..", "renderer", ...parts);
const preloadPath = (...parts: string[]) => join(__dirname, "..", "preload", ...parts);
const appAssetPath = (...parts: string[]) =>
  app.isPackaged
    ? join(process.resourcesPath, "app.asar.unpacked", ...parts)
    : join(app.getAppPath(), ...parts);
const betterLyricsPath = () => appAssetPath("extensions", "better-lyrics");
const normalOverlayMinSize = { width: 420, height: 120 };
const compactOverlayMinSize = { width: 180, height: 48 };
const normalToolbarHeight = 58;
const compactToolbarHeight = 42;
const resizeHandleThickness = 8;
const settingsPanelSize = { width: 560, height: 430 };
const lyricsSearchSettingsPanelSize = { width: 460, height: 280 };
const updateReleaseApiUrl = "https://api.github.com/repos/icez114514/YT-Music-Overlay/releases/latest";
const updateReleasePageUrl = "https://github.com/icez114514/YT-Music-Overlay/releases/latest";
const betterLyricsExtensionId = "effdbpeggelllpfkjppbokhmmiinhlmg";
const ytmusicPartition = "persist:yt-music-overlay";
const splitOverlayWindowsEnabled = false;
let runtimeStoragePaths: RuntimeStoragePaths;

function readRuntimeStoragePaths(): RuntimeStoragePaths {
  const userDataPath = app.getPath("userData");
  return {
    userData: userDataPath,
    sessionData: app.getPath("sessionData"),
    ytmusicPartition: join(userDataPath, "Partitions", "yt-music-overlay"),
    diskCache: join(userDataPath, "Cache", "Disk"),
    gpuCache: join(userDataPath, "Cache", "GPU"),
    legacyMovedSessionData: join(userDataPath, "SessionData")
  };
}

function configureRuntimeStorage(): void {
  if (process.env.YTMO_USER_DATA_DIR) {
    app.setPath("userData", process.env.YTMO_USER_DATA_DIR);
  }

  runtimeStoragePaths = readRuntimeStoragePaths();
  mkdirSync(runtimeStoragePaths.diskCache, { recursive: true });
  mkdirSync(runtimeStoragePaths.gpuCache, { recursive: true });
  app.commandLine.appendSwitch("disk-cache-dir", runtimeStoragePaths.diskCache);
  app.commandLine.appendSwitch("gpu-disk-cache-dir", runtimeStoragePaths.gpuCache);
}

configureRuntimeStorage();
state = loadState();
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns");

function persistNow(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  saveState(state);
}

function schedulePersist(delay = 500): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveState(state);
  }, delay);
}

function closeAuxiliaryWindows(): void {
  settingsWindow?.close();
  lyricsSearchSettingsWindow?.close();
  lyricsWindow?.close();
  overlayWindow?.close();
}

function sendPlayerStatus(message: string): void {
  if (!playerWindow || playerWindow.isDestroyed() || playerWindow.webContents.isDestroyed()) {
    return;
  }
  try {
    playerWindow.webContents.send("player:status", message);
  } catch {
    // The BrowserView can dispose its frame during navigation or shutdown.
  }
}

function isOverlayVisible(): boolean {
  return Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible());
}

function publishOverlayVisibility(): void {
  if (!playerWindow || playerWindow.isDestroyed() || playerWindow.webContents.isDestroyed()) {
    return;
  }
  playerWindow.webContents.send("overlay:visibility", isOverlayVisible());
}

function setOverlayVisibility(visible: boolean): void {
  if (visible && (!overlayWindow || overlayWindow.isDestroyed())) {
    createOverlayWindow();
  }
  if (visible) {
    overlayWindow?.show();
    lyricsWindow?.show();
  } else {
    settingsWindow?.close();
    overlayWindow?.hide();
    lyricsWindow?.hide();
  }
  publishOverlayVisibility();
}

function createPlayerWindow(): void {
  playerWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 880,
    minHeight: 620,
    title: "YT Music Overlay",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121212" : "#f5f5f5",
    webPreferences: {
      preload: preloadPath("player-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  });

  playerWindow.loadFile(rendererPath("player.html"));
  playerWindow.webContents.on("did-finish-load", () => {
    sendPlayerStatus(extensionStatus);
  });
  playerWindow.on("resize", resizeMusicView);
  playerWindow.on("maximize", resizeMusicView);
  playerWindow.on("unmaximize", resizeMusicView);
  playerWindow.on("restore", ensureMusicViewVisible);
  playerWindow.on("show", ensureMusicViewVisible);
  playerWindow.on("focus", ensureMusicViewVisible);
  createMusicView();

  playerWindow.on("closed", () => {
    isClosingApp = true;
    stopLyricsPolling();
    closeAuxiliaryWindows();
    musicView = null;
    playerWindow = null;
  });
}

function compareVersions(current: string, latest: string): number {
  const normalize = (value: string) =>
    value
      .replace(/^v/i, "")
      .split(".")
      .map((part) => Number.parseInt(part.replace(/\D.*/, ""), 10) || 0);
  const currentParts = normalize(current);
  const latestParts = normalize(latest);
  const length = Math.max(currentParts.length, latestParts.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const latestPart = latestParts[index] ?? 0;
    if (latestPart > currentPart) return 1;
    if (latestPart < currentPart) return -1;
  }
  return 0;
}

function fetchLatestRelease(): Promise<{ tag_name?: string; html_url?: string; name?: string }> {
  return new Promise((resolve, reject) => {
    const request = get(
      updateReleaseApiUrl,
      {
        headers: {
          "Accept": "application/vnd.github+json",
          "User-Agent": "YT-Music-Overlay"
        },
        timeout: 8000
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1024 * 1024) {
            request.destroy(new Error("Release response is too large."));
          }
        });
        response.on("end", () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`GitHub release check failed with HTTP ${response.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as { tag_name?: string; html_url?: string; name?: string });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("Release check timed out.")));
    request.on("error", reject);
  });
}

async function checkForUpdates(): Promise<void> {
  try {
    const latest = await fetchLatestRelease();
    const latestTag = latest.tag_name ?? latest.name ?? "";
    if (!latestTag || compareVersions(app.getVersion(), latestTag) <= 0) {
      return;
    }

    const useChinese = state.settings.useChineseInterface;
    const messageBoxOptions: MessageBoxOptions = {
      type: "info",
      buttons: useChinese ? ["開啟下載頁", "稍後"] : ["Open download page", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: useChinese ? "發現新版本" : "Update available",
      message: useChinese
        ? `發現新版本 ${latestTag}`
        : `A new version ${latestTag} is available.`,
      detail: useChinese
        ? `目前版本：${app.getVersion()}\n此免安裝版會開啟 GitHub Release 頁面讓你下載新版。`
        : `Current version: ${app.getVersion()}\nThis portable build opens the GitHub Release page so you can download the new version.`
    };
    const response = playerWindow
      ? await dialog.showMessageBox(playerWindow, messageBoxOptions)
      : await dialog.showMessageBox(messageBoxOptions);

    if (response.response === 0) {
      await shell.openExternal(latest.html_url ?? updateReleasePageUrl);
    }
  } catch {
    return;
  }
}

function musicControlScript(command: string, value?: number): string {
  return `
    (() => {
      const getPlaybackState = () => {
        const playPause = document.querySelector("ytmusic-player-bar .play-pause-button, ytmusic-player-bar #play-pause-button");
        const label = String((playPause?.getAttribute("title") || "") + " " + (playPause?.getAttribute("aria-label") || "")).toLowerCase();
        if (label.includes("pause") || label.includes("\\u66ab\\u505c")) return true;
        if (label.includes("play") || label.includes("\\u64ad\\u653e")) return false;
        const media = document.querySelector("video, audio");
        return Boolean(media && !media.paused && !media.ended);
      };
      const getPlayerState = () => {
        const media = document.querySelector("video, audio");
        const slider = document.querySelector("ytmusic-player-bar tp-yt-paper-slider#volume-slider, ytmusic-player-bar #volume-slider, ytmusic-player-bar tp-yt-paper-slider");
        const rawSliderValue =
          slider?.getAttribute("aria-valuenow") ??
          slider?.getAttribute("value") ??
          String(slider?.immediateValue ?? slider?.value ?? "");
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
      };
      const clickFirst = (selectors) => {
        for (const selector of selectors) {
          const element = Array.from(document.querySelectorAll(selector)).find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const style = window.getComputedStyle(candidate);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          });
          if (element && typeof element.click === "function") {
            element.click();
            return true;
          }
        }
        return false;
      };
      const command = ${JSON.stringify(command)};
      if (command === "previous") {
        clickFirst(["ytmusic-player-bar tp-yt-paper-icon-button.previous-button", "ytmusic-player-bar button.previous-button", "ytmusic-player-bar .previous-button"]);
        return getPlayerState();
      }
      if (command === "play-pause") {
        clickFirst(["ytmusic-player-bar tp-yt-paper-icon-button.play-pause-button", "ytmusic-player-bar button.play-pause-button", "ytmusic-player-bar #play-pause-button", "ytmusic-player-bar .play-pause-button"]);
        return getPlayerState();
      }
      if (command === "next") {
        clickFirst(["ytmusic-player-bar tp-yt-paper-icon-button.next-button", "ytmusic-player-bar button.next-button", "ytmusic-player-bar .next-button"]);
        return getPlayerState();
      }
      if (command === "volume") {
        const volume = Math.max(0, Math.min(1, Number(${JSON.stringify(value ?? 0.8)})));
        const slider = document.querySelector("ytmusic-player-bar tp-yt-paper-slider#volume-slider, ytmusic-player-bar #volume-slider, ytmusic-player-bar tp-yt-paper-slider");
        if (slider) {
          const sliderValue = Math.round(volume * 100);
          slider.value = sliderValue;
          slider.immediateValue = sliderValue;
          slider.setAttribute("value", String(sliderValue));
          slider.setAttribute("aria-valuenow", String(sliderValue));
          slider.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          slider.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        }
        const muteButton = document.querySelector("ytmusic-player-bar .volume button, ytmusic-player-bar [aria-label*='Mute' i], ytmusic-player-bar [aria-label*='Unmute' i]");
        for (const media of Array.from(document.querySelectorAll("video, audio"))) {
          media.volume = volume;
          media.muted = volume === 0;
          media.dispatchEvent(new Event("volumechange", { bubbles: true }));
        }
        if (muteButton) {
          const label = ((muteButton.getAttribute("aria-label") || "") + " " + (muteButton.getAttribute("title") || "")).toLowerCase();
          const wantsMuted = volume === 0;
          const appearsMuted = label.includes("unmute");
          if (wantsMuted !== appearsMuted && typeof muteButton.click === "function") {
            muteButton.click();
          }
        }
        return getPlayerState();
      }
      return getPlayerState();
    })();
  `;
}

async function expandPlayerPageFromCurrentPlayback(source: string): Promise<void> {
  const view = musicView;
  if (!view || view.webContents.isDestroyed()) {
    return;
  }
  if (!view.webContents.getURL().startsWith("https://music.youtube.com")) {
    return;
  }

  const result = await openPlayerPageForLyricsOnce(view.webContents, view.getBounds());
  sendPlayerStatus(
    `Player page expand (${source}): ${result.reason}${result.expanded ? ", expanded" : ""}${result.lyricsClicked ? ", lyrics tab" : ""}`
  );
}

async function sendMusicControl(command: string, value?: number): Promise<void> {
  const view = musicView;
  if (!view || view.webContents.isDestroyed()) {
    return;
  }
  if (!view.webContents.getURL().startsWith("https://music.youtube.com")) {
    return;
  }
  const playerState = await view.webContents.executeJavaScript(musicControlScript(command, value), true) as PlayerState | null;
  if (playerState && typeof playerState.volume === "number") {
    publishPlayerState(playerState);
  }
  if (["play-pause", "previous", "next"].includes(command)) {
    await expandPlayerPageFromCurrentPlayback(`overlay-${command}`);
  }
}

type LyricsSearchTrackInfo = {
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  url: string;
};

function lyricsSearchTrackInfoScript(): string {
  return `
    (() => {
      const cleanText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const firstText = (selectors) => {
        for (const selector of selectors) {
          const text = cleanText(document.querySelector(selector)?.textContent);
          if (text) return text;
        }
        return "";
      };
      const subtitle = firstText([
        "ytmusic-player-bar .subtitle",
        "ytmusic-player-bar .subtitle yt-formatted-string",
        ".content-info-wrapper .subtitle"
      ]);
      const subtitleParts = subtitle
        .split(/\\s*[\\u2022\\u00b7]\\s*/)
        .map(cleanText)
        .filter(Boolean);
      const media = document.querySelector("video, audio");
      const duration = Number(media?.duration);
      return {
        title: firstText([
          "ytmusic-player-bar .title",
          "ytmusic-player-bar yt-formatted-string.title",
          ".content-info-wrapper .title",
          "#blyrics-title",
          ".blyrics-title"
        ]),
        artist: subtitleParts[0] || firstText(["#blyrics-artist", ".blyrics-artist"]),
        album: firstText(["#blyrics-album", ".blyrics-album"]) || subtitleParts.slice(1).join(" \\u2022 "),
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        url: location.href
      };
    })();
  `;
}

function formatTrackDuration(duration: number | null): string {
  if (duration === null || !Number.isFinite(duration) || duration <= 0) {
    return "Unknown";
  }
  const totalSeconds = Math.round(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")} (${totalSeconds} seconds)`;
}

async function copyLyricsSearchPrompt(): Promise<{ ok: boolean; title?: string; error?: string }> {
  const view = musicView;
  let pageInfo: LyricsSearchTrackInfo | null = null;
  if (view && !view.webContents.isDestroyed()) {
    try {
      pageInfo = await view.webContents.executeJavaScript(lyricsSearchTrackInfoScript(), true) as LyricsSearchTrackInfo;
    } catch {
      pageInfo = null;
    }
  }

  const title = pageInfo?.title || latestLyrics.title;
  const artist = pageInfo?.artist || latestLyrics.artist;
  const album = pageInfo?.album || latestLyrics.album || "";
  const pageUrl = pageInfo?.url || view?.webContents.getURL() || "";
  if (!title) {
    return { ok: false, error: "No active song information is available." };
  }

  let videoId = "";
  try {
    videoId = new URL(pageUrl).searchParams.get("v") || "";
  } catch {
    videoId = "";
  }

  const configuredSites = Array.isArray(state.settings.lyricsSearchSites)
    ? state.settings.lyricsSearchSites.map((site) => site.trim()).filter(Boolean)
    : [];
  const siteList = configuredSites.length > 0
    ? configuredSites.map((site) => `- ${site}`).join("\n")
    : "- No preferred sites configured; search other reliable lyrics sources.";

  const prompt = [
    "請使用網路搜尋工具，為以下歌曲尋找可供程式使用的同步歌詞。不要只依賴模型記憶，也不要自行猜測或生成時間戳。",
    "",
    "歌曲資訊：",
    `- 歌名：${title}`,
    `- 歌手：${artist || "未知"}`,
    `- 專輯：${album || "未知"}`,
    `- YouTube Music URL：${pageUrl || "未知"}`,
    `- Video ID：${videoId || "未知"}`,
    `- 歌曲時長：${formatTrackDuration(pageInfo?.duration ?? null)}`,
    "",
    "優先搜尋以下網站：",
    siteList,
    "",
    "搜尋要求：",
    "1. 優先在指定網站內搜尋，可搭配 site: 網域、歌名、歌手、專輯與 Video ID 提高精度。",
    "2. 尋找 LRC、Enhanced LRC、TTML 或其他含逐行／逐字時間戳的同步歌詞；不要把純文字歌詞誤判為同步歌詞。",
    "3. 核對歌曲版本、演出者與時長，避免使用同名歌曲、翻唱、現場版、加速版或不同剪輯版本。",
    "4. 回覆找到的來源網址、歌詞格式與版本核對結果，並保留原始時間戳。",
    "5. 若指定網站找不到，可搜尋其他可信來源；若仍找不到，請明確說明，不要捏造歌詞或時間軸。"
  ].join("\n");

  clipboard.writeText(prompt);
  return { ok: true, title };
}

function ytmusicDebugSnapshotScript(): string {
  return `
    (() => {
      const cleanText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const rectOf = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      };
      const firstText = (selectors) => {
        for (const selector of selectors) {
          const text = cleanText(document.querySelector(selector)?.textContent);
          if (text) return text;
        }
        return "";
      };
      const elementSummary = (element, index) => ({
        index,
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        className: String(element.getAttribute("class") || ""),
        text: cleanText(element.textContent).slice(0, 500),
        dataTime: element.getAttribute("data-time") || element.querySelector("[data-time]")?.getAttribute("data-time") || "",
        ariaCurrent: element.getAttribute("aria-current") || "",
        ariaSelected: element.getAttribute("aria-selected") || "",
        visible: isVisible(element),
        rect: rectOf(element)
      });
      const containerSelectors = [
        "#blyrics-wrapper",
        ".blyrics-wrapper",
        ".blyrics-container",
        "ytmusic-lyrics-renderer",
        "ytmusic-description-shelf-renderer",
        "ytmusic-tab-renderer[page-type='MUSIC_PAGE_TYPE_TRACK_LYRICS']",
        "#lyrics"
      ];
      const containers = containerSelectors.map((selector) => {
        const element = document.querySelector(selector);
        return {
          selector,
          found: Boolean(element),
          visible: isVisible(element),
          rect: rectOf(element),
          className: String(element?.getAttribute("class") || ""),
          textLength: cleanText(element?.textContent).length
        };
      });
      const betterContainer = document.querySelector(".blyrics-container") || document.querySelector("#blyrics-wrapper") || document.querySelector(".blyrics-wrapper");
      const betterChildren = betterContainer
        ? Array.from(betterContainer.children).slice(0, 80).map(elementSummary)
        : [];
      const activeElements = Array.from(document.querySelectorAll(".blyrics--active, .blyrics--line.blyrics--animating, .blyrics--line.blyrics--pre-animating"))
        .slice(0, 40)
        .map(elementSummary);
      const media = document.querySelector("video, audio");
      const playPause = document.querySelector("ytmusic-player-bar .play-pause-button, ytmusic-player-bar #play-pause-button");
      const slider = document.querySelector("ytmusic-player-bar tp-yt-paper-slider#volume-slider, ytmusic-player-bar #volume-slider, ytmusic-player-bar tp-yt-paper-slider");
      return {
        capturedAt: new Date().toISOString(),
        location: {
          href: location.href,
          hostname: location.hostname,
          title: document.title
        },
        track: {
          betterTitle: firstText(["#blyrics-title", ".blyrics-title"]),
          betterArtist: firstText(["#blyrics-artist", ".blyrics-artist"]),
          betterAlbum: firstText(["#blyrics-album", ".blyrics-album"]),
          playerTitle: firstText(["ytmusic-player-bar .title", "ytmusic-player-bar yt-formatted-string.title", ".content-info-wrapper .title"]),
          playerSubtitle: firstText(["ytmusic-player-bar .subtitle", "ytmusic-player-bar .subtitle yt-formatted-string", ".content-info-wrapper .subtitle"])
        },
        playback: {
          mediaFound: Boolean(media),
          currentTime: media && Number.isFinite(media.currentTime) ? media.currentTime : null,
          duration: media && Number.isFinite(media.duration) ? media.duration : null,
          paused: media ? media.paused : null,
          ended: media ? media.ended : null,
          volume: media ? media.volume : null,
          muted: media ? media.muted : null,
          playPauseTitle: playPause?.getAttribute("title") || "",
          playPauseAriaLabel: playPause?.getAttribute("aria-label") || "",
          sliderValue: slider?.getAttribute("aria-valuenow") || slider?.getAttribute("value") || ""
        },
        containers,
        betterLyrics: {
          wrapperFound: Boolean(document.querySelector("#blyrics-wrapper, .blyrics-wrapper")),
          containerFound: Boolean(document.querySelector(".blyrics-container")),
          childCount: betterContainer?.children.length || 0,
          activeElementCount: activeElements.length,
          children: betterChildren,
          activeElements
        },
        ytmusicLyricsTextSample: cleanText(document.querySelector("ytmusic-lyrics-renderer")?.textContent).slice(0, 2000)
      };
    })();
  `;
}

async function readYtMusicDebugSnapshot(): Promise<unknown> {
  const view = musicView;
  if (!view || view.webContents.isDestroyed()) {
    return { error: "musicView is not available" };
  }

  try {
    return await view.webContents.executeJavaScript(ytmusicDebugSnapshotScript(), true);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function exportDebugState(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = join(process.env.YTMO_DEBUG_DIR || app.getAppPath(), "debug-exports");
  const outputPath = join(outputDir, `yt-music-overlay-debug-${timestamp}.json`);

  const snapshot = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      extensionStatus,
      storage: {
        ...runtimeStoragePaths,
        actualSessionData: app.getPath("sessionData")
      }
    },
    windows: {
      player: playerWindow ? { destroyed: playerWindow.isDestroyed(), bounds: playerWindow.getBounds() } : null,
      overlay: overlayWindow ? { destroyed: overlayWindow.isDestroyed(), bounds: overlayWindow.getBounds() } : null,
      settings: settingsWindow ? { destroyed: settingsWindow.isDestroyed(), bounds: settingsWindow.getBounds() } : null,
      musicView: musicView ? { url: musicView.webContents.getURL(), bounds: musicView.getBounds() } : null
    },
    state,
    latestLyrics,
    latestPlayerState,
    latestLyricsSignature,
    ytmusic: await readYtMusicDebugSnapshot()
  };

  try {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), "utf8");
    return { ok: true, path: outputPath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isEmbeddedAppUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return (
    parsed?.protocol === "https:" &&
    (parsed.hostname === "music.youtube.com" || parsed.hostname === "accounts.google.com")
  );
}

function isBetterLyricsExtensionUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed?.protocol === "chrome-extension:" && parsed.hostname === betterLyricsExtensionId;
}

function openExternalUrl(url: string): void {
  const parsed = parseUrl(url);
  if (!parsed || !["https:", "http:", "mailto:"].includes(parsed.protocol)) {
    return;
  }

  void shell.openExternal(parsed.toString()).catch((error) => {
    sendPlayerStatus(`Unable to open external link: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function createMusicView(): void {
  if (!playerWindow) {
    return;
  }

  const ytmSession = session.fromPartition(ytmusicPartition);
  musicView = new BrowserView({
    webPreferences: {
      preload: preloadPath("ytmusic-preload.js"),
      partition: ytmusicPartition,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  musicView.webContents.setMaxListeners(30);

  playerWindow.setBrowserView(musicView);
  resizeMusicView();

  musicView.webContents.setWindowOpenHandler(({ url }) => {
    if (isEmbeddedAppUrl(url)) {
      return { action: "allow" };
    }

    if (isBetterLyricsExtensionUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 760,
          minWidth: 720,
          minHeight: 520,
          autoHideMenuBar: true,
          backgroundColor: "#121212",
          webPreferences: {
            partition: ytmusicPartition,
            contextIsolation: true,
            nodeIntegration: false
          }
        }
      };
    }

    openExternalUrl(url);
    return { action: "deny" };
  });
  musicView.webContents.on("did-create-window", (window, details) => {
    if (!isBetterLyricsExtensionUrl(details.url)) {
      return;
    }

    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isBetterLyricsExtensionUrl(url)) {
        return { action: "allow" };
      }
      openExternalUrl(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (isBetterLyricsExtensionUrl(url)) {
        return;
      }
      event.preventDefault();
      openExternalUrl(url);
    });
  });

  musicView.webContents.on("did-start-loading", () => {
    sendPlayerStatus(`YouTube Music 載入中 · ${extensionStatus}`);
  });
  musicView.webContents.on("did-stop-loading", () => {
    sendPlayerStatus(`請登入、播放歌曲，並切到 Lyrics 分頁 · ${extensionStatus}`);
    scheduleBetterLyricsFallback();
  });
  musicView.webContents.on("did-fail-load", (_event, _code, description) => {
    sendPlayerStatus(`載入失敗：${description}`);
  });
  musicView.webContents.on("render-process-gone", (_event, details) => {
    const url = musicView?.webContents.getURL() || "https://music.youtube.com";
    sendPlayerStatus(`YouTube Music renderer restarted: ${details.reason}`);
    recreateMusicView(url);
  });
  musicView.webContents.on("unresponsive", () => {
    sendPlayerStatus("YouTube Music became unresponsive. Reloading page.");
    musicView?.webContents.reload();
  });
  musicView.webContents.on("console-message", (event) => {
    const message = event.message;
    if (message.includes("BetterLyrics") || message.includes("Better Lyrics")) {
      sendPlayerStatus(message);
    }
  });

  void ytmSession;
  musicView.webContents.loadURL("https://music.youtube.com");
  stopLyricsPolling();
}

function publishLyricsPayload(payload: LyricsPayload): void {
  latestLyrics = payload;
  overlayWindow?.webContents.send("lyrics:update", latestLyrics);
  if (splitOverlayWindowsEnabled) {
    lyricsWindow?.webContents.send("lyrics:update", latestLyrics);
  }
}

function publishPlayerState(payload: PlayerState): void {
  latestPlayerState = payload;
  overlayWindow?.webContents.send("player-state:update", latestPlayerState);
  if (splitOverlayWindowsEnabled) {
    lyricsWindow?.webContents.send("player-state:update", latestPlayerState);
  }
}

function lyricsSignature(payload: LyricsPayload): string {
  return JSON.stringify({
    status: payload.status,
    title: payload.title,
    artist: payload.artist,
    album: payload.album ?? "",
    isPlaying: payload.isPlaying,
    volume: payload.volume,
    muted: payload.muted,
    activeIndex: payload.activeIndex,
    lineCount: payload.lines.length,
    activeText: payload.lines[payload.activeIndex]?.text ?? "",
    message: payload.message
  });
}

function startLyricsPolling(): void {
  stopLyricsPolling();
}

function stopLyricsPolling(): void {
  if (lyricsPollTimer) {
    clearInterval(lyricsPollTimer);
    lyricsPollTimer = null;
  }
  if (betterLyricsFallbackTimer) {
    clearTimeout(betterLyricsFallbackTimer);
    betterLyricsFallbackTimer = null;
  }
}

function overlayToolbarHeight(): number {
  return state.settings.compactMode ? compactToolbarHeight : normalToolbarHeight;
}

function minimumOverlayHeight(compactMode: boolean): number {
  return compactMode ? compactOverlayMinSize.height : normalOverlayMinSize.height;
}

function sanitizeOverlayBounds(bounds: OverlayBounds, compactMode: boolean): Required<OverlayBounds> {
  const minHeight = minimumOverlayHeight(compactMode);
  return {
    x: bounds.x ?? 120,
    y: bounds.y ?? 120,
    width: Math.max(bounds.width ?? state.settings.width, compactMode ? compactOverlayMinSize.width : normalOverlayMinSize.width),
    height: Math.max(bounds.height ?? 220, minHeight)
  };
}

function currentOverlayBounds(): Required<OverlayBounds> {
  const bounds = state.settings.compactMode ? state.compactBounds : state.bounds;
  return sanitizeOverlayBounds(bounds, state.settings.compactMode);
}

function syncOverlayWindowBounds(): void {
  const bounds = currentOverlayBounds();
  const toolbarHeight = overlayToolbarHeight();

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    applyingOverlayBounds = true;
    overlayWindow.setBounds(splitOverlayWindowsEnabled
      ? {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: toolbarHeight
        }
      : bounds);
    setTimeout(() => {
      applyingOverlayBounds = false;
    }, 0);
  }

  if (splitOverlayWindowsEnabled && lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.setBounds(bounds);
  }

  positionSettingsWindow();
}

function updateOverlayWindowShape(): void {
  void resizeHandleThickness;
}

async function pollLyricsFromMusicView(): Promise<void> {
  const view = musicView;
  if (!view || view.webContents.isDestroyed()) {
    return;
  }

  const url = view.webContents.getURL();
  if (!url.startsWith("https://music.youtube.com")) {
    return;
  }

  const payload = await view.webContents.executeJavaScript(getLyricsPollingScript(), true) as LyricsPayload | null;
  if (!payload || !Array.isArray(payload.lines) || typeof payload.updatedAt !== "number") {
    return;
  }

  const signature = lyricsSignature(payload);
  if (signature === latestLyricsSignature) {
    return;
  }

  latestLyricsSignature = signature;
  publishLyricsPayload(payload);
  sendPlayerStatus(`Overlay sync: ${payload.status}, lines=${payload.lines.length}, active=${payload.activeIndex}`);
}

function getLyricsPollingScript(): string {
  return String.raw`
    (() => {
      const ACTIVE_LINE_HINTS = ["selected", "active", "current", "highlight", "playing", "focused"];
      const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const readBetterLyricsTime = (element) => {
        const timedElement = element?.hasAttribute?.("data-time") ? element : element?.querySelector?.("[data-time]");
        const rawValue = timedElement?.getAttribute?.("data-time");
        const value = Number(rawValue);
        return Number.isFinite(value) ? value : undefined;
      };
      const currentMediaTime = () => {
        const media = document.querySelector("video, audio");
        return media && Number.isFinite(media.currentTime) ? media.currentTime : 0;
      };
      const applyTimedActiveLine = (lines) => {
        if (!lines.some((line) => typeof line.time === "number")) return false;
        const now = currentMediaTime();
        let activeIndex = -1;
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          if (typeof lines[index].time === "number" && lines[index].time <= now + 0.05) {
            activeIndex = index;
            break;
          }
        }
        if (activeIndex < 0) return false;
        lines.forEach((line, index) => {
          line.active = index === activeIndex;
        });
        return true;
      };
      const extractBetterLyricsText = (element) => {
        const wordNodes = Array.from(element.querySelectorAll(".blyrics--word"));
        if (wordNodes.length > 0) {
          const words = wordNodes
            .map((node) => cleanText(node.textContent || node.getAttribute("data-content")))
            .filter(Boolean);
          return cleanText(words.reduce((result, word) => {
            if (!result) {
              return word;
            }
            const needsSpace = /[A-Za-z0-9]$/.test(result) && /^[A-Za-z0-9]/.test(word);
            return result + (needsSpace ? " " : "") + word;
          }, ""));
        }

        const pieces = [];
        const walk = (node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            pieces.push(node.textContent || "");
            return;
          }
          if (!(node instanceof Element)) return;
          const className = String(node.getAttribute("class") || "");
          const beforeLength = pieces.length;
          for (const child of Array.from(node.childNodes)) walk(child);
          if (className.includes("blyrics--has-trailing-space") && pieces.length > beforeLength) {
            pieces.push(" ");
          }
        };
        walk(element);
        return cleanText(pieces.join(""));
      };
      const isVisible = (element) => {
        if (!element || !(element instanceof Element)) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
      };
      const firstText = (selectors) => {
        for (const selector of selectors) {
          const text = cleanText(document.querySelector(selector)?.textContent);
          if (text) return text;
        }
        return "";
      };
      const splitSubtitle = (value) => cleanText(value)
        .split(/\s*[•·]\s*/)
        .map((part) => cleanText(part))
        .filter(Boolean);
      const hasActiveHint = (element) => {
        if (!element) return false;
        const className = typeof element.className === "string" ? element.className : String(element.getAttribute("class") || "");
        const text = [
          className,
          element.getAttribute("aria-current") || "",
          element.getAttribute("aria-selected") || "",
          element.getAttribute("data-active") || ""
        ].join(" ").toLowerCase();
        return ACTIVE_LINE_HINTS.some((hint) => text.includes(hint));
      };
      const isBetterLyricsActive = (element, root) => {
        if (!element) return false;
        const hasAnimating = element.matches?.(".blyrics--animating") || element.querySelector?.(".blyrics--animating");
        if (hasAnimating) return true;

        const hasPreAnimating = element.matches?.(".blyrics--pre-animating") || element.querySelector?.(".blyrics--pre-animating");
        if (hasPreAnimating) return false;

        const activeSelector = ".blyrics--active";
        if (element.matches?.(activeSelector) || element.querySelector?.(activeSelector)) return true;
        let current = element.parentElement;
        while (current && current !== root.parentElement) {
          const className = String(current.getAttribute("class") || "").toLowerCase();
          if (className.includes("blyrics--animating")) return true;
          if (className.includes("blyrics--pre-animating")) return false;
          if (className.includes("blyrics--active")) return true;
          if (current === root) return false;
          current = current.parentElement;
        }
        return false;
      };
      const getPlaybackState = () => {
        const video = document.querySelector("video");
        if (video) return Boolean(!video.paused && !video.ended);
        const playPause = document.querySelector("ytmusic-player-bar tp-yt-paper-icon-button.play-pause-button, ytmusic-player-bar .play-pause-button");
        const label = cleanText((playPause?.getAttribute("title") || "") + " " + (playPause?.getAttribute("aria-label") || "")).toLowerCase();
        if (label.includes("pause") || label.includes("暫停")) return true;
        if (label.includes("play") || label.includes("播放")) return false;
        return false;
      };
      const getVolumeState = () => {
        const media = document.querySelector("video, audio");
        const slider = document.querySelector("ytmusic-player-bar tp-yt-paper-slider#volume-slider, ytmusic-player-bar #volume-slider, ytmusic-player-bar tp-yt-paper-slider");
        const rawSliderValue =
          slider?.getAttribute("aria-valuenow") ||
          slider?.getAttribute("value") ||
          String(slider?.immediateValue ?? slider?.value ?? "");
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
      };
      const title = firstText([
        "#blyrics-title",
        ".blyrics-title",
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
      const artist = firstText(["#blyrics-artist", ".blyrics-artist"]) || subtitleParts[0] || "";
      const album = firstText(["#blyrics-album", ".blyrics-album"]) || subtitleParts.slice(1).join(" • ");
      const volumeState = getVolumeState();
      const makePayload = (status, lines, activeIndex, message) => ({
        status,
        title,
        artist,
        album,
        isPlaying: getPlaybackState(),
        volume: volumeState.volume,
        muted: volumeState.muted,
        lines,
        activeIndex,
        message,
        updatedAt: Date.now()
      });
      const collectBetterLyricsLines = () => {
        const root = document.querySelector(".blyrics-container");
        if (!root || !isVisible(root)) return [];
        const candidates = Array.from(root.children)
          .filter((element) => element instanceof HTMLElement && isVisible(element));
        const lines = [];
        for (const element of candidates) {
          const className = String(element.getAttribute("class") || "").toLowerCase();
          if (
            className.includes("blyrics--word") ||
            className.includes("blyrics-footer") ||
            className.includes("blyrics-modal") ||
            className.includes("blyrics-loader") ||
            className.includes("blyrics-button") ||
            element.closest(".blyrics-footer, .blyrics-modal, .blyrics-loader, button, tp-yt-paper-button")
          ) continue;
          const text = extractBetterLyricsText(element);
          if (!text || text.length > 220) continue;
          const active = isBetterLyricsActive(element, root);
          lines.push({ text, active, time: readBetterLyricsTime(element) });
        }
        const hasTimedActiveLine = applyTimedActiveLine(lines);
        const activeElement =
          root.querySelector(".blyrics--animating") ||
          Array.from(root.querySelectorAll(".blyrics--active")).find((element) => !element.matches(".blyrics--pre-animating") && !element.querySelector(".blyrics--pre-animating"));
        const activeLineElement = activeElement?.closest(".blyrics-container > div");
        const activeText = activeLineElement ? extractBetterLyricsText(activeLineElement) : activeElement ? extractBetterLyricsText(activeElement) : "";
        if (!hasTimedActiveLine && activeText && !lines.some((line) => line.active)) {
          const index = lines.findIndex((line) => line.text === activeText || activeText.includes(line.text) || line.text.includes(activeText));
          if (index >= 0) {
            lines[index].active = true;
          }
          else lines.push({ text: activeText, active: true, time: activeLineElement ? readBetterLyricsTime(activeLineElement) : undefined });
        }
        return lines.slice(0, 140);
      };
      const findNativeLyricsContainer = () => {
        const selectors = [
          "ytmusic-lyrics-renderer",
          "ytmusic-description-shelf-renderer",
          "ytmusic-tab-renderer[page-type='MUSIC_PAGE_TYPE_TRACK_LYRICS']",
          "#lyrics",
          "[data-testid*='lyrics' i]",
          "[aria-label*='lyrics' i]",
          "[aria-label*='歌詞' i]"
        ];
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element && isVisible(element)) return element;
        }
        return null;
      };
      const collectNativeLines = () => {
        const container = findNativeLyricsContainer();
        if (!container) return [];
        const nodes = Array.from(container.querySelectorAll("yt-formatted-string, div, span, p")).filter(isVisible);
        const lines = [];
        for (const element of nodes) {
          const role = element.getAttribute("role") || "";
          if (/button|tab/i.test(role) || element.closest("button, tp-yt-paper-button")) continue;
          const text = cleanText(element.textContent);
          if (!text || text.length > 220) continue;
          lines.push({ text, active: hasActiveHint(element) || hasActiveHint(element.parentElement) });
        }
        return lines.slice(0, 120);
      };
      const betterLines = collectBetterLyricsLines();
      const nativeLines = betterLines.length ? [] : collectNativeLines();
      const lines = betterLines.length ? betterLines : nativeLines;
      const activeIndex = lines.findIndex((line) => line.active);
      const hasLyricsSurface = Boolean(
        document.querySelector("#blyrics-wrapper, .blyrics-wrapper, .blyrics-container, [class*='blyrics']") ||
        findNativeLyricsContainer()
      );
      let status = "ready";
      let message = "";
      if (!title && !artist && !getPlaybackState()) {
        status = "not-playing";
        message = "Play a song in YouTube Music.";
      } else if (!hasLyricsSurface) {
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
    })()
  `;
}

function scheduleBetterLyricsFallback(): void {
  const view = musicView;
  if (!view || betterLyricsFallbackTimer || betterLyricsFallbackInjecting) {
    return;
  }

  betterLyricsFallbackTimer = setTimeout(() => {
    betterLyricsFallbackTimer = null;
    injectBetterLyricsFallback(view).catch((error) => {
      sendPlayerStatus(`Better Lyrics fallback failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, 5000);
}

async function injectBetterLyricsFallback(view: BrowserView): Promise<void> {
  if (betterLyricsFallbackInjecting) {
    return;
  }
  betterLyricsFallbackInjecting = true;
  try {
  if (view.webContents.isDestroyed() || !view.webContents.getURL().startsWith("https://music.youtube.com")) {
    return;
  }

  const alreadyPresent = await view.webContents.executeJavaScript(
    "Boolean(window.__betterLyricsElectronFallback || document.querySelector('[id^=\"blyrics\"], .blyrics-container'))",
    true
  );
  if (alreadyPresent) {
    return;
  }

  const extensionId = "effdbpeggelllpfkjppbokhmmiinhlmg";
  const manifest = readFileSync(join(betterLyricsPath(), "manifest.json"), "utf8");
  const earlyInject = readFileSync(join(betterLyricsPath(), "earlyInject.js"), "utf8");
  const playerIntegrationScript = readFileSync(join(betterLyricsPath(), "script.js"), "utf8");
  const betterLyricsScript = readFileSync(join(betterLyricsPath(), "content_scripts", "content-0.js"), "utf8");
  const shim = `
    (() => {
      if (window.__betterLyricsElectronFallback) return;
      window.__betterLyricsElectronFallback = true;
      const manifest = ${manifest};
      const listeners = [];
      const storageKey = "__betterLyricsElectronStorage";
      const readStore = () => {
        try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); }
        catch { return {}; }
      };
      const writeStore = (store) => localStorage.setItem(storageKey, JSON.stringify(store));
      const normalizeGet = (keys, store) => {
        if (keys == null) return { ...store };
        if (typeof keys === "string") return { [keys]: store[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, store[key]]));
        if (typeof keys === "object") return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, store[key] ?? fallback]));
        return {};
      };
      const area = {
        get(keys, callback) {
          const result = normalizeGet(keys, readStore());
          callback?.(result);
          return Promise.resolve(result);
        },
        set(values, callback) {
          const store = readStore();
          const changes = {};
          for (const [key, newValue] of Object.entries(values || {})) {
            changes[key] = { oldValue: store[key], newValue };
            store[key] = newValue;
          }
          writeStore(store);
          for (const listener of listeners) listener(changes, "local");
          callback?.();
          return Promise.resolve();
        },
        remove(keys, callback) {
          const store = readStore();
          for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
          writeStore(store);
          callback?.();
          return Promise.resolve();
        }
      };
      window.chrome = window.chrome || {};
      chrome.storage = chrome.storage || {};
      chrome.storage.local = chrome.storage.local || area;
      chrome.storage.sync = chrome.storage.sync || chrome.storage.local;
      chrome.storage.onChanged = chrome.storage.onChanged || { addListener: (fn) => listeners.push(fn), removeListener: () => {} };
      chrome.runtime = chrome.runtime || {};
      chrome.runtime.id = chrome.runtime.id || ${JSON.stringify(extensionId)};
      chrome.runtime.getManifest = chrome.runtime.getManifest || (() => manifest);
      chrome.runtime.getURL = chrome.runtime.getURL || ((path) => "chrome-extension://${extensionId}/" + String(path).replace(/^\\//, ""));
      chrome.runtime.onMessage = chrome.runtime.onMessage || { addListener: () => {}, removeListener: () => {} };
      chrome.runtime.sendMessage = chrome.runtime.sendMessage || ((message, callback) => { callback?.({}); return Promise.resolve({}); });
      chrome.runtime.connect = chrome.runtime.connect || (() => ({ postMessage: () => {}, disconnect: () => {}, onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} } }));
      chrome.i18n = chrome.i18n || { getMessage: (key) => key };
    })();
  `;

  await view.webContents.executeJavaScript(shim, true);
  await view.webContents.executeJavaScript(earlyInject, true);
  await view.webContents.executeJavaScript(playerIntegrationScript, true);
  await view.webContents.executeJavaScript(betterLyricsScript, true);
  sendPlayerStatus("Better Lyrics fallback injected into YouTube Music.");
  } finally {
    betterLyricsFallbackInjecting = false;
  }
}

function resizeMusicView(): void {
  if (!playerWindow || !musicView) {
    return;
  }

  const [width, height] = playerWindow.getContentSize();
  if (playerWindow.isMinimized() || width <= 0 || height <= 64) {
    return;
  }

  musicView.setBounds({ x: 0, y: 64, width, height: Math.max(1, height - 64) });
}

function ensureMusicViewVisible(): void {
  if (!playerWindow || playerWindow.isDestroyed()) {
    return;
  }

  if (!musicView || musicView.webContents.isDestroyed()) {
    createMusicView();
    return;
  }

  if (!playerWindow.getBrowserViews().includes(musicView)) {
    playerWindow.setBrowserView(musicView);
  }
  resizeMusicView();
}

function recreateMusicView(url = "https://music.youtube.com"): void {
  if (!playerWindow || playerWindow.isDestroyed() || isClosingApp) {
    return;
  }

  stopLyricsPolling();
  if (musicView && !musicView.webContents.isDestroyed()) {
    playerWindow.removeBrowserView(musicView);
  }
  musicView = null;
  createMusicView();
  const nextView = musicView as BrowserView | null;
  if (url.startsWith("https://music.youtube.com") || url.startsWith("https://accounts.google.com")) {
    nextView?.webContents.loadURL(url);
  }
}

function focusExistingInstance(): void {
  if (!playerWindow || playerWindow.isDestroyed()) {
    return;
  }

  if (playerWindow.isMinimized()) {
    playerWindow.restore();
  }
  playerWindow.show();
  playerWindow.focus();
  ensureMusicViewVisible();
}

async function loadBetterLyricsExtension(): Promise<void> {
  const ytmSession = session.fromPartition("persist:yt-music-overlay");
  try {
    const extension = await ytmSession.extensions.loadExtension(betterLyricsPath(), {
      allowFileAccess: false
    });
    extensionStatus = `Loaded ${extension.name} ${extension.version ?? ""}`.trim();
  } catch (error) {
    extensionStatus = `Better Lyrics extension failed to load: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function createOverlayWindow(): void {
  const bounds = currentOverlayBounds();
  const minSize = state.settings.compactMode ? compactOverlayMinSize : normalOverlayMinSize;
  const toolbarHeight = overlayToolbarHeight();

  if (splitOverlayWindowsEnabled) {
    lyricsWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: minSize.width,
      minHeight: minSize.height,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      title: "YT Music Lyrics Overlay",
      backgroundColor: "#00000000",
      webPreferences: {
        preload: preloadPath("overlay-preload.js"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    lyricsWindow.setAlwaysOnTop(true, "screen-saver");
    lyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    lyricsWindow.setIgnoreMouseEvents(true, { forward: true });
    lyricsWindow.loadFile(rendererPath("overlay-lyrics.html"));

    lyricsWindow.webContents.on("console-message", (event) => {
      sendPlayerStatus(`Lyrics overlay console: ${event.message}`);
    });

    lyricsWindow.webContents.on("did-finish-load", () => {
      lyricsWindow?.webContents.send("overlay:settings", state.settings);
      lyricsWindow?.webContents.send("lyrics:update", latestLyrics);
    });

    lyricsWindow.on("closed", () => {
      lyricsWindow = null;
    });
  }

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: splitOverlayWindowsEnabled ? toolbarHeight : bounds.height,
    minWidth: minSize.width,
    minHeight: splitOverlayWindowsEnabled ? toolbarHeight : minSize.height,
    maxHeight: splitOverlayWindowsEnabled ? toolbarHeight : undefined,
    frame: false,
    transparent: true,
    resizable: !state.settings.locked,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: "YT Music Lyrics Overlay",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadPath("overlay-preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setMinimumSize(minSize.width, splitOverlayWindowsEnabled ? toolbarHeight : minSize.height);
  if (splitOverlayWindowsEnabled) {
    overlayWindow.setMaximumSize(10000, toolbarHeight);
  }
  overlayWindow.setIgnoreMouseEvents(false);
  overlayWindow.loadFile(rendererPath(splitOverlayWindowsEnabled ? "overlay-toolbar.html" : "overlay.html"));

  overlayWindow.webContents.on("console-message", (event) => {
    sendPlayerStatus(`Overlay console: ${event.message}`);
  });

  overlayWindow.webContents.on("did-finish-load", () => {
    overlayWindow?.webContents.send("overlay:settings", state.settings);
    overlayWindow?.webContents.send("lyrics:update", latestLyrics);
  });

  overlayWindow.on("show", publishOverlayVisibility);
  overlayWindow.on("hide", publishOverlayVisibility);
  overlayWindow.on("move", rememberOverlayBounds);
  overlayWindow.on("moved", rememberOverlayBounds);
  overlayWindow.on("resize", rememberOverlayBounds);
  overlayWindow.on("resized", () => {
    rememberOverlayBounds();
  });
  overlayWindow.on("close", () => {
    rememberOverlayBounds();
    persistNow();
    lyricsWindow?.close();
  });
  overlayWindow.on("closed", () => {
    settingsWindow?.close();
    overlayWindow = null;
    publishOverlayVisibility();
  });
}

function createSettingsWindow(anchor?: { x: number; y: number; width: number; height: number }): void {
  latestSettingsAnchor = anchor ?? latestSettingsAnchor;
  const overlayBounds = currentOverlayBounds();
  settingsWindowOffset = {
    x: Math.round((anchor?.x ?? (overlayBounds.width - 42)) + (anchor?.width ?? 30) - settingsPanelSize.width),
    y: Math.round(anchor?.y ?? 42)
  };
  const x = Math.round(overlayBounds.x + settingsWindowOffset.x);
  const y = Math.round(overlayBounds.y + settingsWindowOffset.y);

  settingsWindow = new BrowserWindow({
    x,
    y,
    width: settingsPanelSize.width,
    height: settingsPanelSize.height,
    minWidth: settingsPanelSize.width,
    minHeight: settingsPanelSize.height,
    maxWidth: settingsPanelSize.width,
    maxHeight: settingsPanelSize.height,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: "YT Music Overlay Settings",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadPath("overlay-preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.setAlwaysOnTop(true, "screen-saver");
  settingsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  settingsWindow.setMinimumSize(settingsPanelSize.width, settingsPanelSize.height);
  settingsWindow.setMaximumSize(settingsPanelSize.width, settingsPanelSize.height);
  settingsWindow.loadFile(rendererPath("settings.html"));
  settingsWindow.webContents.on("did-finish-load", () => {
    settingsWindow?.webContents.send("overlay:settings", state.settings);
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function toggleSettingsWindow(anchor?: { x: number; y: number; width: number; height: number }): void {
  latestSettingsAnchor = anchor ?? latestSettingsAnchor;
  if (settingsWindow) {
    if (anchor) {
      settingsWindowOffset = {
        x: Math.round(anchor.x + anchor.width - settingsPanelSize.width),
        y: Math.round(anchor.y)
      };
    }
    positionSettingsWindow();
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  createSettingsWindow(anchor);
}

function positionSettingsWindow(): void {
  if (!settingsWindow || !settingsWindowOffset) {
    return;
  }
  const overlayBounds = currentOverlayBounds();
  settingsWindow.setBounds({
    x: Math.round(overlayBounds.x + settingsWindowOffset.x),
    y: Math.round(overlayBounds.y + settingsWindowOffset.y),
    width: settingsPanelSize.width,
    height: settingsPanelSize.height
  });
}

function lyricsSearchSettingsPosition(anchor: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  if (!playerWindow || playerWindow.isDestroyed()) {
    return { x: 0, y: 0 };
  }
  const contentBounds = playerWindow.getContentBounds();
  const desiredX = contentBounds.x + anchor.x + anchor.width - lyricsSearchSettingsPanelSize.width;
  const desiredY = contentBounds.y + anchor.y + anchor.height + 8;
  return {
    x: Math.round(Math.max(contentBounds.x + 8, Math.min(desiredX, contentBounds.x + contentBounds.width - lyricsSearchSettingsPanelSize.width - 8))),
    y: Math.round(Math.max(contentBounds.y + 8, Math.min(desiredY, contentBounds.y + contentBounds.height - lyricsSearchSettingsPanelSize.height - 8)))
  };
}

function toggleLyricsSearchSettingsWindow(anchor: { x: number; y: number; width: number; height: number }): void {
  if (!playerWindow || playerWindow.isDestroyed()) {
    return;
  }
  if (lyricsSearchSettingsWindow && !lyricsSearchSettingsWindow.isDestroyed()) {
    lyricsSearchSettingsWindow.close();
    return;
  }

  const position = lyricsSearchSettingsPosition(anchor);
  lyricsSearchSettingsWindow = new BrowserWindow({
    parent: playerWindow,
    x: position.x,
    y: position.y,
    width: lyricsSearchSettingsPanelSize.width,
    height: lyricsSearchSettingsPanelSize.height,
    minWidth: lyricsSearchSettingsPanelSize.width,
    minHeight: lyricsSearchSettingsPanelSize.height,
    maxWidth: lyricsSearchSettingsPanelSize.width,
    maxHeight: lyricsSearchSettingsPanelSize.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    title: "Lyrics Search Settings",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadPath("player-preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  lyricsSearchSettingsWindow.setMenuBarVisibility(false);
  lyricsSearchSettingsWindow.loadFile(rendererPath("lyrics-search-settings.html"));
  lyricsSearchSettingsWindow.once("ready-to-show", () => {
    lyricsSearchSettingsWindow?.show();
    lyricsSearchSettingsWindow?.focus();
  });
  lyricsSearchSettingsWindow.on("closed", () => {
    lyricsSearchSettingsWindow = null;
  });
}

function updateLyricsSearchSites(sites: unknown): { ok: boolean } {
  const normalizedSites = Array.isArray(sites)
    ? [...new Set(sites
      .filter((site): site is string => typeof site === "string")
      .map((site) => site.trim())
      .filter(Boolean)
      .map((site) => site.slice(0, 500)))]
      .slice(0, 50)
    : [];

  state.settings = {
    ...state.settings,
    lyricsSearchSites: normalizedSites
  };
  playerWindow?.webContents.send("overlay:settings", state.settings);
  settingsWindow?.webContents.send("overlay:settings", state.settings);
  overlayWindow?.webContents.send("overlay:settings", state.settings);
  lyricsWindow?.webContents.send("overlay:settings", state.settings);
  schedulePersist();
  return { ok: true };
}

function rememberOverlayBounds(): void {
  if (!overlayWindow) {
    return;
  }
  if (applyingOverlayBounds) {
    return;
  }

  const toolbarBounds = overlayWindow.getBounds();
  const bounds = {
    x: toolbarBounds.x,
    y: toolbarBounds.y,
    width: toolbarBounds.width,
    height: splitOverlayWindowsEnabled ? currentOverlayBounds().height : toolbarBounds.height
  } satisfies OverlayBounds;
  if (state.settings.compactMode) {
    state.compactBounds = bounds;
  } else {
    state.bounds = bounds;
  }
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.setBounds(bounds);
  }
  positionSettingsWindow();
  schedulePersist();
}

function applyOverlayModeMinSize(compactMode: boolean): void {
  if (!overlayWindow) {
    return;
  }
  const minSize = compactMode ? compactOverlayMinSize : normalOverlayMinSize;
  const toolbarHeight = compactMode ? compactToolbarHeight : normalToolbarHeight;
  overlayWindow.setMinimumSize(minSize.width, splitOverlayWindowsEnabled ? toolbarHeight : minSize.height);
  if (splitOverlayWindowsEnabled) {
    overlayWindow.setMaximumSize(10000, toolbarHeight);
  } else {
    overlayWindow.setMaximumSize(10000, 10000);
  }
  lyricsWindow?.setMinimumSize(minSize.width, minSize.height);
}

function updateOverlaySettings(settings: OverlaySettings): void {
  const wasCompact = state.settings.compactMode;
  const willBeCompact = settings.compactMode;
  const modeChanged = wasCompact !== willBeCompact;

  if (modeChanged) {
    const currentBounds = currentOverlayBounds() satisfies OverlayBounds;
    if (wasCompact) {
      state.compactBounds = currentBounds;
    } else {
      state.bounds = currentBounds;
    }
  }

  state.settings = settings;
  applyOverlayModeMinSize(settings.compactMode);
  overlayWindow?.setResizable(!settings.locked);
  updateOverlayWindowShape();

  if (modeChanged) {
    const targetBounds = willBeCompact ? state.compactBounds : state.bounds;
    const currentBounds = currentOverlayBounds();
    const nextBounds = sanitizeOverlayBounds({
      ...currentBounds,
      ...targetBounds
    }, willBeCompact);
    if (willBeCompact) {
      state.compactBounds = nextBounds;
    } else {
      state.bounds = nextBounds;
    }
    syncOverlayWindowBounds();
  } else {
    positionSettingsWindow();
  }

  overlayWindow?.webContents.send("overlay:settings", settings);
  lyricsWindow?.webContents.send("overlay:settings", settings);
  settingsWindow?.webContents.send("overlay:settings", settings);
  playerWindow?.webContents.send("overlay:settings", settings);
  schedulePersist();
}

function wireIpc(): void {
  ipcMain.handle("app:get-youtube-preload", () => preloadPath("ytmusic-preload.js"));
  ipcMain.handle("app:get-state", () => state);
  ipcMain.handle("app:get-latest-lyrics", () => latestLyrics);
  ipcMain.handle("app:get-latest-player-state", () => latestPlayerState);
  ipcMain.handle("app:get-overlay-visibility", () => isOverlayVisible());
  ipcMain.handle("app:get-extension-status", () => extensionStatus);
  ipcMain.handle("app:export-debug-state", () => exportDebugState());
  ipcMain.handle("app:copy-lyrics-search-prompt", () => copyLyricsSearchPrompt());
  ipcMain.handle("app:update-lyrics-search-sites", (_event, sites: unknown) => updateLyricsSearchSites(sites));

  ipcMain.on("app:toggle-lyrics-search-settings", (_event, rect: { x: number; y: number; width: number; height: number }) => {
    toggleLyricsSearchSettingsWindow(rect);
  });

  ipcMain.on("app:close-lyrics-search-settings", () => {
    lyricsSearchSettingsWindow?.close();
  });

  ipcMain.on("ytmusic:lyrics", (_event, payload: LyricsPayload) => {
    latestLyricsSignature = lyricsSignature(payload);
    publishLyricsPayload(payload);
  });

  ipcMain.on("ytmusic:player-state", (_event, payload: PlayerState) => {
    if (typeof payload.volume !== "number" || typeof payload.muted !== "boolean") {
      return;
    }
    publishPlayerState(payload);
  });

  ipcMain.on("overlay:update-settings", (_event, settings: OverlaySettings) => {
    updateOverlaySettings(settings);
  });

  ipcMain.on("overlay:toggle-settings-panel", (_event, rect: { x: number; y: number; width: number; height: number }) => {
    toggleSettingsWindow(rect);
  });

  ipcMain.on("overlay:close-settings-panel", () => {
    settingsWindow?.close();
  });

  ipcMain.on("overlay:hide", () => {
    setOverlayVisibility(false);
  });

  ipcMain.on("overlay:toolbar-hover", (_event, hovered: boolean) => {
    void hovered;
  });

  ipcMain.on("overlay:drag-start", (_event, point: { x: number; y: number }) => {
    if (!overlayWindow || overlayWindow.isDestroyed() || state.settings.locked) {
      return;
    }
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    overlayDragWasResizable = overlayWindow.isResizable();
    overlayWindow.setResizable(false);
    overlayDragStartBounds = overlayWindow.getBounds();
    overlayDragStartPoint = { x, y };
  });

  ipcMain.on("overlay:drag-to", (_event, point: { x: number; y: number }) => {
    if (!overlayWindow || overlayWindow.isDestroyed() || state.settings.locked || !overlayDragStartBounds || !overlayDragStartPoint) {
      return;
    }
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    overlayWindow.setBounds({
      x: Math.round(overlayDragStartBounds.x + x - overlayDragStartPoint.x),
      y: Math.round(overlayDragStartBounds.y + y - overlayDragStartPoint.y),
      width: overlayDragStartBounds.width,
      height: overlayDragStartBounds.height
    });
    positionSettingsWindow();
  });

  ipcMain.on("overlay:drag-end", () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return;
    }
    overlayWindow.setResizable(overlayDragWasResizable && !state.settings.locked);
    overlayDragStartBounds = null;
    overlayDragStartPoint = null;
    rememberOverlayBounds();
    persistNow();
  });

  ipcMain.on("overlay:music-command", (_event, command: string, value?: number) => {
    sendMusicControl(command, value).catch((error) => {
      sendPlayerStatus(`Music control failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  ipcMain.on("ytmusic:player-control-activated", (_event, command: string) => {
    if (!["play-pause", "previous", "next"].includes(command)) {
      return;
    }
    expandPlayerPageFromCurrentPlayback(`native-${command}`).catch((error) => {
      sendPlayerStatus(`Native player expand failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  ipcMain.on("player:command", (_event, command: string) => {
    if (command === "back" && musicView?.webContents.navigationHistory.canGoBack()) {
      musicView.webContents.navigationHistory.goBack();
    }

    if (command === "forward" && musicView?.webContents.navigationHistory.canGoForward()) {
      musicView.webContents.navigationHistory.goForward();
    }

    if (command === "reload") {
      musicView?.webContents.reload();
    }

    if (command === "show-overlay") {
      setOverlayVisibility(true);
    }

    if (command === "hide-overlay") {
      setOverlayVisibility(false);
    }

    if (command === "open-user-data") {
      shell.openPath(app.getPath("userData"));
    }

  });
}

app.on("second-instance", () => {
  focusExistingInstance();
});

app.whenReady().then(async () => {
  if (!singleInstanceLock) {
    return;
  }

  app.setAppUserModelId("local.yt-music-overlay");
  wireIpc();
  await loadBetterLyricsExtension();
  createPlayerWindow();
  createOverlayWindow();
  setTimeout(() => {
    checkForUpdates().catch(() => undefined);
  }, 2500);
});

app.on("activate", () => {
  if (isClosingApp) {
    return;
  }
  if (!playerWindow) {
    createPlayerWindow();
  }
  if (!overlayWindow) {
    createOverlayWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  persistNow();
});
