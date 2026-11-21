import { describe, expect, it } from 'vitest'
import { createRng } from './rng'

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next())
  })

  it('differs across seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next())
  })

  it('stays in range', () => {
    const r = createRng(7)
    for (let i = 0; i < 1000; i++) {
      const x = r.next()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      const n = r.int(3, 5)
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThanOrEqual(5)
    }
  })

  it('can resume from saved state', () => {
    const a = createRng(99)
    a.next(); a.next()
    const resumed = createRng(a.state())
    expect(resumed.next()).toBe(a.next())
  })
})
