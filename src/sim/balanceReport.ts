/**
 * Balance report: runs the auto-player across many seeds and summarises pacing.
 * Pure; the caller supplies the site and parcel prices.
 */
import { runCampaign, type CampaignOptions, type YearRow } from './autoplayer'

export interface YearSummary {
  year: number
  medianCash: number
  p10Cash: number
  p90Cash: number
  medianOpProfit: number
  p10OpProfit: number
  /** Worst-decile net income (after fixed costs and interest). */
  p10NetIncome: number
  medianNetWorth: number
  medianLifts: number
  medianTrailKm: number
  medianParcels: number
  shareUsingCredit: number
  bankruptShare: number
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

export function balanceReport(base: Omit<CampaignOptions, 'seed'>, seeds: number[]): { runs: YearRow[][]; years: YearSummary[] } {
  const runs = seeds.map((seed) => runCampaign({ ...base, seed }))
  const years: YearSummary[] = []
  for (let y = 1; y <= base.years; y++) {
    const rows = runs.map((r) => r.find((x) => x.year === y)).filter((x): x is YearRow => !!x)
    const bankruptBy = runs.filter((r) => r.some((x) => x.bankrupt && x.year <= y) || (r.length < y && r.at(-1)?.bankrupt)).length
    years.push({
      year: y,
      medianCash: quantile(rows.map((r) => r.endCashUsd), 0.5),
      p10Cash: quantile(rows.map((r) => r.endCashUsd), 0.1),
      p90Cash: quantile(rows.map((r) => r.endCashUsd), 0.9),
      medianOpProfit: quantile(rows.map((r) => r.operatingProfitUsd), 0.5),
      p10OpProfit: quantile(rows.map((r) => r.operatingProfitUsd), 0.1),
      p10NetIncome: quantile(rows.map((r) => r.netIncomeUsd), 0.1),
      medianNetWorth: quantile(rows.map((r) => r.netWorthUsd), 0.5),
      medianLifts: quantile(rows.map((r) => r.lifts), 0.5),
      medianTrailKm: quantile(rows.map((r) => r.trailKm), 0.5),
      medianParcels: quantile(rows.map((r) => r.parcels), 0.5),
      shareUsingCredit: rows.filter((r) => r.creditUsd > 0).length / Math.max(1, rows.length),
      bankruptShare: bankruptBy / runs.length,
    })
  }
  return { runs, years }
}
