import { LyricsPayload, OverlaySettings, PersistedState, PlayerState } from "../shared/types";

declare global {
  interface Window {
    playerApi: {
      getState: () => Promise<PersistedState>;
      getYouTubePreloadPath: () => Promise<string>;
      getExtensionStatus: () => Promise<string>;
      sendLyrics: (payload: LyricsPayload) => void;
      command: (command: string) => void;
      onSettings: (callback: (settings: OverlaySettings) => void) => void;
      onStatus: (callback: (message: string) => void) => void;
    };
    overlayApi: {
      getState: () => Promise<PersistedState>;
      getLatestLyrics: () => Promise<LyricsPayload>;
      getLatestPlayerState: () => Promise<PlayerState>;
      onLyrics: (callback: (payload: LyricsPayload) => void) => void;
      onPlayerState: (callback: (payload: PlayerState) => void) => void;
      onSettings: (callback: (settings: OverlaySettings) => void) => void;
      updateSettings: (settings: OverlaySettings) => void;
      toggleSettingsPanel: (rect: { x: number; y: number; width: number; height: number }) => void;
      closeSettingsPanel: () => void;
      musicCommand: (command: string, value?: number) => void;
    };
  }
}

export {};
