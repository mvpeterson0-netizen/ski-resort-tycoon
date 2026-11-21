import { describe, expect, it } from 'vitest'
import { areAdjacent, aspectFromDeg, buyableParcels, computeParcels, parcelAtCell, parcelLabel } from './parcels'
import type { Terrain } from './terrain'

/** Cone peak in the middle: each outer parcel faces away from the centre. */
function cone(n = 90, cellM = 10): Terrain {
  const elev = new Float32Array(n * n)
  const c = (n - 1) / 2
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) elev[y * n + x] = 2000 - 3 * Math.hypot(x - c, y - c)
  return { width: n, height: n, cellM, elev }
}

describe('computeParcels', () => {
  const ps = computeParcels(cone())

  it('tiles the grid exactly', () => {
    expect(ps).toHaveLength(9)
    const cells = ps.reduce((s, p) => s + (p.x1 - p.x0) * (p.y1 - p.y0), 0)
    expect(cells).toBe(90 * 90)
  })

  it('derives acreage from cell area', () => {
    // 30x30 cells of 10 m = 90,000 m² ≈ 22.2 acres.
    expect(ps[0].acres).toBe(22)
  })

  it('finds aspects facing away from a central peak', () => {
    const at = (col: number, row: number) => ps.find((p) => p.col === col && p.row === row)!
    expect(at(1, 0).aspect).toBe('N')
    expect(at(2, 1).aspect).toBe('E')
    expect(at(1, 2).aspect).toBe('S')
    expect(at(0, 1).aspect).toBe('W')
    expect(at(0, 0).aspect).toBe('NW')
    expect(at(1, 0).northShare).toBeGreaterThan(0.9)
    expect(at(1, 2).northShare).toBeLessThan(0.1)
  })

  it('measures vertical within each parcel', () => {
    for (const p of ps) expect(p.verticalFt).toBeGreaterThan(0)
  })
})

describe('helpers', () => {
  const ps = computeParcels(cone())
  it('maps cells to parcels', () => {
    expect(parcelAtCell(ps, 0, 0)?.id).toBe('r0c0')
    expect(parcelAtCell(ps, 89, 89)?.id).toBe('r2c2')
    expect(parcelAtCell(ps, 90, 0)).toBeUndefined()
  })
  it('knows adjacency (edges, not corners)', () => {
    expect(areAdjacent(ps[0], ps[1])).toBe(true)
    expect(areAdjacent(ps[0], ps[4])).toBe(false)
  })
  it('only lets the owner expand into edge neighbours', () => {
    expect(buyableParcels(ps, ['r1c1']).map((p) => p.id).sort()).toEqual(['r0c1', 'r1c0', 'r1c2', 'r2c1'])
    expect(buyableParcels(ps, ['r0c0']).map((p) => p.id).sort()).toEqual(['r0c1', 'r1c0'])
  })
  it('labels parcels by compass position', () => {
    expect(parcelLabel({ col: 0, row: 0 })).toBe('North-west parcel')
    expect(parcelLabel({ col: 1, row: 1 })).toBe('Centre parcel')
    expect(parcelLabel({ col: 2, row: 1 })).toBe('East parcel')
    expect(parcelLabel({ col: 1, row: 2 })).toBe('South parcel')
  })
  it('converts degrees to compass aspects', () => {
    expect(aspectFromDeg(0)).toBe('N')
    expect(aspectFromDeg(350)).toBe('N')
    expect(aspectFromDeg(-90)).toBe('W')
    expect(aspectFromDeg(135)).toBe('SE')
  })
})
