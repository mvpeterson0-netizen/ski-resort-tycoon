/**
 * Game state: the single serialisable object the UI saves and loads.
 * Pure data and pure functions; storage itself lives in the UI layer.
 */
import type { Difficulty, LiftPlan, LiftType, Pt, TrailPlan } from './build'
import { ECON, planPurchase, type PurchasePlan } from './economy'

// v2 (step 4c): ownedParcels. v3 (step 5): trails, lifts; v2 saves are upgraded.
export const GAME_STATE_VERSION = 3

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

export type Phase = 'offseason'

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
}

export function newGame(siteId: string, plan: PurchasePlan, seed: number, parcelId?: string): GameState {
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
    landPaidUsd: plan.priceUsd,
    ownedParcels: parcelId ? [parcelId] : [],
    loans,
    trails: [],
    lifts: [],
  }
}

export const totalDebt = (g: GameState) => g.loans.reduce((s, l) => s + l.balanceUsd, 0)
export const annualDebtService = (g: GameState) => g.loans.reduce((s, l) => s + l.annualPaymentUsd, 0)

/** Validate a parsed save. Returns null if it is not a usable save of this version. */
export function parseSave(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null
  const g = { ...(raw as object) } as Omit<Partial<GameState>, 'version'> & { version?: number }
  if (g.version === 2) {
    g.trails = []
    g.lifts = []
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
  }
  return { ok: true, game: { ...g, cashUsd: g.cashUsd - plan.costUsd, trails: [...g.trails, trail] } }
}

export function buildLift(g: GameState, plan: LiftPlan, name?: string): BuildResult {
  if (plan.problems.length) return { ok: false, reason: plan.problems[0] }
  if (plan.costUsd > g.cashUsd) return { ok: false, reason: 'Not enough cash' }
  const id = nextId('l', g.lifts)
  const lift: Lift = {
    id, name: name ?? `Lift ${g.lifts.length + 1}`, type: plan.type, bottom: plan.bottom, top: plan.top,
    lengthM: plan.lengthM, verticalM: plan.verticalM, capacityPph: plan.capacityPph, costUsd: plan.costUsd,
  }
  return { ok: true, game: { ...g, cashUsd: g.cashUsd - plan.costUsd, lifts: [...g.lifts, lift] } }
}

export { planPurchase }
