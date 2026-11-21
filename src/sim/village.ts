/**
 * Base village siting: suggest where on the starter parcel the base area should go.
 *
 * A good base spot is (1) flat enough to build a lodge and parking on, and (2) has
 * mountain above it, so lifts can climb from it. Both are measured from the DEM.
 * All weights and radii in VILLAGE are PLACEHOLDER gameplay tuning, not engineering
 * standards. Road access uses real road lines (USGS National Transportation Dataset,
 * preprocessed by scripts/build-site-roads.mjs): a base needs an access road from the
 * nearest public road, and a long one costs more and scores lower.
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
  /** PLACEHOLDER: farthest a base may sit from an existing road (access road length). */
  maxRoadM: 1500,
  /** PLACEHOLDER: access road cost per metre (grading, paving, plowing gear). */
  roadCostPerMUsd: 600,
} as const

/** A road from the site's road file: polylines in terrain cell coordinates. */
export interface Road {
  name: string
  /** NTD functional class (lower = bigger road). */
  cls: number
  parts: [number, number][][]
}

/** Nearest point on any road to (x, y), in cells, with distance in cells. */
export function nearestRoadPoint(roads: Road[], x: number, y: number): { x: number; y: number; d: number; road: Road } | null {
  let best: { x: number; y: number; d: number; road: Road } | null = null
  for (const road of roads) {
    for (const pts of road.parts) {
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1]
        const [bx, by] = pts[i]
        const vx = bx - ax, vy = by - ay
        const l2 = vx * vx + vy * vy
        const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0
        const px = ax + vx * t, py = ay + vy * t
        const d = Math.hypot(x - px, y - py)
        if (!best || d < best.d) best = { x: px, y: py, d, road }
      }
    }
  }
  return best
}

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
  /** Length of the access road needed from the nearest public road, metres (0 if no road data). */
  roadM: number
  /** Where the access road joins the public road (cells), if roads are known. */
  roadJoin?: [number, number]
  roadName?: string
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

/**
 * Score one spot, or null if it is too steep to build on or too far from a road.
 * With no road data (roads = []), access is not scored.
 */
export function scoreBaseSite(t: Terrain, x: number, y: number, roads: Road[] = []): BaseSite | null {
  const r = Math.max(1, Math.round(VILLAGE.footprintM / t.cellM))
  const mean = meanSlope(t, x, y, r)
  if (mean > VILLAGE.maxMeanSlopeDeg) return null
  const near = roads.length ? nearestRoadPoint(roads, x, y) : null
  const roadM = near ? Math.round(near.d * t.cellM) : 0
  if (near && roadM > VILLAGE.maxRoadM) return null
  const elevM = elevAtCell(t, x, y)
  const verticalAboveM = Math.max(0, maxWithin(t, x, y, Math.round(VILLAGE.reachM / t.cellM)) - elevM)
  const nearVerticalM = Math.max(0, maxWithin(t, x, y, Math.round(VILLAGE.nearReachM / t.cellM)) - elevM)
  // Flatness 0..1 (flat = 1); vertical 0..1, saturating at 200 m (near) and 500 m (far).
  const flat = 1 - mean / VILLAGE.maxMeanSlopeDeg
  const vert = 0.5 * Math.min(1, nearVerticalM / 200) + 0.5 * Math.min(1, verticalAboveM / 500)
  // Access 0..1: right on the road = 1, at the limit = 0.
  const access = near ? 1 - roadM / VILLAGE.maxRoadM : 1
  const score = Math.round(100 * (0.4 * flat + 0.4 * vert + 0.2 * access))
  return {
    x, y, elevM, meanSlopeDeg: mean, verticalAboveM, nearVerticalM, roadM, score,
    ...(near ? { roadJoin: [near.x, near.y] as [number, number], roadName: near.road.name } : {}),
  }
}

/**
 * Up to `count` suggested base spots inside the parcel, best first, spread apart.
 * The whole footprint must lie inside the parcel.
 */
export function suggestBaseSites(t: Terrain, parcel: Parcel, count = 3, roads: Road[] = []): BaseSite[] {
  const r = Math.round(VILLAGE.footprintM / t.cellM)
  const step = Math.max(1, Math.round(VILLAGE.stepM / t.cellM))
  const all: BaseSite[] = []
  for (let y = parcel.y0 + r; y < parcel.y1 - r; y += step) {
    for (let x = parcel.x0 + r; x < parcel.x1 - r; x += step) {
      const s = scoreBaseSite(t, x, y, roads)
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

/** Access road cost for a base spot (PLACEHOLDER rate). */
export const accessRoadCostUsd = (b: BaseSite) => Math.round((b.roadM * VILLAGE.roadCostPerMUsd) / 1000) * 1000
