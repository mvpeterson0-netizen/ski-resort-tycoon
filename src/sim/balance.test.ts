/// <reference types="node" />
/**
 * Pacing checks (owner intent): a player who keeps reinvesting should see cash float
 * near $0–3M for years while net worth grows slowly over 10+ years, and bad snow years
 * should hurt. Uses the real Berthoud Pass terrain for parcel prices.
 *
 * Set BALANCE_OUT=/path/file.json to write the full summary for charts.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { balanceReport } from './balanceReport'
import { expansionPremium, landPrice } from './economy'
import { computeParcels, siteForParcel } from './parcels'
import { regionById, SITES } from './sites'
import { decodeDem } from './terrain'

const site = SITES.find((s) => s.id === 'co-berthoud-pass')!
const region = regionById(site.regionId)!
const meta = JSON.parse(readFileSync(new URL('../../public/sites/co-berthoud-pass.json', import.meta.url), 'utf8'))
const buf = readFileSync(new URL('../../public/sites/co-berthoud-pass.dem.bin', import.meta.url))
const terrain = decodeDem(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta.width, meta.height, meta.cellM)
const parcels = computeParcels(terrain)
const price = (id: string) => landPrice(siteForParcel(site, parcels.find((p) => p.id === id)!), region).totalUsd
// Expansion order: edge neighbours of the centre, then corners.
const order = ['r0c1', 'r1c2', 'r2c1', 'r1c0', 'r0c0', 'r0c2', 'r2c2', 'r2c0']
const seeds = Array.from({ length: 20 }, (_, i) => i + 1)
const { years } = balanceReport(
  { site, starterPriceUsd: price('r1c1'), expansionPricesUsd: order.map((id, i) => Math.round(price(id) * expansionPremium(i + 1))), years: 15 },
  seeds,
)
if (process.env.BALANCE_OUT) writeFileSync(process.env.BALANCE_OUT, JSON.stringify(years, null, 2))

describe('pacing on Normal difficulty (reinvesting player)', () => {
  it('keeps median cash between $0 and ~$4M (about one big lift) through the first decade', () => {
    for (const y of years.slice(0, 10)) {
      expect(y.medianCash).toBeGreaterThanOrEqual(0)
      expect(y.medianCash).toBeLessThanOrEqual(4_000_000)
    }
  })

  it('grows net worth, but slowly: no fortune in the first five years', () => {
    expect(years[14].medianNetWorth).toBeGreaterThan(years[0].medianNetWorth * 2)
    expect(years[4].medianNetWorth).toBeLessThan(years[0].medianNetWorth * 2.5)
  })

  it('makes bad snow years noticeably worse, without deciding the outcome', () => {
    // Owner direction: weather sways results, decisions decide survival. Worst-decile
    // operating profit is clearly below the median, but careful players stay afloat.
    const ys = years.slice(2, 12)
    expect(ys.filter((y) => y.p10OpProfit < y.medianOpProfit * 0.75).length).toBeGreaterThanOrEqual(5)
  })

  it('takes more than a decade to build out the mountain', () => {
    expect(years[9].medianParcels).toBeLessThan(9)
  })

  it('rarely bankrupts a careful reinvesting player', () => {
    expect(years[14].bankruptShare).toBeLessThanOrEqual(0.1)
  })
})
