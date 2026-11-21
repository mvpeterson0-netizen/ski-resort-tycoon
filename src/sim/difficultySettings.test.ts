import { describe, expect, it } from 'vitest'
import { financeModifiers, snowModifiers } from './difficultySettings'
import { SEASON, seasonTotals, simulateDay, startSeason, type SeasonInputs } from './season'

const inp: SeasonInputs = {
  avgSnowfallIn: 250, driveToMetroMin: 90, trailKm: 3, difficultyKinds: 2, trailCount: 3,
  lifts: [{ type: 'fixedQuad', capacityPph: 20000 }],
}
const season = (snow: number, finance: number, seed: number) => {
  let s = startSeason(1, seed, { ...inp, snowDifficulty: snow, financeDifficulty: finance }, 79)
  while (s.day < SEASON.lengthDays) s = simulateDay(s, { ...inp, snowDifficulty: snow, financeDifficulty: finance }).season
  return s
}
const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
const avg = (f: (seed: number) => number) => seeds.reduce((t, s) => t + f(s), 0) / seeds.length

describe('difficulty modifiers', () => {
  it('normal reproduces the base tuning', () => {
    expect(snowModifiers(0.5)).toEqual({ yearFactor: [0.55, 1.45], warmChance: 1, maxOpeningDelayDays: 24 })
    expect(financeModifiers(0.5)).toEqual({ costs: 1, demand: 1 })
  })
  it('gets monotonically harder', () => {
    expect(snowModifiers(1).yearFactor[0]).toBeLessThan(snowModifiers(0).yearFactor[0])
    expect(snowModifiers(1).warmChance).toBeGreaterThan(snowModifiers(0).warmChance)
    expect(financeModifiers(1).costs).toBeGreaterThan(financeModifiers(0).costs)
    expect(financeModifiers(1).demand).toBeLessThan(financeModifiers(0).demand)
  })
})

describe('difficulty in the season sim', () => {
  it('harder snow means fewer open days on average', () => {
    const open = (snow: number) => avg((seed) => seasonTotals(season(snow, 0.5, seed).days).openDays)
    expect(open(1)).toBeLessThan(open(0))
  })
  it('harder finances mean less profit on average', () => {
    const net = (fin: number) => avg((seed) => seasonTotals(season(0.5, fin, seed).days).netUsd)
    expect(net(1)).toBeLessThan(net(0.5))
    expect(net(0.5)).toBeLessThan(net(0))
  })
})
