/**
 * Base village siting: suggest where on the starter parcel the base area should go.
 *
 * A good base spot is (1) flat enough to build a lodge and parking on, and (2) has
 * mountain above it, so lifts can climb from it. Both are measured from the DEM.
 * All weights and radii in VILLAGE are PLACEHOLDER gameplay tuning, not engineering
 * standards. Road access is not modelled yet (we have no road geometry).
 */
import type { Parcel } from './parcels'
import { slopeDeg, elevAtCell, type Terrain } from './terrain'

export const VILLAGE = {
  /** PLACEHOLDER: footprint radius for lodge + starter parking (~80 m ≈ 5 acres). */
  footprintM: 80,
  /** PLACEHOLDER: mean slope above this (degrees) is too steep to build a base on. */
  maxMeanSlopeDeg: 10,
  /** PLACEHOLDER: how far uphill we look for liftable vertical (a short and a long lift). */
  nearReachM: 500,
  reachM: 1200,
  /** Candidate spacing. */
  stepM: 30,
  /** Suggestions must be at least this far apart. */
  minSeparationM: 350,
} as const

export interface BaseSite {
  /** Terrain cell coordinates of the village centre. */
  x: number
  y: number
  elevM: number
  /** Mean slope over the footprint, degrees. */
  meanSlopeDeg: number
  /** Highest ground within the long reach minus this spot's elevation, metres. */
  verticalAboveM: number
  /** Same, within the short reach (a first lift). */
  nearVerticalM: number
  /** 0–100, higher is better. */
  score: number
}

/** Mean slope (degrees) in a disc of radius r cells around (cx, cy). */
function meanSlope(t: Terrain, cx: number, cy: number, r: number): number {
  let sum = 0
  let n = 0
  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      if (dx * dx + dy * dy > r * r) continue
      sum += slopeDeg(t, cx + dx, cy + dy)
      n++
    }
  }
  return sum / n
}

/** Highest elevation within radius r cells (sampled every 3 cells). */
function maxWithin(t: Terrain, cx: number, cy: number, r: number): number {
  let max = -Infinity
  for (let dy = -r; dy <= r; dy += 3) {
    for (let dx = -r; dx <= r; dx += 3) {
      if (dx * dx + dy * dy > r * r) continue
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= t.width || y >= t.height) continue
      max = Math.max(max, elevAtCell(t, x, y))
    }
  }
  return max
}

/** Score one spot, or null if it is too steep to build on. */
export function scoreBaseSite(t: Terrain, x: number, y: number): BaseSite | null {
  const r = Math.max(1, Math.round(VILLAGE.footprintM / t.cellM))
  const mean = meanSlope(t, x, y, r)
  if (mean > VILLAGE.maxMeanSlopeDeg) return null
  const elevM = elevAtCell(t, x, y)
  const verticalAboveM = Math.max(0, maxWithin(t, x, y, Math.round(VILLAGE.reachM / t.cellM)) - elevM)
  const nearVerticalM = Math.max(0, maxWithin(t, x, y, Math.round(VILLAGE.nearReachM / t.cellM)) - elevM)
  // Flatness 0..1 (flat = 1); vertical 0..1, saturating at 200 m (near) and 500 m (far).
  const flat = 1 - mean / VILLAGE.maxMeanSlopeDeg
  const vert = 0.5 * Math.min(1, nearVerticalM / 200) + 0.5 * Math.min(1, verticalAboveM / 500)
  const score = Math.round(100 * (0.5 * flat + 0.5 * vert))
  return { x, y, elevM, meanSlopeDeg: mean, verticalAboveM, nearVerticalM, score }
}

/**
 * Up to `count` suggested base spots inside the parcel, best first, spread apart.
 * The whole footprint must lie inside the parcel.
 */
export function suggestBaseSites(t: Terrain, parcel: Parcel, count = 3): BaseSite[] {
  const r = Math.round(VILLAGE.footprintM / t.cellM)
  const step = Math.max(1, Math.round(VILLAGE.stepM / t.cellM))
  const all: BaseSite[] = []
  for (let y = parcel.y0 + r; y < parcel.y1 - r; y += step) {
    for (let x = parcel.x0 + r; x < parcel.x1 - r; x += step) {
      const s = scoreBaseSite(t, x, y)
      if (s) all.push(s)
    }
  }
  all.sort((a, b) => b.score - a.score)
  const sep = VILLAGE.minSeparationM / t.cellM
  const out: BaseSite[] = []
  for (const s of all) {
    if (out.every((o) => Math.hypot(o.x - s.x, o.y - s.y) >= sep)) out.push(s)
    if (out.length >= count) break
  }
  return out
}
