import { describe, expect, it } from 'vitest'
import { amenityEffects } from './amenities'
import { planPurchase } from './economy'
import { beginSeason, finishDay, newGame, playTick, startDay, answerLiveCard, liveDayDone, liveContextFor, type GameState } from './game'
import { IMPACT, computeImpact, replayDay } from './impact'
import {
  answerCard, finishLiveDay, isDayDone as isDone, plainContext, runToEnd, setLiftMode, setLivePrice, startLiveDay, tickLiveDay, type LiveContext, type LiveDay,
} from './liveDay'
import { bookPromo, promoEffects } from './promos'
import { startSeason, simulateDay, type SeasonInputs, type SeasonState } from './season'
import { SITES } from './sites'
import { snowmakingEffects } from './snowmaking'

const base: SeasonInputs = {
  avgSnowfallIn: 300, driveToMetroMin: 75, trailKm: 8, difficultyKinds: 3, trailCount: 5, noEvents: true,
  lifts: [{ type: 'fixedDouble', capacityPph: 1200 }, { type: 'fixedQuad', capacityPph: 2400 }],
}

function dayOn(weekday: number, inp: SeasonInputs, seed = 4): { s: SeasonState; inp: SeasonInputs } {
  let s = startSeason(1, seed, inp, 79, 449)
  for (let guard = 0; guard < 120; guard++) {
    const wd = new Date(Date.UTC(2026, 11, 1 + s.day)).getUTCDay()
    if (s.day >= s.openingDay && wd === weekday && s.day > 20) return { s, inp }
    s = simulateDay(s, inp).season
  }
  throw new Error('no such day')
}
const saturday = (inp = base, seed = 4) => dayOn(6, inp, seed)
const wednesday = (inp = base, seed = 4) => dayOn(3, inp, seed)
const play = (l: LiveDay, inp: SeasonInputs, n: number) => { let x = l; for (let i = 0; i < n; i++) x = tickLiveDay(x, inp); return x }
const finish = (live: LiveDay, s: SeasonState, inp: SeasonInputs, ctx: LiveContext) => computeImpact(s, inp, live, ctx)

describe('replaying a day', () => {
  it('reproduces a day that has a naturally rolled event card, whichever way it is answered', () => {
    const inp: SeasonInputs = { ...base, noEvents: false, lifts: [{ type: 'fixedDouble', capacityPph: 600 }, { type: 'fixedDouble', capacityPph: 600 }] }
    let found: { s: SeasonState; options: string[] } | null = null
    for (let seed = 1; seed < 60 && !found; seed++) {
      let s = startSeason(1, seed, inp, 79, 449)
      for (let d = 0; d < 126 && !found; d++) {
        const live = startLiveDay(s, inp, plainContext(s))
        const c = live.cards.find((x) => x.options.length > 1 && x.event.kind !== 'groupBooking')
        if (c) found = { s, options: c.options.map((o) => o.id) }
        s = simulateDay(s, inp).season
      }
    }
    expect(found).not.toBeNull()
    const { s, options } = found!
    for (const opt of options) {
      let live = startLiveDay(s, inp, plainContext(s))
      for (let guard = 0; guard < 60 && !isDone(live, inp); guard++) {
        live = tickLiveDay(live, inp)
        if (live.pending) live = answerCard(live, inp, opt)
      }
      expect(replayDay(s, inp, live.base!, live.log!, {}).result).toEqual(finishLiveDay(live, s, inp).result)
    }
  })

  it('a day with no decisions replays to the same result', () => {
    const { s, inp } = saturday()
    const ctx = plainContext(s)
    const live = runToEnd(startLiveDay(s, inp, ctx), inp)
    expect(replayDay(s, inp, live.base!, live.log!, {}).result).toEqual(finishLiveDay(live, s, inp).result)
  })

  it('a day with price and lift decisions replays to the same result', () => {
    const inp: SeasonInputs = { ...base, lifts: [{ type: 'fixedDouble', capacityPph: 600 }, { type: 'fixedDouble', capacityPph: 600 }] }
    const { s } = saturday(inp)
    let live = startLiveDay(s, inp, plainContext(s))
    live = setLivePrice(play(live, inp, 4), 120)
    live = setLiftMode(play(live, inp, 2), 1, 'closed')
    live = runToEnd(live, inp)
    expect(replayDay(s, inp, live.base!, live.log!, {}).result).toEqual(finishLiveDay(live, s, inp).result)
  })

  it('records nothing and cannot be analysed for a day saved before decisions were logged', () => {
    const { s, inp } = saturday()
    const live = { ...startLiveDay(s, inp, plainContext(s)) }
    delete live.log
    const edited = setLivePrice(live, 120)
    expect(edited.log).toBeUndefined()
    expect(finish(runToEnd(edited, inp), s, inp, plainContext(s))).toBeNull()
  })
})

describe('ticket price feedback', () => {
  const big: SeasonInputs = { ...base, lifts: [{ type: 'fixedQuad', capacityPph: 30000 }] }

  it('calls a price that is too high, and says what a better one would have earned', () => {
    const { s, inp } = wednesday(big)
    const ctx = { ...plainContext(s), priceUsd: 150 }
    const live = runToEnd(startLiveDay(s, inp, ctx), inp)
    const imp = finish(live, s, inp, ctx)!
    expect(imp.price!.verdict).toBe('high')
    expect(imp.price!.bestUsd).toBeLessThan(150)
    expect(imp.price!.bestNetUsd).toBeGreaterThan(imp.price!.actualNetUsd + IMPACT.priceGainMinUsd)
    const item = imp.items.find((i) => i.id === 'price')!
    expect(item.netUsd).toBeLessThan(0)
    expect(item.detail).toMatch(/too high/i)
    expect(imp.quotes.join(' ')).toMatch(/\$150/)
  })

  it('calls a price that is too low when the mountain is full', () => {
    const tight: SeasonInputs = { ...base, lifts: [{ type: 'fixedDouble', capacityPph: 500 }] }
    const { s, inp } = saturday(tight)
    const ctx = { ...plainContext(s), priceUsd: 30 }
    const live = runToEnd(startLiveDay(s, inp, ctx), inp)
    const imp = finish(live, s, inp, ctx)!
    expect(imp.price!.verdict).toBe('low')
    expect(imp.price!.bestUsd).toBeGreaterThan(30)
    expect(imp.items.find((i) => i.id === 'price')!.missed).toBe(true)
  })

  it('says the price that fills the hill without long lines is about right', () => {
    const mid: SeasonInputs = { ...base, lifts: [{ type: 'fixedQuad', capacityPph: 2400 }] }
    const { s, inp } = saturday(mid)
    // Follow the advice day after day: it should settle on one price instead of drifting forever.
    let price = 79
    let imp = null as ReturnType<typeof finish>
    for (let i = 0; i < 6; i++) {
      const ctx = { ...plainContext(s), priceUsd: price }
      imp = finish(runToEnd(startLiveDay(s, inp, ctx), inp), s, inp, ctx)!
      if (imp.price!.verdict === 'right') break
      price = imp.price!.bestUsd
    }
    expect(imp!.price!.verdict).toBe('right')
    expect(imp!.items.find((i) => i.id === 'price')!.netUsd).toBe(0)
    expect(imp!.price!.waitAtBest).toBeLessThanOrEqual(Math.max(IMPACT.maxLineMin, 15))
  })

  it('never recommends a price that would make the lines long', () => {
    const tight: SeasonInputs = { ...base, lifts: [{ type: 'fixedDouble', capacityPph: 500 }] }
    const { s, inp } = saturday(tight)
    const ctx = { ...plainContext(s), priceUsd: 70 }
    const imp = finish(runToEnd(startLiveDay(s, inp, ctx), inp), s, inp, ctx)!
    expect(imp.price!.waitAtBest).toBeLessThanOrEqual(Math.max(IMPACT.maxLineMin, 15))
  })

  it('shows what changing the price during the day was worth', () => {
    const { s, inp } = wednesday(big)
    const ctx = { ...plainContext(s), priceUsd: 150 }
    let live = startLiveDay(s, inp, ctx)
    live = setLivePrice(play(live, inp, 3), 100)
    live = runToEnd(live, inp)
    const imp = finish(live, s, inp, ctx)!
    const item = imp.items.find((i) => i.id === 'livePrice')!
    expect(item.netUsd).toBeGreaterThan(0)
    expect(item.detail).toMatch(/paid off/i)
  })
})

describe('campaign feedback', () => {
  const big: SeasonInputs = { ...base, lifts: [{ type: 'fixedQuad', capacityPph: 30000 }] }

  it('says how many people a campaign brought in and what it cost', () => {
    const { s, inp } = wednesday(big)
    const booked = bookPromo([], 'twoForOne', s.day, -1)
    if (!booked.ok) throw new Error(booked.reason)
    const ctx = { ...plainContext(s), promos: booked.promos, promo: promoEffects(booked.promos, s.day, 3) }
    const imp = finish(runToEnd(startLiveDay(s, inp, ctx), inp), s, inp, ctx)!
    expect(imp.promos).toHaveLength(1)
    expect(imp.promos![0].kind).toBe('twoForOne')
    expect(imp.promos![0].extraGuests).toBeGreaterThan(50)
    expect(imp.promos![0].costTodayUsd).toBe(6000)
    const item = imp.items.find((i) => i.id === 'promo-twoForOne')!
    expect(item.detail).toMatch(/extra day skiers/)
    expect(item.detail).toMatch(/paid today/)
  })

  it('has no campaign line when none is running', () => {
    const { s, inp } = wednesday(big)
    const imp = finish(runToEnd(startLiveDay(s, inp, plainContext(s)), inp), s, inp, plainContext(s))!
    expect(imp.promos).toBeUndefined()
    expect(imp.items.some((i) => i.id.startsWith('promo'))).toBe(false)
  })
})

describe('lift, night, crew and card feedback', () => {
  const tight: SeasonInputs = { ...base, lifts: [{ type: 'fixedDouble', capacityPph: 600 }, { type: 'fixedDouble', capacityPph: 600 }] }

  it('says what running a lift slowly saved and what it cost', () => {
    const { s, inp } = saturday(tight)
    const ctx = plainContext(s)
    const live = runToEnd(setLiftMode(startLiveDay(s, inp, ctx), 0, 'slow'), inp)
    const imp = finish(live, s, inp, ctx)!
    const item = imp.items.find((i) => i.id === 'lifts')!
    expect(item.detail).toMatch(/Saved \$/)
    expect(item.detail).toMatch(/lost \d+ skiers/)
    expect(item.netUsd).toBeLessThan(0) // on a full Saturday, lost sales outweigh the saving
  })

  const lit: SeasonInputs = { ...base, amenity: amenityEffects({ parking: 4, lodge: 0, rentals: 0, school: 0, housing: 0, lights: 1 }, false) }

  it('measures a night session that ran, and flags one you could have run', () => {
    const { s, inp } = saturday(lit)
    const ran = { ...plainContext(s), ops: { night: true } }
    const a = finish(runToEnd(startLiveDay(s, inp, ran), inp), s, inp, ran)!
    const night = a.items.find((i) => i.id === 'night')!
    expect(night.missed).toBeUndefined()
    expect(night.detail).toMatch(/night skiers/)
    const skipped = plainContext(s)
    const b = finish(runToEnd(startLiveDay(s, inp, skipped), inp), s, inp, skipped)!
    const missed = b.items.find((i) => i.id === 'night')!
    expect(missed.missed).toBe(true)
    expect(missed.netUsd).toBeLessThan(0)
  })

  it('flags an overtime crew you did not use when guests gave up at the lifts, and measures one you did', () => {
    const { s, inp } = saturday({ ...base, lifts: [{ type: 'fixedDouble', capacityPph: 400 }] })
    const none = finish(runToEnd(startLiveDay(s, inp, plainContext(s)), inp), s, inp, plainContext(s))!
    const missed = none.items.find((i) => i.id === 'overtime')
    expect(missed?.missed).toBe(true)
    const ctx = { ...plainContext(s), ops: { overtime: true } }
    const used = finish(runToEnd(startLiveDay(s, inp, ctx), inp), s, inp, ctx)!
    expect(used.items.find((i) => i.id === 'overtime')!.detail).toMatch(/more skiers got on the lifts/)
  })

  it('compares the option you picked on an event card with the other one', () => {
    // A card the sim rolled itself (so the replay can reproduce it): find a day with a two-option card.
    const inp: SeasonInputs = { ...tight, noEvents: false }
    let found: { s: SeasonState; id: string; options: string[] } | null = null
    for (let seed = 1; seed < 80 && !found; seed++) {
      let s = startSeason(1, seed, inp, 79, 449)
      for (let d = 0; d < 126 && !found; d++) {
        const c = startLiveDay(s, inp, plainContext(s)).cards.find((x) => x.options.length > 1 && x.event.kind !== 'groupBooking')
        if (c) found = { s, id: c.id, options: c.options.map((o) => o.id) }
        s = simulateDay(s, inp).season
      }
    }
    expect(found).not.toBeNull()
    const { s, id, options } = found!
    const ctx = plainContext(s)
    const playWith = (opt: string) => {
      let live = startLiveDay(s, inp, ctx)
      for (let guard = 0; guard < 60 && !isDone(live, inp); guard++) { live = tickLiveDay(live, inp); if (live.pending) live = answerCard(live, inp, opt) }
      return live
    }
    const [chosen, other] = options
    const live = playWith(chosen)
    const imp = finish(live, s, inp, ctx)!
    const item = imp.items.find((i) => i.id === `card-${id}`)!
    expect(item).toBeDefined()
    // The number is exactly the net of the choice minus the net of the alternative, played out for real.
    const netOf = (l: LiveDay) => finishLiveDay(l, s, inp).result.netUsd
    expect(item.netUsd).toBe(netOf(live) - netOf(playWith(other)))
  })

  it('names the best call and the biggest miss', () => {
    const { s, inp } = saturday(lit)
    const ctx = { ...plainContext(s), priceUsd: 30 }
    const imp = finish(runToEnd(startLiveDay(s, inp, ctx), inp), s, inp, ctx)!
    expect(imp.takeaways.join(' ')).toMatch(/Biggest (missed chance|cost)/)
  })

  it('writes guest quotes from the day, and caps them', () => {
    const { s, inp } = saturday(tight)
    const imp = finish(runToEnd(startLiveDay(s, inp, plainContext(s)), inp), s, inp, plainContext(s))!
    expect(imp.quotes.length).toBeLessThanOrEqual(4)
  })
})

describe('in the game', () => {
  const site = SITES.find((x) => x.id === 'co-berthoud-pass')!
  const built = (): GameState => {
    const g = { ...newGame(site.id, planPurchase(1_000_000, 100), 3, 'r1c1'), cashUsd: 20_000_000 }
    return {
      ...g,
      trails: [
        { id: 't1', name: 'T', points: [], difficulty: 'blue', lengthM: 1500, verticalM: 300, acres: 10, costUsd: 0 },
        { id: 't2', name: 'U', points: [], difficulty: 'green', lengthM: 1500, verticalM: 300, acres: 10, costUsd: 0 },
      ],
      lifts: [{ id: 'l1', name: 'L', type: 'fixedDouble', bottom: [0, 0], top: [1, 1], lengthM: 1000, verticalM: 250, capacityPph: 1200, costUsd: 0 }],
    }
  }
  const opened = () => { const s = beginSeason(built(), site); return { ...s, season: { ...s.season!, openingDay: 0, baseIn: 40, day: 4 } } }
  const playOut = (g0: GameState) => {
    let g = startDay(g0, site)
    for (let i = 0; i < 80 && !liveDayDone(g, site); i++) { g = playTick(g, site); if (g.live?.pending) g = answerLiveCard(g, site, '') }
    return g
  }

  it('attaches the impact to the day only when asked, and keeps it in the season', () => {
    const g = playOut(opened())
    expect(finishDay(g, site).result.impact).toBeUndefined()
    const r = finishDay(g, site, true)
    expect(r.result.impact?.items.length).toBeGreaterThan(0)
    expect(r.game.season?.days[0].impact).toEqual(r.result.impact)
    // Asking for the impact changes nothing about the day itself.
    const { impact: _i, ...rest } = r.result
    expect(rest).toEqual(finishDay(g, site).result)
  })

  it('records campaigns booked in the game so they can be analysed', () => {
    const b = bookPromo([], 'powderAlert', 4, 0)
    if (!b.ok) throw new Error(b.reason)
    const g0 = { ...opened(), promos: b.promos }
    expect(liveContextFor(g0).promos).toEqual(b.promos)
    const r = finishDay(playOut(g0), site, true)
    expect(r.result.impact?.promos?.[0].kind).toBe('powderAlert')
  })

  it('works with snowmaking on the mountain', () => {
    const inp: SeasonInputs = { ...base, snowmaking: snowmakingEffects(3, 8, 'good', 1) }
    const { s } = saturday(inp)
    const live = runToEnd(startLiveDay(s, inp, plainContext(s)), inp)
    expect(() => computeImpact(s, inp, live, plainContext(s))).not.toThrow()
  })
})
