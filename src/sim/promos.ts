/**
 * Marketing: paid campaigns that lift day-ticket demand for a few days. Pass holders are
 * never affected. Each campaign has a lead time (booking to start) and a cost paid on its
 * first day. All numbers are PLACEHOLDERS for gameplay, not marketing data.
 */
export type PromoKind = 'social' | 'radio' | 'partner' | 'twoForOne' | 'powderAlert'

export interface PromoSpec {
  name: string
  blurb: string
  costUsd: number
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
}

export const PROMOS: Record<PromoKind, PromoSpec> = {
  social: { name: 'Social media push', blurb: 'Cheap and quick. A small bump for locals.', costUsd: 10_000, leadDays: 1, lengthDays: 5, dayDemandMult: 1.04 },
  radio: { name: 'Radio and billboards', blurb: 'A week of regional ads.', costUsd: 30_000, leadDays: 2, lengthDays: 7, dayDemandMult: 1.08 },
  partner: { name: 'Travel partner package', blurb: 'Hotels and tour groups send you more visitors.', costUsd: 20_000, leadDays: 3, lengthDays: 14, dayDemandMult: 1, visitorMult: 1.12 },
  twoForOne: { name: 'Midweek 2-for-1', blurb: 'Fills quiet weekdays, but each ticket earns less.', costUsd: 6_000, leadDays: 1, lengthDays: 14, dayDemandMult: 1.6, priceMult: 0.6, weekdaysOnly: true },
  powderAlert: { name: 'Powder alert', blurb: 'One-day push when a storm is coming.', costUsd: 8_000, leadDays: 1, lengthDays: 1, dayDemandMult: 1.15 },
}

export const PROMO_KINDS = Object.keys(PROMOS) as PromoKind[]

export interface Promo {
  id: string
  kind: PromoKind
  /** Season day the campaign starts. */
  startDay: number
}

export const promoEnd = (p: Promo) => p.startDay + PROMOS[p.kind].lengthDays - 1

export interface PromoEffects {
  dayDemandMult: number
  visitorMult: number
  priceMult: number
  /** Campaign costs due today (paid on the first day). */
  marketingUsd: number
}

/** Campaigns stack, but day-ticket demand never rises by more than this multiple. */
export const MAX_DEMAND_MULT = 1.7

export const NO_PROMO: PromoEffects = { dayDemandMult: 1, visitorMult: 1, priceMult: 1, marketingUsd: 0 }

/** Combined effect of all campaigns on a season day (weekday: 0 = Sunday … 6 = Saturday). */
export function promoEffects(promos: Promo[], day: number, weekday: number): PromoEffects {
  const e = { ...NO_PROMO }
  for (const p of promos) {
    const s = PROMOS[p.kind]
    if (p.startDay === day) e.marketingUsd += s.costUsd
    if (day < p.startDay || day > promoEnd(p)) continue
    if (s.weekdaysOnly && (weekday === 0 || weekday === 6)) continue
    e.dayDemandMult *= s.dayDemandMult
    e.visitorMult *= s.visitorMult ?? 1
    e.priceMult *= s.priceMult ?? 1
  }
  // Campaigns stack, but not without limit.
  e.dayDemandMult = Math.min(e.dayDemandMult, MAX_DEMAND_MULT)
  return e
}

export type PromoResult = { ok: true; promos: Promo[] } | { ok: false; reason: string }

/** Book a campaign to start on `startDay` (not before today + lead time, no overlap of one kind). */
export function bookPromo(promos: Promo[], kind: PromoKind, startDay: number, today: number): PromoResult {
  const s = PROMOS[kind]
  if (startDay < today + s.leadDays) return { ok: false, reason: `${s.name} needs ${s.leadDays} day${s.leadDays > 1 ? 's' : ''} of lead time` }
  const end = startDay + s.lengthDays - 1
  if (promos.some((p) => p.kind === kind && p.startDay <= end && promoEnd(p) >= startDay)) {
    return { ok: false, reason: `You already have ${s.name.toLowerCase()} running then` }
  }
  let n = promos.length + 1
  while (promos.some((p) => p.id === `p${n}`)) n++
  return { ok: true, promos: [...promos, { id: `p${n}`, kind, startDay }] }
}

/** Cancel a campaign that has not started yet. */
export const cancelPromo = (promos: Promo[], id: string, today: number): Promo[] =>
  promos.filter((p) => p.id !== id || p.startDay <= today)
