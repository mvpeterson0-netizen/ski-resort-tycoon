/**
 * Game state: the single serialisable object the UI saves and loads.
 * Pure data and pure functions; storage itself lives in the UI layer.
 */
import { AMENITIES, NO_AMENITIES, amenityEffects, nextAmenityCost, type AmenityId, type AmenityLevels } from './amenities'
import type { Difficulty, LiftPlan, LiftType, Pt, TrailPlan } from './build'
import { ECON, planPurchase, type PurchasePlan } from './economy'
import {
  SEASON, seasonDate, seasonOver, seasonTotals, startSeason,
  type DayResult, type SeasonInputs, type SeasonState, type SeasonTotals,
} from './season'
import type { Site } from './sites'
import { maxSnowmakingKm, snowmakingEffects, SNOWMAKING } from './snowmaking'
import { NO_STAFF, fillRate, headcount, localPool, neededStaff, staffEffects, STAFF_TUNING, type Staffing } from './staff'
import { DEFAULT_DIFFICULTY, type DifficultySettings } from './difficultySettings'
import { closeYear, emptyBook, ensureLiquidity, type YearBook, type YearReport } from './finance'
import type { BasePlacement } from './village'
import { newCalendar, priceForDay, type PriceCalendar } from './pricing'
import { promoEffects, type Promo } from './promos'
import {
  answerCard, finishLiveDay, isDayDone, runToEnd, startLiveDay, tickLiveDay, type LiveContext, type LiveDay,
} from './liveDay'

// v2 (step 4c): ownedParcels. v3 (step 5): trails, lifts. v4 (step 6): season.
// v5: difficulty sliders. v6 (step 7): credit line, year book, reports, bankruptcy.
// v7: season pass price. v8: amenities, reputation. v9: staff. v10: snowmaking.
// v11: base village placement and package value.
// v12: price calendar (weekend/holiday/night prices, per-day plans) and marketing promos.
// Older saves from v2 upward are upgraded in parseSave.
export const GAME_STATE_VERSION = 12

export interface Loan {
  id: string
  name: string
  ratePct: number
  termYears: number
  originalUsd: number
  balanceUsd: number
  annualPaymentUsd: number
}

export interface Trail {
  id: string
  name: string
  points: Pt[]
  difficulty: Difficulty
  lengthM: number
  verticalM: number
  acres: number
  costUsd: number
  /** Metres of the path shared with earlier runs (lengthM and costUsd are the new stretch only). */
  sharedM?: number
}

export interface Lift {
  id: string
  name: string
  type: LiftType
  bottom: Pt
  top: Pt
  lengthM: number
  verticalM: number
  capacityPph: number
  costUsd: number
}

export type Phase = 'offseason' | 'season'

export interface StaffPlan {
  /** auto: headcount follows the recommended numbers; manual: the player's numbers. */
  mode: 'auto' | 'manual'
  hired: Staffing
  /** Wage multiplier, 0.9–1.3 of standard. */
  wageLevel: number
}

export interface GameState {
  version: typeof GAME_STATE_VERSION
  seed: number
  siteId: string
  /** 1 = first season. */
  year: number
  phase: Phase
  cashUsd: number
  landPaidUsd: number
  /** Parcel ids owned. Empty for sites without real terrain (whole site owned). */
  ownedParcels: string[]
  loans: Loan[]
  trails: Trail[]
  lifts: Lift[]
  /** Active winter season, or null in the off-season. */
  season: SeasonState | null
  /** Totals of the most recently finished season. */
  lastSeason: (SeasonTotals & { year: number }) | null
  /** Ticket price carried between seasons. */
  ticketPriceUsd: number
  /** Season pass price, set in the off-season. */
  passPriceUsd: number
  amenities: AmenityLevels
  /** Carries over between seasons; multiplies demand (0.6–1.4). */
  reputation: number
  staff: StaffPlan
  /** Km of trail covered by snowmaking. */
  snowmakingKm: number
  difficulty: DifficultySettings
  /** Drawn balance on the revolving credit line. */
  creditUsd: number
  /** Cash-flow counters for the current year. */
  book: YearBook
  /** One report per closed year, oldest first. */
  reports: YearReport[]
  bankrupt: boolean
  /** Base village location (terrain cells); null for older saves until the player places it. */
  base: BasePlacement | null
  /** Book value of the starter base village (package + access road). */
  villageUsd: number
  /** Weekend, holiday and night prices plus per-day plans. Weekday price is ticketPriceUsd. */
  calendar: PriceCalendar
  /** Marketing campaigns booked for this or the coming season. */
  promos: Promo[]
  /** The day being played hour by hour, or null between days. */
  live: LiveDay | null
}

/** The starter base village bought with the land. */
export interface VillagePurchase { base: BasePlacement | null; costUsd: number }

/**
 * New game. plan.priceUsd is everything bought at the start (land + village package);
 * the village part is split out so land and buildings are booked separately.
 */
export function newGame(
  siteId: string, plan: PurchasePlan, seed: number, parcelId?: string, difficulty: DifficultySettings = DEFAULT_DIFFICULTY,
  village: VillagePurchase = { base: null, costUsd: 0 },
): GameState {
  if (plan.problem) throw new Error(plan.problem)
  const loans: Loan[] = []
  if (plan.loanUsd > 0) {
    loans.push({
      id: 'land',
      name: 'Land mortgage',
      ratePct: ECON.landLoan.ratePct,
      termYears: ECON.landLoan.termYears,
      originalUsd: plan.loanUsd,
      balanceUsd: plan.loanUsd,
      annualPaymentUsd: plan.annualPaymentUsd,
    })
  }
  return {
    version: GAME_STATE_VERSION,
    seed: seed >>> 0,
    siteId,
    year: 1,
    phase: 'offseason',
    cashUsd: plan.cashAfterUsd,
    landPaidUsd: plan.priceUsd - village.costUsd,
    ownedParcels: parcelId ? [parcelId] : [],
    loans,
    trails: [],
    lifts: [],
    season: null,
    lastSeason: null,
    ticketPriceUsd: SEASON.defaultTicketPriceUsd,
    passPriceUsd: SEASON.defaultPassPriceUsd,
    amenities: { ...NO_AMENITIES },
    reputation: SEASON.reputation.start,
    staff: { mode: 'auto', hired: { ...NO_STAFF }, wageLevel: 1 },
    snowmakingKm: 0,
    difficulty: { ...difficulty },
    creditUsd: 0,
    // Year 1 opens with the starting cash, then the land purchase and its mortgage.
    book: { ...emptyBook(ECON.startingCashUsd), capexUsd: plan.priceUsd, newLoansUsd: plan.loanUsd },
    reports: [],
    bankrupt: false,
    base: village.base,
    villageUsd: village.costUsd,
    calendar: newCalendar(),
    promos: [],
    live: null,
  }
}

/** Place (or move, before anything is built) the base village on a save that has none. */
export function placeBase(g: GameState, base: BasePlacement): GameState {
  return { ...g, base }
}

export const totalDebt = (g: GameState) => g.loans.reduce((s, l) => s + l.balanceUsd, 0) + (g.creditUsd ?? 0)
export const annualDebtService = (g: GameState) => g.loans.reduce((s, l) => s + l.annualPaymentUsd, 0)

/** Validate a parsed save. Returns null if it is not a usable save of this version. */
export function parseSave(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null
  const g = { ...(raw as object) } as Omit<Partial<GameState>, 'version'> & { version?: number }
  if (g.version === 2) {
    g.trails = []
    g.lifts = []
    g.version = 3
  }
  if (g.version === 3) {
    g.season = null
    g.lastSeason = null
    g.ticketPriceUsd = SEASON.defaultTicketPriceUsd
    g.phase = 'offseason'
    g.version = 4
  }
  if (g.version === 4) {
    g.difficulty = { ...DEFAULT_DIFFICULTY }
    g.version = 5
  }
  if (g.version === 5) {
    g.creditUsd = 0
    g.book = emptyBook(typeof g.cashUsd === 'number' ? g.cashUsd : 0)
    g.reports = []
    g.bankrupt = false
    g.version = 6
  }
  if (g.version === 6) {
    g.passPriceUsd = SEASON.defaultPassPriceUsd
    const pre = { passesSold: 0, passVisits: 0, passRevenueUsd: 0, ticketRevenueUsd: 0, foodRevenueUsd: 0, avgConditions: 0 }
    if (g.lastSeason) g.lastSeason = { ...pre, ...(g.lastSeason as object) } as GameState['lastSeason']
    g.version = 7
  }
  if (g.version === 7) {
    g.amenities = { ...NO_AMENITIES }
    g.reputation = SEASON.reputation.start
    g.version = 8
  }
  if (g.version === 8) {
    g.staff = { mode: 'auto', hired: { ...NO_STAFF }, wageLevel: 1 }
    if (g.amenities) g.amenities = { ...g.amenities, housing: g.amenities.housing ?? 0 }
    g.version = 9
  }
  if (g.version === 9) {
    g.snowmakingKm = 0
    if (g.staff) g.staff = { ...g.staff, hired: { ...g.staff.hired, snowmakers: g.staff.hired.snowmakers ?? 0 } }
    g.version = 10
  }
  if (g.version === 10) {
    // Older resorts get their village placed on the map later (UI suggests a spot); no charge.
    g.base = null
    g.villageUsd = 0
    g.version = 11
  }
  if (g.version === 11) {
    g.calendar = newCalendar()
    g.promos = []
    g.live = null
    g.version = GAME_STATE_VERSION
  }
  if (g.version !== GAME_STATE_VERSION) return null
  if (!Array.isArray(g.trails) || !Array.isArray(g.lifts)) return null
  if (typeof g.siteId !== 'string' || typeof g.cashUsd !== 'number' || !Array.isArray(g.loans) || !Array.isArray(g.ownedParcels)) return null
  return g as GameState
}

export type BuildResult = { ok: true; game: GameState } | { ok: false; reason: string }

const nextId = (prefix: string, existing: { id: string }[]) => {
  let n = existing.length + 1
  while (existing.some((e) => e.id === `${prefix}${n}`)) n++
  return `${prefix}${n}`
}

export function buildTrail(g: GameState, plan: TrailPlan, name?: string): BuildResult {
  if (plan.problems.length) return { ok: false, reason: plan.problems[0] }
  if (plan.costUsd > g.cashUsd) return { ok: false, reason: 'Not enough cash' }
  const id = nextId('t', g.trails)
  const trail: Trail = {
    id, name: name ?? `Trail ${g.trails.length + 1}`, points: plan.points, difficulty: plan.difficulty,
    lengthM: plan.lengthM, verticalM: plan.verticalM, acres: plan.acres, costUsd: plan.costUsd,
    ...(plan.sharedM > 0 ? { sharedM: plan.sharedM } : {}),
  }
  return { ok: true, game: { ...g, cashUsd: g.cashUsd - plan.costUsd, trails: [...g.trails, trail], book: { ...g.book, capexUsd: g.book.capexUsd + plan.costUsd } } }
}

export function buildLift(g: GameState, plan: LiftPlan, name?: string): BuildResult {
  if (plan.problems.length) return { ok: false, reason: plan.problems[0] }
  if (plan.costUsd > g.cashUsd) return { ok: false, reason: 'Not enough cash' }
  const id = nextId('l', g.lifts)
  const lift: Lift = {
    id, name: name ?? `Lift ${g.lifts.length + 1}`, type: plan.type, bottom: plan.bottom, top: plan.top,
    lengthM: plan.lengthM, verticalM: plan.verticalM, capacityPph: plan.capacityPph, costUsd: plan.costUsd,
  }
  return { ok: true, game: { ...g, cashUsd: g.cashUsd - plan.costUsd, lifts: [...g.lifts, lift], book: { ...g.book, capexUsd: g.book.capexUsd + plan.costUsd } } }
}

export function seasonInputs(g: GameState, site: Site): SeasonInputs {
  const st = staffing(g, site)
  const trailKm = g.trails.reduce((s, t) => s + t.lengthM, 0) / 1000
  return {
    avgSnowfallIn: site.traits.avgSnowfallIn,
    driveToMetroMin: site.traits.driveToMetroMin,
    trailKm: g.trails.reduce((s, t) => s + t.lengthM, 0) / 1000,
    difficultyKinds: new Set(g.trails.map((t) => t.difficulty)).size,
    lifts: g.lifts.map((l) => ({ type: l.type, capacityPph: l.capacityPph })),
    trailCount: g.trails.length,
    snowDifficulty: g.difficulty.snow,
    financeDifficulty: g.difficulty.finance,
    amenity: amenityEffects(g.amenities, g.trails.some((t) => t.difficulty === 'green')),
    reputation: g.reputation,
    staff: st.effects,
    liftNames: g.lifts.map((l) => l.name),
    hasBlack: g.trails.some((t) => t.difficulty === 'black'),
    snowmaking: snowmakingEffects(g.snowmakingKm, trailKm, site.traits.waterRights, st.effects.ratios.snowmakers),
  }
}

/** Recommended and actual staffing for the resort as built. */
export function staffing(g: GameState, site: Site) {
  const needed = neededStaff({
    lifts: g.lifts, trailKm: g.trails.reduce((s, t) => s + t.lengthM, 0) / 1000, hasSchool: g.amenities.school > 0,
    snowmakingKm: g.snowmakingKm ?? 0,
  })
  const hired = g.staff.mode === 'auto' ? needed : g.staff.hired
  const beds = amenityEffects(g.amenities, false).housingBeds
  const pool = localPool(site.traits.driveToMetroMin)
  const fill = fillRate(headcount(hired), pool, beds, g.staff.wageLevel)
  return { needed, hired, pool, beds, fill, effects: staffEffects(hired, needed, fill, g.staff.wageLevel) }
}

/** Why the season cannot start yet, or null if it can. */
export function seasonBlocker(g: GameState): string | null {
  if (g.phase === 'season') return 'Season already running'
  if (!g.lifts.length) return 'Build at least one lift'
  if (!g.trails.length) return 'Build at least one trail'
  return null
}

/** Start the season: pass sales are settled now and their cash arrives up front. */
export function beginSeason(g: GameState, site: Site): GameState {
  const why = seasonBlocker(g)
  if (why) throw new Error(why)
  // Pass sales key off the weekday sticker price; each day then uses its calendar price.
  const started = startSeason(g.year, g.seed, seasonInputs(g, site), g.ticketPriceUsd, g.passPriceUsd)
  const season = { ...started, ticketPriceUsd: priceForDay(g.ticketPriceUsd, g.calendar, g.year, 0) }
  return { ...g, phase: 'season', season, cashUsd: g.cashUsd + season.passRevenueUsd }
}

/** Pass prices are fixed once the season starts. */
export function setPassPrice(g: GameState, priceUsd: number): GameState {
  if (g.phase === 'season') return g
  return { ...g, passPriceUsd: Math.max(50, Math.min(3000, Math.round(priceUsd))) }
}

/** Set the weekday ticket price. Weekend and holiday defaults follow it; the next day uses the new price. */
export function setTicketPrice(g: GameState, priceUsd: number): GameState {
  const p = Math.max(10, Math.min(250, Math.round(priceUsd)))
  const season = g.season ? { ...g.season, ticketPriceUsd: priceForDay(p, g.calendar, g.year, g.season.day) } : null
  return { ...g, ticketPriceUsd: p, season }
}

/** Price, day plan and campaigns for the season day about to be played. */
export function liveContextFor(g: GameState): LiveContext {
  const day = g.season?.day ?? 0
  const date = seasonDate(g.year, day)
  return {
    priceUsd: priceForDay(g.ticketPriceUsd, g.calendar, g.year, day),
    nightPriceUsd: g.calendar.night,
    ops: g.calendar.ops[day] ?? {},
    promo: promoEffects(g.promos, day, date.getUTCDay()),
  }
}

/** Begin playing the next season day hour by hour. No-op if a day is already under way. */
export function startDay(g: GameState, site: Site): GameState {
  if (!g.season || g.phase !== 'season' || g.live) return g
  return { ...g, live: startLiveDay(g.season, seasonInputs(g, site), liveContextFor(g)) }
}

/** Run the next 30 minutes (or stop on an event card). */
export function playTick(g: GameState, site: Site): GameState {
  return g.live ? { ...g, live: tickLiveDay(g.live, seasonInputs(g, site)) } : g
}

/** Answer the event card the day is paused on. */
export function answerLiveCard(g: GameState, site: Site, optionId: string): GameState {
  return g.live ? { ...g, live: answerCard(g.live, seasonInputs(g, site), optionId) } : g
}

export const liveDayDone = (g: GameState, site: Site) => !!g.live && isDayDone(g.live, seasonInputs(g, site))

/** Close the finished live day: cash moves by the day's net; the last day closes the season. */
export function finishDay(g: GameState, site: Site): { game: GameState; result: DayResult } {
  if (!g.season || !g.live) throw new Error('No day to finish')
  const { season, result } = finishLiveDay(g.live, g.season, seasonInputs(g, site))
  // Cash moves by the day's net; a shortfall is covered by the credit line (or bankrupts).
  let next: GameState = ensureLiquidity({ ...g, season, live: null, cashUsd: g.cashUsd + result.netUsd })
  if (seasonOver(season)) next = finishSeason(next)
  else if (next.season) next = { ...next, season: { ...next.season, ticketPriceUsd: priceForDay(next.ticketPriceUsd, next.calendar, next.year, next.season.day) } }
  return { game: next, result }
}

/**
 * Play a whole day with default choices (event cards answered with their default
 * option). Used by the auto-player, tests and as a fallback; the live screen steps the
 * day itself.
 */
export function advanceDay(g: GameState, site: Site): { game: GameState; result: DayResult } {
  if (!g.season || g.phase !== 'season') throw new Error('No season running')
  const started = startDay(g, site)
  return finishDay({ ...started, live: runToEnd(started.live!, seasonInputs(started, site)) }, site)
}

/** Close the season, then close the year (fixed costs, loan payments, report). */
export function finishSeason(g: GameState): GameState {
  if (!g.season) return g
  const totals = { ...seasonTotals(g.season.days, g.season), year: g.season.year }
  const closed = closeYear({ ...g, phase: 'offseason', lastSeason: totals, season: null, reputation: g.season.reputation }, totals).game
  // The season's day plans and campaigns are spent; a new season starts with a clean calendar.
  return { ...closed, year: g.year + 1, calendar: { ...closed.calendar, ops: {} }, promos: [] }
}

export function setDifficulty(g: GameState, d: Partial<DifficultySettings>): GameState {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  return { ...g, difficulty: { snow: clamp01(d.snow ?? g.difficulty.snow), finance: clamp01(d.finance ?? g.difficulty.finance) } }
}

export function buyAmenity(g: GameState, id: AmenityId): BuildResult {
  const cost = nextAmenityCost(g.amenities, id)
  if (cost === null) return { ok: false, reason: `${AMENITIES[id].name} is fully built` }
  if (cost > g.cashUsd) return { ok: false, reason: 'Not enough cash' }
  return {
    ok: true,
    game: {
      ...g, cashUsd: g.cashUsd - cost, amenities: { ...g.amenities, [id]: g.amenities[id] + 1 },
      book: { ...g.book, capexUsd: g.book.capexUsd + cost },
    },
  }
}

/** Buy an expansion parcel. The caller checks adjacency and computes the price. */
export function buyParcel(g: GameState, parcelId: string, priceUsd: number): BuildResult {
  if (g.ownedParcels.includes(parcelId)) return { ok: false, reason: 'You already own this parcel' }
  if (g.phase === 'season') return { ok: false, reason: 'Land deals close in the off-season' }
  if (priceUsd > g.cashUsd) return { ok: false, reason: 'Not enough cash' }
  return {
    ok: true,
    game: {
      ...g, cashUsd: g.cashUsd - priceUsd, landPaidUsd: g.landPaidUsd + priceUsd,
      ownedParcels: [...g.ownedParcels, parcelId], book: { ...g.book, capexUsd: g.book.capexUsd + priceUsd },
    },
  }
}

export function setStaffPlan(g: GameState, plan: Partial<StaffPlan>): GameState {
  const T = STAFF_TUNING
  const next = { ...g.staff, ...plan }
  next.wageLevel = Math.round(Math.max(T.minWageLevel, Math.min(T.maxWageLevel, next.wageLevel)) * 100) / 100
  for (const k of Object.keys(next.hired) as (keyof Staffing)[]) next.hired = { ...next.hired, [k]: Math.max(0, Math.round(next.hired[k])) }
  return { ...g, staff: next }
}

/** Add snowmaking coverage (km), up to what the site's water rights allow. */
export function buySnowmaking(g: GameState, site: Site, km: number): BuildResult {
  const trailKm = g.trails.reduce((s, t) => s + t.lengthM, 0) / 1000
  const room = maxSnowmakingKm(trailKm, site.traits.waterRights) - g.snowmakingKm
  const add = Math.min(km, Math.round(room * 10) / 10)
  if (add <= 0) return { ok: false, reason: trailKm <= 0 ? 'Build trails first' : 'Your water rights allow no more coverage' }
  const cost = Math.round(add * SNOWMAKING.installPerKmUsd)
  if (cost > g.cashUsd) return { ok: false, reason: 'Not enough cash' }
  return {
    ok: true,
    game: { ...g, cashUsd: g.cashUsd - cost, snowmakingKm: Math.round((g.snowmakingKm + add) * 10) / 10, book: { ...g.book, capexUsd: g.book.capexUsd + cost } },
  }
}

export { planPurchase }
