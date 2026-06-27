import { contextBridge, ipcRenderer } from "electron";
import { LyricsPayload, OverlaySettings, PersistedState, PlayerState } from "../shared/types";

contextBridge.exposeInMainWorld("overlayApi", {
  getState: (): Promise<PersistedState> => ipcRenderer.invoke("app:get-state"),
  getLatestLyrics: (): Promise<LyricsPayload> => ipcRenderer.invoke("app:get-latest-lyrics"),
  getLatestPlayerState: (): Promise<PlayerState> => ipcRenderer.invoke("app:get-latest-player-state"),
  onLyrics: (callback: (payload: LyricsPayload) => void) => {
    ipcRenderer.on("lyrics:update", (_event, payload: LyricsPayload) => callback(payload));
  },
  onPlayerState: (callback: (payload: PlayerState) => void) => {
    ipcRenderer.on("player-state:update", (_event, payload: PlayerState) => callback(payload));
  },
  onSettings: (callback: (settings: OverlaySettings) => void) => {
    ipcRenderer.on("overlay:settings", (_event, settings: OverlaySettings) => callback(settings));
  },
  updateSettings: (settings: OverlaySettings) => ipcRenderer.send("overlay:update-settings", settings),
  toggleSettingsPanel: (rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send("overlay:toggle-settings-panel", rect),
  closeSettingsPanel: () => ipcRenderer.send("overlay:close-settings-panel"),
  hideOverlay: () => ipcRenderer.send("overlay:hide"),
  setOverlayToolbarHover: (hovered: boolean) => ipcRenderer.send("overlay:toolbar-hover", hovered),
  startOverlayDrag: (point: { x: number; y: number }) => ipcRenderer.send("overlay:drag-start", point),
  dragOverlayTo: (point: { x: number; y: number }) => ipcRenderer.send("overlay:drag-to", point),
  endOverlayDrag: () => ipcRenderer.send("overlay:drag-end"),
  musicCommand: (command: string, value?: number) => ipcRenderer.send("overlay:music-command", command, value)
});
