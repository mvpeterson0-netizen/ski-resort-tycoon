import { describe, expect, it } from 'vitest'
import { planPurchase } from './economy'
import { advanceDay, beginSeason, newGame, seasonBlocker, setPassPrice, setTicketPrice, type GameState } from './game'
import {
  SEASON, conditionsScore, estimatePassSales, isHoliday, liftComfortGuests, seasonDate, seasonTotals, simulateDay,
  startSeason, type SeasonInputs,
} from './season'
import { SITES } from './sites'

const site = SITES.find((s) => s.id === 'co-berthoud-pass')!
const inputs: SeasonInputs = {
  avgSnowfallIn: 300, driveToMetroMin: 75, trailKm: 3, difficultyKinds: 2, trailCount: 3,
  lifts: [{ type: 'fixedDouble', capacityPph: 1200 }],
}
const run = (seed: number, inp = inputs, price = 79, pass: number = SEASON.defaultPassPriceUsd) => {
  let s = startSeason(1, seed, inp, price, pass)
  while (s.day < SEASON.lengthDays) s = simulateDay(s, inp).season
  return s
}
const seeds = Array.from({ length: 200 }, (_, i) => i + 1)

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

describe('owner rule: snow drives demand, the resort is open most of the time', () => {
  it('never opens fewer than ~78% of days on Normal, even at a low-snow site', () => {
    for (const snow of [300, 140]) {
      const inp = { ...inputs, avgSnowfallIn: snow }
      for (const seed of seeds) {
        const open = seasonTotals(run(seed, inp).days).openDays
        expect(open / SEASON.lengthDays).toBeGreaterThanOrEqual(0.76)
      }
    }
  })

  it('opens on (or near) the first day in good years', () => {
    const early = seeds.filter((seed) => startSeason(1, seed, inputs, 79).openingDay <= SEASON.weather.openingJitterDays)
    expect(early.length).toBeGreaterThan(seeds.length * 0.3)
  })

  it('keeps daily conditions between 50% and 150%, with both extremes occurring', () => {
    const all = seeds.slice(0, 40).flatMap((seed) => run(seed).days.filter((d) => d.open).map((d) => d.conditions))
    expect(Math.min(...all)).toBeGreaterThanOrEqual(0.5)
    expect(Math.max(...all)).toBeLessThanOrEqual(1.5)
    expect(all.some((c) => c >= 1.4)).toBe(true)
    expect(all.some((c) => c <= 0.7)).toBe(true)
  })

  it('scores powder above a thin, warm base', () => {
    expect(conditionsScore(60, 14, false)).toBe(1.5)
    expect(conditionsScore(60, 0, false)).toBe(1)
    expect(conditionsScore(10, 0, true)).toBe(0.5)
  })

  it('makes demand follow conditions', () => {
    const days = seeds.slice(0, 20).flatMap((seed) => run(seed).days.filter((d) => d.open && !d.holiday && d.weekday >= 1 && d.weekday <= 5))
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length)
    const good = avg(days.filter((d) => d.conditions >= 1.2).map((d) => d.guests))
    const poor = avg(days.filter((d) => d.conditions <= 0.8).map((d) => d.guests))
    expect(good).toBeGreaterThan(poor * 1.3)
  })
})

describe('simulateDay', () => {
  it('is deterministic for a seed', () => {
    expect(run(42).days).toEqual(run(42).days)
    expect(run(42).days).not.toEqual(run(43).days)
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

  it('loses day-ticket guests when the day price goes up', () => {
    const big = { ...inputs, lifts: [{ type: 'fixedQuad' as const, capacityPph: 20000 }] }
    const dayGuests = (price: number) => run(5, big, price).days.reduce((s, d) => s + d.dayTicketGuests, 0)
    expect(dayGuests(150)).toBeLessThan(dayGuests(60))
  })

  it('books revenue and costs consistently', () => {
    for (const d of run(9).days) {
      expect(d.netUsd).toBe(d.ticketRevenueUsd + d.foodRevenueUsd + d.extrasRevenueUsd + d.eventIncomeUsd - d.costUsd)
      expect(d.guests).toBe(d.dayTicketGuests + d.passVisits)
      if (!d.open) expect(d.guests).toBe(0)
    }
  })
})

describe('season passes', () => {
  it('sell more when cheaper, and pricier day tickets push locals to passes', () => {
    const at = (pass: number, day = 79) => estimatePassSales(1, inputs, pass, day)
    expect(at(299).passesSold).toBeGreaterThan(at(449).passesSold)
    expect(at(449).passesSold).toBeGreaterThan(at(899).passesSold)
    expect(at(449, 120).passesSold).toBeGreaterThan(at(449, 60).passesSold)
    expect(at(449).revenueUsd).toBe(at(449).passesSold * 449)
  })

  it('cannibalise day tickets: cheap passes mean fewer day-ticket guests', () => {
    const big = { ...inputs, lifts: [{ type: 'fixedQuad' as const, capacityPph: 20000 }] }
    const t = (pass: number) => seasonTotals(run(7, big, 79, pass).days)
    expect(t(199).ticketRevenueUsd).toBeLessThan(t(999).ticketRevenueUsd)
    expect(t(199).passVisits).toBeGreaterThan(t(999).passVisits)
  })

  it('sell nothing without lifts or trails', () => {
    expect(estimatePassSales(1, { ...inputs, lifts: [] }, 449, 79).passesSold).toBe(0)
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

  it('takes pass cash up front, moves cash daily, and ends in the next off-season', () => {
    const before = setPassPrice(setTicketPrice(built(), 85), 399)
    let g = beginSeason(before, site)
    expect(g.season?.ticketPriceUsd).toBe(85)
    expect(g.season?.passPriceUsd).toBe(399)
    expect(g.cashUsd).toBe(before.cashUsd + g.season!.passRevenueUsd)
    expect(setPassPrice(g, 999).passPriceUsd).toBe(399) // locked during the season
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
    expect(g.lastSeason?.passRevenueUsd).toBeGreaterThan(0)
    expect(g.reports).toHaveLength(1)
  })
})
