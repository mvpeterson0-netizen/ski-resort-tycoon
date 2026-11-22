/**
 * Ticket price calendar: weekday price, weekend and holiday defaults, a night-skiing
 * price, and per-day plans (price override, night session, overtime crew, snowmaking push).
 *
 * Weekend and holiday prices follow the weekday price (a default markup) until the player
 * sets them. Season-pass holders are never affected by daily prices. Every default here
 * is a PLACEHOLDER for gameplay, not market data.
 */
import { isHoliday, seasonDate } from './season'

export const PRICING = {
  /** Default markup over the weekday price. */
  weekendMult: 1.15,
  holidayMult: 1.3,
  nightPriceUsd: 35,
  minUsd: 10,
  maxUsd: 250,
  stepUsd: 5,
} as const

/** What the player has planned for one season day. */
export interface DayOps {
  /** Day-ticket price override for this date. */
  price?: number
  /** Run the night session (needs night lighting). */
  night?: boolean
  /** Overtime crew: more lift capacity today, at a payroll premium. */
  overtime?: boolean
  /** Overnight snowmaking push: adds made snow to the base (needs snowmaking). */
  snowPush?: boolean
}

export interface PriceCalendar {
  /** null = default markup over the weekday price. */
  weekend: number | null
  holiday: number | null
  night: number
  /** Half-day ticket price from noon, every day (null = not sold). Absent on older saves = null. */
  halfDay?: number | null
  /** Per season-day plans for the current or coming season (cleared when a season ends). */
  ops: Record<number, DayOps>
}

export const newCalendar = (): PriceCalendar => ({ weekend: null, holiday: null, night: PRICING.nightPriceUsd, halfDay: null, ops: {} })

export type DayKind = 'weekday' | 'weekend' | 'holiday'

/** Holidays use the sim's holiday days; Saturday and Sunday are weekends. */
export function dayKind(d: Date): DayKind {
  if (isHoliday(d)) return 'holiday'
  const w = d.getUTCDay()
  return w === 0 || w === 6 ? 'weekend' : 'weekday'
}

export const clampPrice = (v: number) => Math.max(PRICING.minUsd, Math.min(PRICING.maxUsd, Math.round(v)))
const roundStep = (v: number) => Math.round(v / PRICING.stepUsd) * PRICING.stepUsd

export interface ResolvedPrices { weekday: number; weekend: number; holiday: number; night: number }

export function resolvedPrices(weekdayUsd: number, cal: PriceCalendar): ResolvedPrices {
  return {
    weekday: weekdayUsd,
    weekend: cal.weekend ?? clampPrice(roundStep(weekdayUsd * PRICING.weekendMult)),
    holiday: cal.holiday ?? clampPrice(roundStep(weekdayUsd * PRICING.holidayMult)),
    night: cal.night,
  }
}

/** Day-ticket price for a season day: a date override, else the weekday/weekend/holiday price. */
export function priceForDay(weekdayUsd: number, cal: PriceCalendar, gameYear: number, day: number): number {
  const o = cal.ops[day]?.price
  if (o !== undefined) return clampPrice(o)
  return resolvedPrices(weekdayUsd, cal)[dayKind(seasonDate(gameYear, day))]
}

export function setDayOps(cal: PriceCalendar, day: number, patch: Partial<DayOps> | null): PriceCalendar {
  const next = { ...(cal.ops[day] ?? {}), ...(patch ?? {}) }
  for (const k of Object.keys(next) as (keyof DayOps)[]) if (next[k] === undefined || next[k] === false) delete next[k]
  const ops = { ...cal.ops }
  if (patch === null || Object.keys(next).length === 0) delete ops[day]
  else ops[day] = next
  return { ...cal, ops }
}

export function setKindPrice(cal: PriceCalendar, kind: 'weekend' | 'holiday' | 'night', priceUsd: number | null): PriceCalendar {
  return { ...cal, [kind]: priceUsd === null ? null : clampPrice(priceUsd) }
}

/** Sell a half-day ticket from noon at this price every day (null stops it). */
export const setHalfDayPrice = (cal: PriceCalendar, priceUsd: number | null): PriceCalendar =>
  ({ ...cal, halfDay: priceUsd === null ? null : clampPrice(priceUsd) })
