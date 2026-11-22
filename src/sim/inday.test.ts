/**
 * In-day actions: half-day ticket from noon, après special at the lodge, overflow parking shuttle.
 */
import { describe, expect, it } from 'vitest'
import { NEUTRAL_EFFECTS } from './amenities'
import { planPurchase } from './economy'
import { liveContextFor, newGame } from './game'
import { computeImpact } from './impact'
import {
  LIVE, answerAfternoon, defaultHalfDayUsd, finishLiveDay, parkingCheck, plainContext, runParkingCheck, runToEnd,
  setLiveApres, setLiveHalfDay, setLiveShuttle, startLiveDay, tickLiveDay, type LiveDay,
} from './liveDay'
import { newCalendar, setHalfDayPrice } from './pricing'
import { startSeason, simulateDay, type SeasonInputs, type SeasonState } from './season'
import { FULL_STAFF } from './staff'

const amenity = { ...NEUTRAL_EFFECTS, foodMult: 1.35, extrasPerDayGuestUsd: 9, lodgeSeats: 150 }
const roomy: SeasonInputs = {
  avgSnowfallIn: 300, driveToMetroMin: 75, trailKm: 8, difficultyKinds: 3, trailCount: 5, noEvents: true,
  lifts: [{ type: 'fixedQuad', capacityPph: 30_000 }], staff: { ...FULL_STAFF, payrollUsd: 6000 }, amenity,
}
/** Lifts that fill up: the hill is the limit. */
const tight: SeasonInputs = { ...roomy, lifts: [{ type: 'fixedDouble', capacityPph: 500 }] }
/** A small lot: parking is the limit. */
const smallLot: SeasonInputs = { ...roomy, amenity: { ...amenity, parkingCapGuests: 350 } }

function dayWhere(inp: SeasonInputs, weekday: number, seed = 4): SeasonState {
  let s = startSeason(1, seed, inp, 79, 449)
  for (let guard = 0; guard < 125; guard++) {
    const wd = new Date(Date.UTC(2026, 11, 1 + s.day)).getUTCDay()
    if (s.day >= s.openingDay && s.day > 20 && wd === weekday) return s
    s = simulateDay(s, inp).season
  }
  throw new Error('no such day')
}
const netOf = (l: LiveDay) => l.acc.ticketRev + l.acc.food + l.acc.extras + l.acc.eventIncome - l.acc.cost - l.acc.eventCost
const playTo = (l: LiveDay, inp: SeasonInputs, tick: number) => { let x = l; while (x.tick < tick) x = tickLiveDay(x, inp); return x }

describe('half-day ticket', () => {
  it('leaves the morning alone and sells afternoon arrivals the half-day ticket', () => {
    const s = dayWhere(roomy, 3)
    const off = runToEnd(startLiveDay(s, roomy, plainContext(s)), roomy)
    const on = runToEnd(setLiveHalfDay(startLiveDay(s, roomy, plainContext(s)), 60), roomy)
    expect(on.rows.slice(0, LIVE.halfDayFromTick)).toEqual(off.rows.slice(0, LIVE.halfDayFromTick))
    expect(on.rows.slice(LIVE.halfDayFromTick).every((r) => r.priceUsd === 60)).toBe(true)
    // More afternoon skiers (people who would not pay for a full day).
    expect(on.acc.dayGuests).toBeGreaterThan(off.acc.dayGuests)
  })

  it('pays on a quiet day with room, and costs on a day the lifts are already full', () => {
    const quiet = dayWhere(roomy, 3)
    const q = (l: LiveDay) => runToEnd(l, roomy)
    const qBase = plainContext(quiet)
    expect(netOf(q(setLiveHalfDay(startLiveDay(quiet, roomy, qBase), defaultHalfDayUsd(qBase.priceUsd))))).toBeGreaterThan(netOf(q(startLiveDay(quiet, roomy, qBase))))
    const busy = dayWhere(tight, 6)
    const b = (l: LiveDay) => runToEnd(l, tight)
    const bBase = plainContext(busy)
    expect(netOf(b(setLiveHalfDay(startLiveDay(busy, tight, bBase), defaultHalfDayUsd(bBase.priceUsd))))).toBeLessThan(netOf(b(startLiveDay(busy, tight, bBase))))
  })

  it('comes from the price calendar, and the day report replays it', () => {
    const g = newGame('co-berthoud-pass', planPurchase(900_000, 40), 3)
    expect(liveContextFor(g).halfDayUsd).toBeNull()
    const g2 = { ...g, calendar: setHalfDayPrice(newCalendar(), 55) }
    expect(liveContextFor(g2).halfDayUsd).toBe(55)
    const s = dayWhere(roomy, 3)
    const ctx = { ...plainContext(s), halfDayUsd: 55 }
    const day = runToEnd(startLiveDay(s, roomy, ctx), roomy)
    expect(finishLiveDay(day, s, roomy).result.halfDayUsd).toBe(55)
    const imp = computeImpact(s, roomy, day, ctx)
    expect(imp?.items.find((i) => i.id === 'halfDay')?.label).toBe('Half-day ticket')
  })
})

describe('après special', () => {
  it('seats a share of the guests on the hill at 3 pm, up to the lodge seats', () => {
    const s = dayWhere(roomy, 6)
    const day = runToEnd(setLiveApres(startLiveDay(s, roomy, plainContext(s)), true), roomy)
    const a = day.apresResult!
    expect(a).toBeDefined()
    expect(a.served).toBeLessThanOrEqual(150)
    expect(a.served).toBeLessThanOrEqual(a.wanted)
    expect(a.revenueUsd).toBeGreaterThan(0)
    const without = runToEnd(startLiveDay(s, roomy, plainContext(s)), roomy)
    expect(Math.round(netOf(day) - netOf(without))).toBe(a.revenueUsd - a.costUsd)
    expect(finishLiveDay(day, s, roomy).result.apres).toEqual(a)
  })

  it('costs reputation when the lodge overflows, and earns a little when it does not', () => {
    const s = dayWhere(roomy, 6)
    const tiny: SeasonInputs = { ...roomy, amenity: { ...amenity, lodgeSeats: 10 } }
    const crowded = runToEnd(setLiveApres(startLiveDay(s, tiny, plainContext(s)), true), tiny)
    expect(crowded.apresResult!.reputationDelta).toBeLessThan(0)
    const big: SeasonInputs = { ...roomy, amenity: { ...amenity, lodgeSeats: 5000 } }
    expect(runToEnd(setLiveApres(startLiveDay(s, big, plainContext(s)), true), big).apresResult!.reputationDelta).toBeGreaterThan(0)
  })

  it('cannot be booked once it is past 3 pm, and the feedback replays it', () => {
    const s = dayWhere(roomy, 6)
    const ctx = plainContext(s)
    const after = playTo(startLiveDay(s, roomy, ctx), roomy, LIVE.apresFromTick + 1)
    expect(setLiveApres(after, true)).toBe(after)
    const day = runToEnd(setLiveApres(playTo(startLiveDay(s, roomy, ctx), roomy, 4), true), roomy)
    expect(computeImpact(s, roomy, day, ctx)?.items.find((i) => i.id === 'apres')?.label).toBe('Après special')
  })
})

describe('overflow parking shuttle', () => {
  it('adds parking when the lot is the limit, with one day of hire plus a cost per guest carried', () => {
    const s = dayWhere(smallLot, 6)
    const off = runToEnd(startLiveDay(s, smallLot, plainContext(s)), smallLot)
    expect(off.acc.parkingAway).toBeGreaterThan(0)
    const on = runToEnd(setLiveShuttle(startLiveDay(s, smallLot, plainContext(s)), true), smallLot)
    expect(on.acc.guests).toBeGreaterThan(off.acc.guests)
    const carried = on.acc.guests - off.acc.guests
    expect(on.acc.parts!.services).toBeCloseTo(LIVE.shuttleDayUsd + carried * LIVE.shuttlePerGuestUsd, 0)
    // With room in the lot it only costs the day's hire.
    const roomyDay = dayWhere(roomy, 3)
    const a = runToEnd(startLiveDay(roomyDay, roomy, plainContext(roomyDay)), roomy)
    const b = runToEnd(setLiveShuttle(startLiveDay(roomyDay, roomy, plainContext(roomyDay)), true), roomy)
    expect(b.acc.guests).toBe(a.acc.guests)
  })

  it('pops up once when the lot fills, and the estimate matches what calling it does', () => {
    const s = dayWhere(smallLot, 6)
    let l = startLiveDay(s, smallLot, plainContext(s))
    while (!(l.rows.at(-1)?.turnedAway) && l.tick < LIVE.dayTicks) l = tickLiveDay(l, smallLot)
    const check = parkingCheck(l, smallLot)
    const o = check.options.find((x) => x.id === 'shuttle')!
    expect(o).toBeDefined()
    const offered = runParkingCheck(l, smallLot)
    expect(offered.afternoonOffer?.kind).toBe('parking')
    expect(runParkingCheck({ ...offered, afternoonOffer: null }, smallLot).afternoonOffer).toBeNull() // only once a day
    const taken = runToEnd(answerAfternoon(offered, 'shuttle'), smallLot)
    const declined = runToEnd(answerAfternoon(offered, 'none'), smallLot)
    expect(taken.shuttle).toBe(true)
    expect(Math.round(netOf(taken) - netOf(declined))).toBe(o.gainUsd)
    const imp = computeImpact(s, smallLot, taken, plainContext(s))
    expect(imp?.items.find((i) => i.id === 'shuttle')?.label).toBe('Overflow shuttle')
  })
})

describe('all three together', () => {
  it('replay reproduces a day that used every new action', () => {
    const s = dayWhere(smallLot, 6)
    const ctx = plainContext(s)
    let l = startLiveDay(s, smallLot, ctx)
    l = playTo(l, smallLot, 2)
    l = setLiveShuttle(l, true)
    l = playTo(l, smallLot, 5)
    l = setLiveHalfDay(l, 55)
    l = setLiveApres(l, true)
    const day = runToEnd(l, smallLot)
    // computeImpact returns null if a no-change replay does not reproduce the day.
    expect(computeImpact(s, smallLot, day, ctx)).not.toBeNull()
  })
})
