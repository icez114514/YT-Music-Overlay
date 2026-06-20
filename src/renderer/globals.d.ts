import { LyricsPayload, OverlaySettings, PersistedState } from "../shared/types";

declare global {
  interface Window {
    playerApi: {
      getYouTubePreloadPath: () => Promise<string>;
      getExtensionStatus: () => Promise<string>;
      sendLyrics: (payload: LyricsPayload) => void;
      command: (command: string) => void;
      onStatus: (callback: (message: string) => void) => void;
    };
    overlayApi: {
      getState: () => Promise<PersistedState>;
      getLatestLyrics: () => Promise<LyricsPayload>;
      onLyrics: (callback: (payload: LyricsPayload) => void) => void;
      onSettings: (callback: (settings: OverlaySettings) => void) => void;
      updateSettings: (settings: OverlaySettings) => void;
      toggleSettingsPanel: (rect: { x: number; y: number; width: number; height: number }) => void;
      closeSettingsPanel: () => void;
      setMouseEvents: (ignore: boolean) => void;
    };
  }
}

export {};
