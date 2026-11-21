import { describe, expect, it } from 'vitest'
import { EVENTS, newEventState, rollDay, type EventContext } from './events'
import { createRng } from './rng'
import { SEASON, seasonTotals, simulateDay, startSeason, type SeasonInputs } from './season'
import { FULL_STAFF } from './staff'

const ctx: EventContext = {
  liftNames: ['Lift A', 'Lift B'], mechanicsRatio: 1, patrolRatio: 1, expectedGuests: 1000,
  conditions: 1, lastWaitMin: 0, weekend: false, hasBlack: true, trailCount: 5,
}
/** Count events of a kind over many independent days. */
const count = (c: EventContext, kind: string, days = 20000) => {
  let n = 0
  for (let i = 0; i < days; i++) {
    const { fx } = rollDay(newEventState(i, c.liftNames.length), c, createRng(i * 7919 + 1))
    n += fx.events.filter((e) => e.kind === kind).length
  }
  return n
}

describe('event odds respond to how the resort is run', () => {
  it('short mechanics mean more lift breakdowns', () => {
    expect(count({ ...ctx, mechanicsRatio: 0.3 }, 'liftBreakdown')).toBeGreaterThan(count(ctx, 'liftBreakdown') * 1.5)
  })
  it('a thin patrol and big crowds mean more lawsuits', () => {
    expect(count({ ...ctx, patrolRatio: 0.3 }, 'lawsuit')).toBeGreaterThan(count(ctx, 'lawsuit') * 1.5)
    expect(count({ ...ctx, expectedGuests: 5000 }, 'lawsuit')).toBeGreaterThan(count(ctx, 'lawsuit'))
  })
  it('viral reviews follow the guest experience', () => {
    expect(count({ ...ctx, conditions: 1.4 }, 'viralGood')).toBeGreaterThan(0)
    expect(count({ ...ctx, conditions: 1.0 }, 'viralGood')).toBe(0)
    expect(count({ ...ctx, lastWaitMin: 25 }, 'viralBad')).toBeGreaterThan(0)
    expect(count(ctx, 'viralBad')).toBe(0)
  })
  it('races need a weekend, black terrain and enough trails', () => {
    expect(count({ ...ctx, weekend: true }, 'race')).toBeGreaterThan(0)
    expect(count({ ...ctx, weekend: true, hasBlack: false }, 'race')).toBe(0)
    expect(count({ ...ctx, weekend: false }, 'race')).toBe(0)
  })
})

describe('ongoing breakdowns', () => {
  it('keeps a broken lift closed for its repair days, then reopens it', () => {
    let state = { ...newEventState(1, 2), liftDownDays: [2, 0] }
    let r = rollDay(state, { ...ctx, liftNames: ['A', 'B'] }, createRng(5))
    expect(r.fx.liftsDown.has(0)).toBe(true)
    state = r.state
    r = rollDay(state, ctx, createRng(6))
    expect(r.fx.liftsDown.has(0)).toBe(false)
  })
})

describe('events in the season', () => {
  const inp: SeasonInputs = {
    avgSnowfallIn: 300, driveToMetroMin: 75, trailKm: 8, difficultyKinds: 3, trailCount: 6,
    lifts: [{ type: 'fixedDouble', capacityPph: 1200 }, { type: 'fixedQuad', capacityPph: 2400 }], staff: FULL_STAFF,
  }
  const run = (noEvents: boolean, seed: number) => {
    const i = { ...inp, noEvents }
    let s = startSeason(1, seed, i, 79)
    while (s.day < SEASON.lengthDays) s = simulateDay(s, i).season
    return s
  }
  it('leaves the weather unchanged (separate random stream)', () => {
    const a = run(true, 9).days.map((d) => [d.newSnowIn, d.warm, d.conditions >= 0])
    const b = run(false, 9).days.map((d) => [d.newSnowIn, d.warm, d.conditions >= 0])
    expect(b).toEqual(a)
  })
  it('records events, costs and income in the season totals', () => {
    const totals = Array.from({ length: 10 }, (_, k) => seasonTotals(run(false, k + 1).days))
    expect(totals.some((t) => t.eventCount > 0)).toBe(true)
    expect(totals.some((t) => t.eventCostUsd > 0)).toBe(true)
    for (const t of totals) expect(t.eventIncomeUsd % EVENTS.race.feeUsd).toBe(0)
  })
  it('is deterministic', () => {
    expect(run(false, 4).days).toEqual(run(false, 4).days)
  })
})
