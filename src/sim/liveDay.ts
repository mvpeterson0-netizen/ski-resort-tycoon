/**
 * The live day: one season day played in 30-minute ticks (9:00–16:00, plus an optional
 * night session 17:00–21:00) so the player can watch the resort fill up and react.
 *
 * It uses the same demand, capacity and cost formulas as the old whole-day model, with
 * arrivals spread over the day by a fixed profile. With no decisions and no events the
 * day's totals match the whole-day numbers (checked in tests), so balance is unchanged.
 * Decisions that change things mid-day: ticket price, closing or slowing lifts, event
 * cards, and the night session.
 *
 * Pure and JSON-serialisable: the live state is saved with the game, so a day can be
 * resumed after a reload. Every number here is a PLACEHOLDER for gameplay.
 */
import { buildCard, resolveCard, type CardOutcome, type EventCard } from './cards'
import { NEUTRAL_EFFECTS } from './amenities'
import { financeModifiers, snowModifiers } from './difficultySettings'
import { rollDay, type EventState, type SeasonEvent } from './events'
import type { DayOps } from './pricing'
import type { DayImpact } from './impact'
import { MAX_DEMAND_MULT, NO_PROMO, POWDER_DAY_IN, type Promo, type PromoEffects } from './promos'
import { createRng } from './rng'
import {
  SEASON, conditionsScore, isHoliday, liftComfortGuests, seasonDate, appealOf, dayFactorOf,
  type DayResult, type SeasonInputs, type SeasonState,
} from './season'
import { NO_SNOWMAKING, SNOWMAKING, effectiveBase } from './snowmaking'
import { FULL_STAFF, STAFF_TUNING } from './staff'

export const LIVE = {
  dayTicks: 14,
  nightTicks: 8,
  dayStartMin: 9 * 60,
  nightStartMin: 17 * 60,
  tickMin: 30,
  /** How many ticks a day guest stays on the hill (for the lift-line estimate). */
  dayStayTicks: 10,
  nightStayTicks: 4,
  /** Relative arrivals per tick: a morning surge, a lunch dip, a taper into the afternoon. */
  dayWeights: [10, 13, 12, 10, 8, 7, 7, 6, 5, 5, 4, 4, 3, 3],
  nightWeights: [14, 18, 18, 16, 14, 10, 6, 4],
  /** Night session demand as a share of the day's market (mostly locals). */
  nightMarketShare: 0.3,
  nightRefPriceUsd: 35,
  /** Pass holders' night visits relative to their day visits. */
  nightPassShare: 0.12,
  slowCapacity: 0.5,
  slowCost: 0.7,
  overtimeCapacity: 1.15,
  overtimePayrollPremium: 0.25,
  snowPushIn: 4,
  snowPushCostMult: 0.8,
  /**
   * Extended hours: keep the lifts running to 5:00 pm with the crew on overtime. Late arrivals
   * (after-work locals, half-day skiers) are extra demand, as a share of the day's arrivals
   * profile; they pay a twilight ticket. The crew is paid time-and-a-half for the extra hour.
   */
  lateTicks: 2,
  lateWeights: [6, 5],
  lateTicketMult: 0.6,
  latePayrollMult: 1.5,
  lateOverheadMult: 0.5,
  /**
   * Half-day ticket, sold from noon. Afternoon arrivals buy it instead of a full-day ticket, so
   * they pay less (and react to its price against a lower reference), and it brings out extra
   * people who would not pay for a full day. They spend a little less on food and rentals.
   */
  halfDayFromTick: 6,
  halfDayRefShare: 0.75,
  halfDayNewShare: 0.5,
  halfDayFoodMult: 0.8,
  halfDayExtrasMult: 0.6,
  /**
   * Après special at the lodge from 3:00 pm: a share of the guests on the hill stop for a drink
   * and food, up to the lodge's seats. Setup (staff, music) plus supplies; an overflowing lodge
   * costs a little reputation, a comfortable one earns a little.
   */
  apresFromTick: 12,
  apresTakeRate: 0.15,
  apresSpendUsd: 14,
  apresSupplyShare: 0.45,
  apresSetupUsd: 150,
  apresSetupPerSeatUsd: 2.5,
  apresRepGood: 0.001,
  apresRepCrowded: -0.002,
  /** Crowded when this many times the seats want in. */
  apresCrowdedAt: 1.5,
  /**
   * Overflow parking shuttle: buses from an overflow lot add parking for the rest of the day.
   * A day's hire is charged when it is called, plus a cost per extra guest carried.
   */
  shuttleMinGuests: 250,
  shuttleShareOfLot: 0.35,
  shuttleDayUsd: 1_200,
  shuttlePerGuestUsd: 3,
  /** Advice pop-ups suggest an option only if it should add at least this much to today's net. */
  /** The afternoon check (overtime / extended hours / night session advice) comes up at this tick: 2:00 pm. */
  afternoonTick: 10,
  /** Suggest an option only if it should add at least this much to today's net. */
  afternoonMinGainUsd: 200,
  /** Event cards fire in this tick range (group offers earlier). */
  cardTicks: [2, 11] as const,
  offerTicks: [1, 4] as const,
} as const

const sum = (a: readonly number[]) => a.reduce((s, v) => s + v, 0)
const norm = (w: readonly number[]) => { const t = sum(w); return w.map((v) => v / t) }
export const DAY_W = norm(LIVE.dayWeights)
export const NIGHT_W = norm(LIVE.nightWeights)
/** Late (extended-hours) arrivals, on the same scale as the day's arrival shares. */
export const LATE_W = LIVE.lateWeights.map((v) => v / sum(LIVE.dayWeights))

/** Peak share of a session's guests on the hill at once, given how long they stay. */
function peakShare(w: number[], stay: number): number {
  let best = 0
  for (let t = 0; t < w.length; t++) best = Math.max(best, sum(w.slice(Math.max(0, t - stay + 1), t + 1)))
  return best
}
const DAY_PEAK = peakShare(DAY_W, LIVE.dayStayTicks)
const NIGHT_PEAK = peakShare(NIGHT_W, LIVE.nightStayTicks)

export type LiftMode = 'open' | 'slow' | 'closed'

/** Clock time of a tick, e.g. "9:30" or "17:00". */
export function tickTime(tick: number, late = false): string {
  const end = LIVE.dayTicks + (late ? LIVE.lateTicks : 0)
  const min = tick < end ? LIVE.dayStartMin + tick * LIVE.tickMin : LIVE.nightStartMin + (tick - end) * LIVE.tickMin
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
}

/** Everything fixed when the day starts (weather, events rolled, demand before price). */
export interface DayPrep {
  day: number
  date: string
  weekday: number
  holiday: boolean
  newSnowIn: number
  warm: boolean
  baseIn: number
  open: boolean
  stormClosed: boolean
  /** Conditions at opening, including any groomer breakdown carried over. */
  conditions: number
  snowmaking: boolean
  /** Full-day demand before price: locals and visitors (conditions, appeal, reputation, noise). */
  locals: number
  visitors: number
  passAdoption: number
  /** Main RNG state after today's draws. */
  rngStateAfter: number
  /** Lifts closed all day by breakdowns carried over from earlier days. */
  carryDown: boolean[]
  /** Cost of a closed day. */
  closedCostUsd: number
  /** Snowmaking push cost added today (0 if none). */
  pushCostUsd: number
}

export interface LiveTick {
  tick: number
  /** Guests arriving this tick (including a booked group). */
  arrived: number
  onHill: number
  queueMin: number
  turnedAway: number
  revenueUsd: number
  /** Lifts running. */
  lifts: number
  priceUsd: number
}

interface Acc {
  guests: number
  dayGuests: number
  wanted: number
  parkingAway: number
  ticketRev: number
  food: number
  extras: number
  cost: number
  eventCost: number
  eventIncome: number
  peakWait: number
  nightGuests: number
  nightRev: number
  /** Where the day's running costs went (absent on a day saved before this was tracked). */
  parts?: CostParts
  /** The shuttle's day hire has been charged. */
  shuttleStarted?: boolean
}

export interface CostParts {
  /** Après supplies and setup, shuttle hire (absent on days played before these existed). */
  services?: number
  payroll: number
  lifts: number
  /** Admin, utilities, grooming and base-area running costs. */
  overhead: number
  snowmaking: number
  /** Food supplies, card fees and wear per guest. */
  guests: number
  lights: number
}
const NO_PARTS: CostParts = { payroll: 0, lifts: 0, overhead: 0, snowmaking: 0, guests: 0, lights: 0, services: 0 }

export interface LiveFx {
  /** Lift i is closed while tick < liftUntil[i] (a breakdown). */
  liftUntil: number[]
  outageMult: number
  outageUntil: number
  groomerPenalty: number
  dayDemandMult: number
  groupPerTick: number
  groupUntil: number
  groupPriceUsd: number
}

export interface LiveDay {
  prep: DayPrep
  tick: number
  priceUsd: number
  night: boolean
  /** Extended hours: lifts run to 5:00 pm today (absent on older saved days = no). */
  late?: boolean
  /** Half-day ticket price from noon (null/absent = not sold). */
  halfDayUsd?: number | null
  /** Après special at the lodge from 3 pm, and what it did once it ran. */
  apres?: boolean
  apresResult?: ApresResult
  /** Overflow parking shuttle running (from the tick it was called). */
  shuttle?: boolean
  /** The lot-full check (shuttle advice) has been done today. */
  parkingCheckDone?: boolean
  nightPriceUsd: number
  /** The player's lift settings. */
  lifts: LiftMode[]
  promo: PromoEffects
  ops: DayOps
  fx: LiveFx
  cards: EventCard[]
  /** Id of a card waiting for an answer. */
  pending: string | null
  rows: LiveTick[]
  acc: Acc
  repDelta: number
  /** Event state to carry to tomorrow (edited by card choices). */
  nextEvents: EventState | null
  seed: number
  /** The context the day started with (price, plans, campaigns), for replays. */
  base?: LiveContext
  /** Everything the player decided, in order. Absent on a day saved before this was recorded. */
  log?: LiveAction[]
  /** The 2 pm overtime / night check has been done today. */
  afternoonDone?: boolean
  /** Options from the 2 pm check waiting for an answer (the live screen pauses on it). */
  afternoonOffer?: AfternoonCheck | null
}

export interface ApresResult {
  /** Guests who wanted in, and how many the lodge seated. */
  wanted: number
  served: number
  revenueUsd: number
  costUsd: number
  reputationDelta: number
}

export interface LiveContext {
  ops: DayOps
  promo: PromoEffects
  priceUsd: number
  nightPriceUsd: number
  /** Half-day ticket price from the calendar (null/absent = not sold). */
  halfDayUsd?: number | null
  /** All booked campaigns (so a report can ask what one of them did). */
  promos?: Promo[]
  /** Skip rolling events (focused tests). */
  noCards?: boolean
}

/** One decision the player made during the day, so the day can be replayed with changes. */
export type LiveAction =
  | { tick: number; kind: 'price'; value: number }
  | { tick: number; kind: 'nightPrice'; value: number }
  | { tick: number; kind: 'lift'; lift: number; mode: LiftMode }
  | { tick: number; kind: 'night'; on: boolean }
  | { tick: number; kind: 'overtime'; on: boolean }
  | { tick: number; kind: 'late'; on: boolean }
  | { tick: number; kind: 'halfDay'; value: number | null }
  | { tick: number; kind: 'apres'; on: boolean }
  | { tick: number; kind: 'shuttle'; on: boolean }
  | { tick: number; kind: 'card'; cardId: string; option: string }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const END = 99

/** First tick after the day session: 16:00, or 17:00 with extended hours. */
export const dayEnd = (live: LiveDay) => LIVE.dayTicks + (live.late ? LIVE.lateTicks : 0)

export function totalTicks(live: LiveDay, inp: SeasonInputs): number {
  if (!live.prep.open) return 0
  return dayEnd(live) + (live.night && (inp.amenity ?? NEUTRAL_EFFECTS).nightShare > 0 ? LIVE.nightTicks : 0)
}
export const isDayDone = (live: LiveDay, inp: SeasonInputs) => live.tick >= totalTicks(live, inp)

/** Weather, events and demand for the day; consumes the season RNG in the same order as before. */
export function startLiveDay(s: SeasonState, inp: SeasonInputs, ctx: LiveContext): LiveDay {
  const rng = createRng(s.rngState)
  const W = SEASON.weather, D = SEASON.demand, M = SEASON.money
  const date = seasonDate(s.year, s.day)
  const progress = s.day / SEASON.lengthDays
  const snowMod = snowModifiers(inp.snowDifficulty ?? 0.5)
  const finMod = financeModifiers(inp.financeDifficulty ?? 0.5)
  const snowSys = inp.snowmaking ?? NO_SNOWMAKING
  const staff = inp.staff ?? FULL_STAFF

  let newSnowIn = 0
  if (rng.next() < W.stormChance) {
    const mean = s.expectedSnowIn / (SEASON.lengthDays * W.stormChance)
    newSnowIn = Math.round(-Math.log(1 - rng.next()) * mean)
  }
  const warm = rng.next() < lerp(W.warmChance[0], W.warmChance[1], progress) * snowMod.warmChance
  let baseIn = s.baseIn + newSnowIn * W.settleRatio
  if (warm) baseIn -= lerp(W.warmMeltIn[0], W.warmMeltIn[1], rng.next())
  const reachedOpening = s.day >= s.openingDay
  // An overnight snowmaking push adds made snow on days the resort is running.
  const canPush = !!ctx.ops.snowPush && snowSys.coverage > 0 && !warm && reachedOpening
  if (canPush) baseIn += LIVE.snowPushIn * snowSys.coverage
  if (reachedOpening) baseIn = Math.max(baseIn, W.baseFloorIn)
  baseIn = Math.max(0, Math.round(baseIn * 10) / 10)
  const stormClosed = reachedOpening && rng.next() < W.stormClosureChance
  const open = reachedOpening && !stormClosed && inp.lifts.length > 0 && inp.trailCount > 0
  const recentSnow = newSnowIn + (s.days.at(-1)?.newSnowIn ?? 0)

  // Breakdowns and events roll on a separate RNG stream and only on open days.
  const carryDown = inp.lifts.map((_, i) => Math.max(0, (s.events?.liftDownDays[i] ?? 0) - 1) > 0)
  const carryGroomer = Math.max(0, (s.events?.groomerDownDays ?? 0) - 1) > 0
  const ev = open && !ctx.noCards && s.events
    ? rollDay(
        s.events.liftDownDays.length === inp.lifts.length ? s.events : { ...s.events, liftDownDays: inp.lifts.map((_, i) => s.events!.liftDownDays[i] ?? 0) },
        {
          liftNames: inp.liftNames ?? inp.lifts.map((_, i) => `Lift ${i + 1}`),
          mechanicsRatio: staff.ratios.mechanics, patrolRatio: staff.ratios.patrol,
          expectedGuests: s.days.at(-1)?.guests ?? 0, conditions: conditionsScore(baseIn, recentSnow, warm),
          lastWaitMin: s.days.at(-1)?.waitMin ?? 0,
          weekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
          hasBlack: inp.hasBlack ?? inp.difficultyKinds >= 3, trailCount: inp.trailCount,
        },
        createRng(s.events.rngState),
      )
    : null

  const conditions = Math.max(SEASON.conditions.min,
    Math.round((conditionsScore(effectiveBase(baseIn, snowSys.coverage), recentSnow, warm) - STAFF_TUNING.groomPenalty * (1 - staff.ratios.groomers)
      - (carryGroomer ? 0.1 : 0)) * 100) / 100)

  const noise = lerp(D.noise[0], D.noise[1], rng.next())
  const market = open ? D.marketBase * dayFactorOf(date) * conditions * appealOf(inp) * s.reputation * noise : 0
  const locals = market * D.localShare
  const snowmakingRuns = snowSys.coverage > 0 && !warm
    && (s.day < s.openingDay + SNOWMAKING.runDaysAfterOpening || baseIn < SNOWMAKING.madeBaseIn)
  const pushCostUsd = canPush ? Math.round(snowSys.runCostUsd * LIVE.snowPushCostMult) : 0
  const closedCostUsd = Math.round(finMod.costs * M.overheadClosedUsd + staff.payrollUsd + (snowmakingRuns ? snowSys.runCostUsd : 0))

  // Schedule the day's events as cards at random times.
  const cards: EventCard[] = []
  if (ev) {
    const trng = createRng((ev.state.rngState ^ 0x5bd1e995) >>> 0)
    const names = inp.liftNames ?? inp.lifts.map((_, i) => `Lift ${i + 1}`)
    ev.fx.events.forEach((e: SeasonEvent, i) => {
      const [lo, hi] = e.kind === 'groupBooking' ? LIVE.offerTicks : LIVE.cardTicks
      const tick = lo + Math.floor(trng.next() * (hi - lo + 1))
      cards.push(buildCard(e, `c${s.day}-${i}`, tick, names[e.lift ?? 0] ?? 'A lift'))
    })
    cards.sort((a, b) => a.tick - b.tick)
  }

  const prep: DayPrep = {
    day: s.day, date: date.toISOString().slice(0, 10), weekday: date.getUTCDay(), holiday: isHoliday(date),
    newSnowIn, warm, baseIn, open, stormClosed, conditions, snowmaking: snowmakingRuns,
    locals, visitors: market - locals, passAdoption: s.passAdoption, rngStateAfter: rng.state(), carryDown, closedCostUsd, pushCostUsd,
  }
  return {
    prep, tick: 0, priceUsd: ctx.priceUsd, night: !!ctx.ops.night, nightPriceUsd: ctx.nightPriceUsd,
    ...(ctx.halfDayUsd ? { halfDayUsd: ctx.halfDayUsd } : {}),
    lifts: inp.lifts.map(() => 'open' as LiftMode), promo: ctx.promo, ops: ctx.ops,
    fx: { liftUntil: inp.lifts.map(() => 0), outageMult: 1, outageUntil: 0, groomerPenalty: 0, dayDemandMult: 1, groupPerTick: 0, groupUntil: 0, groupPriceUsd: 0 },
    cards, pending: null, rows: [],
    acc: { guests: 0, dayGuests: 0, wanted: 0, parkingAway: 0, ticketRev: 0, food: 0, extras: 0, cost: 0, eventCost: 0, eventIncome: 0, peakWait: 0, nightGuests: 0, nightRev: 0 },
    repDelta: 0, nextEvents: ev ? ev.state : (s.events ?? null), seed: (s.rngState ^ Math.imul(s.day + 1, 0x9e3779b1)) >>> 0,
    base: ctx, log: [],
  }
}

/** Is lift i running at this tick, and at what share of its capacity? */
function liftFactor(live: LiveDay, i: number, tick: number): number {
  if (live.prep.carryDown[i] || tick < live.fx.liftUntil[i]) return 0
  const m = live.lifts[i]
  return m === 'closed' ? 0 : m === 'slow' ? LIVE.slowCapacity : 1
}

/** The next unanswered card due by this tick, if any. */
const dueCard = (live: LiveDay) => live.cards.find((c) => !c.answered && c.tick <= live.tick) ?? null

/** Apply a card's chosen option to the rest of the day and tomorrow. */
function applyOutcome(live: LiveDay, card: EventCard, o: CardOutcome): LiveDay {
  const fx = { ...live.fx, liftUntil: [...live.fx.liftUntil] }
  let nextEvents = live.nextEvents ? { ...live.nextEvents, liftDownDays: [...live.nextEvents.liftDownDays] } : null
  const here = live.tick
  if (o.liftDown) {
    fx.liftUntil[o.liftDown.lift] = o.liftDown.reopenTick ?? END
    if (nextEvents) nextEvents.liftDownDays[o.liftDown.lift] = o.liftDown.carryDays > 0 ? o.liftDown.carryDays + 1 : 0
  }
  if (o.groomerDown) {
    fx.groomerPenalty = Math.max(fx.groomerPenalty, o.groomerDown.penalty)
    if (nextEvents) nextEvents.groomerDownDays = o.groomerDown.carryDays + 1
  } else if (card.event.kind === 'groomerBreakdown' && nextEvents) {
    nextEvents.groomerDownDays = 0
  }
  if (o.outage) { fx.outageMult = o.outage.mult; fx.outageUntil = o.outage.untilTick ?? END }
  if (o.dayDemandMult) fx.dayDemandMult *= o.dayDemandMult
  if (o.group) {
    fx.groupPerTick = o.group.guests / o.group.ticks
    fx.groupUntil = here + o.group.ticks
    fx.groupPriceUsd = o.group.perGuestUsd
  }
  if (o.releaseRace && nextEvents) nextEvents.raceHeld = false
  return {
    ...live, fx, nextEvents, pending: null,
    repDelta: live.repDelta + o.reputationDelta,
    acc: { ...live.acc, eventCost: live.acc.eventCost + o.costUsd, eventIncome: live.acc.eventIncome + o.incomeUsd },
    cards: live.cards.map((c) => (c.id === card.id
      ? { ...c, answered: '', outcomeText: o.text, outcome: { costUsd: o.costUsd, incomeUsd: o.incomeUsd, reputationDelta: o.reputationDelta } }
      : c)),
  }
}

/** Answer the pending card with one of its options. */
export function answerCard(live: LiveDay, inp: SeasonInputs, optionId: string): LiveDay {
  const card = live.cards.find((c) => c.id === live.pending)
  if (!card) return live
  const choice = card.options.some((o) => o.id === optionId) ? optionId : card.defaultOption
  const o = resolveCard(card, choice, live.tick, totalTicks(live, inp), (live.seed ^ Math.imul(card.tick + 1, 0x85ebca6b)) >>> 0)
  const next = applyOutcome(live, card, o)
  return {
    ...next, cards: next.cards.map((c) => (c.id === card.id ? { ...c, answered: choice } : c)),
    ...(live.log ? { log: [...live.log, { tick: live.tick, kind: 'card' as const, cardId: card.id, option: choice }] } : {}),
  }
}

/**
 * Run the next tick. If an event card is due, the day pauses on it instead (live.pending
 * is set) until it is answered.
 */
export function tickLiveDay(live: LiveDay, inp: SeasonInputs): LiveDay {
  if (isDayDone(live, inp) || live.pending) return live
  const due = dueCard(live)
  if (due) return { ...live, pending: due.id }

  const D = SEASON.demand, P = SEASON.passes, M = SEASON.money
  const t = live.tick
  const end = dayEnd(live)
  const night = t >= end
  const late = !night && t >= LIVE.dayTicks
  const w = night ? NIGHT_W[t - end] : late ? LATE_W[t - LIVE.dayTicks] : DAY_W[t]
  const prep = live.prep
  const amen = inp.amenity ?? NEUTRAL_EFFECTS
  const staff = inp.staff ?? FULL_STAFF
  const finMod = financeModifiers(inp.financeDifficulty ?? 0.5)
  const snowSys = inp.snowmaking ?? NO_SNOWMAKING
  const fx = live.fx
  const outage = t < fx.outageUntil ? fx.outageMult : 1
  const condNow = Math.max(SEASON.conditions.min, prep.conditions - fx.groomerPenalty)
  const condScale = prep.conditions > 0 ? condNow / prep.conditions : 1

  // Capacity from the lifts running right now.
  const factors = inp.lifts.map((_, i) => liftFactor(live, i, t))
  const liftStaffing = staff.ratios.liftOps * (1 - STAFF_TUNING.mechanicsSpeedShare * (1 - staff.ratios.mechanics))
  const running = inp.lifts.map((l, i) => ({ type: l.type, capacityPph: l.capacityPph * factors[i] }))
  const overtime = live.ops.overtime ? LIVE.overtimeCapacity : 1
  const lit = night ? amen.nightShare * (LIVE.nightTicks * LIVE.tickMin / 60 / SEASON.lifts.hoursPerDay) : 1
  const comfort = Math.floor(liftComfortGuests(running) * liftStaffing * overtime * lit)
  const liftCap = Math.floor(comfort * SEASON.lifts.hardCapMultiple)
  const lotCap = amen.parkingCapGuests
  const shuttleGuests = live.shuttle && Number.isFinite(lotCap) ? Math.max(LIVE.shuttleMinGuests, lotCap * LIVE.shuttleShareOfLot) : 0
  const parkingCap = lotCap + shuttleGuests

  // Demand this tick. Pass holders ignore the day price; promos and the price touch day tickets only.
  let wantDay: number, wantPass: number
  // Half-day ticket: from noon, afternoon arrivals buy it (late extended-hours arrivals keep the twilight ticket).
  const halfDay = !night && !late && live.halfDayUsd && t >= LIVE.halfDayFromTick ? live.halfDayUsd : null
  if (!night) {
    const priceFactor = halfDay
      ? Math.pow((D.referencePriceUsd * LIVE.halfDayRefShare) / halfDay, D.priceElasticity) * (1 + LIVE.halfDayNewShare)
      : Math.pow(D.referencePriceUsd / live.priceUsd, D.priceElasticity)
    const powder = prep.newSnowIn >= POWDER_DAY_IN ? live.promo.powderMult ?? 1 : 1
    wantDay = w * (prep.locals * (1 - prep.passAdoption) * (live.promo.localMult ?? 1) + prep.visitors * live.promo.visitorMult)
      * Math.min(MAX_DEMAND_MULT, live.promo.dayDemandMult * powder) * priceFactor * fx.dayDemandMult * condScale * outage
    wantPass = w * prep.locals * prep.passAdoption * P.frequencyBoost * condScale * outage
  } else {
    const market = prep.locals + prep.visitors
    const priceFactor = Math.pow(LIVE.nightRefPriceUsd / live.nightPriceUsd, D.priceElasticity)
    wantDay = w * market * LIVE.nightMarketShare * (1 - D.localShare * prep.passAdoption) * priceFactor * condScale * outage
    wantPass = w * prep.locals * prep.passAdoption * P.frequencyBoost * LIVE.nightPassShare * condScale * outage
  }
  const wanted = wantDay + wantPass
  const cap = Math.min(liftCap, parkingCap) * w
  const guests = Math.min(wanted, cap)
  const scale = wanted > 0 ? guests / wanted : 0
  const dayG = wantDay * scale
  const away = Math.max(0, wanted - guests)
  const parkingAway = parkingCap < liftCap ? Math.max(0, Math.min(wanted, liftCap * w) - guests) : 0
  // A booked group arrives over a few ticks at a flat price.
  const group = !night && t < fx.groupUntil ? fx.groupPerTick : 0

  const price = night ? live.nightPriceUsd : late ? Math.round(live.priceUsd * LIVE.lateTicketMult) : halfDay ?? live.priceUsd
  const ticketRev = dayG * price * (night ? 1 : live.promo.priceMult) + group * fx.groupPriceUsd
  const allGuests = guests + group
  // Half-day skiers are on the hill for less time: a bit less food, fewer rentals and lessons.
  const halfFood = halfDay ? LIVE.halfDayFoodMult : 1
  const halfExtras = halfDay ? LIVE.halfDayExtrasMult : 1
  const food = (allGuests - dayG + dayG * halfFood) * M.foodPerGuestUsd * amen.foodMult
  const extras = (dayG * halfExtras + group) * (amen.extrasPerDayGuestUsd - amen.lessonsPerDayGuestUsd * (1 - staff.ratios.instructors))
  // Shuttle: a day's hire when it starts (the first tick it runs), plus each guest it carries.
  const shuttleFirst = live.shuttle && !live.acc.shuttleStarted
  const carried = live.shuttle ? Math.max(0, guests - lotCap * w) : 0
  const shuttleCost = shuttleGuests > 0 ? (shuttleFirst ? LIVE.shuttleDayUsd : 0) + carried * LIVE.shuttlePerGuestUsd : 0

  // Costs accrue every tick: fixed running costs by the hour, lifts only while running.
  const ticks = night ? LIVE.nightTicks : LIVE.dayTicks
  const liftDaily = inp.lifts.reduce((s, l, i) => s + M.liftDailyCostUsd[l.type] * (live.lifts[i] === 'slow' ? LIVE.slowCost : factors[i] > 0 ? 1 : 0), 0)
  const guestCost = finMod.costs * allGuests * M.variableCostPerGuestUsd
  const tickParts: CostParts = late
    ? {
        // The extra hour: the crew on time-and-a-half, lifts running, part of the base overhead.
        payroll: (staff.payrollUsd * LIVE.latePayrollMult * (1 + (live.ops.overtime ? LIVE.overtimePayrollPremium : 0))) / ticks,
        lifts: (finMod.costs * liftDaily) / ticks,
        overhead: (finMod.costs * LIVE.lateOverheadMult * (M.overheadOpenUsd + amen.dailyCostUsd)) / ticks,
        snowmaking: 0, guests: guestCost, lights: 0,
      }
    : !night
    ? {
        payroll: (staff.payrollUsd * (1 + (live.ops.overtime ? LIVE.overtimePayrollPremium : 0))) / ticks,
        lifts: (finMod.costs * liftDaily) / ticks,
        overhead: (finMod.costs * (M.overheadOpenUsd + inp.trailCount * M.groomPerTrailUsd + amen.dailyCostUsd)) / ticks,
        snowmaking: ((prep.snowmaking ? snowSys.runCostUsd : 0) + prep.pushCostUsd) / ticks,
        guests: guestCost, lights: 0,
      }
    : {
        payroll: (staff.payrollUsd * 0.1) / ticks,
        lifts: (finMod.costs * liftDaily * amen.nightShare * 0.5) / ticks,
        overhead: 0, snowmaking: 0, guests: guestCost, lights: amen.nightCostUsd / ticks,
      }
  tickParts.services = shuttleCost
  const cost = tickParts.payroll + tickParts.lifts + tickParts.overhead + tickParts.snowmaking + tickParts.guests + tickParts.lights + shuttleCost
  const prevParts = live.acc.parts ?? NO_PARTS
  const parts: CostParts = {
    payroll: prevParts.payroll + tickParts.payroll, lifts: prevParts.lifts + tickParts.lifts, overhead: prevParts.overhead + tickParts.overhead,
    snowmaking: prevParts.snowmaking + tickParts.snowmaking, guests: prevParts.guests + tickParts.guests, lights: prevParts.lights + tickParts.lights,
    services: (prevParts.services ?? 0) + shuttleCost,
  }

  // Lift line: guests on the hill against the lift capacity right now.
  const stay = night ? LIVE.nightStayTicks : LIVE.dayStayTicks
  const session = live.rows.filter((r) => (night ? r.tick >= end : r.tick < end))
  const onHill = sum(session.slice(-(stay - 1)).map((r) => r.arrived)) + allGuests
  // Late guests arrive while the day crowd thins out; the day's peak share still sizes the line.
  const peak = night ? NIGHT_PEAK : DAY_PEAK
  const load = comfort > 0 ? onHill / (comfort * peak) : 4
  const queueMin = Math.round(Math.max(0, load - 0.7) * 25)

  // Après: once, as it opens at 3 pm, from the guests on the hill then.
  let apresResult = live.apresResult
  let apresRev = 0, apresCost = 0
  if (live.apres && !apresResult && !night && t === LIVE.apresFromTick) {
    const seats = amen.lodgeSeats ?? Infinity
    const wantIn = onHill * LIVE.apresTakeRate
    const served = Math.min(wantIn, seats)
    apresRev = served * LIVE.apresSpendUsd * amen.foodMult
    apresCost = LIVE.apresSetupUsd + (Number.isFinite(seats) ? seats : 0) * LIVE.apresSetupPerSeatUsd + apresRev * LIVE.apresSupplyShare
    const reputationDelta = wantIn > seats * LIVE.apresCrowdedAt ? LIVE.apresRepCrowded : wantIn > 0 ? LIVE.apresRepGood : 0
    apresResult = { wanted: Math.round(wantIn), served: Math.round(served), revenueUsd: Math.round(apresRev), costUsd: Math.round(apresCost), reputationDelta }
    parts.services = (parts.services ?? 0) + apresCost
  }

  const revenue = ticketRev + food + extras + apresRev
  const row: LiveTick = {
    tick: t, arrived: allGuests, onHill: Math.round(onHill), queueMin, turnedAway: away, revenueUsd: Math.round(revenue),
    lifts: factors.filter((f) => f > 0).length, priceUsd: price,
  }
  const a = live.acc
  const acc: Acc = {
    ...a,
    guests: a.guests + allGuests, dayGuests: a.dayGuests + dayG + group, wanted: a.wanted + wanted + group,
    parkingAway: a.parkingAway + parkingAway, ticketRev: a.ticketRev + ticketRev, food: a.food + food + apresRev, extras: a.extras + extras,
    cost: a.cost + cost + apresCost, ...(live.shuttle ? { shuttleStarted: true } : {}), peakWait: night ? a.peakWait : Math.max(a.peakWait, queueMin),
    nightGuests: a.nightGuests + (night ? allGuests : 0), nightRev: a.nightRev + (night ? revenue : 0), parts,
  }
  return {
    ...live, tick: t + 1, rows: [...live.rows, row], acc,
    ...(apresResult !== live.apresResult ? { apresResult, repDelta: live.repDelta + (apresResult?.reputationDelta ?? 0) } : {}),
  }
}

/** Auto-answer every card with its default option and play the rest of the day. */
export function runToEnd(live: LiveDay, inp: SeasonInputs): LiveDay {
  let l = live
  for (let guard = 0; guard < 200 && !isDayDone(l, inp); guard++) {
    l = tickLiveDay(l, inp)
    if (l.pending) l = answerCard(l, inp, '')
  }
  return l
}

/** Compile the finished day into the season state and the day's result. */
export function finishLiveDay(live: LiveDay, s: SeasonState, inp: SeasonInputs, impact?: DayImpact | null): { season: SeasonState; result: DayResult } {
  const prep = live.prep
  const R = SEASON.reputation
  const a = live.acc
  const open = prep.open
  const guests = Math.round(a.guests)
  const dayTicketGuests = Math.round(a.dayGuests)
  const passVisits = guests - dayTicketGuests
  const waitMin = open ? a.peakWait : 0
  const conditions = Math.max(SEASON.conditions.min, prep.conditions - live.fx.groomerPenalty)

  const ticketRevenueUsd = Math.round(a.ticketRev)
  const foodRevenueUsd = Math.round(a.food)
  const extrasRevenueUsd = Math.round(a.extras)
  const eventCostUsd = Math.round(a.eventCost)
  const eventIncomeUsd = Math.round(a.eventIncome)
  // A campaign's cost comes out on its first day, even if the resort is closed that day.
  const marketingUsd = live.promo.marketingUsd
  const costUsd = (open ? Math.round(a.cost) : prep.closedCostUsd) + eventCostUsd + marketingUsd

  let reputation = s.reputation
  if (open && guests > 0) {
    const experience = clamp(
      1 + R.conditionsWeight * (conditions - 1) - (waitMin / 10) * R.waitPenaltyPer10Min + (inp.difficultyKinds - 2) * R.varietyBonus,
      R.min, R.max,
    )
    reputation = clamp(reputation + (experience - reputation) * R.dailyWeight, R.min, R.max)
  }
  reputation = clamp(reputation + live.repDelta, R.min, R.max)

  const events: SeasonEvent[] = live.cards
    .filter((c) => c.answered && !(c.event.kind === 'groupBooking' && c.answered === 'decline'))
    .map((c) => ({ ...c.event, ...(c.outcome ?? {}), text: `${c.title}: ${c.outcomeText ?? ''}`.trim() }))

  const result: DayResult = {
    day: prep.day, date: prep.date, weekday: prep.weekday, holiday: prep.holiday,
    newSnowIn: prep.newSnowIn, warm: prep.warm, baseIn: prep.baseIn, open, stormClosed: prep.stormClosed, conditions: Math.round(conditions * 100) / 100,
    guests, dayTicketGuests, passVisits, turnedAway: Math.max(0, Math.round(a.wanted) - guests), parkingTurnedAway: Math.round(a.parkingAway), waitMin,
    ticketPriceUsd: live.priceUsd,
    ticketRevenueUsd, foodRevenueUsd, extrasRevenueUsd, costUsd,
    netUsd: ticketRevenueUsd + foodRevenueUsd + extrasRevenueUsd + eventIncomeUsd - costUsd,
    reputation: Math.round(reputation * 1000) / 1000,
    snowmaking: prep.snowmaking,
    events, eventCostUsd, eventIncomeUsd,
    nightGuests: Math.round(a.nightGuests), nightRevenueUsd: Math.round(a.nightRev), marketingUsd,
    ...(open && a.parts ? {
      costParts: {
        payroll: Math.round(a.parts.payroll), lifts: Math.round(a.parts.lifts), overhead: Math.round(a.parts.overhead),
        snowmaking: Math.round(a.parts.snowmaking), guests: Math.round(a.parts.guests), lights: Math.round(a.parts.lights),
        services: Math.round(a.parts.services ?? 0),
      },
    } : {}),
    ...(open && live.late ? { late: true } : {}),
    ...(open && live.apresResult ? { apres: live.apresResult } : {}),
    ...(open && live.shuttle ? { shuttle: true } : {}),
    ...(open && live.halfDayUsd ? { halfDayUsd: live.halfDayUsd } : {}),
    ...(open ? { peakOnHill: Math.max(0, ...live.rows.map((r) => r.onHill)), hourly: live.rows.map((r) => Math.round(r.arrived)) } : {}),
    ...(impact ? { impact } : {}),
  }
  return {
    season: {
      ...s, day: s.day + 1, baseIn: prep.baseIn, reputation, rngState: prep.rngStateAfter,
      events: live.nextEvents ?? s.events, days: [...s.days, result],
    },
    result,
  }
}

/** Default context for a plain day: the season's current price, no plans, no campaigns. */
export const plainContext = (s: SeasonState): LiveContext => ({ ops: {}, promo: NO_PROMO, priceUsd: s.ticketPriceUsd, nightPriceUsd: LIVE.nightRefPriceUsd })

// ---- player controls (each returns a new LiveDay) ----

/** Add a decision to the log (only when the day has one: older saved days are left alone). */
const logged = (live: LiveDay, next: LiveDay, a: LiveAction): LiveDay => (live.log ? { ...next, log: [...live.log, a] } : next)

export function setLivePrice(live: LiveDay, priceUsd: number): LiveDay {
  const v = clamp(Math.round(priceUsd), 10, 250)
  return logged(live, { ...live, priceUsd: v }, { tick: live.tick, kind: 'price', value: v })
}
export function setLiveNightPrice(live: LiveDay, priceUsd: number): LiveDay {
  const v = clamp(Math.round(priceUsd), 10, 250)
  return logged(live, { ...live, nightPriceUsd: v }, { tick: live.tick, kind: 'nightPrice', value: v })
}
export function setLiftMode(live: LiveDay, lift: number, mode: LiftMode): LiveDay {
  return logged(live, { ...live, lifts: live.lifts.map((m, i) => (i === lift ? mode : m)) }, { tick: live.tick, kind: 'lift', lift, mode })
}
/** The night session can be switched until it starts. */
export function setLiveNight(live: LiveDay, on: boolean): LiveDay {
  return live.tick <= dayEnd(live) ? logged(live, { ...live, night: on }, { tick: live.tick, kind: 'night', on }) : live
}


/** Overtime crew from now on: more lift capacity, payroll premium on the remaining day hours. */
export function setLiveOvertime(live: LiveDay, on: boolean): LiveDay {
  if (live.tick >= dayEnd(live) || !!live.ops.overtime === on) return live
  return logged(live, { ...live, ops: { ...live.ops, overtime: on } }, { tick: live.tick, kind: 'overtime', on })
}

/** Half-day ticket price from noon (null stops selling it). Applies to arrivals from now. */
export function setLiveHalfDay(live: LiveDay, priceUsd: number | null): LiveDay {
  const v = priceUsd === null ? null : clamp(Math.round(priceUsd), 10, 250)
  if ((live.halfDayUsd ?? null) === v) return live
  return logged(live, { ...live, halfDayUsd: v }, { tick: live.tick, kind: 'halfDay', value: v })
}

/** Après special: can be booked or called off until it opens at 3 pm. */
export function setLiveApres(live: LiveDay, on: boolean): LiveDay {
  if (live.tick > LIVE.apresFromTick || live.apresResult || !!live.apres === on) return live
  return logged(live, { ...live, apres: on }, { tick: live.tick, kind: 'apres', on })
}

/** Overflow shuttle: once called, it runs for the rest of the day (the day's hire is paid). */
export function setLiveShuttle(live: LiveDay, on: boolean): LiveDay {
  if (!on || live.shuttle || live.tick >= dayEnd(live)) return live
  return logged(live, { ...live, shuttle: true }, { tick: live.tick, kind: 'shuttle', on: true })
}

/** Default half-day price: 75% of the day price, to the nearest $5. */
export const defaultHalfDayUsd = (dayPriceUsd: number) => Math.max(10, Math.round((dayPriceUsd * 0.75) / 5) * 5)

/** Extended hours (lifts to 5:00 pm, crew on overtime): can be switched until 4:00 pm. */
export function setLiveLate(live: LiveDay, on: boolean): LiveDay {
  if (live.tick >= LIVE.dayTicks || !!live.late === on) return live
  return logged(live, { ...live, late: on }, { tick: live.tick, kind: 'late', on })
}

// ---- the 2 pm check ----

export interface AfternoonOption {
  /** 'combo' = every option that pays on its own, together. */
  id: Single | 'combo'
  /** For 'combo': what it switches on. */
  parts?: Single[]
  /** Estimated change to today's net from switching it on now. */
  gainUsd: number
  /** Extra guests in the estimate. */
  extraGuests: number
}

export interface AfternoonCheck {
  /** Which pop-up: the 2 pm check, or the lot filling up. Absent = afternoon. */
  kind?: 'afternoon' | 'parking'
  options: AfternoonOption[]
  /** Guests turned away so far today (why overtime might help). */
  turnedAwaySoFar: number
}

const netOf = (l: LiveDay) => l.acc.ticketRev + l.acc.food + l.acc.extras + l.acc.eventIncome - l.acc.cost - l.acc.eventCost

/** Is it time for the 2 pm check (and has it not been done yet)? */
export const afternoonDue = (live: LiveDay) =>
  live.prep.open && !live.afternoonDone && !live.pending && live.tick === LIVE.afternoonTick

/** Run the 2 pm check if it is due: marks it done and, if anything should pay off, leaves an offer. */
export function runAfternoonCheck(live: LiveDay, inp: SeasonInputs): LiveDay {
  if (!afternoonDue(live)) return live
  const check = afternoonCheck(live, inp)
  return { ...live, afternoonDone: true, afternoonOffer: check.options.length ? check : null }
}

/** Answer the 2 pm offer: switch on what was chosen ('none' declines). */
export function answerAfternoon(live: LiveDay, choice: AfternoonOption['id'] | 'none'): LiveDay {
  let l: LiveDay = { ...live, afternoonOffer: null }
  if (choice === 'none') return l
  const parts = choice === 'combo' ? live.afternoonOffer?.options.find((o) => o.id === 'combo')?.parts ?? [] : [choice]
  return applyParts(l, parts)
}

/**
 * Would calling in an overtime crew for the rest of the day, staying open to 5 pm (extended
 * hours, crew on overtime), or running the night session tonight, pay off? Plays the rest of the day out each way (later event cards on their default
 * option) and compares today's net. It is an estimate: the player may still change prices or
 * answer cards differently. Only options worth at least `afternoonMinGainUsd` are returned.
 */
export function afternoonCheck(live: LiveDay, inp: SeasonInputs): AfternoonCheck {
  const amen = inp.amenity ?? NEUTRAL_EFFECTS
  const singles: Single[] = []
  if (!live.ops.overtime) singles.push('overtime')
  if (!live.late) singles.push('late')
  if (amen.nightShare > 0 && !live.night) singles.push('night')
  if (!live.apres && !live.apresResult) singles.push('apres')
  if (!live.shuttle && live.acc.parkingAway > 0) singles.push('shuttle')
  return { kind: 'afternoon', options: bestOptions(live, inp, singles), turnedAwaySoFar: Math.round(live.rows.reduce((s, r) => s + r.turnedAway, 0)) }
}

/** Is it time for the lot-full check: the lot turned guests away in the last half hour, shuttle not running? */
export const parkingDue = (live: LiveDay) =>
  live.prep.open && !live.parkingCheckDone && !live.pending && !live.shuttle && live.tick < LIVE.dayTicks
  && (live.rows.at(-1)?.turnedAway ?? 0) > 0 && live.acc.parkingAway > 0

/** Lot full: would an overflow shuttle pay for the rest of the day? */
export function parkingCheck(live: LiveDay, inp: SeasonInputs): AfternoonCheck {
  return { kind: 'parking', options: bestOptions(live, inp, ['shuttle']), turnedAwaySoFar: Math.round(live.acc.parkingAway) }
}

/** Run the lot-full check if it is due: marks it done and, if the shuttle should pay, leaves an offer. */
export function runParkingCheck(live: LiveDay, inp: SeasonInputs): LiveDay {
  if (!parkingDue(live)) return live
  const check = parkingCheck(live, inp)
  return { ...live, parkingCheckDone: true, afternoonOffer: check.options.length ? check : null }
}

/** Each single option that pays, plus all of them together if that beats the best one. */
function bestOptions(live: LiveDay, inp: SeasonInputs, singles: Single[]): AfternoonOption[] {
  const base = runToEnd(live, inp)
  const tryIt = (id: AfternoonOption['id'], parts: Single[]): AfternoonOption => {
    const end = runToEnd(applyParts(live, parts), inp)
    const gainUsd = Math.round(netOf(end) - netOf(base))
    return { id, gainUsd, extraGuests: Math.round(end.acc.guests - base.acc.guests), ...(id === 'combo' ? { parts } : {}) }
  }
  const options: AfternoonOption[] = []
  for (const id of singles) {
    const o = tryIt(id, [id])
    if (o.gainUsd >= LIVE.afternoonMinGainUsd) options.push(o)
  }
  if (options.length >= 2) {
    const combo = tryIt('combo', options.map((o) => o.id as Single))
    if (combo.gainUsd > Math.max(...options.map((o) => o.gainUsd))) options.push(combo)
  }
  return options
}

export type Single = 'overtime' | 'late' | 'night' | 'apres' | 'shuttle'
function applyParts(live: LiveDay, parts: Single[]): LiveDay {
  let l = live
  for (const p of parts) {
    l = p === 'overtime' ? setLiveOvertime(l, true) : p === 'late' ? setLiveLate(l, true) : p === 'night' ? setLiveNight(l, true)
      : p === 'apres' ? setLiveApres(l, true) : setLiveShuttle(l, true)
  }
  return l
}
