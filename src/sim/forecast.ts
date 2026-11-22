/**
 * Five-day weather forecast. It peeks at the season's real upcoming weather (same random
 * draws as the day sim) but shows it with ranges that widen the further ahead it looks,
 * so it is a good guide, not a promise. Deterministic: no random draws of its own.
 *
 * Range widths and confidence are PLACEHOLDERS for gameplay, not meteorology.
 */
import { createRng } from './rng'
import { SEASON, isHoliday, seasonDate, type SeasonState } from './season'
import { snowModifiers } from './difficultySettings'
import { dayKind, type DayKind } from './pricing'

export type Outlook = 'Heavy snow' | 'Snow' | 'Clear' | 'Warm spell'

export interface ForecastDay {
  day: number
  date: string
  weekday: number
  holiday: boolean
  kind: DayKind
  /** Days ahead (0 = today). */
  lead: number
  snowLowIn: number
  snowHighIn: number
  /** Chance of a warm, slushy day (0–1). */
  warmChance: number
  outlook: Outlook
  /** 0–1: how much to trust it. */
  confidence: number
  /** The resort is not open yet on this day. */
  beforeOpening: boolean
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Deterministic 0..1 from two integers. */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

export const FORECAST_DAYS = 5

/**
 * Forecast for the next days of the season, starting with the day about to be played.
 * Follows the day sim's random draws exactly (snow, warmth, storm closure, demand noise).
 */
export function forecast(s: SeasonState, snowDifficulty = 0.5, days = FORECAST_DAYS): ForecastDay[] {
  const W = SEASON.weather
  const rng = createRng(s.rngState)
  const snowMod = snowModifiers(snowDifficulty)
  let baseIn = s.baseIn
  const out: ForecastDay[] = []
  for (let lead = 0; lead < days && s.day + lead < SEASON.lengthDays; lead++) {
    const day = s.day + lead
    const progress = day / SEASON.lengthDays
    let newSnow = 0
    if (rng.next() < W.stormChance) {
      const mean = s.expectedSnowIn / (SEASON.lengthDays * W.stormChance)
      newSnow = Math.round(-Math.log(1 - rng.next()) * mean)
    }
    const warm = rng.next() < lerp(W.warmChance[0], W.warmChance[1], progress) * snowMod.warmChance
    baseIn += newSnow * W.settleRatio
    if (warm) baseIn -= lerp(W.warmMeltIn[0], W.warmMeltIn[1], rng.next())
    const reachedOpening = day >= s.openingDay
    if (reachedOpening) { baseIn = Math.max(baseIn, W.baseFloorIn); rng.next() } // storm-closure draw
    rng.next() // demand noise draw

    // Wider and vaguer with lead time.
    const u = 0.15 * lead
    const jitter = hash01(day, newSnow) - 0.5
    const centre = lead === 0 ? newSnow : newSnow * (1 + jitter * u * 1.6)
    const low = lead === 0 ? newSnow : Math.max(0, Math.round(centre * (1 - u)))
    const high = lead === 0 ? newSnow : Math.round(centre * (1 + u) + lead * 0.6)
    const warmChance = lead === 0 ? (warm ? 1 : 0) : warm ? Math.max(0.4, 0.92 - 0.12 * lead) : Math.min(0.5, 0.05 + 0.07 * lead)
    const mid = (low + high) / 2
    const outlook: Outlook = mid >= 8 ? 'Heavy snow' : mid >= 3 ? 'Snow' : warmChance >= 0.5 ? 'Warm spell' : 'Clear'
    const date = seasonDate(s.year, day)
    out.push({
      day, date: date.toISOString().slice(0, 10), weekday: date.getUTCDay(), holiday: isHoliday(date), kind: dayKind(date),
      lead, snowLowIn: low, snowHighIn: Math.max(low, high), warmChance: Math.round(warmChance * 100) / 100, outlook,
      confidence: Math.round(Math.max(0.4, 1 - 0.14 * lead) * 100) / 100, beforeOpening: !reachedOpening,
    })
  }
  return out
}
