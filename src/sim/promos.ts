/**
 * Marketing: paid campaigns that lift day-ticket demand for a few days. Pass holders are
 * never affected. Each campaign has a lead time (booking to start) and a cost paid on its
 * first day.
 *
 * Costs scale with the size of the resort's market (bigger resort, bigger ad buys), so every
 * campaign is a similar decision in year 1 and year 10. Each one is tuned to come out slightly
 * ahead when it is used at the right time (its `bestTime`) and to lose money otherwise.
 * "Hometown ski club" (small resorts only) has a random result: its lift on local demand is
 * drawn from a bell curve when it is booked, so most runs pay a little, some lose, a few do well.
 *
 * All numbers are PLACEHOLDERS for gameplay, not marketing data.
 */
export type PromoKind = 'social' | 'radio' | 'partner' | 'twoForOne' | 'powderAlert' | 'hometown'

export interface PromoSpec {
  name: string
  blurb: string
  /** When it pays (shown to the player). */
  bestTime: string
  /** Cost per guest of the resort's daily market (Saturday-equivalent demand), and a floor. */
  costPerMarketGuestUsd: number
  minCostUsd: number
  /** Cost also scales with spend per guest (food and rentals), for deals whose gain is mostly that spend. */
  spendScaled?: boolean
  /** Days between booking and the start. */
  leadDays: number
  lengthDays: number
  /** Multiplier on day-ticket demand (locals without a pass and visitors). */
  dayDemandMult: number
  /** Extra multiplier on visitors only. */
  visitorMult?: number
  /** Revenue per day ticket as a share of the sticker price (deals). */
  priceMult?: number
  weekdaysOnly?: boolean
  /** Extra multiplier on day-ticket demand on a powder day (at least POWDER_DAY_IN of new snow). */
  powderMult?: number
  /** Random multiplier on local day-ticket demand, drawn from a normal distribution at booking. */
  luck?: { mean: number; sd: number; min: number; max: number }
  /** Only resorts with at most this many lifts can book it. */
  maxLifts?: number
}

/** New snow (in) that makes a day a powder day for the powder alert. */
export const POWDER_DAY_IN = 6

export const PROMOS: Record<PromoKind, PromoSpec> = {
  social: {
    name: 'Social media push', blurb: 'A quick weekend push to locals and nearby day-trippers.',
    bestTime: 'Fri–Sun or a holiday weekend', costPerMarketGuestUsd: 15, minCostUsd: 2_000, leadDays: 1, lengthDays: 3, dayDemandMult: 1.1,
  },
  radio: {
    name: 'Radio and billboards', blurb: 'A week of regional ads.',
    bestTime: 'a holiday week (Christmas, MLK, Presidents\' Day)', costPerMarketGuestUsd: 35, minCostUsd: 6_000, leadDays: 2, lengthDays: 7, dayDemandMult: 1.1,
  },
  partner: {
    name: 'Travel partner package', blurb: 'Hotels and tour groups send you more visitors.',
    bestTime: 'two weeks with holidays in them', costPerMarketGuestUsd: 37, minCostUsd: 6_000, leadDays: 3, lengthDays: 14, dayDemandMult: 1, visitorMult: 1.12,
  },
  twoForOne: {
    name: 'Midweek 2-for-1', blurb: 'Fills quiet weekdays, but each ticket earns less.',
    bestTime: 'quiet January–March weekdays with spare lift room', costPerMarketGuestUsd: 33, minCostUsd: 5_000, leadDays: 1, lengthDays: 14, dayDemandMult: 1.7, priceMult: 0.65, weekdaysOnly: true, spendScaled: true,
  },
  powderAlert: {
    name: 'Powder alert', blurb: `One-day push. Works when it really snows (${POWDER_DAY_IN}″+ new).`,
    bestTime: 'a storm day in the forecast, best on a weekend', costPerMarketGuestUsd: 11, minCostUsd: 1_500, leadDays: 1, lengthDays: 1, dayDemandMult: 1.03, powderMult: 1.25,
  },
  hometown: {
    name: 'Hometown ski club', blurb: 'Flyers, school clubs and a town night. Cheap, but the turnout is a gamble.',
    bestTime: 'any week; a little better with a weekend in it', costPerMarketGuestUsd: 12.5, minCostUsd: 1_500, leadDays: 2, lengthDays: 7, dayDemandMult: 1,
    luck: { mean: 1.1, sd: 0.05, min: 0.95, max: 1.25 }, maxLifts: 2,
  },
}

export const PROMO_KINDS = Object.keys(PROMOS) as PromoKind[]

export interface Promo {
  id: string
  kind: PromoKind
  /** Season day the campaign starts. */
  startDay: number
  /** Cost fixed at booking (absent on campaigns booked before costs scaled: the spec's floor). */
  costUsd?: number
  /** A random campaign's drawn multiplier on local demand (fixed at booking, not shown). */
  luckMult?: number
}

/**
 * What a campaign costs for a resort whose daily market is `marketGuests` (Saturday-equivalent).
 * `spendIndex` is food and rental spend per guest relative to a resort with no lodge or rentals (1).
 */
export function promoCostUsd(kind: PromoKind, marketGuests: number, spendIndex = 1): number {
  const s = PROMOS[kind]
  const raw = s.costPerMarketGuestUsd * marketGuests * (s.spendScaled ? spendIndex : 1)
  return Math.max(s.minCostUsd, Math.round(raw / 100) * 100)
}

/** A campaign's cost as booked. */
export const costOf = (p: Promo) => p.costUsd ?? PROMOS[p.kind].minCostUsd

/** Standard normal from two uniform draws (Box–Muller). */
export function normalDraw(u1: number, u2: number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, u1))) * Math.cos(2 * Math.PI * u2)
}

/** A random campaign's multiplier from two uniform draws, clamped to its range. */
export function luckMultFor(kind: PromoKind, u1: number, u2: number): number | undefined {
  const l = PROMOS[kind].luck
  if (!l) return undefined
  return Math.round(Math.max(l.min, Math.min(l.max, l.mean + l.sd * normalDraw(u1, u2))) * 1000) / 1000
}

export const promoEnd = (p: Promo) => p.startDay + PROMOS[p.kind].lengthDays - 1

export interface PromoEffects {
  dayDemandMult: number
  visitorMult: number
  /** Extra multiplier on local (non-pass) day-ticket demand (random campaigns). */
  localMult?: number
  /** Extra multiplier on day-ticket demand if today turns out to be a powder day. */
  powderMult?: number
  priceMult: number
  /** Campaign costs due today (paid on the first day). */
  marketingUsd: number
}

/** Campaigns stack, but day-ticket demand never rises by more than this multiple. */
export const MAX_DEMAND_MULT = 1.7

export const NO_PROMO: PromoEffects = { dayDemandMult: 1, visitorMult: 1, priceMult: 1, marketingUsd: 0 }

/** Combined effect of all campaigns on a season day (weekday: 0 = Sunday … 6 = Saturday). */
export function promoEffects(promos: Promo[], day: number, weekday: number): PromoEffects {
  const e: PromoEffects = { ...NO_PROMO }
  for (const p of promos) {
    const s = PROMOS[p.kind]
    if (p.startDay === day) e.marketingUsd += costOf(p)
    if (day < p.startDay || day > promoEnd(p)) continue
    if (s.weekdaysOnly && (weekday === 0 || weekday === 6)) continue
    e.dayDemandMult *= s.dayDemandMult
    e.visitorMult *= s.visitorMult ?? 1
    e.priceMult *= s.priceMult ?? 1
    if (s.powderMult) e.powderMult = (e.powderMult ?? 1) * s.powderMult
    if (p.luckMult) e.localMult = (e.localMult ?? 1) * p.luckMult
  }
  // Campaigns stack, but not without limit.
  e.dayDemandMult = Math.min(e.dayDemandMult, MAX_DEMAND_MULT)
  return e
}

export type PromoResult = { ok: true; promos: Promo[] } | { ok: false; reason: string }

/** Book a campaign to start on `startDay` (not before today + lead time, no overlap of one kind). */
export function bookPromo(promos: Promo[], kind: PromoKind, startDay: number, today: number, extra: { costUsd?: number; luckMult?: number } = {}): PromoResult {
  const s = PROMOS[kind]
  if (startDay < today + s.leadDays) return { ok: false, reason: `${s.name} needs ${s.leadDays} day${s.leadDays > 1 ? 's' : ''} of lead time` }
  const end = startDay + s.lengthDays - 1
  if (promos.some((p) => p.kind === kind && p.startDay <= end && promoEnd(p) >= startDay)) {
    return { ok: false, reason: `You already have ${s.name.toLowerCase()} running then` }
  }
  let n = promos.length + 1
  while (promos.some((p) => p.id === `p${n}`)) n++
  const p: Promo = { id: `p${n}`, kind, startDay }
  if (extra.costUsd !== undefined) p.costUsd = extra.costUsd
  if (extra.luckMult !== undefined) p.luckMult = extra.luckMult
  return { ok: true, promos: [...promos, p] }
}

/** Cancel a campaign that has not started yet. */
export const cancelPromo = (promos: Promo[], id: string, today: number): Promo[] =>
  promos.filter((p) => p.id !== id || p.startDay <= today)

export type PromoStatus = 'scheduled' | 'running' | 'completed'

/**
 * Where a campaign stands. `today` is the next season day to be played (so a campaign that ended
 * on an earlier day is completed, and one that includes today is still running).
 */
export function promoStatus(p: Promo, today: number): PromoStatus {
  if (p.startDay > today) return 'scheduled'
  return promoEnd(p) < today ? 'completed' : 'running'
}

export interface PromoResults {
  /** Days of the campaign already played, and its full length. */
  daysPlayed: number
  daysTotal: number
  /** Played days with no recorded comparison (for example days played before results existed). */
  daysWithoutResults: number
  extraGuests: number
  extraRevenueUsd: number
  /** Net effect before the campaign's own cost, and the cost paid (the first day). */
  netBeforeCostUsd: number
  costUsd: number
  /** What the campaign earned or lost overall. */
  netUsd: number
  perDay: { day: number; extraGuests: number; netBeforeCostUsd: number }[]
}

/**
 * What a campaign did, from the comparison each played day recorded (the day replayed without
 * it). Works for a campaign still running (results so far) or finished.
 */
export function promoResults(
  p: Promo,
  days: { day: number; impact?: { promos?: { kind: PromoKind; extraGuests: number; extraRevenueUsd: number; netBeforeCostUsd: number }[] } }[],
): PromoResults {
  const end = promoEnd(p)
  const mine = days.filter((d) => d.day >= p.startDay && d.day <= end)
  const perDay: PromoResults['perDay'] = []
  let extraGuests = 0, extraRevenueUsd = 0, netBeforeCostUsd = 0, without = 0
  for (const d of mine) {
    const r = d.impact?.promos?.find((x) => x.kind === p.kind)
    if (!r) { without++; continue }
    extraGuests += r.extraGuests
    extraRevenueUsd += r.extraRevenueUsd
    netBeforeCostUsd += r.netBeforeCostUsd
    perDay.push({ day: d.day, extraGuests: r.extraGuests, netBeforeCostUsd: r.netBeforeCostUsd })
  }
  // The campaign's cost comes out on its first day, once that day has been played.
  const costUsd = mine.some((d) => d.day === p.startDay) ? costOf(p) : 0
  return {
    daysPlayed: mine.length, daysTotal: PROMOS[p.kind].lengthDays, daysWithoutResults: without,
    extraGuests: Math.round(extraGuests), extraRevenueUsd: Math.round(extraRevenueUsd), netBeforeCostUsd: Math.round(netBeforeCostUsd),
    costUsd, netUsd: Math.round(netBeforeCostUsd - costUsd), perDay,
  }
}
