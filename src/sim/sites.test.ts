import { describe, expect, it } from 'vitest'
import { REGIONS, SITES, aspectSnowRetention, sitesInRegion } from './sites'

describe('site catalogue', () => {
  it('has 5-10 US regions and 3-4 international', () => {
    const us = REGIONS.filter((r) => r.country === 'US').length
    const intl = REGIONS.filter((r) => r.country === 'INTL').length
    expect(us).toBeGreaterThanOrEqual(5)
    expect(us).toBeLessThanOrEqual(10)
    expect(intl).toBeGreaterThanOrEqual(3)
    expect(intl).toBeLessThanOrEqual(4)
  })

  it('has unique ids and every site belongs to a known region', () => {
    const ids = [...REGIONS.map((r) => r.id), ...SITES.map((s) => s.id)]
    expect(new Set(ids).size).toBe(ids.length)
    const regionIds = new Set(REGIONS.map((r) => r.id))
    for (const s of SITES) expect(regionIds.has(s.regionId)).toBe(true)
  })

  it('no region exceeds 10 sites', () => {
    for (const r of REGIONS) expect(sitesInRegion(r.id).length).toBeLessThanOrEqual(10)
  })

  it('trait values are positive', () => {
    for (const s of SITES) {
      expect(s.traits.verticalDropFt).toBeGreaterThan(0)
      expect(s.traits.acres).toBeGreaterThan(0)
      expect(s.traits.avgSnowfallIn).toBeGreaterThan(0)
    }
  })
})

describe('access parcels', () => {
  it('every real-terrain site defines a road-access starter parcel', () => {
    for (const s of SITES.filter((x) => x.terrainId)) expect(s.accessParcel).toMatch(/^r[0-2]c[0-2]$/)
  })
})

describe('aspectSnowRetention', () => {
  it('ranks north above east above south', () => {
    expect(aspectSnowRetention('N')).toBeCloseTo(1)
    expect(aspectSnowRetention('E')).toBeCloseTo(0.5)
    expect(aspectSnowRetention('S')).toBeCloseTo(0)
  })
})
