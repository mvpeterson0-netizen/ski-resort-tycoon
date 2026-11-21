import { describe, expect, it } from 'vitest'
import { contourSegments, decodeDem, elevAt, hillshade, slopeDeg, type Terrain } from './terrain'

/** Plane rising toward the south at `rise` metres per cell. */
function plane(w: number, h: number, rise: number, cellM = 10): Terrain {
  const elev = new Float32Array(w * h)
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) elev[r * w + c] = 1000 + r * rise
  return { width: w, height: h, cellM, elev }
}

describe('decodeDem', () => {
  it('decodes uint16 decimetres', () => {
    const u = new Uint16Array([30000, 30015, 0, 65535])
    const t = decodeDem(u.buffer, 2, 2, 10)
    expect(Array.from(t.elev)).toEqual([3000, 3001.5, 0, 6553.5])
  })
  it('rejects wrong sizes', () => {
    expect(() => decodeDem(new ArrayBuffer(6), 2, 2, 10)).toThrow()
  })
})

describe('slope and elevation', () => {
  it('measures a 45 degree plane', () => {
    expect(slopeDeg(plane(5, 5, 10), 2, 2)).toBeCloseTo(45)
  })
  it('measures flat ground as 0', () => {
    expect(slopeDeg(plane(5, 5, 0), 2, 2)).toBeCloseTo(0)
  })
  it('interpolates bilinearly', () => {
    expect(elevAt(plane(5, 5, 10), 1, 1.5)).toBeCloseTo(1015)
  })
})

describe('hillshade', () => {
  it('lights a north-facing slope less than a south-facing one with sun from the south', () => {
    // Rising toward the south means the slope faces north.
    const northFacing = hillshade(plane(5, 5, 5), 180, 30)[12]
    const southFacing = hillshade(plane(5, 5, -5), 180, 30)[12]
    expect(northFacing).toBeLessThan(southFacing)
  })
  it('is in [0, 1]', () => {
    for (const v of hillshade(plane(6, 6, 20))) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('contourSegments', () => {
  it('draws a horizontal contour across a south-rising plane', () => {
    const segs = contourSegments(plane(4, 4, 10), 1015)
    expect(segs.length).toBe(3) // one per column of cells
    for (const [, y1, , y2] of segs) {
      expect(y1).toBeCloseTo(1.5)
      expect(y2).toBeCloseTo(1.5)
    }
  })
  it('draws nothing outside the elevation range', () => {
    expect(contourSegments(plane(4, 4, 10), 5000)).toEqual([])
  })
})
