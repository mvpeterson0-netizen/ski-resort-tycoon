import { describe, expect, it } from 'vitest'
import { planPurchase } from './economy'
import {
  advanceDay, answerLiveCard, beginSeason, finishDay, liveContextFor, liveDayDone, newGame, parseSave, playTick, setTicketPrice, startDay,
  type GameState,
} from './game'
import { PRICING, setDayOps, setKindPrice } from './pricing'
import { bookPromo, PROMOS } from './promos'
import { SEASON } from './season'
import { SITES } from './sites'

const site = SITES.find((s) => s.id === 'co-berthoud-pass')!

const built = (): GameState => ({
  ...newGame(site.id, planPurchase(1_000_000, 100), 3, 'r1c1'),
  cashUsd: 20_000_000,
  trails: [
    { id: 't1', name: 'T', points: [], difficulty: 'blue', lengthM: 1500, verticalM: 300, acres: 10, costUsd: 0 },
    { id: 't2', name: 'U', points: [], difficulty: 'green', lengthM: 1500, verticalM: 300, acres: 10, costUsd: 0 },
  ],
  lifts: [{ id: 'l1', name: 'L', type: 'fixedDouble', bottom: [0, 0], top: [1, 1], lengthM: 1000, verticalM: 250, capacityPph: 1200, costUsd: 0 }],
})

/** A season with day 0 already opened (no late-opening complications). */
const opened = (g: GameState): GameState => {
  const s = beginSeason(g, site)
  return { ...s, season: { ...s.season!, openingDay: 0, baseIn: 40 } }
}

describe('live day in the game state', () => {
  it('starts a day, plays it in ticks, and finishes it with cash moving by the net', () => {
    let g = startDay(opened(built()), site)
    expect(g.live).not.toBeNull()
    const cash0 = g.cashUsd
    for (let i = 0; i < 60 && !liveDayDone(g, site); i++) {
      g = playTick(g, site)
      if (g.live?.pending) g = answerLiveCard(g, site, '')
    }
    expect(liveDayDone(g, site)).toBe(true)
    const r = finishDay(g, site)
    expect(r.game.live).toBeNull()
    expect(r.game.season?.day).toBe(1)
    expect(r.game.cashUsd).toBe(cash0 + r.result.netUsd)
    expect(r.game.season?.days).toHaveLength(1)
  })

  it('survives a save and reload in the middle of a day', () => {
    let g = startDay(opened(built()), site)
    for (let i = 0; i < 5; i++) g = playTick(g, site)
    const back = parseSave(JSON.parse(JSON.stringify(g)))!
    expect(back.live?.tick).toBe(g.live?.tick)
    // Finish the day from the reloaded save and from the original: same result.
    const finish = (x: GameState) => {
      let y = x
      for (let i = 0; i < 60 && !liveDayDone(y, site); i++) { y = playTick(y, site); if (y.live?.pending) y = answerLiveCard(y, site, '') }
      return finishDay(y, site).result
    }
    expect(finish(back)).toEqual(finish(g))
  })

  it('plays the same day as the one-call advanceDay', () => {
    const g = opened(built())
    let stepped = startDay(g, site)
    for (let i = 0; i < 60 && !liveDayDone(stepped, site); i++) { stepped = playTick(stepped, site); if (stepped.live?.pending) stepped = answerLiveCard(stepped, site, '') }
    expect(finishDay(stepped, site).result).toEqual(advanceDay(g, site).result)
  })

  it('does not start a second day while one is under way', () => {
    const g = startDay(opened(built()), site)
    expect(startDay(g, site)).toBe(g)
  })

  it('plays a whole season live and closes the year', () => {
    let g = opened(built())
    for (let d = 0; d < SEASON.lengthDays && g.phase === 'season' && !g.bankrupt; d++) g = advanceDay(g, site).game
    expect(g.phase).toBe('offseason')
    expect(g.year).toBe(2)
    expect(g.reports).toHaveLength(1)
    // The year's plans and campaigns are spent.
    expect(g.calendar.ops).toEqual({})
    expect(g.promos).toEqual([])
  })
})

describe('calendar prices reach the day', () => {
  it('uses weekday, weekend, holiday and date-override prices', () => {
    const g0 = setTicketPrice(opened(built()), 80)
    const at = (day: number) => liveContextFor({ ...g0, season: { ...g0.season!, day } }).priceUsd
    expect(at(0)).toBe(80) // Tue Dec 1
    expect(at(4)).toBe(90) // Sat Dec 5: default weekend markup
    expect(at(24)).toBe(105) // Dec 25: holiday
    const custom = { ...g0, calendar: setKindPrice(setDayOps(g0.calendar, 5, { price: 200 }), 'weekend', 100) }
    const at2 = (day: number) => liveContextFor({ ...custom, season: { ...custom.season!, day } }).priceUsd
    expect(at2(4)).toBe(100)
    expect(at2(5)).toBe(200) // override beats the weekend price
  })

  it('plays a weekend day at the weekend price and shows it on the result', () => {
    let g = setTicketPrice(opened(built()), 80)
    g = { ...g, season: { ...g.season!, day: 4 } }
    expect(advanceDay(g, site).result.ticketPriceUsd).toBe(90)
  })

  it('charges a campaign on its first day and plays its demand effect', () => {
    let g = opened(built())
    const b = bookPromo([], 'social', 0, -1)
    if (!b.ok) throw new Error('booking failed')
    g = { ...g, promos: b.promos }
    const withPromo = advanceDay(g, site).result
    const without = advanceDay({ ...g, promos: [] }, site).result
    expect(withPromo.marketingUsd).toBe(PROMOS.social.minCostUsd)
    expect(withPromo.dayTicketGuests).toBeGreaterThanOrEqual(without.dayTicketGuests)
    expect(withPromo.costUsd).toBeGreaterThan(without.costUsd)
  })

  it('day plans carry into the live day', () => {
    let g = opened(built())
    g = { ...g, calendar: setDayOps(g.calendar, 0, { overtime: true }) }
    expect(startDay(g, site).live?.ops.overtime).toBe(true)
  })
})

describe('saves', () => {
  it('upgrades a v11 save to the calendar and no live day', () => {
    const g = built()
    const { calendar: _c, promos: _p, live: _l, ...rest } = { ...g, version: 11 }
    const back = parseSave(JSON.parse(JSON.stringify(rest)))!
    expect(back.version).toBe(12)
    expect(back.calendar.night).toBe(PRICING.nightPriceUsd)
    expect(back.promos).toEqual([])
    expect(back.live).toBeNull()
  })
})

describe('saves from before a building existed', () => {
  it('fills in missing amenities (night lighting) and newer fields, whatever the save version', () => {
    const g = built()
    const old = JSON.parse(JSON.stringify(g))
    delete old.amenities.lights
    delete old.calendar
    delete old.promos
    delete old.live
    delete old.base
    delete old.villageUsd
    const back = parseSave(old)!
    expect(back.version).toBe(12)
    expect(back.amenities.lights).toBe(0)
    expect(back.amenities.parking).toBe(g.amenities.parking)
    expect(back.calendar.night).toBe(PRICING.nightPriceUsd)
    expect(back.promos).toEqual([])
    expect(back.live).toBeNull()
    expect(back.base).toBeNull()
    expect(back.villageUsd).toBe(0)
  })

  it('keeps the levels a player already built', () => {
    const g = { ...built(), amenities: { parking: 2, lodge: 3, rentals: 1, school: 2, housing: 1, lights: 1 } }
    expect(parseSave(JSON.parse(JSON.stringify(g)))!.amenities).toEqual(g.amenities)
  })
})

describe('campaign cost on a closed day', () => {
  it('is charged even if the resort is closed on its first day', () => {
    const g0 = beginSeason(built(), site)
    const closed = { ...g0, season: { ...g0.season!, openingDay: 50 } }
    const b = bookPromo([], 'social', 0, -1)
    if (!b.ok) throw new Error(b.reason)
    const withPromo = advanceDay({ ...closed, promos: b.promos }, site).result
    const without = advanceDay(closed, site).result
    expect(withPromo.open).toBe(false)
    expect(withPromo.marketingUsd).toBe(PROMOS.social.minCostUsd)
    expect(withPromo.costUsd).toBe(without.costUsd + PROMOS.social.minCostUsd)
  })
})
