import { describe, expect, it } from 'vitest'
import { BUILD, difficultyFor, pctToDeg, planLift, planTrail, resample, type Pt } from './build'
import { planPurchase } from './economy'
import { buildLift, buildTrail, newGame, parseSave } from './game'
import { computeParcels } from './parcels'
import type { Terrain } from './terrain'

/** Plane rising toward the north at `pct` percent grade. 90x90 cells of 10 m. */
function slope(pct: number, n = 90): Terrain {
  const elev = new Float32Array(n * n)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) elev[y * n + x] = 2000 + (n - y) * 10 * (pct / 100)
  return { width: n, height: n, cellM: 10, elev }
}
const all = (t: Terrain) => {
  const ps = computeParcels(t)
  return { parcels: ps, owned: ps.map((p) => p.id) }
}

describe('difficulty', () => {
  it('uses grade thresholds', () => {
    expect(difficultyFor(pctToDeg(15))).toBe('green')
    expect(difficultyFor(pctToDeg(30))).toBe('blue')
    expect(difficultyFor(pctToDeg(55))).toBe('black')
  })

  it('grades a drawn trail from the terrain under it', () => {
    for (const [pct, want] of [[15, 'green'], [30, 'blue'], [55, 'black']] as const) {
      const t = slope(pct)
      const { parcels, owned } = all(t)
      const plan = planTrail(t, [[45, 5], [45, 85]], parcels, owned)
      expect(plan.difficulty).toBe(want)
      expect(plan.problems).toEqual([])
    }
  })
})

describe('planTrail', () => {
  const t = slope(30)
  const { parcels, owned } = all(t)

  it('orients trails downhill and measures them', () => {
    const plan = planTrail(t, [[45, 85], [45, 5]], parcels, owned) // drawn uphill
    expect(plan.points[0][1]).toBeLessThan(plan.points[plan.points.length - 1][1]) // starts north (high)
    expect(plan.verticalM).toBeCloseTo(800 * 0.3, -1)
    // Slope length of 800 m horizontal at 30%: ≈ 835 m.
    expect(plan.lengthM).toBeGreaterThan(820)
    expect(plan.lengthM).toBeLessThan(850)
  })

  it('costs by cleared acreage', () => {
    const plan = planTrail(t, [[45, 5], [45, 85]], parcels, owned)
    const acres = (plan.lengthM * BUILD.trail.widthM) / 4046.8564224
    expect(plan.costUsd).toBeCloseTo(acres * BUILD.trail.costPerAcreUsd, -3)
  })

  it('rejects short trails and land not owned', () => {
    expect(planTrail(t, [[45, 40], [45, 45]], parcels, owned).problems.join()).toMatch(/short/i)
    const onlyCentre = planTrail(t, [[45, 5], [45, 85]], parcels, ['r1c1'])
    expect(onlyCentre.problems.join()).toMatch(/own/i)
  })
})

describe('planLift', () => {
  const t = slope(30)
  const { parcels, owned } = all(t)

  it('puts the bottom station at the lower end', () => {
    const lift = planLift(t, 'fixedDouble', [45, 10], [45, 80], parcels, owned)
    expect(lift.bottom).toEqual([45, 80])
    expect(lift.verticalM).toBeCloseTo(700 * 0.3, -1)
    expect(lift.problems).toEqual([])
  })

  it('enforces type length limits', () => {
    const tow = planLift(t, 'ropeTow', [45, 10], [45, 80], parcels, owned)
    expect(tow.problems.join()).toMatch(/too long/i)
  })

  it('rejects lifts that barely climb', () => {
    const gentle = slope(5)
    const g = all(gentle)
    expect(planLift(gentle, 'fixedDouble', [45, 10], [45, 80], g.parcels, g.owned).problems.join()).toMatch(/uphill/i)
  })

  it('requires climbing and owned land', () => {
    const flat = planLift(t, 'fixedDouble', [10, 45], [80, 45], parcels, owned)
    expect(flat.problems.join()).toMatch(/uphill/i)
    const out = planLift(t, 'fixedDouble', [45, 10], [45, 80], parcels, ['r1c1'])
    expect(out.problems.join()).toMatch(/own/i)
  })

  it('costs base plus per metre', () => {
    const l = planLift(t, 'fixedQuad', [45, 30], [45, 70], parcels, owned)
    const s = BUILD.lifts.fixedQuad
    // lengthM is rounded to the metre, so allow a couple of metres of cost slack.
    expect(Math.abs(l.costUsd - (s.baseCostUsd + s.costPerMUsd * l.lengthM))).toBeLessThan(s.costPerMUsd * 2 + 1000)
  })
})

describe('resample', () => {
  it('spaces points evenly and keeps the ends', () => {
    const r = resample([[0, 0], [10, 0]] as Pt[], 2)
    expect(r.map((p) => p[0])).toEqual([0, 2, 4, 6, 8, 10])
  })
})

describe('building into game state', () => {
  const t = slope(30)
  const { parcels, owned } = all(t)
  const fresh = () => newGame('x', planPurchase(1_000_000, 100), 1, 'r1c1')

  it('deducts cost and records a trail', () => {
    const g = { ...fresh(), ownedParcels: owned }
    const plan = planTrail(t, [[45, 5], [45, 85]], parcels, owned)
    const r = buildTrail(g, plan)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.game.cashUsd).toBe(g.cashUsd - plan.costUsd)
      expect(r.game.trails).toHaveLength(1)
      expect(r.game.trails[0].difficulty).toBe('blue')
    }
  })

  it('refuses invalid plans and unaffordable builds', () => {
    const g = fresh()
    const bad = planTrail(t, [[45, 5], [45, 85]], parcels, ['r1c1'])
    expect(buildTrail(g, bad).ok).toBe(false)
    const lift = planLift(t, 'fixedQuad', [45, 40], [45, 50], parcels, owned)
    expect(buildLift({ ...g, cashUsd: 10 }, lift)).toEqual({ ok: false, reason: 'Not enough cash' })
  })

  it('upgrades v2 saves', () => {
    const { trails: _t, lifts: _l, ...v2 } = { ...fresh(), version: 2 }
    void _t; void _l
    const g = parseSave(JSON.parse(JSON.stringify(v2)))
    expect(g?.version).toBe(8)
    expect(g?.amenities.lodge).toBe(0)
    expect(g?.passPriceUsd).toBeGreaterThan(0)
    expect(g?.creditUsd).toBe(0)
    expect(g?.difficulty).toEqual({ snow: 0.5, finance: 0.5 })
    expect(g?.season).toBeNull()
    expect(g?.trails).toEqual([])
  })
})
