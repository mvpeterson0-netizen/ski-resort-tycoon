/// <reference types="node" />
/**
 * Marketing that scales with the resort, the random "Hometown ski club" campaign, the powder
 * alert that only works on a powder day, and the 2 pm overtime / night-session check.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { amenityEffects } from './amenities'
import { runCampaign } from './autoplayer'
import { expansionPremium, landPrice, planPurchase } from './economy'
import { advanceDay, bookCampaign, campaignCostUsd, marketGuests, newGame, type GameState } from './game'
import { computeImpact } from './impact'
import {
  LIVE, afternoonCheck, answerAfternoon, dayEnd, finishLiveDay, plainContext, runAfternoonCheck, runToEnd, setLiveLate, setLiveNight, setLiveOvertime, startLiveDay, tickLiveDay, tickTime,
  type LiveContext, type LiveDay,
} from './liveDay'
import { computeParcels, siteForParcel } from './parcels'
import { MAX_DEMAND_MULT, POWDER_DAY_IN, PROMOS, luckMultFor, promoCostUsd, promoEffects, type Promo, type PromoKind } from './promos'
import { createRng } from './rng'
import { startSeason, simulateDay, type SeasonInputs, type SeasonState } from './season'
import { SITES, regionById } from './sites'
import { FULL_STAFF } from './staff'
import { decodeDem } from './terrain'

const inputs: SeasonInputs = {
  avgSnowfallIn: 300, driveToMetroMin: 75, trailKm: 8, difficultyKinds: 3, trailCount: 5, noEvents: true,
  lifts: [{ type: 'fixedDouble', capacityPph: 1200 }, { type: 'fixedQuad', capacityPph: 2400 }],
}

function dayWhere(inp: SeasonInputs, ok: (s: SeasonState, weekday: number) => boolean, seed = 4): SeasonState {
  for (let sd = seed; sd < seed + 40; sd++) {
    let s = startSeason(1, sd, inp, 79, 449)
    for (let guard = 0; guard < 125; guard++) {
      const wd = new Date(Date.UTC(2026, 11, 1 + s.day)).getUTCDay()
      if (s.day >= s.openingDay && s.day > 10 && ok(s, wd)) return s
      s = simulateDay(s, inp).season
    }
  }
  throw new Error('no such day')
}
const netOf = (l: LiveDay) => l.acc.ticketRev + l.acc.food + l.acc.extras + l.acc.eventIncome - l.acc.cost - l.acc.eventCost
const playTo = (l: LiveDay, inp: SeasonInputs, tick: number) => { let x = l; while (x.tick < tick) x = tickLiveDay(x, inp); return x }

describe('campaign costs scale with the resort', () => {
  it('costs more for a bigger market, with a floor for tiny ones', () => {
    for (const k of Object.keys(PROMOS) as PromoKind[]) {
      expect(promoCostUsd(k, 2000)).toBeGreaterThan(promoCostUsd(k, 500))
      expect(promoCostUsd(k, 1)).toBe(PROMOS[k].minCostUsd)
    }
  })

  it('scales only the 2-for-1 with spend per guest (its gain is mostly food and rentals)', () => {
    expect(promoCostUsd('twoForOne', 800, 2)).toBeCloseTo(promoCostUsd('twoForOne', 800, 1) * 2, -2)
    expect(promoCostUsd('radio', 800, 2)).toBe(promoCostUsd('radio', 800, 1))
  })

  it('fixes the cost at booking from the resort as it is', () => {
    const site = SITES.find((s) => s.id === 'co-berthoud-pass')!
    const g: GameState = { ...newGame(site.id, planPurchase(900_000, 40), 3), lifts: [{ id: 'l1', name: 'A', type: 'fixedDouble', bottom: [0, 0], top: [1, 1], lengthM: 900, verticalM: 250, capacityPph: 1200, costUsd: 1 } as never] }
    const r = bookCampaign(g, site, 'radio', 5)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.promos[0].costUsd).toBe(campaignCostUsd(g, site, 'radio'))
    expect(marketGuests(g, site)).toBeGreaterThan(0)
  })
})

describe('Hometown ski club: a bell curve of results', () => {
  it('draws its lift on local demand from a normal distribution around a slight bump', () => {
    const rng = createRng(11)
    const xs = Array.from({ length: 20_000 }, () => luckMultFor('hometown', rng.next(), rng.next())!)
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
    const L = PROMOS.hometown.luck!
    expect(mean).toBeCloseTo(L.mean, 2)
    expect(sd).toBeGreaterThan(L.sd * 0.9)
    expect(sd).toBeLessThan(L.sd * 1.05)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(L.min)
    expect(Math.max(...xs)).toBeLessThanOrEqual(L.max)
    // Roughly bell-shaped: about two-thirds within one standard deviation.
    const within = xs.filter((x) => Math.abs(x - L.mean) <= L.sd).length / xs.length
    expect(within).toBeGreaterThan(0.62)
    expect(within).toBeLessThan(0.74)
    expect(luckMultFor('radio', 0.5, 0.5)).toBeUndefined()
  })

  it('is for small resorts only, and the draw is fixed per date (rebooking cannot reroll it)', () => {
    const site = SITES.find((s) => s.id === 'co-berthoud-pass')!
    const lift = (id: string) => ({ id, name: id, type: 'fixedDouble', bottom: [0, 0], top: [1, 1], lengthM: 900, verticalM: 250, capacityPph: 1200, costUsd: 1 }) as never
    const small: GameState = { ...newGame(site.id, planPurchase(900_000, 40), 3), lifts: [lift('a')] }
    const a = bookCampaign(small, site, 'hometown', 6)
    const b = bookCampaign(small, site, 'hometown', 6)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.promos[0].luckMult).toBe(b.promos[0].luckMult)
    expect(promoEffects(a.promos, 7, 3).localMult).toBe(a.promos[0].luckMult)
    const big = { ...small, lifts: [lift('a'), lift('b'), lift('c')] }
    expect(bookCampaign(big, site, 'hometown', 6).ok).toBe(false)
  })

  it('moves only local day-ticket demand', () => {
    const s = dayWhere(inputs, (_, wd) => wd === 3)
    const promos: Promo[] = [{ id: 'p1', kind: 'hometown', startDay: s.day, luckMult: 1.2 }]
    const ctx: LiveContext = { ...plainContext(s), promos, promo: promoEffects(promos, s.day, 3) }
    const with_ = runToEnd(startLiveDay(s, inputs, ctx), inputs)
    const without = runToEnd(startLiveDay(s, inputs, plainContext(s)), inputs)
    expect(with_.acc.dayGuests).toBeGreaterThan(without.acc.dayGuests)
    expect(with_.acc.guests - with_.acc.dayGuests).toBeCloseTo(without.acc.guests - without.acc.dayGuests, 6) // pass visits unchanged
  })
})

describe('powder alert', () => {
  const ctxFor = (s: SeasonState): LiveContext => {
    const promos: Promo[] = [{ id: 'p1', kind: 'powderAlert', startDay: s.day, costUsd: 0 }]
    return { ...plainContext(s), promos, promo: promoEffects(promos, s.day, new Date(Date.UTC(2026, 11, 1 + s.day)).getUTCDay()) }
  }
  const lift = (s: SeasonState) => {
    const a = runToEnd(startLiveDay(s, inputs, ctxFor(s)), inputs).acc.dayGuests
    const b = runToEnd(startLiveDay(s, inputs, plainContext(s)), inputs).acc.dayGuests
    return a / b
  }

  it('brings a real crowd on a powder day and almost nothing otherwise', () => {
    const powder = dayWhere(inputs, (s) => startLiveDay(s, inputs, plainContext(s)).prep.newSnowIn >= POWDER_DAY_IN)
    const dry = dayWhere(inputs, (s) => startLiveDay(s, inputs, plainContext(s)).prep.newSnowIn === 0)
    expect(lift(powder)).toBeGreaterThan(1.2)
    expect(lift(powder)).toBeLessThanOrEqual(MAX_DEMAND_MULT)
    expect(lift(dry)).toBeLessThan(1.05)
  })
})

describe('the 2 pm check', () => {
  // A small lift on a big market: lines and people turned away.
  const crowded: SeasonInputs = { ...inputs, lifts: [{ type: 'fixedDouble', capacityPph: 150 }], staff: { ...FULL_STAFF, payrollUsd: 6000 } }
  const quiet: SeasonInputs = { ...inputs, lifts: [{ type: 'fixedQuad', capacityPph: 30_000 }] }

  it('suggests overtime when the lifts are turning people away, and the estimate is the real effect', () => {
    const s = dayWhere(crowded, (_, wd) => wd === 6)
    const at2 = playTo(startLiveDay(s, crowded, plainContext(s)), crowded, LIVE.afternoonTick)
    const check = afternoonCheck(at2, crowded)
    const ot = check.options.find((o) => o.id === 'overtime')
    expect(ot).toBeDefined()
    expect(check.turnedAwaySoFar).toBeGreaterThan(0)
    // Taking it and playing on gives exactly the estimated gain (no later events in this test).
    const taken = runToEnd(answerAfternoon(at2, 'overtime'), crowded)
    const declined = runToEnd(answerAfternoon(at2, 'none'), crowded)
    expect(Math.round(netOf(taken) - netOf(declined))).toBe(ot!.gainUsd)
  })

  it('stays quiet on a day when nothing would pay off, and only comes up once', () => {
    const s = dayWhere(quiet, (_, wd) => wd === 3)
    const at2 = playTo(startLiveDay(s, quiet, plainContext(s)), quiet, LIVE.afternoonTick)
    const after = runAfternoonCheck(at2, quiet)
    expect(after.afternoonDone).toBe(true)
    expect(after.afternoonOffer).toBeNull()
    expect(runAfternoonCheck(after, quiet)).toBe(after)
  })

  it('suggests the night session when there are lights and it should pay', () => {
    const lit: SeasonInputs = { ...crowded, amenity: amenityEffects({ parking: 3, lodge: 1, rentals: 0, school: 0, housing: 0, lights: 2 } as never, true) }
    const s = dayWhere(lit, (_, wd) => wd === 6)
    const at2 = playTo(startLiveDay(s, lit, plainContext(s)), lit, LIVE.afternoonTick)
    const night = afternoonCheck(at2, lit).options.find((o) => o.id === 'night')
    if (night) {
      const taken = runToEnd(answerAfternoon(at2, 'night'), lit)
      expect(taken.night).toBe(true)
      expect(taken.acc.nightGuests).toBeGreaterThan(0)
    }
  })

  it('charges the overtime premium only for the hours after it was called in, and the feedback replays it', () => {
    const s = dayWhere(crowded, (_, wd) => wd === 6)
    const ctx = plainContext(s)
    const allDay = runToEnd(startLiveDay(s, crowded, { ...ctx, ops: { overtime: true } }), crowded)
    const none = runToEnd(startLiveDay(s, crowded, ctx), crowded)
    const late = runToEnd(setLiveOvertime(playTo(startLiveDay(s, crowded, ctx), crowded, LIVE.afternoonTick), true), crowded)
    const premium = (l: LiveDay) => l.acc.parts!.payroll - none.acc.parts!.payroll
    expect(premium(late)).toBeGreaterThan(0)
    expect(premium(late)).toBeCloseTo(premium(allDay) * (LIVE.dayTicks - LIVE.afternoonTick) / LIVE.dayTicks, 0)
    const imp = computeImpact(s, crowded, late, ctx)
    expect(imp).not.toBeNull()
    expect(imp!.items.some((i) => i.id === 'overtime')).toBe(true)
    expect(finishLiveDay(late, s, crowded).result.netUsd).not.toBe(finishLiveDay(none, s, crowded).result.netUsd)
  })
})

describe('extended hours (open to 5 pm)', () => {
  const inp: SeasonInputs = { ...inputs, staff: { ...FULL_STAFF, payrollUsd: 6000 } }

  it('adds an hour before any night session and keeps the clock right', () => {
    const s = dayWhere(inp, (_, wd) => wd === 6)
    const l = setLiveLate(startLiveDay(s, inp, plainContext(s)), true)
    expect(dayEnd(l)).toBe(LIVE.dayTicks + LIVE.lateTicks)
    expect(runToEnd(l, inp).rows).toHaveLength(LIVE.dayTicks + LIVE.lateTicks)
    expect(tickTime(LIVE.dayTicks, true)).toBe('16:00')
    expect(tickTime(LIVE.dayTicks + LIVE.lateTicks, true)).toBe('17:00')
    expect(tickTime(LIVE.dayTicks)).toBe('17:00')
    // With lights, the night session follows straight after.
    const lit: SeasonInputs = { ...inp, amenity: amenityEffects({ parking: 3, lodge: 1, rentals: 0, school: 0, housing: 0, lights: 2 } as never, true) }
    const both = runToEnd(setLiveNight(setLiveLate(startLiveDay(s, lit, plainContext(s)), true), true), lit)
    expect(both.rows).toHaveLength(LIVE.dayTicks + LIVE.lateTicks + LIVE.nightTicks)
    expect(both.acc.nightGuests).toBeGreaterThan(0)
  })

  it('brings extra guests at a twilight price and costs overtime only for the extra hour', () => {
    const s = dayWhere(inp, (_, wd) => wd === 6)
    const off = runToEnd(startLiveDay(s, inp, plainContext(s)), inp)
    const on = runToEnd(setLiveLate(startLiveDay(s, inp, plainContext(s)), true), inp)
    expect(on.rows.slice(0, LIVE.dayTicks)).toEqual(off.rows) // the normal day is untouched
    const lateRows = on.rows.slice(LIVE.dayTicks)
    expect(lateRows.every((r) => r.arrived > 0)).toBe(true)
    expect(lateRows[0].priceUsd).toBe(Math.round(off.priceUsd * LIVE.lateTicketMult))
    const extraPayroll = on.acc.parts!.payroll - off.acc.parts!.payroll
    expect(extraPayroll).toBeCloseTo((6000 / LIVE.dayTicks) * LIVE.latePayrollMult * LIVE.lateTicks, 0)
  })

  it('can no longer be switched once it is 4 pm, and the feedback replays it', () => {
    const s = dayWhere(inp, (_, wd) => wd === 6)
    const ctx = plainContext(s)
    const at4 = playTo(startLiveDay(s, inp, ctx), inp, LIVE.dayTicks)
    expect(setLiveLate(at4, true)).toBe(at4)
    const day = runToEnd(setLiveLate(playTo(startLiveDay(s, inp, ctx), inp, 6), true), inp)
    const imp = computeImpact(s, inp, day, ctx)
    expect(imp).not.toBeNull()
    expect(imp!.items.find((i) => i.id === 'late')?.label).toBe('Open to 5 pm')
    expect(finishLiveDay(day, s, inp).result.late).toBe(true)
  })

  it('is offered at 2 pm on a busy day, and the estimate matches what taking it does', () => {
    const s = dayWhere(inp, (_, wd) => wd === 6)
    const at2 = playTo(startLiveDay(s, inp, plainContext(s)), inp, LIVE.afternoonTick)
    const o = afternoonCheck(at2, inp).options.find((x) => x.id === 'late')
    expect(o).toBeDefined()
    const offer = runAfternoonCheck(at2, inp)
    const taken = runToEnd(answerAfternoon(offer, 'late'), inp)
    const declined = runToEnd(answerAfternoon(offer, 'none'), inp)
    expect(taken.late).toBe(true)
    expect(Math.round(netOf(taken) - netOf(declined))).toBe(o!.gainUsd)
  })
})

// ---- on the real resort: each campaign comes out a little ahead at its best time ----

describe('timing decides whether a campaign pays (year 1, Berthoud Pass)', () => {
  const site = SITES.find((s) => s.id === 'co-berthoud-pass')!
  const region = regionById(site.regionId)!
  const meta = JSON.parse(readFileSync(new URL('../../public/sites/co-berthoud-pass.json', import.meta.url), 'utf8'))
  const buf = readFileSync(new URL('../../public/sites/co-berthoud-pass.dem.bin', import.meta.url))
  const terrain = decodeDem(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta.width, meta.height, meta.cellM)
  const parcels = computeParcels(terrain)
  const price = (id: string) => landPrice(siteForParcel(site, parcels.find((p) => p.id === id)!), region).totalUsd
  const order = ['r0c1', 'r1c2', 'r2c1', 'r1c0', 'r0c0', 'r0c2', 'r2c2', 'r2c0']
  const starts: GameState[] = []
  for (const seed of [1, 2]) {
    runCampaign({
      site, starterPriceUsd: price('r1c1'), expansionPricesUsd: order.map((id, i) => Math.round(price(id) * expansionPremium(i + 1))),
      years: 1, seed, onSeasonStart: (g) => starts.push(g),
    })
  }
  const season = (g0: GameState, promos: Promo[]) => {
    let g = { ...g0, promos }
    const days = []
    while (g.phase === 'season' && !g.bankrupt) { const r = advanceDay(g, site); g = r.game; days.push(r.result) }
    return { net: g.lastSeason!.netUsd, days }
  }
  type Day = ReturnType<typeof season>['days'][number]
  /** Average season effect (after cost) of a campaign started on each open window, split by `right`. */
  function payoff(kind: PromoKind, right: (win: Day[]) => boolean) {
    const acc = { right: [] as number[], wrong: [] as number[] }
    for (const g0 of starts) {
      const base = season(g0, [])
      const len = PROMOS[kind].lengthDays
      // Booked at the season start, so the first possible day is after the lead time.
      for (let d = PROMOS[kind].leadDays; d + len <= base.days.length; d += 2) {
        const win = base.days.slice(d, d + len)
        if (!win.every((x) => x.open)) continue
        const b = bookCampaign(g0, site, kind, d)
        if (!b.ok) throw new Error(b.reason)
        acc[right(win) ? 'right' : 'wrong'].push(season(g0, b.promos).net - base.net)
      }
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
    return { right: avg(acc.right), wrong: avg(acc.wrong), nRight: acc.right.length }
  }
  const weekend = (w: Day[]) => w.some((d) => d.holiday) || (w.some((d) => d.weekday === 6) && w.some((d) => d.weekday === 0))

  it('social push: ahead over a weekend, behind midweek', () => {
    const r = payoff('social', weekend)
    expect(r.right).toBeGreaterThan(0)
    expect(r.wrong).toBeLessThan(0)
    // "Slightly": well under the campaign's own cost.
    expect(r.right).toBeLessThan(campaignCostUsd(starts[0], site, 'social'))
  })

  it('powder alert: ahead on a weekend powder day, behind on a dry day', () => {
    const r = payoff('powderAlert', (w) => w[0].newSnowIn >= POWDER_DAY_IN && (w[0].weekday === 0 || w[0].weekday === 6 || w[0].holiday))
    expect(r.nRight).toBeGreaterThan(3)
    expect(r.right).toBeGreaterThan(0)
    expect(r.wrong).toBeLessThan(0)
  })

  it('hometown ski club: a slight bump on average', () => {
    const r = payoff('hometown', () => true)
    expect(r.right).toBeGreaterThan(0)
    expect(r.right).toBeLessThan(campaignCostUsd(starts[0], site, 'hometown'))
  })
}, 120_000)
