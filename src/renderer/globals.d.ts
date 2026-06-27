import { LyricsPayload, OverlaySettings, PersistedState, PlayerState } from "../shared/types";

declare global {
  interface Window {
    playerApi: {
      getState: () => Promise<PersistedState>;
      getOverlayVisibility: () => Promise<boolean>;
      getYouTubePreloadPath: () => Promise<string>;
      getExtensionStatus: () => Promise<string>;
      exportDebugState: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      copyLyricsSearchPrompt: () => Promise<{ ok: boolean; title?: string; error?: string }>;
      toggleLyricsSearchSettings: (rect: { x: number; y: number; width: number; height: number }) => void;
      updateLyricsSearchSites: (sites: string[]) => Promise<{ ok: boolean }>;
      closeLyricsSearchSettings: () => void;
      sendLyrics: (payload: LyricsPayload) => void;
      command: (command: string) => void;
      onSettings: (callback: (settings: OverlaySettings) => void) => void;
      onStatus: (callback: (message: string) => void) => void;
      onOverlayVisibility: (callback: (visible: boolean) => void) => void;
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
      hideOverlay: () => void;
      setOverlayToolbarHover: (hovered: boolean) => void;
      startOverlayDrag: (point: { x: number; y: number }) => void;
      dragOverlayTo: (point: { x: number; y: number }) => void;
      endOverlayDrag: () => void;
      musicCommand: (command: string, value?: number) => void;
    };
  }
}

export {};
