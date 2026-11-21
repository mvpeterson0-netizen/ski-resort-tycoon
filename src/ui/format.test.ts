import { describe, expect, it } from 'vitest'
import { usd } from './format'

describe('usd', () => {
  it('formats millions, thousands, small and negative amounts', () => {
    expect(usd(2_500_000)).toBe('$2.5M')
    expect(usd(744_000)).toBe('$744k')
    expect(usd(0)).toBe('$0')
    expect(usd(450)).toBe('$450')
    expect(usd(-1_200_000)).toBe('−$1.2M')
  })
})
