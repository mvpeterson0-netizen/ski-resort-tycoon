import { DEFAULT_DIFFICULTY, parseSave, type DifficultySettings, type GameState } from '../sim'

// localStorage is enough for now: the save is a few KB of JSON.
const KEY = 'ski-resort-tycoon/save/v1'

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? parseSave(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveGame(g: GameState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(g))
    return true
  } catch {
    return false
  }
}

export function clearGame() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

// Difficulty defaults for new games (the current game keeps its own copy).
const SETTINGS_KEY = 'ski-resort-tycoon/settings/v1'

export function loadDefaultDifficulty(): DifficultySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const d = raw ? (JSON.parse(raw) as Partial<DifficultySettings>) : {}
    return {
      snow: typeof d.snow === 'number' ? d.snow : DEFAULT_DIFFICULTY.snow,
      finance: typeof d.finance === 'number' ? d.finance : DEFAULT_DIFFICULTY.finance,
    }
  } catch {
    return { ...DEFAULT_DIFFICULTY }
  }
}

export function saveDefaultDifficulty(d: DifficultySettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(d))
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
