import { describe, expect, it } from 'vitest'
import { planPurchase } from './economy'
import { assetValue, fixedCosts } from './finance'
import { buySnowmaking, newGame, seasonInputs, type GameState } from './game'
import { SEASON, seasonTotals, simulateDay, startSeason, type SeasonInputs } from './season'
import { SITES, type Site } from './sites'
import { SNOWMAKING, effectiveBase, maxSnowmakingKm, snowmakingEffects } from './snowmaking'

const site = SITES.find((s) => s.id === 'co-berthoud-pass')!
const base: SeasonInputs = {
  avgSnowfallIn: 140, driveToMetroMin: 75, trailKm: 6, difficultyKinds: 3, trailCount: 5,
  lifts: [{ type: 'fixedQuad', capacityPph: 20000 }],
}
const seeds = Array.from({ length: 60 }, (_, i) => i + 1)

describe('snowmaking effects', () => {
  it('caps coverage by water rights', () => {
    expect(maxSnowmakingKm(10, 'poor')).toBe(2.5)
    expect(maxSnowmakingKm(10, 'fair')).toBe(6)
    expect(maxSnowmakingKm(10, 'good')).toBe(10)
  })
  it('scales coverage by crew and costs more with poor water', () => {
    expect(snowmakingEffects(3, 6, 'fair').coverage).toBeCloseTo(0.5)
    expect(snowmakingEffects(3, 6, 'fair', 0.5).coverage).toBeCloseTo(0.25)
    expect(snowmakingEffects(3, 6, 'poor').runCostUsd).toBeGreaterThan(snowmakingEffects(3, 6, 'good').runCostUsd)
    expect(snowmakingEffects(0, 6, 'good').coverage).toBe(0)
  })
  it('holds covered terrain at the made base', () => {
    expect(effectiveBase(10, 0)).toBe(10)
    expect(effectiveBase(10, 1)).toBe(SNOWMAKING.madeBaseIn)
    expect(effectiveBase(60, 1)).toBe(60)
  })
})

describe('snowmaking in the season', () => {
  const run = (cov: number, seed: number) => {
    const inp = { ...base, snowmaking: snowmakingEffects(cov * base.trailKm, base.trailKm, 'good') }
    let s = startSeason(1, seed, inp, 79)
    while (s.day < SEASON.lengthDays) s = simulateDay(s, inp).season
    return { s, t: seasonTotals(s.days, s) }
  }
  it('opens bad years much earlier', () => {
    const late = seeds.map((seed) => run(0, seed).s.openingDay)
    const made = seeds.map((seed) => run(1, seed).s.openingDay)
    expect(Math.max(...made)).toBeLessThan(Math.max(...late))
    expect(made.reduce((a, b) => a + b, 0)).toBeLessThan(late.reduce((a, b) => a + b, 0) * 0.4)
  })
  it('lifts conditions and guests in thin-snow seasons', () => {
    const avg = (f: (seed: number) => number) => seeds.reduce((t, seed) => t + f(seed), 0) / seeds.length
    expect(avg((seed) => run(1, seed).t.avgConditions)).toBeGreaterThan(avg((seed) => run(0, seed).t.avgConditions))
    expect(avg((seed) => run(1, seed).t.guests)).toBeGreaterThan(avg((seed) => run(0, seed).t.guests))
  })
  it('costs money to run', () => {
    expect(run(1, 3).t.costUsd).toBeGreaterThan(run(0, 3).t.costUsd)
  })
})

describe('buying snowmaking', () => {
  const built = (): GameState => ({
    ...newGame(site.id, planPurchase(1_000_000, 100), 1, 'r1c1'),
    cashUsd: 10_000_000,
    trails: [{ id: 't1', name: 'T', points: [], difficulty: 'blue', lengthM: 4000, verticalM: 300, acres: 30, costUsd: 0 }],
    lifts: [{ id: 'l1', name: 'L', type: 'fixedDouble', bottom: [0, 0], top: [1, 1], lengthM: 1000, verticalM: 250, capacityPph: 1200, costUsd: 0 }],
  })
  it('installs up to the water-rights cap, as an asset with upkeep and a crew', () => {
    const g0 = built()
    const r = buySnowmaking(g0, site, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.game.snowmakingKm).toBe(1)
    expect(r.game.cashUsd).toBe(g0.cashUsd - SNOWMAKING.installPerKmUsd)
    expect(assetValue(r.game)).toBe(assetValue(g0) + SNOWMAKING.installPerKmUsd)
    expect(fixedCosts(r.game)).toBeGreaterThan(fixedCosts(g0))
    expect(seasonInputs(r.game, site).staff!.ratios.snowmakers).toBe(1)
    // Berthoud's water rights are "fair" (placeholder): 60% of 4 km = 2.4 km.
    const capped = buySnowmaking(r.game, site, 10)
    expect(capped.ok && capped.game.snowmakingKm).toBe(maxSnowmakingKm(4, site.traits.waterRights))
    expect(buySnowmaking(capped.ok ? capped.game : r.game, site, 1).ok).toBe(false)
  })
  it('needs trails first', () => {
    const noTrails: Site = site
    expect(buySnowmaking({ ...built(), trails: [] }, noTrails, 1).ok).toBe(false)
  })
})
