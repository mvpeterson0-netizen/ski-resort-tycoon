import { describe, expect, it } from 'vitest'
import { ECON, annualPayment, landPrice, planPurchase } from './economy'
import { newGame, parseSave, totalDebt } from './game'
import { REGIONS, SITES, regionById, type Site } from './sites'

const region = REGIONS[0]
const base: Site = {
  id: 'x', regionId: region.id, name: 'X', placeholder: true,
  traits: { verticalDropFt: 1500, aspect: 'E', avgSnowfallIn: 200, acres: 1000,
    driveToInterstateMin: 30, nearestMetro: 'M', driveToMetroMin: 120,
    waterRights: 'fair', permitDifficulty: 'moderate', adjacentParcels: 1 },
}
const withTraits = (t: Partial<Site['traits']>): Site => ({ ...base, traits: { ...base.traits, ...t } })
const price = (s: Site) => landPrice(s, region).totalUsd

describe('landPrice', () => {
  it('scales with acreage', () => {
    expect(price(withTraits({ acres: 2000 }))).toBeGreaterThan(price(base) * 1.9)
  })
  it('responds to common-sense factors in the right direction', () => {
    expect(price(withTraits({ driveToMetroMin: 60 }))).toBeGreaterThan(price(base))
    expect(price(withTraits({ driveToInterstateMin: 5 }))).toBeGreaterThan(price(base))
    expect(price(withTraits({ verticalDropFt: 2800 }))).toBeGreaterThan(price(base))
    expect(price(withTraits({ avgSnowfallIn: 350 }))).toBeGreaterThan(price(base))
    expect(price(withTraits({ aspect: 'N' }))).toBeGreaterThan(price(withTraits({ aspect: 'S' })))
    expect(price(withTraits({ waterRights: 'good' }))).toBeGreaterThan(price(base))
    expect(price(withTraits({ permitDifficulty: 'hard' }))).toBeLessThan(price(base))
  })
  it('keeps every factor within a sane band', () => {
    for (const s of SITES) {
      for (const f of landPrice(s, regionById(s.regionId)!).factors) {
        expect(f.factor).toBeGreaterThanOrEqual(0.6)
        expect(f.factor).toBeLessThanOrEqual(1.4)
      }
    }
  })
  it('makes every catalogue site affordable with the minimum down payment', () => {
    for (const s of SITES) {
      const p = landPrice(s, regionById(s.regionId)!).totalUsd
      expect(planPurchase(p, ECON.landLoan.minDownPct).problem).toBeUndefined()
    }
  })
})

describe('loans', () => {
  it('computes a standard amortising payment', () => {
    // $100k at 10% over 10 years ≈ $16,275/yr (textbook annuity formula).
    expect(annualPayment(100_000, 10, 10)).toBeCloseTo(16_274.54, 1)
    expect(annualPayment(100_000, 0, 10)).toBe(10_000)
    expect(annualPayment(0, 7, 20)).toBe(0)
  })
  it('enforces the minimum down payment and cash limit', () => {
    expect(planPurchase(1_000_000, 0).downPct).toBe(ECON.landLoan.minDownPct)
    expect(planPurchase(100_000_000, 100).problem).toBeDefined()
  })
})

describe('newGame', () => {
  it('records cash and the land loan', () => {
    const plan = planPurchase(4_000_000, 50)
    const g = newGame('x', plan, 123)
    expect(g.cashUsd).toBe(ECON.startingCashUsd - 2_000_000)
    expect(totalDebt(g)).toBe(2_000_000)
    expect(g.year).toBe(1)
  })
  it('has no loan when paying cash', () => {
    expect(newGame('x', planPurchase(1_000_000, 100), 1).loans).toEqual([])
  })
  it('round-trips through JSON and rejects junk', () => {
    const g = newGame('x', planPurchase(1_000_000, 40), 9)
    expect(parseSave(JSON.parse(JSON.stringify(g)))).toEqual(g)
    expect(parseSave({ version: 999 })).toBeNull()
    expect(parseSave('nope')).toBeNull()
  })
})
