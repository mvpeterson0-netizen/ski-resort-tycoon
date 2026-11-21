/**
 * Slope → run difficulty classes. Shared by trail grading (build.ts) and the parcel
 * terrain overlay, so the overlay predicts exactly what trails will grade as.
 *
 * Thresholds follow commonly quoted North American guidance (green < ~25% grade,
 * blue 25–40%, black > 40%); this is not an official standard. The 45° hazard cut-off
 * is a PLACEHOLDER for "too steep to groom or ski safely" in this model.
 */
export type Difficulty = 'green' | 'blue' | 'black'
export type SlopeClass = Difficulty | 'hazard'

export const SLOPE = {
  blueFromPct: 25,
  blackFromPct: 40,
  hazardFromDeg: 45,
} as const

export const pctToDeg = (pct: number) => (Math.atan(pct / 100) * 180) / Math.PI

const BLUE_DEG = pctToDeg(SLOPE.blueFromPct)
const BLACK_DEG = pctToDeg(SLOPE.blackFromPct)

export function slopeClass(deg: number): SlopeClass {
  if (deg > SLOPE.hazardFromDeg) return 'hazard'
  if (deg >= BLACK_DEG) return 'black'
  if (deg >= BLUE_DEG) return 'blue'
  return 'green'
}

/** Position within the slope's class, 0 = gentle end, 1 = steep end (hazard: 60° = 1). */
export function slopeClassDepth(deg: number): number {
  const [lo, hi] =
    deg > SLOPE.hazardFromDeg ? [SLOPE.hazardFromDeg, 60]
    : deg >= BLACK_DEG ? [BLACK_DEG, SLOPE.hazardFromDeg]
    : deg >= BLUE_DEG ? [BLUE_DEG, BLACK_DEG]
    : [0, BLUE_DEG]
  return Math.max(0, Math.min(1, (deg - lo) / (hi - lo)))
}

export function difficultyFor(slopeDeg: number): Difficulty {
  const c = slopeClass(slopeDeg)
  return c === 'hazard' ? 'black' : c
}
