import { describe, expect, it } from 'vitest'
import { newGame } from './game'
import { planPurchase } from './economy'
import { PRICING, clampPrice, dayKind, newCalendar, priceForDay, resolvedPrices, setDayOps, setKindPrice } from './pricing'
import { MAX_DEMAND_MULT, PROMOS, bookPromo, cancelPromo, promoEffects, promoEnd, promoResults, promoStatus } from './promos'
import { seasonDate } from './season'

describe('price calendar', () => {
  it('classifies days: Saturday and Sunday are weekends, holidays win', () => {
    expect(dayKind(new Date(Date.UTC(2026, 11, 1)))).toBe('weekday') // Tue Dec 1
    expect(dayKind(new Date(Date.UTC(2026, 11, 5)))).toBe('weekend') // Sat
    expect(dayKind(new Date(Date.UTC(2026, 11, 6)))).toBe('weekend') // Sun
    expect(dayKind(new Date(Date.UTC(2026, 11, 25)))).toBe('holiday') // Christmas (a Friday)
    expect(dayKind(new Date(Date.UTC(2027, 0, 17)))).toBe('holiday') // MLK weekend Sunday
    expect(dayKind(new Date(Date.UTC(2027, 0, 20)))).toBe('weekday')
  })

  it('defaults weekend and holiday prices to a markup on the weekday price', () => {
    const p = resolvedPrices(80, newCalendar())
    expect(p.weekday).toBe(80)
    expect(p.weekend).toBe(90) // 80 × 1.15 = 92 → nearest $5
    expect(p.holiday).toBe(105) // 80 × 1.3 = 104 → nearest $5
    expect(p.night).toBe(PRICING.nightPriceUsd)
    // Defaults follow the weekday price until the player sets them.
    expect(resolvedPrices(100, newCalendar()).weekend).toBe(115)
    expect(resolvedPrices(100, setKindPrice(newCalendar(), 'weekend', 120)).weekend).toBe(120)
    expect(resolvedPrices(100, setKindPrice(setKindPrice(newCalendar(), 'weekend', 120), 'weekend', null)).weekend).toBe(115)
  })

  it('prices a season day by its type, and a date override wins', () => {
    let cal = newCalendar()
    // Season day 0 = Dec 1 2026 (Tue); day 4 = Sat Dec 5; day 24 = Dec 25.
    expect(priceForDay(80, cal, 1, 0)).toBe(80)
    expect(priceForDay(80, cal, 1, 4)).toBe(90)
    expect(priceForDay(80, cal, 1, 24)).toBe(105)
    cal = setDayOps(cal, 4, { price: 130 })
    expect(priceForDay(80, cal, 1, 4)).toBe(130)
    expect(priceForDay(80, cal, 1, 5)).toBe(90)
    expect(seasonDate(1, 4).getUTCDay()).toBe(6)
  })

  it('keeps prices in range and removes empty plans', () => {
    expect(clampPrice(3)).toBe(PRICING.minUsd)
    expect(clampPrice(999)).toBe(PRICING.maxUsd)
    let cal = setDayOps(newCalendar(), 3, { night: true, overtime: true })
    expect(cal.ops[3]).toEqual({ night: true, overtime: true })
    cal = setDayOps(cal, 3, { night: false, overtime: false })
    expect(cal.ops[3]).toBeUndefined()
    cal = setDayOps(setDayOps(newCalendar(), 5, { snowPush: true }), 5, null)
    expect(cal.ops).toEqual({})
  })

  it('starts every new game with defaults and no campaigns', () => {
    const g = newGame('x', planPurchase(1_000_000, 100), 1)
    expect(g.calendar).toEqual(newCalendar())
    expect(g.promos).toEqual([])
  })
})

describe('promotions', () => {
  it('needs lead time and refuses overlapping campaigns of one kind', () => {
    const early = bookPromo([], 'radio', 1, 0)
    expect(early.ok).toBe(false) // radio needs 2 days
    const ok = bookPromo([], 'radio', 2, 0)
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(bookPromo(ok.promos, 'radio', 5, 0).ok).toBe(false) // overlaps days 2–8
    expect(bookPromo(ok.promos, 'radio', 9, 0).ok).toBe(true)
    expect(bookPromo(ok.promos, 'social', 2, 0).ok).toBe(true) // different kind
  })

  it('applies demand, visitor and price effects only inside the campaign window', () => {
    const r = bookPromo([], 'twoForOne', 10, 0)
    if (!r.ok) throw new Error('booking failed')
    const [p] = r.promos
    expect(promoEnd(p)).toBe(23)
    const wkday = promoEffects(r.promos, 12, 2)
    expect(wkday.dayDemandMult).toBe(PROMOS.twoForOne.dayDemandMult)
    expect(wkday.priceMult).toBe(PROMOS.twoForOne.priceMult)
    // Weekdays only: no effect on a Saturday.
    expect(promoEffects(r.promos, 13, 6).dayDemandMult).toBe(1)
    expect(promoEffects(r.promos, 9, 2).dayDemandMult).toBe(1)
    expect(promoEffects(r.promos, 24, 2).dayDemandMult).toBe(1)
    // Cost is due on the first day only.
    expect(promoEffects(r.promos, 10, 2).marketingUsd).toBe(PROMOS.twoForOne.costUsd)
    expect(promoEffects(r.promos, 11, 3).marketingUsd).toBe(0)
  })

  it('stacks campaigns up to a cap, and the travel partner only lifts visitors', () => {
    let promos = [] as ReturnType<typeof bookPromo> extends infer R ? (R extends { ok: true; promos: infer P } ? P : never) : never
    for (const k of ['radio', 'social', 'twoForOne', 'powderAlert'] as const) {
      const r = bookPromo(promos, k, 5, 0)
      if (r.ok) promos = r.promos
    }
    expect(promoEffects(promos, 5, 2).dayDemandMult).toBe(MAX_DEMAND_MULT)
    const partner = bookPromo([], 'partner', 5, 0)
    if (!partner.ok) throw new Error('booking failed')
    const e = promoEffects(partner.promos, 6, 6)
    expect(e.visitorMult).toBe(PROMOS.partner.visitorMult)
    expect(e.dayDemandMult).toBe(1)
  })

  it('cancels only campaigns that have not started', () => {
    const r = bookPromo([], 'social', 5, 0)
    if (!r.ok) throw new Error('booking failed')
    expect(cancelPromo(r.promos, 'p1', 2)).toHaveLength(0)
    expect(cancelPromo(r.promos, 'p1', 5)).toHaveLength(1)
  })
})

describe('campaign status and results', () => {
  const social = (startDay: number) => {
    const r = bookPromo([], 'social', startDay, 0)
    if (!r.ok) throw new Error(r.reason)
    return r.promos[0]
  }

  it('is scheduled before it starts, running through its last day, then completed', () => {
    const p = social(5) // days 5–9
    expect(promoStatus(p, 3)).toBe('scheduled')
    expect(promoStatus(p, 5)).toBe('running')
    expect(promoStatus(p, 9)).toBe('running') // the last day has not been played yet
    expect(promoStatus(p, 10)).toBe('completed')
  })

  it('adds up what a campaign did from each played day, and the cost on its first day', () => {
    const p = social(5)
    const day = (d: number, extra: number, net: number) => ({ day: d, impact: { promos: [{ kind: 'social' as const, extraGuests: extra, extraRevenueUsd: extra * 90, netBeforeCostUsd: net }] } })
    const r = promoResults(p, [day(4, 99, 999), day(5, 40, 3000), day(6, 50, 3800), day(7, 30, 2200), { day: 8 }, day(10, 77, 777)])
    expect(r.daysPlayed).toBe(4) // days 5–8; day 4 and 10 are outside the campaign
    expect(r.daysTotal).toBe(5)
    expect(r.daysWithoutResults).toBe(1)
    expect(r.extraGuests).toBe(120)
    expect(r.extraRevenueUsd).toBe(10_800)
    expect(r.netBeforeCostUsd).toBe(9000)
    expect(r.costUsd).toBe(PROMOS.social.costUsd)
    expect(r.netUsd).toBe(9000 - PROMOS.social.costUsd)
    expect(r.perDay.map((x) => x.day)).toEqual([5, 6, 7])
  })

  it('charges nothing until the first day has been played, and has empty results before then', () => {
    const p = social(5)
    const r = promoResults(p, [])
    expect(r.costUsd).toBe(0)
    expect(r.extraGuests).toBe(0)
    expect(r.netUsd).toBe(0)
  })
})
