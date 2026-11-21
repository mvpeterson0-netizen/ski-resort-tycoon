/**
 * Winter season: day-by-day weather, guests, revenue and costs.
 *
 * Deterministic: all randomness comes from the season's saved RNG state.
 * Every coefficient in SEASON is a PLACEHOLDER chosen for readable, playable
 * behaviour — none is sourced from real resort or climate data.
 */
import type { LiftType } from './build'
import { createRng } from './rng'

export const SEASON = {
  /** Opening day (month is 0-based) and length. */
  startMonth: 11, startDay: 1, lengthDays: 126,
  weather: {
    /** Season snowfall = site average × a factor drawn once per season in this range. */
    yearFactor: [0.55, 1.45] as const,
    stormChance: 0.22,
    /** Fraction of new snow that ends up as packed base. */
    settleRatio: 0.35,
    /** Chance of a warm day rises from start to end of season. */
    warmChance: [0.04, 0.2] as const,
    warmMeltIn: [1, 4] as const,
    /** Base needed to open (no snowmaking yet). */
    openBaseIn: 18,
  },
  demand: {
    /** Potential guests on a Saturday for a large, well-known area near a metro. */
    marketBase: 2500,
    weekday: 0.35, saturday: 1, sunday: 0.85, holiday: 1.15,
    /** Ticket price at which the price factor is 1. */
    referencePriceUsd: 90,
    priceElasticity: 1.2,
    /** Trail km at which the terrain factor reaches 1. */
    fullTerrainKm: 10,
    noise: [0.85, 1.15] as const,
  },
  lifts: {
    hoursPerDay: 6.5,
    ridesPerGuest: 8,
    /** Guests above comfortable capacity give up beyond this multiple. */
    hardCapMultiple: 1.3,
  },
  money: {
    foodPerGuestUsd: 18,
    liftDailyCostUsd: { ropeTow: 300, fixedDouble: 1500, fixedQuad: 2500 } satisfies Record<LiftType, number>,
    groomPerTrailUsd: 250,
    // Stand-in for staff wages, insurance and upkeep until those systems exist (step 8).
    overheadOpenUsd: 12000,
    overheadClosedUsd: 3000,
  },
  defaultTicketPriceUsd: 79,
} as const

export interface SeasonInputs {
  avgSnowfallIn: number
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
  guests: number
  /** Guests turned away because lifts were full. */
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
  baseIn: number
  ticketPriceUsd: number
  days: DayResult[]
}

export interface SeasonTotals {
  days: number
  openDays: number
  guests: number
  revenueUsd: number
  costUsd: number
  netUsd: number
  snowfallIn: number
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

export function startSeason(gameYear: number, seed: number, avgSnowfallIn: number, ticketPriceUsd: number): SeasonState {
  const rng = createRng((seed ^ Math.imul(gameYear, 0x9e3779b1)) >>> 0)
  const [lo, hi] = SEASON.weather.yearFactor
  return {
    year: gameYear,
    day: 0,
    expectedSnowIn: Math.round(avgSnowfallIn * lerp(lo, hi, rng.next())),
    baseIn: 0,
    ticketPriceUsd,
    rngState: rng.state(),
    days: [],
  }
}

/** Comfortable guests per day the lift network can carry. */
export function liftComfortGuests(lifts: SeasonInputs['lifts']): number {
  const pph = lifts.reduce((s, l) => s + l.capacityPph, 0)
  return Math.floor((pph * SEASON.lifts.hoursPerDay) / SEASON.lifts.ridesPerGuest)
}

export function simulateDay(s: SeasonState, inp: SeasonInputs): { season: SeasonState; result: DayResult } {
  const rng = createRng(s.rngState)
  const W = SEASON.weather, D = SEASON.demand, M = SEASON.money
  const date = seasonDate(s.year, s.day)
  const progress = s.day / SEASON.lengthDays

  // Weather.
  let newSnowIn = 0
  if (rng.next() < W.stormChance) {
    const mean = s.expectedSnowIn / (SEASON.lengthDays * W.stormChance)
    newSnowIn = Math.round(-Math.log(1 - rng.next()) * mean)
  }
  const warm = rng.next() < lerp(W.warmChance[0], W.warmChance[1], progress)
  let baseIn = s.baseIn + newSnowIn * W.settleRatio
  if (warm) baseIn -= lerp(W.warmMeltIn[0], W.warmMeltIn[1], rng.next())
  baseIn = Math.max(0, Math.round(baseIn * 10) / 10)
  const open = baseIn >= W.openBaseIn && inp.lifts.length > 0 && inp.trailCount > 0

  // Demand.
  const weekday = date.getUTCDay()
  const holiday = isHoliday(date)
  const dayFactor = holiday ? D.holiday : weekday === 6 ? D.saturday : weekday === 0 ? D.sunday : D.weekday
  const recentSnow = newSnowIn + (s.days.at(-1)?.newSnowIn ?? 0)
  const snowFactor = clamp(baseIn / 40, 0.5, 1.1) * (recentSnow >= 6 ? 1.3 : 1)
  const accessFactor = clamp(1.6 - inp.driveToMetroMin / 150, 0.2, 1.4)
  const terrainFactor = clamp(inp.trailKm / D.fullTerrainKm, 0.15, 1.2) * (0.8 + 0.1 * inp.difficultyKinds)
  const priceFactor = Math.pow(D.referencePriceUsd / s.ticketPriceUsd, D.priceElasticity)
  const noise = lerp(D.noise[0], D.noise[1], rng.next())
  const wanted = open ? D.marketBase * dayFactor * snowFactor * accessFactor * terrainFactor * priceFactor * noise : 0

  const comfort = liftComfortGuests(inp.lifts)
  const cap = Math.floor(comfort * SEASON.lifts.hardCapMultiple)
  const guests = Math.round(Math.min(wanted, cap))
  const turnedAway = Math.max(0, Math.round(wanted) - guests)
  const load = comfort > 0 ? guests / comfort : 0
  const waitMin = open ? Math.round(Math.max(0, load - 0.7) * 25) : 0

  // Money.
  const ticketRevenueUsd = guests * s.ticketPriceUsd
  const foodRevenueUsd = guests * M.foodPerGuestUsd
  const costUsd = open
    ? M.overheadOpenUsd + inp.lifts.reduce((t, l) => t + M.liftDailyCostUsd[l.type], 0) + inp.trailCount * M.groomPerTrailUsd
    : M.overheadClosedUsd

  const result: DayResult = {
    day: s.day,
    date: date.toISOString().slice(0, 10),
    weekday, holiday, newSnowIn, warm, baseIn, open, guests, turnedAway, waitMin,
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

export function seasonTotals(days: DayResult[]): SeasonTotals {
  const t: SeasonTotals = { days: days.length, openDays: 0, guests: 0, revenueUsd: 0, costUsd: 0, netUsd: 0, snowfallIn: 0 }
  for (const d of days) {
    if (d.open) t.openDays++
    t.guests += d.guests
    t.revenueUsd += d.ticketRevenueUsd + d.foodRevenueUsd
    t.costUsd += d.costUsd
    t.netUsd += d.netUsd
    t.snowfallIn += d.newSnowIn
  }
  return t
}
