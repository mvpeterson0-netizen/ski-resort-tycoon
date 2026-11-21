/**
 * Automatic player for balance testing: buys a starter resort, then every off-season
 * reinvests cash above a buffer into a growth ladder (trails → lifts → more land).
 * Trails and lifts are abstract (no geometry), with costs from the BUILD formulas.
 * Used by balance tests to check pacing; not part of normal play.
 */
import { AMENITIES, nextAmenityCost, type AmenityId } from './amenities'
import { BUILD, type LiftType } from './build'
import type { DifficultySettings } from './difficultySettings'
import { planPurchase } from './economy'
import { advanceDay, beginSeason, buyAmenity, newGame, type GameState, type Lift, type Trail } from './game'
import { FIN, assetValue, fixedCosts, loanDebt, takeTermLoan, termLoanLimit } from './finance'
import type { Site } from './sites'

const M2_PER_ACRE = 4046.8564224

export interface CampaignOptions {
  site: Site
  /** Starter parcel price, then expansion parcels in the order they'd be bought. */
  starterPriceUsd: number
  expansionPricesUsd: number[]
  seed: number
  years: number
  difficulty?: DifficultySettings
  /** Cash kept back when reinvesting. */
  bufferUsd?: number
  downPct?: number
  /** Growth caps per owned parcel. */
  liftsPerParcel?: number
  trailKmPerParcel?: number
}

export interface YearRow {
  year: number
  endCashUsd: number
  operatingProfitUsd: number
  netIncomeUsd: number
  assetsUsd: number
  debtUsd: number
  netWorthUsd: number
  guests: number
  openDays: number
  lifts: number
  trailKm: number
  parcels: number
  creditUsd: number
  capexUsd: number
  bankrupt: boolean
}

export const trailCostUsd = (lengthM: number) =>
  Math.round(((lengthM * BUILD.trail.widthM) / M2_PER_ACRE) * BUILD.trail.costPerAcreUsd / 1000) * 1000

export const liftCostUsd = (type: LiftType, lengthM: number) =>
  Math.round((BUILD.lifts[type].baseCostUsd + BUILD.lifts[type].costPerMUsd * lengthM) / 1000) * 1000

const TRAIL_M = 1200
const LIFT_M = 1000

function addTrail(g: GameState): GameState {
  const cost = trailCostUsd(TRAIL_M)
  const t: Trail = {
    id: `t${g.trails.length + 1}`, name: 'auto', points: [], difficulty: (['blue', 'green', 'black'] as const)[g.trails.length % 3],
    lengthM: TRAIL_M, verticalM: 250, acres: 0, costUsd: cost,
  }
  return { ...g, cashUsd: g.cashUsd - cost, trails: [...g.trails, t], book: { ...g.book, capexUsd: g.book.capexUsd + cost } }
}

function addLift(g: GameState): GameState {
  const type: LiftType = g.lifts.length % 2 === 0 ? 'fixedDouble' : 'fixedQuad'
  const cost = liftCostUsd(type, LIFT_M)
  const l: Lift = {
    id: `l${g.lifts.length + 1}`, name: 'auto', type, bottom: [0, 0], top: [0, 0],
    lengthM: LIFT_M, verticalM: 250, capacityPph: BUILD.lifts[type].capacityPph, costUsd: cost,
  }
  return { ...g, cashUsd: g.cashUsd - cost, lifts: [...g.lifts, l], book: { ...g.book, capexUsd: g.book.capexUsd + cost } }
}

function addParcel(g: GameState, price: number): GameState {
  return {
    ...g, cashUsd: g.cashUsd - price, landPaidUsd: g.landPaidUsd + price,
    ownedParcels: [...g.ownedParcels, `x${g.ownedParcels.length}`],
    book: { ...g.book, capexUsd: g.book.capexUsd + price },
  }
}

type Opts = Required<Omit<CampaignOptions, 'difficulty'>> & { difficulty?: DifficultySettings }

/** Cash reserve: the larger of the configured buffer and one year of fixed costs. */
const reserve = (g: GameState, o: Opts) => Math.max(o.bufferUsd, fixedCosts(g))

/**
 * Reinvest like a sensible owner: add a lift if lifts were full last season, otherwise
 * trails (more terrain draws more guests), otherwise more land. Borrow on a term loan
 * when the purchase is out of reach and the extra payment stays affordable.
 */
function reinvest(g: GameState, o: Opts, landQueue: number[]): GameState {
  // A sensible owner clears the credit line before expanding again.
  if (g.creditUsd > 0) return g
  const guests = Math.max(1, g.lastSeason?.guests ?? 0)
  const parkingFull = (g.lastSeason?.parkingTurnedAway ?? 0) > 0.02 * guests
  const crowded = (g.lastSeason?.turnedAway ?? 0) - (g.lastSeason?.parkingTurnedAway ?? 0) > 0.03 * guests
  type Option = { cost: number; apply: (x: GameState) => GameState }
  for (let guard = 0; guard < 100; guard++) {
    const parcels = g.ownedParcels.length
    const km = g.trails.reduce((s, t) => s + t.lengthM, 0) / 1000
    const kmRoom = km + TRAIL_M / 1000 <= parcels * o.trailKmPerParcel
    const liftRoom = g.lifts.length < parcels * o.liftsPerParcel
    const liftType: LiftType = g.lifts.length % 2 === 0 ? 'fixedDouble' : 'fixedQuad'
    const lift: Option = { cost: liftCostUsd(liftType, LIFT_M), apply: addLift }
    const amenity = (id: AmenityId): Option | null => {
      const cost = nextAmenityCost(g.amenities, id)
      return cost === null ? null : { cost, apply: (x: GameState) => { const r = buyAmenity(x, id); return r.ok ? r.game : x } }
    }
    const lodgeMax = g.amenities.lodge >= AMENITIES.lodge.levels.length
    // Wish-list in priority order; buy the first one that is affordable.
    const wishes: (Option | null | false)[] = [
      parkingFull && amenity('parking'),
      crowded && liftRoom && lift,
      kmRoom && { cost: trailCostUsd(TRAIL_M), apply: addTrail },
      g.amenities.lodge === 0 && amenity('lodge'),
      g.amenities.rentals === 0 && amenity('rentals'),
      g.amenities.school === 0 && amenity('school'),
      !lodgeMax && g.lifts.length >= 4 && amenity('lodge'),
      liftRoom && km >= g.lifts.length * 3 && lift,
      // Out of room for terrain and lifts on owned land: buy the next parcel.
      !kmRoom && (!liftRoom || km < g.lifts.length * 3) && landQueue.length > 0 && {
        cost: landQueue[0], apply: (x: GameState) => { const price = landQueue.shift()!; return addParcel(x, price) },
      },
    ]
    let bought = false
    for (const w of wishes) {
      if (!w) continue
      const spare = g.cashUsd - reserve(g, o)
      if (spare >= w.cost) { g = w.apply(g); bought = true; break }
      // Borrow the shortfall if the bank allows it and total loan payments stay under
      // a fifth of last season's operating profit (financing stays a minor factor).
      const need = Math.ceil((w.cost - spare) / 10_000) * 10_000
      const pay = need * (FIN.termLoan.ratePct / 100) / (1 - Math.pow(1 + FIN.termLoan.ratePct / 100, -FIN.termLoan.termYears))
      const opProfit = g.lastSeason?.netUsd ?? 0
      const currentPay = g.loans.reduce((s, l) => s + l.annualPaymentUsd, 0)
      if (need > termLoanLimit(g) || need < FIN.termLoan.minUsd || currentPay + pay > opProfit / 5) continue
      const r = takeTermLoan(g, need)
      if (!r.ok) continue
      g = w.apply(r.game)
      bought = true
      break
    }
    if (!bought) return g
  }
  return g
}

export function runCampaign(opts: CampaignOptions): YearRow[] {
  const o = { bufferUsd: 500_000, downPct: 40, liftsPerParcel: 2, trailKmPerParcel: 6, difficulty: undefined, ...opts }
  const landQueue = [...o.expansionPricesUsd]
  let g = newGame(o.site.id, planPurchase(o.starterPriceUsd, o.downPct), o.seed, 'start', o.difficulty)
  // Opening build: at least one lift and two trails, even if it dips into the buffer.
  g = addLift(addTrail(addTrail(g)))
  g = reinvest(g, o, landQueue)
  const rows: YearRow[] = []
  for (let y = 0; y < o.years && !g.bankrupt; y++) {
    g = beginSeason(g, o.site)
    while (g.phase === 'season' && !g.bankrupt) g = advanceDay(g, o.site).game
    if (g.bankrupt && g.phase === 'season') {
      // Went under mid-season: no year-end report, record the failure for this year.
      rows.push({
        year: g.year, endCashUsd: g.cashUsd, operatingProfitUsd: 0, netIncomeUsd: 0, assetsUsd: assetValue(g),
        debtUsd: loanDebt(g) + g.creditUsd, netWorthUsd: g.cashUsd + assetValue(g) - loanDebt(g) - g.creditUsd,
        guests: 0, openDays: 0, lifts: g.lifts.length, trailKm: g.trails.reduce((s, t) => s + t.lengthM, 0) / 1000,
        parcels: g.ownedParcels.length, creditUsd: g.creditUsd, capexUsd: 0, bankrupt: true,
      })
      break
    }
    const r = g.reports.at(-1)
    if (!r) break
    rows.push({
      year: r.year, endCashUsd: g.cashUsd, operatingProfitUsd: r.operatingProfitUsd, netIncomeUsd: r.netIncomeUsd,
      assetsUsd: assetValue(g), debtUsd: loanDebt(g) + g.creditUsd, netWorthUsd: g.cashUsd + assetValue(g) - loanDebt(g) - g.creditUsd,
      guests: g.lastSeason?.guests ?? 0, openDays: g.lastSeason?.openDays ?? 0, lifts: g.lifts.length,
      trailKm: g.trails.reduce((s, t) => s + t.lengthM, 0) / 1000, parcels: g.ownedParcels.length,
      creditUsd: g.creditUsd, capexUsd: r.capexUsd, bankrupt: g.bankrupt,
    })
    // Pay down the credit line first, then grow.
    if (g.creditUsd > 0) {
      const pay = Math.min(g.creditUsd, Math.max(0, g.cashUsd - o.bufferUsd))
      g = { ...g, cashUsd: g.cashUsd - pay, creditUsd: g.creditUsd - pay, book: { ...g.book, creditRepaidUsd: g.book.creditRepaidUsd + pay } }
    }
    g = reinvest(g, o, landQueue)
  }
  return rows
}
