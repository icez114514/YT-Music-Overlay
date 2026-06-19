import { contextBridge, ipcRenderer } from "electron";
import { LyricsPayload, OverlaySettings, PersistedState } from "../shared/types";

contextBridge.exposeInMainWorld("overlayApi", {
  getState: (): Promise<PersistedState> => ipcRenderer.invoke("app:get-state"),
  getLatestLyrics: (): Promise<LyricsPayload> => ipcRenderer.invoke("app:get-latest-lyrics"),
  onLyrics: (callback: (payload: LyricsPayload) => void) => {
    ipcRenderer.on("lyrics:update", (_event, payload: LyricsPayload) => callback(payload));
  },
  onSettings: (callback: (settings: OverlaySettings) => void) => {
    ipcRenderer.on("overlay:settings", (_event, settings: OverlaySettings) => callback(settings));
  },
  updateSettings: (settings: OverlaySettings) => ipcRenderer.send("overlay:update-settings", settings),
  toggleSettingsPanel: (rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send("overlay:toggle-settings-panel", rect),
  closeSettingsPanel: () => ipcRenderer.send("overlay:close-settings-panel"),
  setMouseEvents: (ignore: boolean) => ipcRenderer.send("overlay:set-mouse-events", ignore)
});
