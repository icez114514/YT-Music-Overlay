import { contextBridge, ipcRenderer } from "electron";
import { LyricsPayload, OverlaySettings, PersistedState } from "../shared/types";

contextBridge.exposeInMainWorld("playerApi", {
  getState: (): Promise<PersistedState> => ipcRenderer.invoke("app:get-state"),
  getOverlayVisibility: (): Promise<boolean> => ipcRenderer.invoke("app:get-overlay-visibility"),
  getYouTubePreloadPath: () => ipcRenderer.invoke("app:get-youtube-preload"),
  getExtensionStatus: () => ipcRenderer.invoke("app:get-extension-status"),
  exportDebugState: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke("app:export-debug-state"),
  copyLyricsSearchPrompt: (): Promise<{ ok: boolean; title?: string; error?: string }> =>
    ipcRenderer.invoke("app:copy-lyrics-search-prompt"),
  toggleLyricsSearchSettings: (rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send("app:toggle-lyrics-search-settings", rect),
  updateLyricsSearchSites: (sites: string[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("app:update-lyrics-search-sites", sites),
  closeLyricsSearchSettings: () => ipcRenderer.send("app:close-lyrics-search-settings"),
  sendLyrics: (payload: LyricsPayload) => ipcRenderer.send("ytmusic:lyrics", payload),
  command: (command: string) => ipcRenderer.send("player:command", command),
  onSettings: (callback: (settings: OverlaySettings) => void) => {
    ipcRenderer.on("overlay:settings", (_event, settings: OverlaySettings) => callback(settings));
  },
  onStatus: (callback: (message: string) => void) => {
    ipcRenderer.on("player:status", (_event, message: string) => callback(message));
  },
  onOverlayVisibility: (callback: (visible: boolean) => void) => {
    ipcRenderer.on("overlay:visibility", (_event, visible: boolean) => callback(visible));
  }
});
