import { describe, expect, it } from 'vitest'
import { difficultyFor, pctToDeg, slopeClass, slopeClassDepth } from './difficulty'
import { computeParcels } from './parcels'
import type { Terrain } from './terrain'

describe('slopeClass', () => {
  it('classifies by grade with a hazard band', () => {
    expect(slopeClass(pctToDeg(10))).toBe('green')
    expect(slopeClass(pctToDeg(30))).toBe('blue')
    expect(slopeClass(pctToDeg(60))).toBe('black')
    expect(slopeClass(50)).toBe('hazard')
    expect(difficultyFor(50)).toBe('black')
  })
  it('gives depth 0 at the gentle end and 1 at the steep end of a class', () => {
    expect(slopeClassDepth(0)).toBe(0)
    expect(slopeClassDepth(pctToDeg(25) - 1e-9)).toBeCloseTo(1, 3)
    expect(slopeClassDepth(pctToDeg(25))).toBeCloseTo(0, 3)
    expect(slopeClassDepth(90)).toBe(1)
  })
})

describe('parcel terrain mix', () => {
  it('sums to 1 and reflects the terrain', () => {
    // Plane at 30% grade: blue. The outermost row of the map uses a one-sided
    // difference (half the gradient), so edge parcels are only ~95% blue.
    const n = 60
    const elev = new Float32Array(n * n)
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) elev[y * n + x] = 2000 + (n - y) * 10 * 0.3
    const t: Terrain = { width: n, height: n, cellM: 10, elev }
    for (const p of computeParcels(t)) {
      const m = p.terrainMix
      expect(m.green + m.blue + m.black + m.hazard).toBeCloseTo(1)
      expect(m.blue).toBeGreaterThan(0.9)
    }
  })
})
