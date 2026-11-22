/**
 * Moving skiers for the live day: dots queue at each lift's bottom station, ride the lift
 * up, and ski down the trails that start near its top. Purely visual: the numbers come from
 * the day sim; each dot stands for a handful of guests.
 */
import type { Lift, Pt, Terrain, Trail } from '../../sim'
import { RENDER_SCALE } from '../MapView'

const COATS = ['#c0392b', '#2a68c4', '#e0a92b', '#2f8f5b', '#7a3fa0', '#e86a2c', '#1d2a36', '#d94f8a', '#3aa6b9']
const MAX_DOTS = 420
/** Seconds of screen time for one ride up and one run down (independent of game speed). */
const UP_SEC = 9
const DOWN_SEC = 11

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

interface Path { pts: Pt[]; cum: number[]; len: number }

function makePath(pts: Pt[]): Path {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  return { pts, cum, len: cum[cum.length - 1] || 1 }
}

function along(p: Path, f: number): Pt {
  const d = Math.max(0, Math.min(1, f)) * p.len
  let i = 1
  while (i < p.cum.length - 1 && p.cum[i] < d) i++
  const seg = p.cum[i] - p.cum[i - 1] || 1
  const u = (d - p.cum[i - 1]) / seg
  return [p.pts[i - 1][0] + (p.pts[i][0] - p.pts[i - 1][0]) * u, p.pts[i - 1][1] + (p.pts[i][1] - p.pts[i - 1][1]) * u]
}

export interface SkierRoute {
  lift: Lift
  index: number
  /** Runs that start near the lift's top; a straight descent if there are none. */
  downs: Path[]
}

/** Which trails each lift feeds: those whose first point is near its top station. */
export function buildRoutes(lifts: Lift[], trails: Trail[]): SkierRoute[] {
  return lifts.map((lift, index) => {
    const near = trails.filter((t) => t.points.length > 1 && Math.hypot(t.points[0][0] - lift.top[0], t.points[0][1] - lift.top[1]) < 30)
    const downs = near.length ? near.map((t) => makePath(t.points)) : [makePath([lift.top, lift.bottom])]
    return { lift, index, downs }
  })
}

export interface SkierState {
  /** Guests on the hill and the lift line (minutes). */
  onHill: number
  queueMin: number
  /** Share of each lift's capacity running (0 = closed). */
  factors: number[]
  /** Seconds of screen time. */
  time: number
}

export function drawSkiers(ctx: CanvasRenderingContext2D, scale: number, t: Terrain, routes: SkierRoute[], st: SkierState) {
  if (st.onHill <= 0 || !routes.length) return
  const S = RENDER_SCALE
  const px = (p: Pt): [number, number] => [(p[0] + 0.5) * S, (p[1] + 0.5) * S]
  const dots = Math.min(MAX_DOTS, Math.ceil(st.onHill / 5))
  const weights = routes.map((r) => r.lift.capacityPph * (st.factors[r.index] ?? 1))
  const totalW = weights.reduce((a, b) => a + b, 0)
  if (totalW <= 0) return
  const queueSec = Math.max(0.4, Math.min(12, st.queueMin * 0.8))
  const period = queueSec + UP_SEC + DOWN_SEC
  const r = Math.max(1.4, 2.0 / scale)
  void t
  for (const route of routes) {
    const n = Math.round((dots * weights[route.index]) / totalW)
    if (!n) continue
    const [bx, by] = px(route.lift.bottom)
    const [tx, ty] = px(route.lift.top)
    const dx = tx - bx, dy = ty - by
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len
    for (let i = 0; i < n; i++) {
      const h = hash(route.index * 7919 + 13, i)
      const tau = (st.time + h * period * 3.7) % period
      let x: number, y: number
      if (tau < queueSec) {
        // Waiting in line behind the station, in a loose crowd.
        const row = Math.floor(h * 6), side = (hash(i, 5) - 0.5) * 2.4
        x = bx - ux * (1.2 + row * 0.7) * S + -uy * side * S
        y = by - uy * (1.2 + row * 0.7) * S + ux * side * S
      } else if (tau < queueSec + UP_SEC) {
        const f = (tau - queueSec) / UP_SEC
        x = bx + dx * f + -uy * 0.6 * S
        y = by + dy * f + ux * 0.6 * S
      } else {
        const f = (tau - queueSec - UP_SEC) / DOWN_SEC
        const path = route.downs[Math.floor(hash(i, 11) * route.downs.length)]
        // Carve a little as they ski down.
        const [ax, ay] = px(along(path, f))
        const sway = Math.sin(f * 14 + h * 6.28) * 0.5 * S
        x = ax + sway
        y = ay
      }
      ctx.fillStyle = COATS[Math.floor(hash(i, route.index) * COATS.length)]
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
