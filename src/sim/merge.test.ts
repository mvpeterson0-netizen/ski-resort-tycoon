import { describe, expect, it } from 'vitest'
import { BUILD, planTrail, type Pt } from './build'
import { buildTrail, newGame } from './game'
import { planPurchase } from './economy'
import { MERGE, snapToRuns, type ExistingRun } from './merge'
import { computeParcels } from './parcels'
import type { Terrain } from './terrain'

/** Plane rising toward the north at 30% grade. 90x90 cells of 10 m. */
function slope(n = 90): Terrain {
  const elev = new Float32Array(n * n)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) elev[y * n + x] = 2000 + (n - y) * 10 * 0.3
  return { width: n, height: n, cellM: 10, elev }
}
const t = slope()
const parcels = computeParcels(t)
const owned = parcels.map((p) => p.id)

/** An existing run straight down the x = 45 line. */
const base = planTrail(t, [[45, 5], [45, 85]], parcels, owned)
const existing: ExistingRun[] = [{ id: 't1', name: 'Pass Run', points: base.points }]

const distToRun = (p: Pt) => Math.min(...base.points.slice(1).map((b, i) => {
  const a = base.points[i]
  const vx = b[0] - a[0], vy = b[1] - a[1]
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)))
  return Math.hypot(p[0] - a[0] - vx * u, p[1] - a[1] - vy * u)
}))

describe('run merging', () => {
  it('a run that follows an existing one for a stretch snaps onto it and shares that stretch', () => {
    // Down the same line to y = 45, then veers away east.
    const plan = planTrail(t, [[45.5, 5], [45.5, 45], [75, 85]], parcels, owned, existing)
    expect(plan.merges).toHaveLength(1)
    expect(plan.merges[0]).toMatchObject({ trailId: 't1', name: 'Pass Run', kind: 'merge' })
    expect(plan.sharedM).toBeGreaterThan(250)
    // Shared points lie exactly on the existing run.
    plan.points.forEach((p, i) => { if (plan.shared[i]) expect(distToRun(p)).toBeLessThan(0.01) })
    // Only the new stretch is billed and counted; the whole path is longer.
    expect(Math.abs(plan.lengthM - (plan.fullLengthM - plan.sharedM))).toBeLessThanOrEqual(1)
    const alone = planTrail(t, [[45.5, 5], [45.5, 45], [75, 85]], parcels, owned)
    expect(alone.sharedM).toBe(0)
    expect(plan.costUsd).toBeLessThan(alone.costUsd)
    expect(plan.lengthM).toBeLessThan(alone.lengthM)
  })

  it('keeps the same number of points so the snap can be animated', () => {
    const plan = planTrail(t, [[45.5, 5], [45.5, 45], [75, 85]], parcels, owned, existing)
    expect(plan.points).toHaveLength(plan.rawPoints.length)
    expect(plan.shared).toHaveLength(plan.points.length)
  })

  it('does not merge a run that crosses an existing one at an angle', () => {
    const plan = planTrail(t, [[10, 45], [80, 46]], parcels, owned, existing)
    expect(plan.merges).toEqual([])
    expect(plan.sharedM).toBe(0)
    expect(plan.points).toEqual(plan.rawPoints)
  })

  it('joins an existing run at the bottom: the end snaps on, nothing is shared', () => {
    // Drawn from the west down toward the run, finishing 2 cells (20 m) beside it.
    const plan = planTrail(t, [[15, 20], [43, 60]], parcels, owned, existing)
    expect(plan.merges).toHaveLength(1)
    expect(plan.merges[0].kind).toBe('join')
    expect(plan.merges[0].to).toBe(plan.points.length - 1)
    expect(plan.sharedM).toBe(0)
    expect(distToRun(plan.points[plan.points.length - 1])).toBeLessThan(0.01)
    // Billed for its whole length: a junction shares no cleared run.
    expect(plan.lengthM).toBe(plan.fullLengthM)
  })

  it('branches off the top of an existing run', () => {
    // A sharp branch: it leaves at a steep angle, so it joins at the top rather than running alongside.
    const plan = planTrail(t, [[46, 8], [8, 32]], parcels, owned, existing)
    expect(plan.merges[0].kind).toBe('join')
    expect(plan.merges[0].from).toBe(0)
    expect(distToRun(plan.points[0])).toBeLessThan(0.01)
  })

  it('refuses a run that only retraces an existing one', () => {
    const plan = planTrail(t, [[45.5, 8], [45.5, 80]], parcels, owned, existing)
    expect(plan.sharedM).toBeGreaterThan(400)
    expect(plan.lengthM).toBeLessThan(BUILD.trail.minLengthM)
    expect(plan.problems.join()).toMatch(/follows an existing run/i)
  })

  it('leaves runs that are far apart alone', () => {
    const plan = planTrail(t, [[20, 5], [20, 85]], parcels, owned, existing)
    expect(plan.merges).toEqual([])
    expect(plan.lengthM).toBe(plan.fullLengthM)
  })

  it('grades a merged run from its new stretch, not the shared part', () => {
    // The new stretch is a steeper line east of the run; the shared part is on the 30% plane too,
    // so difficulty is decided by the unique points and never by an empty list.
    const plan = planTrail(t, [[45.5, 5], [45.5, 45], [75, 85]], parcels, owned, existing)
    expect(['green', 'blue', 'black']).toContain(plan.difficulty)
    expect(plan.steepSlopeDeg).toBeGreaterThan(0)
  })

  it('records the shared length on the built trail and counts only the new km', () => {
    const g0 = { ...newGame('x', planPurchase(1_000_000, 100), 1, 'r1c1'), cashUsd: 50_000_000 }
    const first = buildTrail(g0, base)
    if (!first.ok) throw new Error(first.reason)
    const plan = planTrail(t, [[45.5, 5], [45.5, 45], [75, 85]], parcels, owned, first.game.trails.map((x) => ({ id: x.id, name: x.name, points: x.points })))
    const second = buildTrail(first.game, plan)
    if (!second.ok) throw new Error(second.reason)
    const tr = second.game.trails[1]
    expect(tr.sharedM).toBe(plan.sharedM)
    expect(tr.lengthM).toBe(plan.lengthM)
    expect(tr.points).toEqual(plan.points)
    expect(second.game.trails.reduce((s, x) => s + x.lengthM, 0)).toBe(base.lengthM + plan.lengthM)
  })
})

describe('snapToRuns', () => {
  const pts: Pt[] = Array.from({ length: 30 }, (_, i) => [45.8, 5 + i * 2] as Pt)
  it('pulls points within the snap distance and reports where each went', () => {
    const r = snapToRuns(pts, existing, 10)
    expect(r.pulls.length).toBeGreaterThan(20)
    expect(r.pulls[0].to[0]).toBeCloseTo(45, 5)
  })
  it('does nothing without runs or with an empty line', () => {
    expect(snapToRuns(pts, [], 10).merges).toEqual([])
    expect(snapToRuns([], existing, 10).points).toEqual([])
    expect(snapToRuns(pts, [{ id: 'a', name: 'A', points: [] }], 10).merges).toEqual([])
  })
  it('only counts a stretch as a merge past the minimum shared length', () => {
    const short: Pt[] = [[45.5, 20], [45.5, 22], [45.5, 24]] // 40 m alongside, not touching an end... but it is the whole line
    expect(MERGE.minShareM).toBeGreaterThan(40)
    expect(snapToRuns(short, existing, 10).merges[0]?.kind).toBe('join')
  })
})
