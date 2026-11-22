/**
 * Breakdowns and events during the winter season. Rolled once per open day from a
 * separate RNG stream, so a game's weather is the same with or without events.
 *
 * Every probability, duration and cost here is a PLACEHOLDER for gameplay, not
 * sourced incident data.
 */
import type { Rng } from './rng'

export const EVENTS = {
  liftBreakdown: { chancePerLiftDay: 0.003, mechanicsShortageMult: 3, days: [1, 2] as const, repairUsd: [15_000, 60_000] as const },
  groomerBreakdown: { chancePerDay: 0.006, days: 2, repairUsd: 8_000, conditionsPenalty: 0.1 },
  powerOutage: { chancePerDay: 0.002, guestShare: 0.35 },
  // Settlement is what the resort pays after liability insurance (premiums are in fixed costs).
  lawsuit: { chancePerDay: 0.0015, per1000Guests: 0.0006, patrolShortageMult: 3, settlementUsd: [20_000, 120_000] as const, reputationHit: 0.03 },
  viralGood: { chancePerDay: 0.012, minConditions: 1.3, maxWaitMin: 5, reputationGain: 0.04 },
  viralBad: { chancePerDay: 0.015, minWaitMin: 20, maxConditions: 0.6, reputationHit: 0.04 },
  race: { chancePerWeekendDay: 0.025, minTrails: 3, feeUsd: 40_000, dayGuestShare: 0.8, reputationGain: 0.03, onePerSeason: true },
  // A ski club or school asks to book a discounted group. Only an offer: declining costs nothing.
  groupBooking: { chancePerWeekday: 0.012, guests: [150, 400] as const, perGuestUsd: 38 },
} as const

export type EventKind = 'liftBreakdown' | 'groomerBreakdown' | 'powerOutage' | 'lawsuit' | 'viralGood' | 'viralBad' | 'race' | 'groupBooking'

export interface SeasonEvent {
  kind: EventKind
  text: string
  costUsd: number
  /** Positive for income (race fee). */
  incomeUsd: number
  reputationDelta: number
  /** Which lift (index) broke, and for how many days. */
  lift?: number
  days?: number
  /** Group size for a booking offer. */
  guests?: number
}

/** Ongoing effects carried day to day. */
export interface EventState {
  rngState: number
  /** Days each lift (by index) remains closed. */
  liftDownDays: number[]
  groomerDownDays: number
  raceHeld: boolean
}

export const newEventState = (seed: number, lifts: number): EventState => ({
  rngState: seed >>> 0, liftDownDays: Array(lifts).fill(0), groomerDownDays: 0, raceHeld: false,
})

export interface EventContext {
  liftNames: string[]
  mechanicsRatio: number
  patrolRatio: number
  /** Guests expected today before events (for lawsuit odds). */
  expectedGuests: number
  conditions: number
  /** Lift line from yesterday (for reviews). */
  lastWaitMin: number
  weekend: boolean
  hasBlack: boolean
  trailCount: number
}

export interface DayEffects {
  events: SeasonEvent[]
  /** Lift indexes closed today. */
  liftsDown: Set<number>
  conditionsPenalty: number
  /** Multiplier on all guests (outage). */
  guestMult: number
  /** Multiplier on day-ticket demand (race closes some runs). */
  dayDemandMult: number
  costUsd: number
  incomeUsd: number
  reputationDelta: number
}

const between = (rng: Rng, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * rng.next()
const roundK = (n: number) => Math.round(n / 1000) * 1000

/** Advance ongoing breakdowns and roll today's new events. */
export function rollDay(state: EventState, ctx: EventContext, rng: Rng): { state: EventState; fx: DayEffects } {
  const E = EVENTS
  const events: SeasonEvent[] = []
  const liftDownDays = state.liftDownDays.map((d) => Math.max(0, d - 1))
  let groomerDownDays = Math.max(0, state.groomerDownDays - 1)
  let raceHeld = state.raceHeld
  let guestMult = 1
  let dayDemandMult = 1

  // Lift breakdowns (more likely when short of mechanics).
  const liftChance = E.liftBreakdown.chancePerLiftDay * (1 + E.liftBreakdown.mechanicsShortageMult * (1 - ctx.mechanicsRatio))
  ctx.liftNames.forEach((name, i) => {
    if (liftDownDays[i] > 0 || rng.next() >= liftChance) return
    const days = Math.round(between(rng, E.liftBreakdown.days))
    const cost = roundK(between(rng, E.liftBreakdown.repairUsd))
    liftDownDays[i] = days
    events.push({ kind: 'liftBreakdown', text: `${name} broke down: closed ${days} day${days > 1 ? 's' : ''}`, costUsd: cost, incomeUsd: 0, reputationDelta: 0, lift: i, days })
  })

  if (groomerDownDays === 0 && rng.next() < E.groomerBreakdown.chancePerDay) {
    groomerDownDays = E.groomerBreakdown.days
    events.push({ kind: 'groomerBreakdown', text: 'A snowcat broke down: rougher snow for 2 days', costUsd: E.groomerBreakdown.repairUsd, incomeUsd: 0, reputationDelta: 0 })
  }

  if (rng.next() < E.powerOutage.chancePerDay) {
    guestMult = E.powerOutage.guestShare
    events.push({ kind: 'powerOutage', text: 'Power outage: lifts stopped most of the day', costUsd: 0, incomeUsd: 0, reputationDelta: 0 })
  }

  // Injury lawsuits: more guests and a thin patrol raise the odds.
  const lawChance = (E.lawsuit.chancePerDay + (ctx.expectedGuests / 1000) * E.lawsuit.per1000Guests)
    * (1 + E.lawsuit.patrolShortageMult * (1 - ctx.patrolRatio))
  if (rng.next() < lawChance) {
    const cost = roundK(between(rng, E.lawsuit.settlementUsd))
    events.push({ kind: 'lawsuit', text: 'An injured skier sued: your share after insurance', costUsd: cost, incomeUsd: 0, reputationDelta: -E.lawsuit.reputationHit })
  }

  if (ctx.conditions >= E.viralGood.minConditions && ctx.lastWaitMin <= E.viralGood.maxWaitMin && rng.next() < E.viralGood.chancePerDay) {
    events.push({ kind: 'viralGood', text: 'A powder-day video of your mountain went viral', costUsd: 0, incomeUsd: 0, reputationDelta: E.viralGood.reputationGain })
  } else if ((ctx.lastWaitMin >= E.viralBad.minWaitMin || ctx.conditions <= E.viralBad.maxConditions) && rng.next() < E.viralBad.chancePerDay) {
    const why = ctx.lastWaitMin >= E.viralBad.minWaitMin ? 'lift lines' : 'icy snow'
    events.push({ kind: 'viralBad', text: `A post about your ${why} went viral`, costUsd: 0, incomeUsd: 0, reputationDelta: -E.viralBad.reputationHit })
  }

  if (!raceHeld && ctx.weekend && ctx.hasBlack && ctx.trailCount >= E.race.minTrails && rng.next() < E.race.chancePerWeekendDay) {
    raceHeld = true
    dayDemandMult = E.race.dayGuestShare
    events.push({ kind: 'race', text: 'You hosted a regional race: fee, crowds at the lodge, and good press', costUsd: 0, incomeUsd: E.race.feeUsd, reputationDelta: E.race.reputationGain })
  }

  // A group booking offer on a quiet weekday (rolled last so earlier events keep their odds).
  if (!ctx.weekend && rng.next() < E.groupBooking.chancePerWeekday) {
    const guests = Math.round(between(rng, E.groupBooking.guests) / 10) * 10
    events.push({ kind: 'groupBooking', text: `A ski club asks to book ${guests} skiers today`, costUsd: 0, incomeUsd: 0, reputationDelta: 0, guests })
  }

  const liftsDown = new Set<number>()
  liftDownDays.forEach((d, i) => { if (d > 0) liftsDown.add(i) })
  return {
    state: { rngState: rng.state(), liftDownDays, groomerDownDays, raceHeld },
    fx: {
      events, liftsDown,
      conditionsPenalty: groomerDownDays > 0 ? E.groomerBreakdown.conditionsPenalty : 0,
      guestMult, dayDemandMult,
      costUsd: events.reduce((s, e) => s + e.costUsd, 0),
      incomeUsd: events.reduce((s, e) => s + e.incomeUsd, 0),
      reputationDelta: events.reduce((s, e) => s + e.reputationDelta, 0),
    },
  }
}
