export type LyricsStatus =
  | "booting"
  | "ready"
  | "not-youtube-music"
  | "not-playing"
  | "lyrics-closed"
  | "no-lyrics"
  | "static-lyrics";

export interface LyricLine {
  text: string;
  active: boolean;
}

export interface LyricsPayload {
  status: LyricsStatus;
  title: string;
  artist: string;
  album?: string;
  isPlaying: boolean;
  lines: LyricLine[];
  activeIndex: number;
  message: string;
  updatedAt: number;
}

export interface OverlaySettings {
  opacity: number;
  fontSize: number;
  width: number;
  backgroundBlur: number;
  textShadow: number;
  backgroundColor: string;
  textColor: string;
  inactiveTextColor: string;
  accentColor: string;
  borderColor: string;
  borderRadius: number;
  verticalPadding: number;
  horizontalPadding: number;
  lineGap: number;
  adjacentScale: number;
  clickThrough: boolean;
  locked: boolean;
  showAdjacentLines: boolean;
  compactMode: boolean;
  hideBackgroundUntilHover: boolean;
}

export interface OverlayBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface PersistedState {
  settings: OverlaySettings;
  bounds: OverlayBounds;
  compactBounds: OverlayBounds;
}

export const defaultSettings: OverlaySettings = {
  opacity: 0.82,
  fontSize: 34,
  width: 920,
  backgroundBlur: 18,
  textShadow: 80,
  backgroundColor: "#101010",
  textColor: "#fffaf3",
  inactiveTextColor: "#fffaf3",
  accentColor: "#ff2938",
  borderColor: "#ffffff",
  borderRadius: 8,
  verticalPadding: 18,
  horizontalPadding: 28,
  lineGap: 10,
  adjacentScale: 0.62,
  clickThrough: false,
  locked: false,
  showAdjacentLines: true,
  compactMode: false,
  hideBackgroundUntilHover: false
};

export const defaultLyricsPayload: LyricsPayload = {
  status: "booting",
  title: "",
  artist: "",
  album: "",
  isPlaying: false,
  lines: [],
  activeIndex: -1,
  message: "Waiting for YouTube Music...",
  updatedAt: Date.now()
};
