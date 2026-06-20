import { contextBridge, ipcRenderer } from "electron";
import { LyricsPayload, OverlaySettings, PersistedState } from "../shared/types";

contextBridge.exposeInMainWorld("playerApi", {
  getState: (): Promise<PersistedState> => ipcRenderer.invoke("app:get-state"),
  getYouTubePreloadPath: () => ipcRenderer.invoke("app:get-youtube-preload"),
  getExtensionStatus: () => ipcRenderer.invoke("app:get-extension-status"),
  sendLyrics: (payload: LyricsPayload) => ipcRenderer.send("ytmusic:lyrics", payload),
  command: (command: string) => ipcRenderer.send("player:command", command),
  onSettings: (callback: (settings: OverlaySettings) => void) => {
    ipcRenderer.on("overlay:settings", (_event, settings: OverlaySettings) => callback(settings));
  },
  onStatus: (callback: (message: string) => void) => {
    ipcRenderer.on("player:status", (_event, message: string) => callback(message));
  }
});
