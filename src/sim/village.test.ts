import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { computeParcels } from './parcels'
import { decodeDem, type Terrain } from './terrain'
import { scoreBaseSite, suggestBaseSites, VILLAGE } from './village'

/** Flat valley floor (west half) rising into a slope (east half). */
function valley(n = 120, cellM = 10): Terrain {
  const elev = new Float32Array(n * n)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) elev[y * n + x] = 2000 + Math.max(0, x - 60) * 4
  return { width: n, height: n, cellM, elev }
}

describe('base village siting', () => {
  it('rejects steep ground and accepts flat ground', () => {
    const t = valley()
    expect(scoreBaseSite(t, 100, 60)).toBeNull() // 4 m per 10 m ≈ 22° slope
    expect(scoreBaseSite(t, 30, 60)).not.toBeNull()
  })

  it('prefers flat spots with mountain above them', () => {
    const t = valley()
    const [p] = computeParcels(t, 1)
    const best = suggestBaseSites(t, p, 3)
    expect(best.length).toBeGreaterThan(0)
    // Best spot sits on the flat floor, near the foot of the slope.
    expect(best[0].x).toBeLessThan(60)
    expect(best[0].x).toBeGreaterThan(35)
    expect(best[0].verticalAboveM).toBeGreaterThan(100)
  })

  it('spreads suggestions apart', () => {
    const t = valley()
    const [p] = computeParcels(t, 1)
    const s = suggestBaseSites(t, p, 3)
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      expect(Math.hypot(s[i].x - s[j].x, s[i].y - s[j].y) * t.cellM).toBeGreaterThanOrEqual(VILLAGE.minSeparationM)
    }
  })

  it('finds buildable spots on the Berthoud Pass access parcel', () => {
    const meta = JSON.parse(readFileSync(new URL('../../public/sites/co-berthoud-pass.json', import.meta.url), 'utf8'))
    const buf = readFileSync(new URL('../../public/sites/co-berthoud-pass.dem.bin', import.meta.url))
    const t = decodeDem(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta.width, meta.height, meta.cellM)
    const p = computeParcels(t).find((q) => q.id === 'r1c1')!
    const s = suggestBaseSites(t, p, 3)
    expect(s.length).toBeGreaterThan(0)
    for (const b of s) {
      expect(b.meanSlopeDeg).toBeLessThanOrEqual(VILLAGE.maxMeanSlopeDeg)
      expect(b.x).toBeGreaterThanOrEqual(p.x0)
      expect(b.x).toBeLessThan(p.x1)
    }
    console.log('Berthoud base suggestions', s.map((b) => ({ ...b, meanSlopeDeg: +b.meanSlopeDeg.toFixed(1) })))
  })
})
