import { AMENITY_TUNING, type AmenityId } from '../sim'

/** What the current level of each amenity does, in plain words. */
export function effectLine(id: AmenityId, level: number): string {
  const T = AMENITY_TUNING
  switch (id) {
    case 'parking': {
      const spaces = T.baseSpaces + level * T.spacesPerLevel
      return `${spaces.toLocaleString()} spaces · up to ${Math.round(spaces * T.guestsPerSpace).toLocaleString()} guests a day`
    }
    case 'lodge':
      return level === 0 ? 'Warming hut only' : `Food spend ×${T.lodgeFoodMult[level]} · appeal +${Math.round(level * T.lodgeAppealPerLevel * 100)}%`
    case 'rentals':
      return level === 0 ? 'Not built' : `+$${T.rentalSpendPerDayGuestUsd[level]} per day-ticket guest · appeal +${Math.round(level * T.rentalsAppeal * 100)}%`
    case 'school':
      return level === 0 ? 'Not built' : `+$${T.lessonSpendPerDayGuestUsd[level]} per day-ticket guest · families +${Math.round(level * T.schoolAppeal * 100)}%`
    case 'housing':
      return level === 0 ? 'No beds: local hires only' : `${level * T.bedsPerHousingLevel} beds for staff`
  }
}

