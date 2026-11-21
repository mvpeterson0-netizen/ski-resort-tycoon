import { parseSave, type GameState } from '../sim'

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
