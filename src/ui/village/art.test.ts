import { describe, expect, it } from 'vitest'
import { parkedCars } from './art'

describe('parked cars', () => {
  it('draws exactly the share of spaces taken, nearest lot first', () => {
    expect(parkedCars(1, 0).size).toBe(0)
    expect(parkedCars(1, 0.5).size).toBe(24)
    expect(parkedCars(1, 1).size).toBe(48)
    const two = parkedCars(2, 0.75)
    expect(two.size).toBe(72)
    expect([...two].filter((k) => k.startsWith('0:')).length).toBe(48)
  })
  it('keeps parked cars in place as the lot fills', () => {
    const a = parkedCars(2, 0.3), b = parkedCars(2, 0.6)
    expect([...a].every((k) => b.has(k))).toBe(true)
  })
})
