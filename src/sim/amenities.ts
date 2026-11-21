/**
 * Base-area amenities: the player's "add-on" decisions. Each has levels with a build
 * cost, a daily running cost while open, and effects on guests and revenue.
 *
 * Every number here is a PLACEHOLDER for gameplay balance, not sourced data.
 */

export type AmenityId = 'parking' | 'lodge' | 'rentals' | 'school'

export interface AmenityLevel {
  costUsd: number
  /** Extra daily running cost while the resort is open. */
  dailyCostUsd: number
}

export interface AmenitySpec {
  id: AmenityId
  name: string
  blurb: string
  /** Level 1..n (level 0 = not built / basic). */
  levels: AmenityLevel[]
}

export const AMENITIES: Record<AmenityId, AmenitySpec> = {
  parking: {
    id: 'parking', name: 'Parking', blurb: 'More spaces let more guests come on busy days.',
    levels: [
      { costUsd: 350_000, dailyCostUsd: 300 },
      { costUsd: 450_000, dailyCostUsd: 400 },
      { costUsd: 600_000, dailyCostUsd: 500 },
      { costUsd: 800_000, dailyCostUsd: 600 },
    ],
  },
  lodge: {
    id: 'lodge', name: 'Day lodge', blurb: 'Guests spend more on food and like the resort more.',
    levels: [
      { costUsd: 1_800_000, dailyCostUsd: 2500 },
      { costUsd: 3_200_000, dailyCostUsd: 4000 },
    ],
  },
  rentals: {
    id: 'rentals', name: 'Rental shop', blurb: 'Rental income, and beginners come more often.',
    levels: [{ costUsd: 700_000, dailyCostUsd: 900 }],
  },
  school: {
    id: 'school', name: 'Ski school', blurb: 'Lesson income, and families choose you. Best with green terrain.',
    levels: [{ costUsd: 600_000, dailyCostUsd: 1600 }],
  },
}

export type AmenityLevels = Record<AmenityId, number>
export const NO_AMENITIES: AmenityLevels = { parking: 0, lodge: 0, rentals: 0, school: 0 }

export const AMENITY_TUNING = {
  /** Spaces in the starter gravel lot, and per parking level. */
  baseSpaces: 500,
  spacesPerLevel: 400,
  guestsPerSpace: 2.5,
  /** Food spend multiplier by lodge level (snack hut, lodge, big lodge). */
  lodgeFoodMult: [1.0, 1.35, 1.6],
  lodgeAppealPerLevel: 0.04,
  rentalSpendPerDayGuestUsd: 9,
  rentalsAppeal: 0.02,
  lessonSpendPerDayGuestUsd: 7,
  schoolAppeal: 0.03,
  /** Extra school appeal when the mountain has green terrain. */
  schoolGreenBonus: 0.02,
  /** Yearly upkeep as a share of build cost (goes into fixed costs). */
  upkeepShare: 0.03,
} as const

/** What the base area does to a season. */
export interface AmenityEffects {
  /** Max guests per day the parking can serve (Infinity = not modelled). */
  parkingCapGuests: number
  foodMult: number
  /** Rentals + lessons spend per day-ticket guest. */
  extrasPerDayGuestUsd: number
  appealMult: number
  dailyCostUsd: number
}

export const NEUTRAL_EFFECTS: AmenityEffects = {
  parkingCapGuests: Infinity, foodMult: 1, extrasPerDayGuestUsd: 0, appealMult: 1, dailyCostUsd: 0,
}

export function amenityEffects(a: AmenityLevels, hasGreenTerrain: boolean): AmenityEffects {
  const T = AMENITY_TUNING
  let daily = 0
  for (const id of Object.keys(AMENITIES) as AmenityId[]) {
    for (let l = 0; l < a[id]; l++) daily += AMENITIES[id].levels[l].dailyCostUsd
  }
  const appeal = 1 + a.lodge * T.lodgeAppealPerLevel + a.rentals * T.rentalsAppeal
    + a.school * (T.schoolAppeal + (hasGreenTerrain ? T.schoolGreenBonus : 0))
  return {
    parkingCapGuests: Math.round((T.baseSpaces + a.parking * T.spacesPerLevel) * T.guestsPerSpace),
    foodMult: T.lodgeFoodMult[Math.min(a.lodge, T.lodgeFoodMult.length - 1)],
    extrasPerDayGuestUsd: a.rentals * T.rentalSpendPerDayGuestUsd + a.school * T.lessonSpendPerDayGuestUsd,
    appealMult: appeal,
    dailyCostUsd: daily,
  }
}

/** Cost of the next level, or null if maxed. */
export function nextAmenityCost(a: AmenityLevels, id: AmenityId): number | null {
  const lvl = AMENITIES[id].levels[a[id]]
  return lvl ? lvl.costUsd : null
}

/** Total build cost spent on amenities (book value). */
export function amenityBookValue(a: AmenityLevels): number {
  let v = 0
  for (const id of Object.keys(AMENITIES) as AmenityId[]) {
    for (let l = 0; l < a[id]; l++) v += AMENITIES[id].levels[l].costUsd
  }
  return v
}

export const amenityUpkeep = (a: AmenityLevels) => Math.round(amenityBookValue(a) * AMENITY_TUNING.upkeepShare)
