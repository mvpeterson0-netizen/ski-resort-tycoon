import { describe, expect, it } from 'vitest'
import { planPurchase } from './economy'
import { advanceDay, beginSeason, newGame, seasonBlocker, setTicketPrice, type GameState } from './game'
import {
  SEASON, isHoliday, liftComfortGuests, seasonDate, simulateDay, startSeason, type SeasonInputs,
} from './season'
import { SITES } from './sites'

const site = SITES.find((s) => s.id === 'co-berthoud-pass')!
const inputs: SeasonInputs = {
  avgSnowfallIn: 300, driveToMetroMin: 75, trailKm: 3, difficultyKinds: 2, trailCount: 3,
  lifts: [{ type: 'fixedDouble', capacityPph: 1200 }],
}
const run = (seed: number, inp = inputs, price = 79) => {
  let s = startSeason(1, seed, inp.avgSnowfallIn, price)
  while (s.day < SEASON.lengthDays) s = simulateDay(s, inp).season
  return s
}

describe('calendar', () => {
  it('starts on Dec 1 of 2026 for game year 1', () => {
    expect(seasonDate(1, 0).toISOString().slice(0, 10)).toBe('2026-12-01')
  })
  it('flags Christmas week and the MLK / Presidents Day weekends', () => {
    expect(isHoliday(new Date(Date.UTC(2026, 11, 25)))).toBe(true)
    expect(isHoliday(new Date(Date.UTC(2027, 0, 1)))).toBe(true)
    // MLK Day 2027 is Monday Jan 18 (3rd Monday); Sat 16 – Mon 18.
    expect(isHoliday(new Date(Date.UTC(2027, 0, 16)))).toBe(true)
    expect(isHoliday(new Date(Date.UTC(2027, 0, 18)))).toBe(true)
    expect(isHoliday(new Date(Date.UTC(2027, 0, 19)))).toBe(false)
    // Presidents' Day 2027 is Monday Feb 15.
    expect(isHoliday(new Date(Date.UTC(2027, 1, 15)))).toBe(true)
    expect(isHoliday(new Date(Date.UTC(2027, 1, 10)))).toBe(false)
  })
})

describe('simulateDay', () => {
  it('is deterministic for a seed', () => {
    expect(run(42).days).toEqual(run(42).days)
    expect(run(42).days).not.toEqual(run(43).days)
  })

  it('stays closed until the base is deep enough', () => {
    for (const d of run(7).days) expect(d.open).toBe(d.baseIn >= SEASON.weather.openBaseIn)
  })

  it('never carries more guests than the hard lift cap', () => {
    const cap = Math.floor(liftComfortGuests(inputs.lifts) * SEASON.lifts.hardCapMultiple)
    for (const d of run(3).days) expect(d.guests).toBeLessThanOrEqual(cap)
  })

  it('draws more guests on weekends than weekdays', () => {
    const days = run(11).days.filter((d) => d.open && !d.holiday)
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
    const sat = avg(days.filter((d) => d.weekday === 6).map((d) => d.guests))
    const wkd = avg(days.filter((d) => d.weekday >= 1 && d.weekday <= 5).map((d) => d.guests))
    expect(sat).toBeGreaterThan(wkd * 1.5)
  })

  it('loses guests when the price goes up', () => {
    // Plenty of lift capacity so the cap does not hide the price effect.
    const big = { ...inputs, lifts: [{ type: 'fixedQuad' as const, capacityPph: 20000 }] }
    const guests = (price: number) => run(5, big, price).days.reduce((s, d) => s + d.guests, 0)
    expect(guests(150)).toBeLessThan(guests(60))
  })

  it('books revenue and costs consistently', () => {
    for (const d of run(9).days) {
      expect(d.netUsd).toBe(d.ticketRevenueUsd + d.foodRevenueUsd - d.costUsd)
      if (!d.open) expect(d.guests).toBe(0)
    }
  })
})

describe('season in game state', () => {
  const built = (): GameState => ({
    ...newGame(site.id, planPurchase(1_000_000, 100), 1, 'r1c1'),
    trails: [{ id: 't1', name: 'T', points: [], difficulty: 'blue', lengthM: 1200, verticalM: 300, acres: 10, costUsd: 0 }],
    lifts: [{ id: 'l1', name: 'L', type: 'fixedDouble', bottom: [0, 0], top: [1, 1], lengthM: 1000, verticalM: 250, capacityPph: 1200, costUsd: 0 }],
  })

  it('needs a lift and a trail', () => {
    expect(seasonBlocker(newGame(site.id, planPurchase(1_000_000, 100), 1))).toMatch(/lift/)
    expect(seasonBlocker(built())).toBeNull()
  })

  it('moves cash by each day and ends in the next off-season', () => {
    let g = beginSeason(setTicketPrice(built(), 85), site)
    expect(g.season?.ticketPriceUsd).toBe(85)
    let cash = g.cashUsd
    for (let i = 0; i < SEASON.lengthDays; i++) {
      const r = advanceDay(g, site)
      // The last day also closes the year (fixed costs, debt service), checked in finance tests.
      if (i < SEASON.lengthDays - 1) expect(r.game.cashUsd).toBe(cash + r.result.netUsd)
      cash = r.game.cashUsd
      g = r.game
    }
    expect(g.phase).toBe('offseason')
    expect(g.year).toBe(2)
    expect(g.lastSeason?.days).toBe(SEASON.lengthDays)
    expect(g.reports).toHaveLength(1)
  })
})
