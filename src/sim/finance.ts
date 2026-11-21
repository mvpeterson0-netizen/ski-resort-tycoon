/**
 * Cash flow, borrowing and the year-end close. Pure functions over GameState.
 *
 * All rates, limits and fixed costs in FIN are PLACEHOLDERS for playability, not
 * sourced figures. There is no depreciation or tax model yet; "net income" here is
 * operating profit minus fixed costs and interest.
 */
import { amenityBookValue, amenityUpkeep } from './amenities'
import type { GameState, Loan } from './game'

export const FIN = {
  credit: {
    /** PLACEHOLDER: credit line limit as a share of asset (book) value. */
    limitShareOfAssets: 0.3,
    minLimitUsd: 1_000_000,
    /** PLACEHOLDER: annual interest on the drawn balance, charged at year end. */
    ratePct: 8,
  },
  termLoan: {
    /** PLACEHOLDER: total term debt may not exceed this share of asset value. */
    maxShareOfAssets: 0.6,
    ratePct: 6.5,
    termYears: 15,
    minUsd: 100_000,
  },
  /** PLACEHOLDER off-season fixed costs (insurance, property tax, upkeep), per year. */
  fixed: { baseUsd: 400_000, perLiftUsd: 80_000, perTrailUsd: 10_000 },
} as const

/** Running cash-flow counters for the current year, reset at each year-end close. */
export interface YearBook {
  startCashUsd: number
  capexUsd: number
  /** New term loans (and the opening land mortgage in year 1). */
  newLoansUsd: number
  creditDrawnUsd: number
  creditRepaidUsd: number
}

export const emptyBook = (startCashUsd: number): YearBook => ({
  startCashUsd, capexUsd: 0, newLoansUsd: 0, creditDrawnUsd: 0, creditRepaidUsd: 0,
})

export interface YearReport {
  year: number
  // Profit and loss.
  seasonRevenueUsd: number
  seasonCostUsd: number
  operatingProfitUsd: number
  fixedCostsUsd: number
  interestUsd: number
  netIncomeUsd: number
  // Cash flow (start + lines = end).
  startCashUsd: number
  principalUsd: number
  capexUsd: number
  newLoansUsd: number
  creditDrawnUsd: number
  creditRepaidUsd: number
  endCashUsd: number
  // Position at year end.
  assetsUsd: number
  loanDebtUsd: number
  creditUsd: number
  creditLimitUsd: number
  bankrupt: boolean
}

/** Book value: land plus construction at cost (no depreciation yet). */
export function assetValue(g: GameState): number {
  return g.landPaidUsd + g.trails.reduce((s, t) => s + t.costUsd, 0) + g.lifts.reduce((s, l) => s + l.costUsd, 0)
    + amenityBookValue(g.amenities ?? { parking: 0, lodge: 0, rentals: 0, school: 0 })
}

export const loanDebt = (g: GameState) => g.loans.reduce((s, l) => s + l.balanceUsd, 0)

export function creditLimit(g: GameState): number {
  return Math.max(FIN.credit.minLimitUsd, Math.round(assetValue(g) * FIN.credit.limitShareOfAssets / 10_000) * 10_000)
}

export const creditAvailable = (g: GameState) => Math.max(0, creditLimit(g) - g.creditUsd)

export function termLoanLimit(g: GameState): number {
  const room = assetValue(g) * FIN.termLoan.maxShareOfAssets - loanDebt(g)
  return Math.max(0, Math.floor(room / 10_000) * 10_000)
}

export function fixedCosts(g: GameState): number {
  return FIN.fixed.baseUsd + g.lifts.length * FIN.fixed.perLiftUsd + g.trails.length * FIN.fixed.perTrailUsd
    + amenityUpkeep(g.amenities ?? { parking: 0, lodge: 0, rentals: 0, school: 0 })
}

function annualPayment(principal: number, ratePct: number, years: number): number {
  const r = ratePct / 100
  return r === 0 ? principal / years : (principal * r) / (1 - Math.pow(1 + r, -years))
}

export type FinResult = { ok: true; game: GameState } | { ok: false; reason: string }

export function drawCredit(g: GameState, amountUsd: number): FinResult {
  const amt = Math.round(amountUsd)
  if (amt <= 0) return { ok: false, reason: 'Enter an amount' }
  if (amt > creditAvailable(g)) return { ok: false, reason: 'Over your credit limit' }
  return {
    ok: true,
    game: { ...g, cashUsd: g.cashUsd + amt, creditUsd: g.creditUsd + amt, book: { ...g.book, creditDrawnUsd: g.book.creditDrawnUsd + amt } },
  }
}

export function repayCredit(g: GameState, amountUsd: number): FinResult {
  const amt = Math.round(Math.min(amountUsd, g.creditUsd))
  if (amt <= 0) return { ok: false, reason: 'Nothing to repay' }
  if (amt > g.cashUsd) return { ok: false, reason: 'Not enough cash' }
  return {
    ok: true,
    game: { ...g, cashUsd: g.cashUsd - amt, creditUsd: g.creditUsd - amt, book: { ...g.book, creditRepaidUsd: g.book.creditRepaidUsd + amt } },
  }
}

export function takeTermLoan(g: GameState, amountUsd: number): FinResult {
  const amt = Math.round(amountUsd / 10_000) * 10_000
  if (g.phase !== 'offseason') return { ok: false, reason: 'Banks only lend in the off-season' }
  if (amt < FIN.termLoan.minUsd) return { ok: false, reason: `Minimum loan is $${FIN.termLoan.minUsd.toLocaleString()}` }
  if (amt > termLoanLimit(g)) return { ok: false, reason: 'More than the bank will lend against your assets' }
  const n = g.loans.filter((l) => l.id.startsWith('term')).length + 1
  const loan: Loan = {
    id: `term${n}`, name: `Term loan ${n}`,
    ratePct: FIN.termLoan.ratePct, termYears: FIN.termLoan.termYears,
    originalUsd: amt, balanceUsd: amt,
    annualPaymentUsd: Math.round(annualPayment(amt, FIN.termLoan.ratePct, FIN.termLoan.termYears)),
  }
  return {
    ok: true,
    game: { ...g, cashUsd: g.cashUsd + amt, loans: [...g.loans, loan], book: { ...g.book, newLoansUsd: g.book.newLoansUsd + amt } },
  }
}

/**
 * If cash is negative, draw on the credit line to cover it. If the line cannot cover
 * the shortfall, the resort is bankrupt.
 */
export function ensureLiquidity(g: GameState): GameState {
  if (g.cashUsd >= 0 || g.bankrupt) return g
  const need = -g.cashUsd
  const draw = Math.min(need, creditAvailable(g))
  const next: GameState = {
    ...g,
    cashUsd: g.cashUsd + draw,
    creditUsd: g.creditUsd + draw,
    book: { ...g.book, creditDrawnUsd: g.book.creditDrawnUsd + draw },
  }
  return draw < need ? { ...next, bankrupt: true } : next
}

/** Pay one year of a loan: interest on the balance, the rest of the payment to principal. */
function payLoan(l: Loan): { loan: Loan; interest: number; principal: number } {
  const interest = Math.round(l.balanceUsd * (l.ratePct / 100))
  const principal = Math.min(l.balanceUsd, Math.max(0, l.annualPaymentUsd - interest))
  return { loan: { ...l, balanceUsd: l.balanceUsd - principal }, interest, principal }
}

/**
 * Close the year: off-season fixed costs, loan payments and credit interest come out of
 * cash, the credit line covers any shortfall, and a report is produced.
 */
export function closeYear(g: GameState, season: { revenueUsd: number; costUsd: number; netUsd: number; year: number }): {
  game: GameState; report: YearReport
} {
  const fixed = fixedCosts(g)
  let interest = Math.round(g.creditUsd * (FIN.credit.ratePct / 100))
  let principal = 0
  const loans: Loan[] = []
  for (const l of g.loans) {
    const r = payLoan(l)
    interest += r.interest
    principal += r.principal
    if (r.loan.balanceUsd > 0) loans.push(r.loan)
  }
  let next: GameState = { ...g, loans, cashUsd: g.cashUsd - fixed - interest - principal }
  next = ensureLiquidity(next)
  const b = next.book
  const report: YearReport = {
    year: season.year,
    seasonRevenueUsd: season.revenueUsd,
    seasonCostUsd: season.costUsd,
    operatingProfitUsd: season.netUsd,
    fixedCostsUsd: fixed,
    interestUsd: interest,
    netIncomeUsd: season.netUsd - fixed - interest,
    startCashUsd: b.startCashUsd,
    principalUsd: principal,
    capexUsd: b.capexUsd,
    newLoansUsd: b.newLoansUsd,
    creditDrawnUsd: b.creditDrawnUsd,
    creditRepaidUsd: b.creditRepaidUsd,
    endCashUsd: next.cashUsd,
    assetsUsd: assetValue(next),
    loanDebtUsd: loanDebt(next),
    creditUsd: next.creditUsd,
    creditLimitUsd: creditLimit(next),
    bankrupt: next.bankrupt,
  }
  return { game: { ...next, book: emptyBook(next.cashUsd), reports: [...next.reports, report] }, report }
}

/** Cash-flow identity used by tests and the report screen. */
export function reportCashCheck(r: YearReport): number {
  return r.startCashUsd + r.operatingProfitUsd - r.fixedCostsUsd - r.interestUsd - r.principalUsd
    - r.capexUsd + r.newLoansUsd + r.creditDrawnUsd - r.creditRepaidUsd - r.endCashUsd
}
