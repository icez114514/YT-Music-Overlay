import { contextBridge, ipcRenderer } from "electron";
import { LyricsPayload } from "../shared/types";

contextBridge.exposeInMainWorld("playerApi", {
  getYouTubePreloadPath: () => ipcRenderer.invoke("app:get-youtube-preload"),
  getExtensionStatus: () => ipcRenderer.invoke("app:get-extension-status"),
  sendLyrics: (payload: LyricsPayload) => ipcRenderer.send("ytmusic:lyrics", payload),
  command: (command: string) => ipcRenderer.send("player:command", command),
  onStatus: (callback: (message: string) => void) => {
    ipcRenderer.on("player:status", (_event, message: string) => callback(message));
  }
});
