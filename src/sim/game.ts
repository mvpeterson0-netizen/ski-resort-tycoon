/**
 * Game state: the single serialisable object the UI saves and loads.
 * Pure data and pure functions; storage itself lives in the UI layer.
 */
import { ECON, planPurchase, type PurchasePlan } from './economy'

export const GAME_STATE_VERSION = 1

export interface Loan {
  id: string
  name: string
  ratePct: number
  termYears: number
  originalUsd: number
  balanceUsd: number
  annualPaymentUsd: number
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
  loans: Loan[]
}

export function newGame(siteId: string, plan: PurchasePlan, seed: number): GameState {
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
    loans,
  }
}

export const totalDebt = (g: GameState) => g.loans.reduce((s, l) => s + l.balanceUsd, 0)
export const annualDebtService = (g: GameState) => g.loans.reduce((s, l) => s + l.annualPaymentUsd, 0)

/** Validate a parsed save. Returns null if it is not a usable save of this version. */
export function parseSave(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Partial<GameState>
  if (g.version !== GAME_STATE_VERSION) return null
  if (typeof g.siteId !== 'string' || typeof g.cashUsd !== 'number' || !Array.isArray(g.loans)) return null
  return g as GameState
}

export { planPurchase }
