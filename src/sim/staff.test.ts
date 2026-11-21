import { describe, expect, it } from 'vitest'
import { planPurchase } from './economy'
import { newGame, setStaffPlan, staffing, type GameState } from './game'
import { SEASON, seasonTotals, simulateDay, startSeason, type SeasonInputs } from './season'
import { SITES } from './sites'
import { FULL_STAFF, NO_STAFF, ROLE_SPECS, STAFF_TUNING, fillRate, headcount, localPool, neededStaff, staffEffects } from './staff'

const site = SITES.find((s) => s.id === 'co-berthoud-pass')!

describe('needed staff', () => {
  it('scales with lifts, terrain and the ski school', () => {
    const small = neededStaff({ lifts: [{ type: 'fixedDouble' }], trailKm: 2, hasSchool: false })
    const big = neededStaff({ lifts: [{ type: 'fixedQuad' }, { type: 'fixedQuad' }], trailKm: 20, hasSchool: true })
    expect(small.liftOps).toBe(STAFF_TUNING.liftOpsPerLift.fixedDouble)
    expect(small.instructors).toBe(0)
    expect(big.liftOps).toBe(2 * STAFF_TUNING.liftOpsPerLift.fixedQuad)
    expect(big.patrol).toBeGreaterThan(small.patrol)
    expect(big.instructors).toBe(STAFF_TUNING.instructorsWithSchool)
    expect(headcount(neededStaff({ lifts: [], trailKm: 0, hasSchool: false }))).toBe(0)
  })
})

describe('filling positions', () => {
  it('fills from the local pool, housing and higher wages', () => {
    expect(fillRate(20, 60, 0, 1)).toBe(1)
    expect(fillRate(120, 60, 0, 1)).toBeCloseTo(0.5)
    expect(fillRate(120, 60, 60, 1)).toBe(1)
    expect(fillRate(120, 60, 0, 1.2)).toBeGreaterThan(fillRate(120, 60, 0, 1))
  })
  it('has a bigger local pool near a city', () => {
    expect(localPool(40)).toBeGreaterThan(localPool(200))
  })
  it('pays only for filled positions, at the wage level', () => {
    const needed = { ...NO_STAFF, liftOps: 10 }
    const e = staffEffects(needed, needed, 0.5, 1.2)
    expect(e.ratios.liftOps).toBeCloseTo(0.5)
    expect(e.payrollUsd).toBe(Math.round(5 * ROLE_SPECS.liftOps.wageUsd * 1.2))
  })
})

describe('shortages in the season', () => {
  const base: SeasonInputs = {
    avgSnowfallIn: 300, driveToMetroMin: 75, trailKm: 10, difficultyKinds: 3, trailCount: 8,
    lifts: [{ type: 'fixedDouble', capacityPph: 1200 }],
  }
  const run = (staff = FULL_STAFF) => {
    const inp = { ...base, staff }
    let s = startSeason(1, 6, inp, 79)
    while (s.day < SEASON.lengthDays) s = simulateDay(s, inp).season
    return { totals: seasonTotals(s.days, s), days: s.days }
  }
  const short = (role: keyof typeof NO_STAFF, ratio: number) =>
    ({ ...FULL_STAFF, ratios: { ...FULL_STAFF.ratios, [role]: ratio } })

  it('short lift crews cut guests', () => {
    expect(run(short('liftOps', 0.5)).totals.guests).toBeLessThan(run().totals.guests)
  })
  it('short patrol closes terrain and cuts demand', () => {
    expect(run(short('patrol', 0.3)).totals.guests).toBeLessThan(run().totals.guests)
  })
  it('short grooming lowers conditions', () => {
    expect(run(short('groomers', 0)).totals.avgConditions).toBeLessThan(run().totals.avgConditions)
  })
  it('payroll is a daily cost', () => {
    const withPay = run({ ...FULL_STAFF, payrollUsd: 5000 })
    expect(withPay.totals.costUsd - run().totals.costUsd).toBe(5000 * SEASON.lengthDays)
  })
})

describe('staff plan in the game', () => {
  const built = (): GameState => ({
    ...newGame(site.id, planPurchase(1_000_000, 100), 1, 'r1c1'),
    trails: [{ id: 't1', name: 'T', points: [], difficulty: 'blue', lengthM: 3000, verticalM: 300, acres: 30, costUsd: 0 }],
    lifts: [{ id: 'l1', name: 'L', type: 'fixedDouble', bottom: [0, 0], top: [1, 1], lengthM: 1000, verticalM: 250, capacityPph: 1200, costUsd: 0 }],
  })
  it('auto mode hires the recommended roster', () => {
    const s = staffing(built(), site)
    expect(s.hired).toEqual(s.needed)
    expect(s.effects.ratios.liftOps).toBe(1)
  })
  it('manual mode uses the player numbers, and clamps wages', () => {
    const g = setStaffPlan(built(), { mode: 'manual', hired: { ...NO_STAFF, liftOps: 3 }, wageLevel: 5 })
    expect(g.staff.wageLevel).toBe(STAFF_TUNING.maxWageLevel)
    const s = staffing(g, site)
    expect(s.effects.ratios.liftOps).toBeCloseTo(3 / s.needed.liftOps)
    expect(s.effects.ratios.patrol).toBe(0)
  })
})
