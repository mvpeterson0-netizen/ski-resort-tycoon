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
import type { LiftType } from './build'
import { financeModifiers, snowModifiers } from './difficultySettings'
import { createRng } from './rng'

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
    marketBase: 900,
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
    noise: [0.85, 1.15] as const,
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
    // Stand-in for staff wages, insurance and upkeep until those systems exist (step 8).
    overheadOpenUsd: 18000,
    overheadClosedUsd: 5000,
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
  waitMin: number
  ticketPriceUsd: number
  ticketRevenueUsd: number
  foodRevenueUsd: number
  costUsd: number
  netUsd: number
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
  revenueUsd: number
  costUsd: number
  netUsd: number
  snowfallIn: number
  /** Guests who gave up because lifts were full. */
  turnedAway: number
  avgConditions: number
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

function dayFactor(d: Date): number {
  const D = SEASON.demand
  const w = d.getUTCDay()
  return isHoliday(d) ? D.holiday : w === 6 ? D.saturday : w === 0 ? D.sunday : D.weekday
}

/** Demand multiplier for the resort's size, terrain variety and access (no price, snow or day). */
function appeal(inp: SeasonInputs): number {
  const D = SEASON.demand
  const access = clamp(1.6 - inp.driveToMetroMin / 150, 0.2, 1.4)
  const terrain = clamp(Math.pow(inp.trailKm / D.fullTerrainKm, D.terrainExponent), 0.15, D.maxTerrainFactor)
    * (0.8 + 0.1 * inp.difficultyKinds)
  return access * terrain * financeModifiers(inp.financeDifficulty ?? 0.5).demand
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
  localVisits *= appeal(inp)
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
  const openingDay = Math.round(shortfall * mod.maxOpeningDelayDays + rng.next() * W.openingJitterDays)
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

export function simulateDay(s: SeasonState, inp: SeasonInputs): { season: SeasonState; result: DayResult } {
  const rng = createRng(s.rngState)
  const W = SEASON.weather, D = SEASON.demand, P = SEASON.passes, M = SEASON.money
  const date = seasonDate(s.year, s.day)
  const progress = s.day / SEASON.lengthDays
  const snowMod = snowModifiers(inp.snowDifficulty ?? 0.5)
  const finMod = financeModifiers(inp.financeDifficulty ?? 0.5)

  // Weather.
  let newSnowIn = 0
  if (rng.next() < W.stormChance) {
    const mean = s.expectedSnowIn / (SEASON.lengthDays * W.stormChance)
    newSnowIn = Math.round(-Math.log(1 - rng.next()) * mean)
  }
  const warm = rng.next() < lerp(W.warmChance[0], W.warmChance[1], progress) * snowMod.warmChance
  let baseIn = s.baseIn + newSnowIn * W.settleRatio
  if (warm) baseIn -= lerp(W.warmMeltIn[0], W.warmMeltIn[1], rng.next())
  const reachedOpening = s.day >= s.openingDay
  if (reachedOpening) baseIn = Math.max(baseIn, W.baseFloorIn)
  baseIn = Math.max(0, Math.round(baseIn * 10) / 10)
  const stormClosed = reachedOpening && rng.next() < W.stormClosureChance
  const open = reachedOpening && !stormClosed && inp.lifts.length > 0 && inp.trailCount > 0
  const recentSnow = newSnowIn + (s.days.at(-1)?.newSnowIn ?? 0)
  const conditions = conditionsScore(baseIn, recentSnow, warm)

  // Demand: locals (some hold passes) and visitors.
  const holiday = isHoliday(date)
  const noise = lerp(D.noise[0], D.noise[1], rng.next())
  const market = open ? D.marketBase * dayFactor(date) * conditions * appeal(inp) * noise : 0
  const priceFactor = Math.pow(D.referencePriceUsd / s.ticketPriceUsd, D.priceElasticity)
  const locals = market * D.localShare
  const visitors = market - locals
  const wantDay = (locals * (1 - s.passAdoption) + visitors) * priceFactor
  const wantPass = locals * s.passAdoption * P.frequencyBoost
  const wanted = wantDay + wantPass

  const comfort = liftComfortGuests(inp.lifts)
  const cap = Math.floor(comfort * SEASON.lifts.hardCapMultiple)
  const guests = Math.round(Math.min(wanted, cap))
  const scale = wanted > 0 ? guests / wanted : 0
  const dayTicketGuests = Math.round(wantDay * scale)
  const passVisits = guests - dayTicketGuests
  const turnedAway = Math.max(0, Math.round(wanted) - guests)
  const load = comfort > 0 ? guests / comfort : 0
  const waitMin = open ? Math.round(Math.max(0, load - 0.7) * 25) : 0

  // Money (pass revenue is booked when the season starts, not per day).
  const ticketRevenueUsd = dayTicketGuests * s.ticketPriceUsd
  const foodRevenueUsd = guests * M.foodPerGuestUsd
  const costUsd = Math.round(finMod.costs * (open
    ? M.overheadOpenUsd + inp.lifts.reduce((t, l) => t + M.liftDailyCostUsd[l.type], 0) + inp.trailCount * M.groomPerTrailUsd
      + guests * M.variableCostPerGuestUsd
    : M.overheadClosedUsd))

  const result: DayResult = {
    day: s.day,
    date: date.toISOString().slice(0, 10),
    weekday: date.getUTCDay(), holiday, newSnowIn, warm, baseIn, open, stormClosed, conditions,
    guests, dayTicketGuests, passVisits, turnedAway, waitMin,
    ticketPriceUsd: s.ticketPriceUsd,
    ticketRevenueUsd, foodRevenueUsd, costUsd,
    netUsd: ticketRevenueUsd + foodRevenueUsd - costUsd,
  }
  return {
    season: { ...s, day: s.day + 1, baseIn, rngState: rng.state(), days: [...s.days, result] },
    result,
  }
}

export const seasonOver = (s: SeasonState) => s.day >= SEASON.lengthDays

/** Totals for a season. Pass revenue comes from the season state (booked up front). */
export function seasonTotals(days: DayResult[], passes?: Pick<SeasonState, 'passesSold' | 'passRevenueUsd'>): SeasonTotals {
  const t: SeasonTotals = {
    days: days.length, openDays: 0, guests: 0, passesSold: passes?.passesSold ?? 0, passVisits: 0,
    passRevenueUsd: passes?.passRevenueUsd ?? 0, ticketRevenueUsd: 0, foodRevenueUsd: 0,
    revenueUsd: passes?.passRevenueUsd ?? 0, costUsd: 0, netUsd: passes?.passRevenueUsd ?? 0,
    snowfallIn: 0, turnedAway: 0, avgConditions: 0,
  }
  let condSum = 0
  for (const d of days) {
    if (d.open) { t.openDays++; condSum += d.conditions }
    t.guests += d.guests
    t.passVisits += d.passVisits
    t.ticketRevenueUsd += d.ticketRevenueUsd
    t.foodRevenueUsd += d.foodRevenueUsd
    t.revenueUsd += d.ticketRevenueUsd + d.foodRevenueUsd
    t.costUsd += d.costUsd
    t.netUsd += d.netUsd
    t.snowfallIn += d.newSnowIn
    t.turnedAway += d.turnedAway
  }
  t.avgConditions = t.openDays ? Math.round((condSum / t.openDays) * 100) / 100 : 0
  return t
}
