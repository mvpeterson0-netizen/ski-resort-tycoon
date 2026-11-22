/**
 * Winter season: day-by-day weather, guests, revenue and costs.
 *
 * Design (owner direction): snow mostly changes *demand*, not whether the resort is
 * open. Each day has a snow-conditions score from 50% to 150% that multiplies demand.
 * A bad snow year only delays opening day (Normal: worst year ≈ 80% of days open);
 * once open, the resort closes only on rare storm days.
 *
 * Season passes: sold before the season (cash arrives on opening of the season), bought
 * by local skiers who then stop buying day tickets and ski more often.
 *
 * Deterministic: all randomness comes from the season's saved RNG state.
 * Every coefficient in SEASON is a PLACEHOLDER chosen for readable, playable
 * behaviour — none is sourced from real resort, climate or pass-sales data.
 */
import { NEUTRAL_EFFECTS, type AmenityEffects } from './amenities'
import type { LiftType } from './build'
import { NO_SNOWMAKING, SNOWMAKING, type SnowmakingEffects } from './snowmaking'
import { FULL_STAFF, type StaffEffects } from './staff'
import { financeModifiers, snowModifiers } from './difficultySettings'
import { newEventState, type EventState, type SeasonEvent } from './events'
import { createRng } from './rng'
import { finishLiveDay, plainContext, runToEnd, startLiveDay, type LiveContext } from './liveDay'

export const SEASON = {
  /** First possible day (month is 0-based) and season length. */
  startMonth: 11, startDay: 1, lengthDays: 126,
  weather: {
    // Season snowfall factor range, warm-day multiplier and worst opening delay come
    // from the snow difficulty slider (difficultySettings.ts).
    stormChance: 0.22,
    /** Fraction of new snow that ends up as packed base (shown as base depth). */
    settleRatio: 0.42,
    warmChance: [0.035, 0.17] as const,
    warmMeltIn: [0.75, 3] as const,
    /** Once open, grooming keeps at least this much packed base. */
    baseFloorIn: 18,
    /** Snow factor at or above which a year opens on the first day. */
    goodYearFactor: 1.1,
    openingJitterDays: 3,
    /** Chance of a storm closure day (wind hold, blizzard) once open. */
    stormClosureChance: 0.012,
  },
  conditions: {
    min: 0.5, max: 1.5,
    /** Base depth (in) that counts as fully covered. */
    fullBaseIn: 50,
    /** Fresh snow (last two days, in) for the full powder bonus. */
    powderIn: 12,
    powderBonus: 0.5,
    warmPenalty: 0.15,
  },
  demand: {
    /** Potential Saturday guests for a ~10 km area near a metro (balance-tuned). */
    marketBase: 950,
    weekday: 0.35, saturday: 1, sunday: 0.85, holiday: 1.15,
    /** Share of the market that is local (pass candidates); the rest are visitors. */
    localShare: 0.6,
    /** Day-ticket price at which the price factor is 1. */
    referencePriceUsd: 90,
    priceElasticity: 1.2,
    /** Trail km at which the terrain factor is 1; beyond it, diminishing returns. */
    fullTerrainKm: 10,
    terrainExponent: 0.5,
    maxTerrainFactor: 2.0,
    /** More lifts = more to do: appeal × (1 + k·ln(lift count)). */
    liftAppealPerLog: 0.1,
    noise: [0.85, 1.15] as const,
  },
  reputation: {
    /** Reputation multiplies demand and carries over years; good operation builds it. */
    start: 1.0, min: 0.7, max: 1.2,
    /** How far each open day moves reputation toward that day's experience. */
    dailyWeight: 0.012,
    conditionsWeight: 0.35,
    /** Experience lost per 10 minutes of lift line. */
    waitPenaltyPer10Min: 0.2,
    varietyBonus: 0.05,
  },
  passes: {
    /** Share of locals buying a pass at the reference prices. */
    baseAdoption: 0.3,
    referencePriceUsd: 450,
    priceElasticity: 1.6,
    /** Pricier day tickets push more locals to passes. */
    dayPriceInfluence: 0.6,
    maxAdoption: 0.75,
    /** Average season visits by a local without a pass (used to count buyers). */
    visitsPerLocal: 5,
    /** Pass holders ski this much more often than they would on day tickets. */
    frequencyBoost: 1.6,
  },
  lifts: {
    hoursPerDay: 6.5,
    ridesPerGuest: 8,
    /** Guests above comfortable capacity give up beyond this multiple. */
    hardCapMultiple: 1.3,
  },
  money: {
    foodPerGuestUsd: 18,
    /** Food supplies, card fees, wear and tear per guest. */
    variableCostPerGuestUsd: 16,
    liftDailyCostUsd: { ropeTow: 600, fixedDouble: 4000, fixedQuad: 6500 } satisfies Record<LiftType, number>,
    groomPerTrailUsd: 450,
    // Admin, utilities, insurance and non-mountain staff; mountain staff are payroll.
    overheadOpenUsd: 14500,
    overheadClosedUsd: 4000,
  },
  defaultTicketPriceUsd: 79,
  defaultPassPriceUsd: 449,
} as const

export interface SeasonInputs {
  avgSnowfallIn: number
  /** 0 easy … 0.5 normal … 1 hard. Omitted = normal. */
  snowDifficulty?: number
  financeDifficulty?: number
  driveToMetroMin: number
  trailKm: number
  difficultyKinds: number
  lifts: { type: LiftType; capacityPph: number }[]
  trailCount: number
  /** Base-area effects; omitted = neutral (no parking cap, standard food spend). */
  amenity?: AmenityEffects
  /** Reputation at season start (0.6–1.4); omitted = new resort. */
  reputation?: number
  /** Staffing; omitted = fully staffed with no payroll (used by older tests). */
  staff?: StaffEffects
  /** Snowmaking; omitted = none. */
  snowmaking?: SnowmakingEffects
  /** Lift names for event messages; omitted = "Lift 1", "Lift 2"… */
  liftNames?: string[]
  hasBlack?: boolean
  /** Turn breakdowns and events off (used by focused tests). */
  noEvents?: boolean
}

export interface DayResult {
  day: number
  /** ISO date, e.g. 2026-12-01. */
  date: string
  weekday: number
  holiday: boolean
  newSnowIn: number
  warm: boolean
  baseIn: number
  open: boolean
  /** Closed for a storm (wind hold) rather than before opening day. */
  stormClosed: boolean
  /** Snow-conditions score, 0.5–1.5, multiplies demand. */
  conditions: number
  guests: number
  dayTicketGuests: number
  passVisits: number
  /** Guests who gave up because lifts were full. */
  turnedAway: number
  /** Of those, guests who found the parking full. */
  parkingTurnedAway: number
  waitMin: number
  ticketPriceUsd: number
  ticketRevenueUsd: number
  foodRevenueUsd: number
  /** Rentals and lessons. */
  extrasRevenueUsd: number
  costUsd: number
  netUsd: number
  /** Reputation after this day. */
  reputation: number
  /** Snowmaking ran today. */
  snowmaking: boolean
  events: SeasonEvent[]
  /** Repairs and settlements (included in costUsd). */
  eventCostUsd: number
  /** Race fees (included in netUsd). */
  eventIncomeUsd: number
  /** Night session (included in guests and revenue above). */
  nightGuests?: number
  nightRevenueUsd?: number
  /** Campaign costs paid today (included in costUsd). */
  marketingUsd?: number
}

export interface SeasonState {
  year: number
  day: number
  rngState: number
  /** Season snowfall budget in inches (from the year factor). */
  expectedSnowIn: number
  /** First day the resort opens (0 = Dec 1). */
  openingDay: number
  baseIn: number
  ticketPriceUsd: number
  passPriceUsd: number
  passesSold: number
  /** Share of local demand converted to pass holders this season. */
  passAdoption: number
  passRevenueUsd: number
  reputation: number
  /** Breakdown state and the event RNG; absent on seasons saved before v11. */
  events?: EventState
  days: DayResult[]
}

export interface SeasonTotals {
  days: number
  openDays: number
  guests: number
  passesSold: number
  passVisits: number
  passRevenueUsd: number
  ticketRevenueUsd: number
  foodRevenueUsd: number
  extrasRevenueUsd: number
  revenueUsd: number
  costUsd: number
  netUsd: number
  snowfallIn: number
  /** Guests who gave up because lifts were full. */
  turnedAway: number
  parkingTurnedAway: number
  avgConditions: number
  /** Reputation at the end of the season (null if no days). */
  reputation: number | null
  eventCostUsd: number
  eventIncomeUsd: number
  eventCount: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Calendar year in which a season starts (game year 1 starts in 2026). */
export const seasonStartYear = (gameYear: number) => 2025 + gameYear

export function seasonDate(gameYear: number, day: number): Date {
  return new Date(Date.UTC(seasonStartYear(gameYear), SEASON.startMonth, SEASON.startDay + day))
}

/** Nth weekday (0=Sun) of a month, UTC. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
}

/**
 * Holiday periods with extra demand: Christmas–New Year (Dec 24–Jan 1), and the
 * Saturday–Monday of MLK Day (3rd Monday of Jan) and Presidents' Day (3rd Monday of Feb).
 */
export function isHoliday(d: Date): boolean {
  const m = d.getUTCMonth(), day = d.getUTCDate(), y = d.getUTCFullYear()
  if ((m === 11 && day >= 24) || (m === 0 && day === 1)) return true
  for (const month of [0, 1]) {
    if (m !== month) continue
    const monday = nthWeekday(y, month, 1, 3)
    if (day >= monday - 2 && day <= monday) return true
  }
  return false
}

export const dayFactorOf = (d: Date) => dayFactor(d)

function dayFactor(d: Date): number {
  const D = SEASON.demand
  const w = d.getUTCDay()
  return isHoliday(d) ? D.holiday : w === 6 ? D.saturday : w === 0 ? D.sunday : D.weekday
}

/** Demand multiplier for the resort's size, terrain variety and access (no price, snow or day). */
export const appealOf = (inp: SeasonInputs) => appeal(inp)

function appeal(inp: SeasonInputs): number {
  const D = SEASON.demand
  const access = clamp(1.6 - inp.driveToMetroMin / 150, 0.2, 1.4)
  // Patrol shortages keep some terrain closed.
  const openKm = inp.trailKm * (inp.staff ?? FULL_STAFF).ratios.patrol
  const terrain = clamp(Math.pow(openKm / D.fullTerrainKm, D.terrainExponent), 0.15, D.maxTerrainFactor)
    * (0.8 + 0.1 * inp.difficultyKinds)
  const lifts = 1 + D.liftAppealPerLog * Math.log(Math.max(1, inp.lifts.length))
  const amenity = (inp.amenity ?? NEUTRAL_EFFECTS).appealMult
  return access * terrain * lifts * amenity * financeModifiers(inp.financeDifficulty ?? 0.5).demand
}

export interface PassEstimate {
  adoption: number
  passesSold: number
  revenueUsd: number
}

/**
 * Pass sales for a season, from prices and the resort's appeal. Deterministic, so the
 * UI can preview it before the season starts.
 */
export function estimatePassSales(gameYear: number, inp: SeasonInputs, passPriceUsd: number, dayPriceUsd: number): PassEstimate {
  const P = SEASON.passes, D = SEASON.demand
  if (!inp.lifts.length || !inp.trailCount) return { adoption: 0, passesSold: 0, revenueUsd: 0 }
  const adoption = clamp(
    P.baseAdoption * Math.pow(P.referencePriceUsd / passPriceUsd, P.priceElasticity)
      * Math.pow(dayPriceUsd / D.referencePriceUsd, P.dayPriceInfluence),
    0, P.maxAdoption,
  )
  // Expected local visits over a normal season (conditions 1, no noise).
  let localVisits = 0
  for (let d = 0; d < SEASON.lengthDays; d++) localVisits += D.marketBase * D.localShare * dayFactor(seasonDate(gameYear, d))
  localVisits *= appeal(inp) * (inp.reputation ?? SEASON.reputation.start)
  const passesSold = Math.round((adoption * localVisits) / P.visitsPerLocal)
  return { adoption, passesSold, revenueUsd: passesSold * Math.round(passPriceUsd) }
}

export function startSeason(
  gameYear: number, seed: number, inp: SeasonInputs, ticketPriceUsd: number, passPriceUsd: number = SEASON.defaultPassPriceUsd,
): SeasonState {
  const W = SEASON.weather
  const rng = createRng((seed ^ Math.imul(gameYear, 0x9e3779b1)) >>> 0)
  const mod = snowModifiers(inp.snowDifficulty ?? 0.5)
  const [lo, hi] = mod.yearFactor
  const factor = lerp(lo, hi, rng.next())
  // A poor year opens late; the worst year in range opens maxOpeningDelayDays late.
  const shortfall = clamp((W.goodYearFactor - factor) / (W.goodYearFactor - lo), 0, 1)
  const snow = inp.snowmaking ?? NO_SNOWMAKING
  const delay = shortfall * mod.maxOpeningDelayDays * (1 - SNOWMAKING.openingDelayCut * snow.coverage)
  const openingDay = Math.round(delay + rng.next() * W.openingJitterDays)
  const pass = estimatePassSales(gameYear, inp, passPriceUsd, ticketPriceUsd)
  return {
    year: gameYear,
    day: 0,
    expectedSnowIn: Math.round(inp.avgSnowfallIn * factor),
    openingDay,
    baseIn: 0,
    ticketPriceUsd,
    passPriceUsd: Math.round(passPriceUsd),
    passesSold: pass.passesSold,
    passAdoption: pass.adoption,
    passRevenueUsd: pass.revenueUsd,
    reputation: inp.reputation ?? SEASON.reputation.start,
    events: newEventState((seed ^ Math.imul(gameYear + 7919, 0x85ebca6b)) >>> 0, inp.lifts.length),
    rngState: rng.state(),
    days: [],
  }
}

/** Comfortable guests per day the lift network can carry. */
export function liftComfortGuests(lifts: SeasonInputs['lifts']): number {
  const pph = lifts.reduce((s, l) => s + l.capacityPph, 0)
  return Math.floor((pph * SEASON.lifts.hoursPerDay) / SEASON.lifts.ridesPerGuest)
}

/** Snow-conditions score from base depth, fresh snow and warmth (0.5–1.5). */
export function conditionsScore(baseIn: number, recentSnowIn: number, warm: boolean): number {
  const C = SEASON.conditions
  const cover = clamp(baseIn / C.fullBaseIn, 0.3, 1)
  const powder = (Math.min(recentSnowIn, C.powderIn) / C.powderIn) * C.powderBonus
  return Math.round(clamp(0.5 + 0.5 * cover + powder - (warm ? C.warmPenalty : 0), C.min, C.max) * 100) / 100
}

/**
 * Play one whole day with default choices (no live decisions): the batch path used by
 * the auto-player and tests. The live screen uses liveDay.ts directly.
 */
export function simulateDay(s: SeasonState, inp: SeasonInputs, ctx?: Partial<LiveContext>): { season: SeasonState; result: DayResult } {
  const live = runToEnd(startLiveDay(s, inp, { ...plainContext(s), noCards: inp.noEvents, ...ctx }), inp)
  return finishLiveDay(live, s, inp)
}

export const seasonOver = (s: SeasonState) => s.day >= SEASON.lengthDays

/** Totals for a season. Pass revenue comes from the season state (booked up front). */
export function seasonTotals(days: DayResult[], passes?: Pick<SeasonState, 'passesSold' | 'passRevenueUsd'>): SeasonTotals {
  const t: SeasonTotals = {
    days: days.length, openDays: 0, guests: 0, passesSold: passes?.passesSold ?? 0, passVisits: 0,
    passRevenueUsd: passes?.passRevenueUsd ?? 0, ticketRevenueUsd: 0, foodRevenueUsd: 0, extrasRevenueUsd: 0,
    revenueUsd: passes?.passRevenueUsd ?? 0, costUsd: 0, netUsd: passes?.passRevenueUsd ?? 0,
    snowfallIn: 0, turnedAway: 0, parkingTurnedAway: 0, avgConditions: 0, reputation: days.at(-1)?.reputation ?? null,
    eventCostUsd: 0, eventIncomeUsd: 0, eventCount: 0,
  }
  let condSum = 0
  for (const d of days) {
    if (d.open) { t.openDays++; condSum += d.conditions }
    t.guests += d.guests
    t.passVisits += d.passVisits
    t.ticketRevenueUsd += d.ticketRevenueUsd
    t.foodRevenueUsd += d.foodRevenueUsd
    t.extrasRevenueUsd += d.extrasRevenueUsd
    t.revenueUsd += d.ticketRevenueUsd + d.foodRevenueUsd + d.extrasRevenueUsd + (d.eventIncomeUsd ?? 0)
    t.eventCostUsd += d.eventCostUsd ?? 0
    t.eventIncomeUsd += d.eventIncomeUsd ?? 0
    t.eventCount += d.events?.length ?? 0
    t.costUsd += d.costUsd
    t.netUsd += d.netUsd
    t.snowfallIn += d.newSnowIn
    t.turnedAway += d.turnedAway
    t.parkingTurnedAway += d.parkingTurnedAway
  }
  t.avgConditions = t.openDays ? Math.round((condSum / t.openDays) * 100) / 100 : 0
  return t
}
