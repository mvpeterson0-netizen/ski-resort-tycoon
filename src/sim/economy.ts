/**
 * Land pricing and loan maths. Pure functions.
 *
 * Every coefficient in ECON is a PLACEHOLDER chosen for common-sense direction and
 * playable magnitudes, not taken from real market data. Tune here, in one place.
 */
import type { PermitDifficulty, Rating, Region, Site } from './sites'
import { aspectSnowRetention } from './sites'

export const ECON = {
  /** PLACEHOLDER: owner's starting cash for a new game. */
  startingCashUsd: 8_000_000,
  landLoan: {
    /** PLACEHOLDER: annual interest rate. */
    ratePct: 7.5,
    termYears: 20,
    /** PLACEHOLDER: lenders require at least this share as down payment. */
    minDownPct: 25,
  },
  waterRights: { poor: 0.85, fair: 1.0, good: 1.2 } satisfies Record<Rating, number>,
  // Harder permitting = riskier to develop = lower price.
  permits: { easy: 1.1, moderate: 0.95, hard: 0.8 } satisfies Record<PermitDifficulty, number>,
} as const

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export interface PriceFactor {
  label: string
  /** Multiplier applied to the base price. */
  factor: number
  reason: string
}

export interface LandPrice {
  baseUsd: number
  factors: PriceFactor[]
  totalUsd: number
}

/**
 * Price = acres × regional base $/acre × product of site factors.
 * Each factor is bounded so no single trait dominates.
 */
export function landPrice(site: Site, region: Region): LandPrice {
  const t = site.traits
  const baseUsd = t.acres * region.baseLandUsdPerAcre
  const factors: PriceFactor[] = [
    {
      label: 'Metro access',
      factor: clamp(1.5 - t.driveToMetroMin / 300, 0.6, 1.4),
      reason: 'Closer to a city means more buyers and more skiers',
    },
    {
      label: 'Interstate access',
      factor: clamp(1.15 - t.driveToInterstateMin / 200, 0.8, 1.15),
      reason: 'Easy road access is worth more',
    },
    {
      label: 'Vertical drop',
      factor: 0.8 + 0.4 * clamp(t.verticalDropFt / 3000, 0, 1),
      reason: 'More vertical makes better ski terrain',
    },
    {
      label: 'Snowfall',
      factor: 0.8 + 0.4 * clamp(t.avgSnowfallIn / 400, 0, 1),
      reason: 'Reliable natural snow is valuable',
    },
    {
      label: 'Slope aspect',
      factor: 0.95 + 0.1 * aspectSnowRetention(t.aspect),
      reason: 'North-facing slopes hold snow longer',
    },
    {
      label: 'Water rights',
      factor: ECON.waterRights[t.waterRights],
      reason: 'Water for snowmaking adds value',
    },
    {
      label: 'Permitting',
      factor: ECON.permits[t.permitDifficulty],
      reason: 'Hard permits make development risky',
    },
  ]
  const product = factors.reduce((p, f) => p * f.factor, 1)
  // Round to the nearest $10k like a listing price.
  const totalUsd = Math.round((baseUsd * product) / 10_000) * 10_000
  return { baseUsd, factors, totalUsd }
}

/** Level annual payment for a fully amortising loan. */
export function annualPayment(principal: number, ratePct: number, termYears: number): number {
  if (principal <= 0) return 0
  const r = ratePct / 100
  if (r === 0) return principal / termYears
  return (principal * r) / (1 - Math.pow(1 + r, -termYears))
}

export interface PurchasePlan {
  priceUsd: number
  downPct: number
  downUsd: number
  loanUsd: number
  annualPaymentUsd: number
  cashAfterUsd: number
  /** Why the plan is not allowed, if it is not. */
  problem?: string
}

export function planPurchase(priceUsd: number, downPct: number, cashUsd = ECON.startingCashUsd): PurchasePlan {
  const { ratePct, termYears, minDownPct } = ECON.landLoan
  const pct = clamp(downPct, minDownPct, 100)
  const downUsd = Math.round((priceUsd * pct) / 100)
  const loanUsd = priceUsd - downUsd
  const plan: PurchasePlan = {
    priceUsd,
    downPct: pct,
    downUsd,
    loanUsd,
    annualPaymentUsd: Math.round(annualPayment(loanUsd, ratePct, termYears)),
    cashAfterUsd: cashUsd - downUsd,
  }
  if (plan.cashAfterUsd < 0) plan.problem = 'Not enough cash for this down payment'
  return plan
}
