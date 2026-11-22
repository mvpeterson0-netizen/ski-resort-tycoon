/**
 * Mountain construction: trails and lifts. Pure functions over terrain + parcels.
 *
 * All costs, capacities, speeds and limits in BUILD are PLACEHOLDERS for playability,
 * not sourced figures. Difficulty thresholds follow commonly quoted North American
 * guidance (green < ~25% grade, blue 25–40%, black > 40%) but are not an official
 * standard; treat them as tunable.
 */
import { SLOPE, difficultyFor, pctToDeg, type Difficulty } from './difficulty'
import { parcelAtCell, type Parcel } from './parcels'
import { snapToRuns, type ExistingRun, type MergeSpan } from './merge'
import { elevAt, slopeDeg, type Terrain } from './terrain'

export type LiftType = 'ropeTow' | 'fixedDouble' | 'fixedQuad'
export type Pt = [number, number] // terrain cell coordinates

export const BUILD = {
  trail: {
    /** PLACEHOLDER: cleared trail width. */
    widthM: 40,
    /** PLACEHOLDER: clearing + grading cost per acre of trail. */
    costPerAcreUsd: 55_000,
    // Difficulty thresholds live in difficulty.ts (SLOPE), measured on the
    // 90th-percentile steepest point of the line.
    minLengthM: 150,
    /** Resample spacing along the drawn line. */
    stepM: 20,
  },
  lifts: {
    ropeTow: { name: 'Rope tow', capacityPph: 600, speedMps: 3, maxLengthM: 400, baseCostUsd: 60_000, costPerMUsd: 300 },
    fixedDouble: { name: 'Fixed-grip double chair', capacityPph: 1200, speedMps: 2.3, maxLengthM: 1600, baseCostUsd: 900_000, costPerMUsd: 1_500 },
    fixedQuad: { name: 'Fixed-grip quad chair', capacityPph: 2400, speedMps: 2.3, maxLengthM: 1600, baseCostUsd: 1_800_000, costPerMUsd: 2_800 },
  } satisfies Record<LiftType, { name: string; capacityPph: number; speedMps: number; maxLengthM: number; baseCostUsd: number; costPerMUsd: number }>,
  minLiftLengthM: 100,
  /** PLACEHOLDER: lifts must climb at least this average grade (%) to be worth building. */
  minLiftGradePct: 8,
} as const

const M2_PER_ACRE = 4046.8564224

export interface TrailPlan {
  /** The run's full path, including any stretch shared with existing runs. */
  points: Pt[]
  /** The line as drawn (resampled, downhill), before snapping: for the snap animation. */
  rawPoints: Pt[]
  /** Existing runs this one merges with or joins. */
  merges: MergeSpan[]
  /** Point i lies on an existing run. */
  shared: boolean[]
  /** Metres shared with existing runs (already cleared: not charged or counted again). */
  sharedM: number
  /** Length of the whole path, shared stretch included. */
  fullLengthM: number
  /** The new, billed length (full length minus the shared stretch). */
  lengthM: number
  verticalM: number
  avgSlopeDeg: number
  /** 90th-percentile slope along the line, used for difficulty. */
  steepSlopeDeg: number
  maxSlopeDeg: number
  difficulty: Difficulty
  acres: number
  costUsd: number
  problems: string[]
}

export interface LiftPlan {
  type: LiftType
  bottom: Pt
  top: Pt
  lengthM: number
  verticalM: number
  rideMin: number
  capacityPph: number
  costUsd: number
  problems: string[]
}

export { difficultyFor, pctToDeg, type Difficulty }

/** Resample a polyline at a fixed spacing (in cells). */
export function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice()
  const out: Pt[] = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const seg = Math.hypot(bx - ax, by - ay)
    let d = step - carry
    while (d <= seg) {
      const t = d / seg
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t])
      d += step
    }
    carry = seg - (d - step)
  }
  const last = pts[pts.length - 1]
  const tail = out[out.length - 1]
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.25) out.push(last)
  return out
}

/** True if every point lies inside a parcel the player owns. */
export function allOwned(pts: Pt[], parcels: Parcel[], owned: string[]): boolean {
  return pts.every(([x, y]) => {
    const p = parcelAtCell(parcels, Math.floor(x), Math.floor(y))
    return !!p && owned.includes(p.id)
  })
}

export function planTrail(t: Terrain, raw: Pt[], parcels: Parcel[], owned: string[], existing: ExistingRun[] = []): TrailPlan {
  const cfg = BUILD.trail
  let drawn = resample(raw, cfg.stepM / t.cellM)
  // Trails run downhill: flip a line drawn bottom-to-top.
  if (drawn.length > 1 && elevAt(t, ...drawn[0]) < elevAt(t, ...drawn[drawn.length - 1])) drawn = drawn.reverse()
  // Pull the line onto any existing run it merges with or joins.
  const snap = snapToRuns(drawn, existing, t.cellM)
  const pts = snap.points

  let fullM = 0, sharedM = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = (pts[i][0] - pts[i - 1][0]) * t.cellM
    const dy = (pts[i][1] - pts[i - 1][1]) * t.cellM
    const dz = elevAt(t, ...pts[i]) - elevAt(t, ...pts[i - 1])
    const seg = Math.hypot(dx, dy, dz)
    fullM += seg
    if (snap.shared[i] && snap.shared[i - 1]) sharedM += seg
  }
  const lengthM = fullM - sharedM
  // Difficulty comes from the new stretch only: the shared part is already graded.
  const own = pts.filter((_, i) => !snap.shared[i])
  const slopes = own.map(([x, y]) => slopeDeg(t, Math.round(x), Math.round(y))).sort((a, b) => a - b)
  const steep = slopes.length ? slopes[Math.min(slopes.length - 1, Math.floor(slopes.length * 0.9))] : 0
  const verticalM = pts.length ? elevAt(t, ...pts[0]) - elevAt(t, ...pts[pts.length - 1]) : 0
  const acres = (lengthM * cfg.widthM) / M2_PER_ACRE
  const plan: TrailPlan = {
    points: pts,
    rawPoints: drawn,
    merges: snap.merges,
    shared: snap.shared,
    sharedM: Math.round(sharedM),
    fullLengthM: Math.round(fullM),
    lengthM: Math.round(lengthM),
    verticalM: Math.round(verticalM),
    avgSlopeDeg: slopes.length ? slopes.reduce((s, v) => s + v, 0) / slopes.length : 0,
    steepSlopeDeg: steep,
    maxSlopeDeg: slopes.length ? slopes[slopes.length - 1] : 0,
    difficulty: difficultyFor(steep),
    acres: Math.round(acres * 10) / 10,
    costUsd: Math.round((acres * cfg.costPerAcreUsd) / 1000) * 1000,
    problems: [],
  }
  if (lengthM < cfg.minLengthM) {
    plan.problems.push(sharedM > 0 ? `Mostly follows an existing run (needs ${cfg.minLengthM} m of new run)` : `Too short (min ${cfg.minLengthM} m)`)
  }
  if (plan.maxSlopeDeg > SLOPE.hazardFromDeg) plan.problems.push(`Crosses terrain too steep to ski (over ${SLOPE.hazardFromDeg}°)`)
  if (!allOwned(pts, parcels, owned)) plan.problems.push('Leaves land you own')
  return plan
}

export function planLift(t: Terrain, type: LiftType, a: Pt, b: Pt, parcels: Parcel[], owned: string[]): LiftPlan {
  const spec = BUILD.lifts[type]
  // Bottom is whichever station is lower.
  const [bottom, top] = elevAt(t, ...a) <= elevAt(t, ...b) ? [a, b] : [b, a]
  const horiz = Math.hypot(top[0] - bottom[0], top[1] - bottom[1]) * t.cellM
  const verticalM = elevAt(t, ...top) - elevAt(t, ...bottom)
  const lengthM = Math.hypot(horiz, verticalM)
  const plan: LiftPlan = {
    type, bottom, top,
    lengthM: Math.round(lengthM),
    verticalM: Math.round(verticalM),
    rideMin: Math.round((lengthM / spec.speedMps / 60) * 10) / 10,
    capacityPph: spec.capacityPph,
    costUsd: Math.round((spec.baseCostUsd + spec.costPerMUsd * lengthM) / 1000) * 1000,
    problems: [],
  }
  if (lengthM < BUILD.minLiftLengthM) plan.problems.push(`Too short (min ${BUILD.minLiftLengthM} m)`)
  if (lengthM > spec.maxLengthM) plan.problems.push(`Too long for a ${spec.name.toLowerCase()} (max ${spec.maxLengthM} m)`)
  if (verticalM < 10 || (verticalM / Math.max(horiz, 1)) * 100 < BUILD.minLiftGradePct) {
    plan.problems.push(`Needs to climb uphill (at least ${BUILD.minLiftGradePct}% average grade)`)
  }
  // Check the line between stations, not just the ends.
  const line = resample([bottom, top], 2)
  if (!allOwned(line, parcels, owned)) plan.problems.push('Leaves land you own')
  return plan
}
