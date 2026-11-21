/**
 * Where things sit in the base village, how trees are cleared around what's built, and
 * the data the bird's-eye view loads (roads, sprites). Placement here is cosmetic: the
 * sim stores only the base location; buildings are arranged around it for the picture.
 */
import { useEffect, useState } from 'react'
import type { AmenityLevels, BasePlacement, Lift, LiftType, Pt, Road, Terrain, Trail } from '../../sim'
import { loadSprites, type Sprites } from './art'

// ---------- data ----------

const roadCache = new Map<string, Promise<Road[]>>()
/** Real roads for a site (USGS NTD, preprocessed by scripts/build-site-roads.mjs); [] if none. */
export function useRoads(terrainId: string): Road[] | null {
  const [roads, setRoads] = useState<Road[] | null>(null)
  useEffect(() => {
    let p = roadCache.get(terrainId)
    if (!p) {
      p = fetch(`${import.meta.env.BASE_URL}sites/${terrainId}.roads.json`)
        .then((r) => (r.ok ? r.json() : { roads: [] }))
        .then((d) => d.roads as Road[])
        .catch(() => [])
      roadCache.set(terrainId, p)
    }
    let live = true
    p.then((r) => live && setRoads(r))
    return () => { live = false }
  }, [terrainId])
  return roads
}

let spriteCache: Promise<Sprites> | null = null
export function useSprites(): Sprites | null {
  const [sp, setSp] = useState<Sprites | null>(null)
  useEffect(() => {
    spriteCache ??= loadSprites()
    let live = true
    spriteCache.then((s) => live && setSp(s))
    return () => { live = false }
  }, [])
  return sp
}

/** Display name for a road. The NTD names the south-west stretch of US-40 "W Park Ave". */
export const roadLabel = (r: Road) =>
  /hwy 40|park ave/i.test(r.name) ? 'US-40' : r.name.replace(/\b(\w)(\w*)/g, (_, a: string, b: string) => a + b.toLowerCase())

// ---------- village frame ----------

export interface VillageFrame {
  /** Village centre (cells): the base pushed back from the road to leave room for parking. */
  v: Pt
  /** Unit vector from the road toward the village, and along the road (cells). */
  r: [number, number]
  tg: [number, number]
  /** Where the access drive meets the public road. */
  join: Pt
}

export function villageFrame(t: Terrain, base: BasePlacement): VillageFrame {
  const join: Pt = base.roadJoin ?? [base.x, base.y + 10]
  let r: [number, number] = [base.x - join[0], base.y - join[1]]
  const rl = Math.hypot(...r) || 1
  r = [r[0] / rl, r[1] / rl]
  const tg: [number, number] = [-r[1], r[0]]
  const off = Math.max(rl * t.cellM, 90)
  return { v: [join[0] + (r[0] * off) / t.cellM, join[1] + (r[1] * off) / t.cellM], r, tg, join }
}

export type ItemKind = 'lodge' | 'rentals' | 'school' | 'housing' | 'ticket' | 'shop' | 'terminal' | 'parking'
export interface VillageItem {
  kind: ItemKind
  /** Sprite level (art levels start at 1; lodge art = sim level + 1). */
  art: number
  c: Pt
  /** Clearing radius, metres. */
  r: number
  liftId?: string
}

export const TERMINAL_ART: Record<LiftType, number> = { ropeTow: 1, fixedDouble: 2, fixedQuad: 3 }

/** Buildings around the village centre, scaled to the lodge so a small base stays compact. */
export function villageItems(t: Terrain, F: VillageFrame, a: AmenityLevels, lifts: Lift[]): { items: VillageItem[]; lot: Pt } {
  const at = (away: number, along: number): Pt => [F.v[0] + (F.r[0] * away + F.tg[0] * along) / t.cellM, F.v[1] + (F.r[1] * away + F.tg[1] * along) / t.cellM]
  const lodgeArt = a.lodge + 1
  const f = 0.55 + 0.12 * lodgeArt
  const items: VillageItem[] = [
    { kind: 'lodge', art: lodgeArt, c: at(5, 0), r: 20 + 12 * lodgeArt },
    { kind: 'ticket', art: 1, c: at(40, 34 * f), r: 12 },
    { kind: 'rentals', art: a.rentals, c: at(0, 80 * f), r: 28 },
    { kind: 'school', art: a.school, c: at(20, -85 * f), r: 34 },
    { kind: 'housing', art: a.housing, c: at(-26, 155 * f), r: 40 },
    { kind: 'shop', art: 1, c: at(-26, -145 * f), r: 30 },
  ]
  const out = items.filter((it) => it.art > 0)
  for (const l of lifts) out.push({ kind: 'terminal', art: TERMINAL_ART[l.type], c: l.bottom, r: 18, liftId: l.id })
  return { items: out, lot: at(-60, 0) }
}

// ---------- tree clearing (spatial grid, fast enough for phones) ----------

const segDist = (x: number, y: number, a: Pt, b: Pt) => {
  const vx = b[0] - a[0], vy = b[1] - a[1]
  const l2 = vx * vx + vy * vy
  const u = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / l2)) : 0
  return Math.hypot(x - a[0] - vx * u, y - a[1] - vy * u)
}

/** Trees that survive clearing for trails, lifts, roads, the village and parking. */
export function clearTrees(
  t: Terrain, trees: Float32Array, roads: Road[], trails: Trail[], lifts: Lift[],
  village: { F: VillageFrame; items: VillageItem[]; lot: Pt; parking: number } | null,
): Float32Array {
  const CELL = 16 // grid tile, in terrain cells
  const cols = Math.ceil(t.width / CELL) + 1
  const grid = new Map<number, [Pt, Pt, number][]>()
  const put = (key: number, v: [Pt, Pt, number]) => { const a = grid.get(key); if (a) a.push(v); else grid.set(key, [v]) }
  const addLine = (pts: Pt[], halfM: number) => {
    const h = halfM / t.cellM
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      const x0 = Math.floor((Math.min(a[0], b[0]) - h) / CELL), x1 = Math.floor((Math.max(a[0], b[0]) + h) / CELL)
      const y0 = Math.floor((Math.min(a[1], b[1]) - h) / CELL), y1 = Math.floor((Math.max(a[1], b[1]) + h) / CELL)
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) put(gy * cols + gx, [a, b, h])
    }
  }
  for (const tr of trails) addLine(tr.points, 26)
  for (const l of lifts) addLine([l.bottom, l.top], 10)
  for (const r of roads) for (const p of r.parts) addLine(p, 13)
  const discs: [Pt, number][] = []
  if (village) {
    addLine([village.F.join, village.F.v], 11)
    for (const it of village.items) discs.push([it.c, (it.r + 14) / t.cellM])
    discs.push([village.lot, (55 + 20 * village.parking) / t.cellM])
  }
  const keep: number[] = []
  for (let i = 0; i < trees.length; i += 3) {
    const x = trees[i], y = trees[i + 1]
    if (discs.some(([c, r]) => Math.abs(x - c[0]) < r && Math.abs(y - c[1]) < r && Math.hypot(x - c[0], y - c[1]) < r)) continue
    const segs = grid.get(Math.floor(y / CELL) * cols + Math.floor(x / CELL))
    if (segs && segs.some(([a, b, h]) => segDist(x, y, a, b) < h)) continue
    keep.push(x, y, trees[i + 2])
  }
  return new Float32Array(keep)
}
