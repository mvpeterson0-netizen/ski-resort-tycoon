import { describe, expect, it } from 'vitest'
import { ECON, planPurchase } from './economy'
import {
  FIN, assetValue, closeYear, creditLimit, drawCredit, ensureLiquidity, repayCredit, reportCashCheck,
  takeTermLoan, termLoanLimit,
} from './finance'
import { advanceDay, beginSeason, buildLift, newGame, type GameState } from './game'
import { SEASON } from './season'
import { SITES } from './sites'

const site = SITES.find((s) => s.id === 'co-berthoud-pass')!
const fresh = (downPct = 50): GameState => newGame(site.id, planPurchase(2_000_000, downPct), 1, 'r1c1')
const withResort = (g: GameState): GameState => ({
  ...g,
  trails: [{ id: 't1', name: 'T', points: [], difficulty: 'blue', lengthM: 1500, verticalM: 300, acres: 15, costUsd: 300_000 }],
  lifts: [{ id: 'l1', name: 'L', type: 'fixedDouble', bottom: [0, 0], top: [1, 1], lengthM: 1000, verticalM: 250, capacityPph: 1200, costUsd: 2_400_000 }],
})
const season = { revenueUsd: 0, costUsd: 0, netUsd: 0, year: 1 }

describe('limits', () => {
  it('values assets at cost and sizes credit and term limits from them', () => {
    const g = withResort(fresh())
    expect(assetValue(g)).toBe(2_000_000 + 300_000 + 2_400_000)
    expect(creditLimit(g)).toBe(Math.round(assetValue(g) * FIN.credit.limitShareOfAssets / 10_000) * 10_000)
    expect(termLoanLimit(g)).toBe(Math.floor((assetValue(g) * FIN.termLoan.maxShareOfAssets - 1_000_000) / 10_000) * 10_000)
  })
  it('has a minimum credit line', () => {
    expect(creditLimit({ ...fresh(), landPaidUsd: 0 })).toBe(FIN.credit.minLimitUsd)
  })
})

describe('credit line', () => {
  it('draws and repays, respecting the limit and cash', () => {
    const g = fresh()
    const d = drawCredit(g, 200_000)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.game.cashUsd).toBe(g.cashUsd + 200_000)
    expect(d.game.creditUsd).toBe(200_000)
    expect(drawCredit(g, 99_000_000).ok).toBe(false)
    const r = repayCredit(d.game, 500_000) // capped at the balance
    expect(r.ok && r.game.creditUsd).toBe(0)
  })
  it('covers negative cash automatically, or bankrupts', () => {
    const covered = ensureLiquidity({ ...fresh(), cashUsd: -100_000 })
    expect(covered.cashUsd).toBe(0)
    expect(covered.creditUsd).toBe(100_000)
    expect(covered.bankrupt).toBe(false)
    const broke = ensureLiquidity({ ...fresh(), cashUsd: -50_000_000 })
    expect(broke.bankrupt).toBe(true)
  })
})

describe('term loans', () => {
  it('lends in the off-season within the limit', () => {
    const g = withResort(fresh())
    const r = takeTermLoan(g, 500_000)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.game.loans).toHaveLength(2)
      expect(r.game.cashUsd).toBe(g.cashUsd + 500_000)
    }
    expect(takeTermLoan(g, 50_000_000).ok).toBe(false)
    expect(takeTermLoan({ ...g, phase: 'season' }, 500_000).ok).toBe(false)
  })
})

describe('closeYear', () => {
  it('pays fixed costs, interest and principal, and the cash flow adds up', () => {
    const g = withResort(fresh())
    const { game, report } = closeYear(g, { revenueUsd: 3_000_000, costUsd: 1_000_000, netUsd: 2_000_000, year: 1 })
    expect(report.fixedCostsUsd).toBe(FIN.fixed.baseUsd + FIN.fixed.perLiftUsd + FIN.fixed.perTrailUsd)
    // Mortgage interest on $1M at the land rate.
    expect(report.interestUsd).toBe(Math.round(1_000_000 * ECON.landLoan.ratePct / 100))
    expect(report.principalUsd).toBeGreaterThan(0)
    expect(game.loans[0].balanceUsd).toBe(1_000_000 - report.principalUsd)
    expect(game.reports).toHaveLength(1)
    expect(game.book.startCashUsd).toBe(game.cashUsd)
    // The test injects operating profit without adding it to cash, so add it back.
    expect(reportCashCheck({ ...report, operatingProfitUsd: 0 })).toBe(0)
  })

  it('reconciles a full played year, including construction and the land purchase', () => {
    let g = withResort(fresh())
    const lift = buildLift(g, {
      type: 'ropeTow', bottom: [0, 0], top: [1, 1], lengthM: 300, verticalM: 60, rideMin: 2,
      capacityPph: 600, costUsd: 150_000, problems: [],
    })
    expect(lift.ok).toBe(true)
    if (lift.ok) g = lift.game
    g = beginSeason(g, site)
    for (let i = 0; i < SEASON.lengthDays; i++) g = advanceDay(g, site).game
    const report = g.reports[0]
    expect(report.capexUsd).toBe(2_000_000 + 150_000)
    expect(reportCashCheck(report)).toBe(0)
  })

  it('bankrupts when costs exceed cash and credit', () => {
    const g = { ...withResort(fresh()), cashUsd: 0, creditUsd: creditLimit(withResort(fresh())) }
    expect(closeYear(g, season).report.bankrupt).toBe(true)
  })

  it('retires a loan once it is paid off', () => {
    const g = { ...fresh(), loans: [{ ...fresh().loans[0], balanceUsd: 10_000 }] }
    expect(closeYear(g, season).game.loans).toHaveLength(0)
  })
})
