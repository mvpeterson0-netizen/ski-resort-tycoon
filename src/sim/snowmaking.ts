/**
 * Snowmaking: pipes and guns covering part of the trail network.
 *
 * Effects: a poor snow year opens much less late, and covered terrain keeps a groomed
 * base that lifts the conditions score when natural snow is thin. Costs: install per km,
 * a daily running cost (energy, water) on days the system runs, yearly upkeep, and a
 * snowmaking crew. Water rights cap how much terrain can be covered.
 *
 * Every number here is a PLACEHOLDER for gameplay balance, not sourced data.
 */
import type { Rating } from './sites'

export const SNOWMAKING = {
  installPerKmUsd: 450_000,
  /** Energy and water per covered km on a day the system runs. */
  runPerKmDayUsd: 1_400,
  /** Max share of trail km that can be covered, by water rights. */
  maxShareByWater: { poor: 0.25, fair: 0.6, good: 1.0 } satisfies Record<Rating, number>,
  waterCostMult: { poor: 1.3, fair: 1.0, good: 0.9 } satisfies Record<Rating, number>,
  /** Full coverage removes this share of a poor year's opening delay. */
  openingDelayCut: 0.85,
  /** Covered terrain is kept at least this deep (groomed made snow). */
  madeBaseIn: 40,
  /** The system runs before opening, for this many days after, and whenever base is thin. */
  runDaysAfterOpening: 14,
  upkeepShare: 0.03,
} as const

export interface SnowmakingEffects {
  /** Share of trails covered, after crew shortages (0–1). */
  coverage: number
  /** Daily running cost on a day the system runs. */
  runCostUsd: number
}

export const NO_SNOWMAKING: SnowmakingEffects = { coverage: 0, runCostUsd: 0 }

export function maxSnowmakingKm(trailKm: number, water: Rating): number {
  return Math.floor(trailKm * SNOWMAKING.maxShareByWater[water] * 10) / 10
}

export function snowmakingEffects(km: number, trailKm: number, water: Rating, crewRatio = 1): SnowmakingEffects {
  if (km <= 0 || trailKm <= 0) return NO_SNOWMAKING
  return {
    coverage: Math.min(1, km / trailKm) * Math.max(0, Math.min(1, crewRatio)),
    runCostUsd: Math.round(km * SNOWMAKING.runPerKmDayUsd * SNOWMAKING.waterCostMult[water]),
  }
}

/** Base depth that counts for conditions: covered terrain is held at the made base. */
export function effectiveBase(naturalBaseIn: number, coverage: number): number {
  return naturalBaseIn + coverage * Math.max(0, SNOWMAKING.madeBaseIn - naturalBaseIn)
}

export const snowmakingBookValue = (km: number) => Math.round(km * SNOWMAKING.installPerKmUsd)
export const snowmakingUpkeep = (km: number) => Math.round(snowmakingBookValue(km) * SNOWMAKING.upkeepShare)
