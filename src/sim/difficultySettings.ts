/**
 * Player-set difficulty. Each slider runs 0 (easy) → 0.5 (normal) → 1 (hard).
 * Normal reproduces the base SEASON tuning exactly. All multipliers are PLACEHOLDERS.
 */
export interface DifficultySettings {
  snow: number
  finance: number
}

export const DEFAULT_DIFFICULTY: DifficultySettings = { snow: 0.5, finance: 0.5 }

/** Interpolate easy → normal → hard. */
function scale(t: number, easy: number, normal: number, hard: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x <= 0.5 ? easy + (normal - easy) * (x / 0.5) : normal + (hard - normal) * ((x - 0.5) / 0.5)
}

export interface SnowModifiers {
  /** Range of the season snowfall factor (× site average). */
  yearFactor: [number, number]
  /** Multiplier on the chance of a warm melt day. */
  warmChance: number
  /** Opening delay (days) in the worst year in range; Normal ≈ 20% of the season. */
  maxOpeningDelayDays: number
}

export function snowModifiers(t: number): SnowModifiers {
  return {
    yearFactor: [scale(t, 0.85, 0.55, 0.35), scale(t, 1.6, 1.45, 1.15)],
    warmChance: scale(t, 0.5, 1, 1.7),
    maxOpeningDelayDays: Math.round(scale(t, 12, 24, 32)),
  }
}

export interface FinanceModifiers {
  costs: number
  demand: number
}

export function financeModifiers(t: number): FinanceModifiers {
  return { costs: scale(t, 0.7, 1, 1.5), demand: scale(t, 1.2, 1, 0.8) }
}

export function difficultyLabel(t: number): string {
  if (t < 0.2) return 'Easy'
  if (t < 0.4) return 'Relaxed'
  if (t <= 0.6) return 'Normal'
  if (t <= 0.8) return 'Tough'
  return 'Hard'
}
