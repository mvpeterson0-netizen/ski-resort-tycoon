import { lotSpaces } from './liveDay'
import { describe, expect, it } from 'vitest'
import { AMENITIES, AMENITY_TUNING, NO_AMENITIES, amenityEffects, amenityUpkeep, nextAmenityCost } from './amenities'
import { planPurchase } from './economy'
import { assetValue, fixedCosts } from './finance'
import { buyAmenity, buyParcel, newGame } from './game'
import { SEASON, seasonTotals, simulateDay, startSeason, type SeasonInputs } from './season'

const fresh = () => newGame('co-berthoud-pass', planPurchase(1_000_000, 100), 1, 'r1c1')

describe('amenity effects', () => {
  it('start neutral and grow with levels', () => {
    const none = amenityEffects(NO_AMENITIES, false)
    expect(none.foodMult).toBe(1)
    expect(none.appealMult).toBe(1)
    expect(none.extrasPerDayGuestUsd).toBe(0)
    expect(none.parkingCapGuests).toBe(AMENITY_TUNING.baseSpaces * AMENITY_TUNING.guestsPerSpace)
    const full = amenityEffects({ parking: 2, lodge: 2, rentals: 1, school: 1, housing: 1, lights: 0 }, true)
    expect(full.foodMult).toBeGreaterThan(none.foodMult)
    expect(full.appealMult).toBeGreaterThan(1)
    expect(full.extrasPerDayGuestUsd).toBeGreaterThan(0)
    expect(full.parkingCapGuests).toBeGreaterThan(none.parkingCapGuests)
    expect(full.dailyCostUsd).toBeGreaterThan(0)
  })
  it('gives the ski school a bonus with green terrain', () => {
    const a = { ...NO_AMENITIES, school: 1 }
    expect(amenityEffects(a, true).appealMult).toBeGreaterThan(amenityEffects(a, false).appealMult)
  })
})

describe('buying', () => {
  it('buys amenity levels until maxed, counting them as assets and upkeep', () => {
    let g = fresh()
    const r = buyAmenity(g, 'lodge')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    g = r.game
    expect(g.amenities.lodge).toBe(1)
    expect(g.book.capexUsd).toBeGreaterThan(0)
    expect(assetValue(g)).toBe(1_000_000 + AMENITIES.lodge.levels[0].costUsd)
    expect(fixedCosts(g)).toBeGreaterThan(fixedCosts(fresh()))
    expect(amenityUpkeep(g.amenities)).toBeGreaterThan(0)
    const maxed = { ...g, cashUsd: 1e9, amenities: { ...g.amenities, rentals: 3 } }
    expect(nextAmenityCost(maxed.amenities, 'rentals')).toBeNull()
    expect(buyAmenity(maxed, 'rentals').ok).toBe(false)
    expect(buyAmenity({ ...g, cashUsd: 0 }, 'parking').ok).toBe(false)
  })

  it('buys an expansion parcel in the off-season only', () => {
    const g = { ...fresh(), cashUsd: 5_000_000 }
    const r = buyParcel(g, 'r0c1', 1_500_000)
    expect(r.ok && r.game.ownedParcels).toEqual(['r1c1', 'r0c1'])
    expect(r.ok && r.game.landPaidUsd).toBe(g.landPaidUsd + 1_500_000)
    expect(buyParcel(g, 'r1c1', 1).ok).toBe(false)
    expect(buyParcel({ ...g, phase: 'season' }, 'r0c1', 1).ok).toBe(false)
  })
})

describe('reputation and the growth loop', () => {
  const base: SeasonInputs = {
    avgSnowfallIn: 300, driveToMetroMin: 75, trailKm: 6, difficultyKinds: 3, trailCount: 5,
    lifts: [{ type: 'fixedDouble', capacityPph: 1200 }],
  }
  const run = (inp: SeasonInputs, seed = 4) => {
    let s = startSeason(1, seed, inp, 79)
    while (s.day < SEASON.lengthDays) s = simulateDay(s, inp).season
    return seasonTotals(s.days, s)
  }

  it('falls when lifts are overcrowded and rises with short lines', () => {
    const crowded = run({ ...base, trailKm: 30, lifts: [{ type: 'ropeTow', capacityPph: 600 }] })
    const roomy = run({ ...base, lifts: [{ type: 'fixedQuad', capacityPph: 2400 }, { type: 'fixedQuad', capacityPph: 2400 }] })
    expect(crowded.reputation!).toBeLessThan(SEASON.reputation.start)
    expect(roomy.reputation!).toBeGreaterThan(crowded.reputation!)
  })

  it('draws more guests with more lifts and amenities, even with spare capacity', () => {
    const big = [{ type: 'fixedQuad' as const, capacityPph: 20000 }]
    const one = run({ ...base, lifts: big })
    const many = run({ ...base, lifts: [...big, ...Array(5).fill({ type: 'fixedDouble', capacityPph: 1 })] })
    const amen = run({ ...base, lifts: big, amenity: amenityEffects({ parking: 4, lodge: 2, rentals: 1, school: 1, housing: 0, lights: 0 }, true) })
    expect(many.guests).toBeGreaterThan(one.guests)
    expect(amen.guests).toBeGreaterThan(one.guests)
  })

  it('caps guests at parking capacity (cars in the lot at once)', () => {
    const tiny = { ...amenityEffects(NO_AMENITIES, false), parkingCapGuests: 100 }
    let s = startSeason(1, 2, { ...base, amenity: tiny }, 79)
    while (s.day < SEASON.lengthDays) s = simulateDay(s, { ...base, amenity: tiny }).season
    // The lot turns over as people leave, so a mobbed day can see up to ~1.7× its rated guests.
    for (const d of s.days) expect(d.peakOnHill ?? 0).toBeLessThanOrEqual(lotSpaces(100) + 1)
    for (const d of s.days) expect(d.guests).toBeLessThanOrEqual(2 * 100)
    expect(seasonTotals(s.days, s).parkingTurnedAway).toBeGreaterThan(0)
  })
})
