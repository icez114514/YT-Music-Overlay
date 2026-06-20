import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultSettings, PersistedState } from "../shared/types";

const statePath = () => join(app.getPath("userData"), "settings.json");

const defaultState: PersistedState = {
  settings: defaultSettings,
  bounds: {
    width: defaultSettings.width,
    height: 220
  },
  compactBounds: {
    width: 720,
    height: 96
  }
};

export function loadState(): PersistedState {
  try {
    const file = statePath();
    if (!existsSync(file)) {
      return defaultState;
    }

    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<PersistedState>;
    return {
      settings: { ...defaultSettings, ...parsed.settings },
      bounds: { ...defaultState.bounds, ...parsed.bounds },
      compactBounds: { ...defaultState.compactBounds, ...parsed.compactBounds }
    };
  } catch {
    return defaultState;
  }
}

export function saveState(state: PersistedState): void {
  const file = statePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}
