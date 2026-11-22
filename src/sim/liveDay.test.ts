import { describe, expect, it } from 'vitest'
import { amenityEffects, NEUTRAL_EFFECTS } from './amenities'
import { buildCard } from './cards'
import {
  LIVE, answerCard, finishLiveDay, isDayDone, plainContext, runToEnd, setLiftMode, setLivePrice, startLiveDay, tickLiveDay, totalTicks,
  setLiveNight, tickTime, type LiveDay,
} from './liveDay'
import { PROMOS, promoEffects, bookPromo } from './promos'
import { SEASON, simulateDay, startSeason, type SeasonInputs, type SeasonState } from './season'
import { snowmakingEffects } from './snowmaking'

const inputs: SeasonInputs = {
  avgSnowfallIn: 300, driveToMetroMin: 75, trailKm: 8, difficultyKinds: 3, trailCount: 5, noEvents: true,
  lifts: [{ type: 'fixedDouble', capacityPph: 1200 }, { type: 'fixedQuad', capacityPph: 2400 }],
}

/** A season advanced to a busy open Saturday (day index with weekday 6 after opening). */
function saturday(inp = inputs, seed = 4): { s: SeasonState; inp: SeasonInputs } {
  let s = startSeason(1, seed, inp, 79, 449)
  for (let guard = 0; guard < 120; guard++) {
    const open = s.day >= s.openingDay
    const wd = (new Date(Date.UTC(2026, 11, 1 + s.day)).getUTCDay())
    if (open && wd === 6 && s.day > 20) return { s, inp }
    s = simulateDay(s, inp).season
  }
  throw new Error('no Saturday found')
}

/** Play until the day pauses on its card (or ends). */
const play = (live: LiveDay, inp: SeasonInputs, ticks: number) => {
  let l = live
  for (let i = 0; i < ticks; i++) l = tickLiveDay(l, inp)
  return l
}

const toCard = (live: LiveDay, inp: SeasonInputs) => play(live, inp, 30)

describe('live day', () => {
  it('runs 14 half-hour ticks from 9:00 to 16:00 and no night session without lights', () => {
    const { s, inp } = saturday()
    const live = startLiveDay(s, inp, plainContext(s))
    expect(totalTicks(live, inp)).toBe(LIVE.dayTicks)
    const done = runToEnd(live, inp)
    expect(isDayDone(done, inp)).toBe(true)
    expect(done.rows).toHaveLength(LIVE.dayTicks)
    expect(tickTime(0)).toBe('9:00')
    expect(tickTime(13)).toBe('15:30')
    expect(tickTime(14)).toBe('17:00')
  })

  it('fills the hill in the morning: arrivals peak early and lines peak mid-day', () => {
    const { s, inp } = saturday()
    const done = runToEnd(startLiveDay(s, inp, plainContext(s)), inp)
    const arrivals = done.rows.map((r) => r.arrived)
    expect(arrivals[1]).toBeGreaterThan(arrivals[0])
    expect(arrivals[1]).toBeGreaterThan(arrivals[10])
    const onHill = done.rows.map((r) => r.onHill)
    expect(Math.max(...onHill)).toBeGreaterThan(onHill[0] * 3)
    // Whatever the profile, the rows add up to the day's guests.
    const result = finishLiveDay(done, s, inp).result
    expect(Math.round(arrivals.reduce((a, b) => a + b, 0))).toBe(result.guests)
  })

  it('gives the same day whether played tick by tick or in one go', () => {
    const { s, inp } = saturday()
    const stepped = finishLiveDay(runToEnd(play(startLiveDay(s, inp, plainContext(s)), inp, 6), inp), s, inp).result
    expect(stepped).toEqual(simulateDay(s, inp).result)
  })

  it('reproduces itself deterministically', () => {
    const { s, inp } = saturday()
    expect(finishLiveDay(runToEnd(startLiveDay(s, inp, plainContext(s)), inp), s, inp))
      .toEqual(finishLiveDay(runToEnd(startLiveDay(s, inp, plainContext(s)), inp), s, inp))
  })

  it('books revenue and costs so the day nets out', () => {
    const { s, inp } = saturday()
    const r = simulateDay(s, inp).result
    expect(r.netUsd).toBe(r.ticketRevenueUsd + r.foodRevenueUsd + r.extrasRevenueUsd + r.eventIncomeUsd - r.costUsd)
    expect(r.guests).toBe(r.dayTicketGuests + r.passVisits)
  })
})

describe('live decisions', () => {
  // A small lift network on a Saturday: capacity binds, so lift decisions matter.
  const tight: SeasonInputs = { ...inputs, lifts: [{ type: 'fixedDouble', capacityPph: 600 }, { type: 'fixedDouble', capacityPph: 600 }] }

  it('closing a lift mid-day cuts later guests and saves its running cost', () => {
    const { s, inp } = saturday(tight)
    const base = runToEnd(startLiveDay(s, inp, plainContext(s)), inp)
    const half = runToEnd(setLiftMode(play(startLiveDay(s, inp, plainContext(s)), inp, 5), 1, 'closed'), inp)
    expect(half.acc.guests).toBeLessThan(base.acc.guests)
    expect(half.acc.cost / Math.max(1, half.acc.guests)).toBeLessThan(base.acc.cost / Math.max(1, base.acc.guests) * 1.2)
    // Same guests before the change, fewer lifts running after it.
    expect(half.rows[4].arrived).toBeCloseTo(base.rows[4].arrived)
    expect(half.rows[8].lifts).toBe(1)
    expect(base.rows[8].lifts).toBe(2)
  })

  it('running a lift slowly keeps it open at half capacity', () => {
    const { s, inp } = saturday(tight)
    const slow = runToEnd(setLiftMode(startLiveDay(s, inp, plainContext(s)), 0, 'slow'), inp)
    const full = runToEnd(startLiveDay(s, inp, plainContext(s)), inp)
    expect(slow.acc.guests).toBeLessThan(full.acc.guests)
    expect(slow.rows[3].lifts).toBe(2)
  })

  it('a price change applies only to guests arriving afterwards, and not to pass holders', () => {
    const big: SeasonInputs = { ...inputs, lifts: [{ type: 'fixedQuad', capacityPph: 30000 }] }
    const { s, inp } = saturday(big)
    const same = runToEnd(startLiveDay(s, inp, plainContext(s)), inp)
    const raised = runToEnd(setLivePrice(play(startLiveDay(s, inp, plainContext(s)), inp, 7), 150), inp)
    // Same morning, fewer day tickets in the afternoon.
    expect(raised.rows[6].priceUsd).toBe(79)
    expect(raised.rows[9].priceUsd).toBe(150)
    expect(raised.acc.dayGuests).toBeLessThan(same.acc.dayGuests)
    // Pass visits are unchanged: pass holders are unaffected by daily prices.
    expect(raised.acc.guests - raised.acc.dayGuests).toBeCloseTo(same.acc.guests - same.acc.dayGuests, 5)
  })

  it('the day price moves day tickets, not pass visits', () => {
    const big: SeasonInputs = { ...inputs, lifts: [{ type: 'fixedQuad', capacityPph: 30000 }] }
    const { s, inp } = saturday(big)
    const cheap = finishLiveDay(runToEnd(startLiveDay(s, inp, { ...plainContext(s), priceUsd: 50 }), inp), s, inp).result
    const dear = finishLiveDay(runToEnd(startLiveDay(s, inp, { ...plainContext(s), priceUsd: 150 }), inp), s, inp).result
    expect(cheap.dayTicketGuests).toBeGreaterThan(dear.dayTicketGuests)
    // Pass holders are unaffected by the day price (up to rounding of the day's totals).
    expect(Math.abs(cheap.passVisits - dear.passVisits)).toBeLessThanOrEqual(1)
  })
})

describe('night skiing', () => {
  const lit: SeasonInputs = { ...inputs, amenity: amenityEffects({ parking: 4, lodge: 0, rentals: 0, school: 0, housing: 0, lights: 1 }, false) }

  it('adds a night session only with lights and only when switched on', () => {
    const { s, inp } = saturday(lit)
    const off = runToEnd(startLiveDay(s, inp, plainContext(s)), inp)
    const on = runToEnd(startLiveDay(s, inp, { ...plainContext(s), ops: { night: true } }), inp)
    expect(off.rows).toHaveLength(LIVE.dayTicks)
    expect(on.rows).toHaveLength(LIVE.dayTicks + LIVE.nightTicks)
    expect(on.acc.nightGuests).toBeGreaterThan(0)
    expect(on.acc.nightRev).toBeGreaterThan(0)
    // No lights, no night: the plan is ignored.
    const dark = runToEnd(startLiveDay(s, inputs, { ...plainContext(s), ops: { night: true } }), inputs)
    expect(dark.rows).toHaveLength(LIVE.dayTicks)
  })

  it('can be switched on or off until the evening, and charges lights and crew only when run', () => {
    const { s, inp } = saturday(lit)
    const start = startLiveDay(s, inp, plainContext(s))
    const turnedOn = runToEnd(setLiveNight(play(start, inp, 8), true), inp)
    expect(turnedOn.rows).toHaveLength(LIVE.dayTicks + LIVE.nightTicks)
    const day = runToEnd(start, inp)
    expect(turnedOn.acc.cost).toBeGreaterThan(day.acc.cost)
    // Once the night has started it cannot be cancelled by the toggle.
    const evening = play(start, inp, LIVE.dayTicks + 1)
    expect(setLiveNight(evening, false).night).toBe(evening.night)
  })

  it('counts night skiers as visits, with passes skiing free', () => {
    const { s, inp } = saturday(lit)
    const r = finishLiveDay(runToEnd(startLiveDay(s, inp, { ...plainContext(s), ops: { night: true } }), inp), s, inp).result
    expect(r.nightGuests).toBeGreaterThan(0)
    expect(r.guests).toBe(r.dayTicketGuests + r.passVisits)
    expect(r.nightRevenueUsd).toBeGreaterThan(0)
  })
})

describe('day plans and promos', () => {
  it('an overtime crew adds lift capacity at a payroll premium', () => {
    const tight: SeasonInputs = { ...inputs, lifts: [{ type: 'fixedDouble', capacityPph: 500 }], staff: undefined }
    const { s, inp } = saturday(tight)
    const plain = runToEnd(startLiveDay(s, inp, plainContext(s)), inp)
    const ot = runToEnd(startLiveDay(s, inp, { ...plainContext(s), ops: { overtime: true } }), inp)
    expect(ot.acc.guests).toBeGreaterThan(plain.acc.guests)
  })

  it('a snowmaking push adds base on a day with snowmaking, and costs money', () => {
    const snowy: SeasonInputs = { ...inputs, snowmaking: snowmakingEffects(3, 8, 'good', 1) }
    // Find a Saturday that is not a warm day (the system does not push through a thaw).
    let found: ReturnType<typeof saturday> | null = null
    for (let seed = 1; seed < 40 && !found; seed++) {
      const c = saturday(snowy, seed)
      if (!startLiveDay(c.s, c.inp, plainContext(c.s)).prep.warm) found = c
    }
    const { s, inp } = found!
    const plain = startLiveDay(s, inp, plainContext(s))
    const push = startLiveDay(s, inp, { ...plainContext(s), ops: { snowPush: true } })
    expect(push.prep.baseIn).toBeGreaterThan(plain.prep.baseIn)
    expect(push.prep.pushCostUsd).toBeGreaterThan(0)
    expect(runToEnd(push, inp).acc.cost).toBeGreaterThan(runToEnd(plain, inp).acc.cost)
    // No snowmaking, no push.
    expect(startLiveDay(s, inputs, { ...plainContext(s), ops: { snowPush: true } }).prep.pushCostUsd).toBe(0)
  })

  it('the midweek 2-for-1 fills weekdays but each ticket earns less', () => {
    const big: SeasonInputs = { ...inputs, lifts: [{ type: 'fixedQuad', capacityPph: 30000 }] }
    let s = startSeason(1, 6, big, 79, 449)
    while (s.day < 30 || new Date(Date.UTC(2026, 11, 1 + s.day)).getUTCDay() !== 3) s = simulateDay(s, big).season
    const booked = bookPromo([], 'twoForOne', s.day, 0)
    if (!booked.ok) throw new Error('booking failed')
    const promo = promoEffects(booked.promos, s.day, 3)
    const base = finishLiveDay(runToEnd(startLiveDay(s, big, plainContext(s)), big), s, big).result
    const deal = finishLiveDay(runToEnd(startLiveDay(s, big, { ...plainContext(s), promo }), big), s, big).result
    expect(deal.dayTicketGuests).toBeGreaterThan(base.dayTicketGuests * 1.4)
    expect(deal.ticketRevenueUsd / deal.dayTicketGuests).toBeLessThan((base.ticketRevenueUsd / base.dayTicketGuests) * 0.7)
    expect(deal.marketingUsd).toBe(PROMOS.twoForOne.minCostUsd)
    expect(deal.costUsd).toBeGreaterThan(base.costUsd)
  })
})

describe('event cards', () => {
  const card = (kind: 'liftBreakdown' | 'powerOutage' | 'groupBooking' | 'lawsuit', extra = {}) => buildCard(
    { kind, text: 'x', costUsd: 30_000, incomeUsd: 0, reputationDelta: -0.03, lift: 1, days: 2, guests: 200, ...extra }, 'c1', 4, 'Lift 2',
  )

  const withCard = (c: ReturnType<typeof card>) => {
    const { s, inp } = saturday({ ...inputs, lifts: [{ type: 'fixedDouble', capacityPph: 600 }, { type: 'fixedDouble', capacityPph: 600 }] })
    const live = startLiveDay(s, inp, plainContext(s))
    return { s, inp, live: { ...live, cards: [c], nextEvents: { rngState: 1, liftDownDays: [0, 2], groomerDownDays: 0, raceHeld: false } } }
  }

  it('pauses the day on the card until it is answered', () => {
    const { inp, live } = withCard(card('liftBreakdown'))
    const paused = toCard(live, inp)
    expect(paused.tick).toBe(4)
    expect(paused.pending).toBe('c1')
    // Ticking again does nothing until it is answered.
    expect(tickLiveDay(paused, inp).tick).toBe(4)
    const resumed = tickLiveDay(answerCard(paused, inp, 'standard'), inp)
    expect(resumed.tick).toBe(5)
  })

  it('a standard repair closes the lift for the rest of the day and tomorrow; a rush crew reopens it in two hours', () => {
    const { inp, live } = withCard(card('liftBreakdown'))
    const std = runToEnd(answerCard(toCard(live, inp), inp, 'standard'), inp)
    expect(std.rows[10].lifts).toBe(1)
    expect(std.nextEvents?.liftDownDays[1]).toBe(2)
    expect(std.acc.eventCost).toBe(30_000)
    const rush = runToEnd(answerCard(toCard(live, inp), inp, 'rush'), inp)
    expect(rush.rows[5].lifts).toBe(1)
    expect(rush.rows[10].lifts).toBe(2)
    expect(rush.nextEvents?.liftDownDays[1]).toBe(0)
    expect(rush.acc.eventCost).toBe(66_000)
    expect(rush.acc.guests).toBeGreaterThan(std.acc.guests)
  })

  it('the day report lists what you paid for the option you chose, not the original quote', () => {
    const { s, inp, live } = withCard(card('liftBreakdown'))
    const r = finishLiveDay(runToEnd(answerCard(toCard(live, inp), inp, 'rush'), inp), s, inp).result
    expect(r.events[0].costUsd).toBe(66_000)
    expect(r.eventCostUsd).toBe(66_000)
    expect(r.events[0].text).toMatch(/rush crew/i)
  })

  it('splits the running costs into parts that add up, and records the busiest moment and arrivals', () => {
    const { s, inp } = saturday()
    const r = simulateDay(s, inp).result
    const cp = r.costParts!
    const sumParts = cp.payroll + cp.lifts + cp.overhead + cp.snowmaking + cp.guests + cp.lights
    expect(Math.abs(sumParts - (r.costUsd - r.eventCostUsd - (r.marketingUsd ?? 0)))).toBeLessThanOrEqual(6)
    expect(r.hourly).toHaveLength(LIVE.dayTicks)
    expect(Math.abs(r.hourly!.reduce((a, b) => a + b, 0) - r.guests)).toBeLessThanOrEqual(LIVE.dayTicks)
    expect(r.peakOnHill).toBeGreaterThan(0)
  })

  it('runToEnd answers every card with its default option', () => {
    const { s, inp, live } = withCard(card('lawsuit'))
    const r = finishLiveDay(runToEnd(live, inp), s, inp).result
    expect(r.eventCostUsd).toBe(30_000)
    expect(r.events[0].text).toMatch(/Settled/)
  })

  it('an outage wipes out the afternoon unless you run generators', () => {
    const { inp, live } = withCard(card('powerOutage'))
    const wait = runToEnd(answerCard(toCard(live, inp), inp, 'wait'), inp)
    const gen = runToEnd(answerCard(toCard(live, inp), inp, 'generators'), inp)
    expect(wait.rows[8].arrived).toBeLessThan(wait.rows[3].arrived)
    expect(gen.acc.guests).toBeGreaterThan(wait.acc.guests)
    expect(gen.acc.eventCost).toBe(10_000)
  })

  it('a group booking adds paying skiers over four ticks (taking room walk-ins would use on a full day), or nothing if declined', () => {
    const { inp, live } = withCard(card('groupBooking'))
    const yes = runToEnd(answerCard(toCard(live, inp), inp, 'accept'), inp)
    const no = runToEnd(answerCard(toCard(live, inp), inp, 'decline'), inp)
    expect(yes.acc.guests - no.acc.guests).toBeGreaterThan(0)
    expect(yes.acc.guests - no.acc.guests).toBeLessThanOrEqual(200 + 1e-6)
    expect(yes.acc.ticketRev).toBeGreaterThan(no.acc.ticketRev)
  })

  it('fighting a lawsuit is repeatable and costs legal fees either way', () => {
    const { inp, live } = withCard(card('lawsuit'))
    const a = answerCard(toCard(live, inp), inp, 'fight')
    const b = answerCard(toCard(live, inp), inp, 'fight')
    expect(a.acc.eventCost).toBe(b.acc.eventCost)
    expect(a.acc.eventCost).toBeGreaterThanOrEqual(25_000)
  })

  it('declining a race gives the race slot back', () => {
    const c = buildCard({ kind: 'race', text: 'x', costUsd: 0, incomeUsd: 40_000, reputationDelta: 0.03 }, 'c1', 3, 'Lift 1')
    const { inp, live } = withCard(c)
    const withRace = { ...live, nextEvents: { rngState: 1, liftDownDays: [0, 0], groomerDownDays: 0, raceHeld: true } }
    expect(runToEnd(answerCard(toCard(withRace, inp), inp, 'decline'), inp).nextEvents?.raceHeld).toBe(false)
    const hosted = runToEnd(answerCard(toCard(withRace, inp), inp, 'host'), inp)
    expect(hosted.nextEvents?.raceHeld).toBe(true)
    expect(hosted.acc.eventIncome).toBe(40_000)
  })
})

describe('closed days and seasons', () => {
  it('a closed day has no ticks and only closed-day costs', () => {
    let s = startSeason(1, 3, inputs, 79, 449)
    s = { ...s, openingDay: 50 }
    const live = startLiveDay(s, inputs, plainContext(s))
    expect(totalTicks(live, inputs)).toBe(0)
    const r = finishLiveDay(live, s, inputs).result
    expect(r.open).toBe(false)
    expect(r.guests).toBe(0)
    expect(r.costUsd).toBeGreaterThan(0)
  })

  it('stays within the season length', () => {
    let s = startSeason(1, 9, inputs, 79, 449)
    while (s.day < SEASON.lengthDays) s = simulateDay(s, inputs).season
    expect(s.days).toHaveLength(SEASON.lengthDays)
    void NEUTRAL_EFFECTS
  })
})
