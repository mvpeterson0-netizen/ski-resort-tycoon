/**
 * What your decisions did: the feedback loop for the end-of-day report.
 *
 * The day sim is deterministic, so a finished day can be replayed with one decision changed
 * (a different ticket price, no campaign, lifts left open, night session on or off, an overtime
 * crew, the other option on an event card) and compared with what actually happened. Weather,
 * guests' moods and events are identical in every replay; only the decision differs.
 *
 * The "guest" quotes are flavour generated from the day's numbers, not real feedback.
 * All thresholds are PLACEHOLDER tuning.
 */
import { NEUTRAL_EFFECTS } from './amenities'
import {
  answerCard, defaultHalfDayUsd, finishLiveDay, isDayDone, setLiftMode, setLiveApres, setLiveHalfDay, setLiveLate, setLiveNight, setLiveOvertime, setLiveShuttle, setLiveNightPrice, setLivePrice, startLiveDay, tickLiveDay,
  type LiveAction, type LiveContext, type LiveDay,
} from './liveDay'
import { PROMOS, costOf, promoEffects, promoEnd, type PromoKind } from './promos'
import { dayKind } from './pricing'
import { seasonDate, type DayResult, type SeasonInputs, type SeasonState } from './season'

export interface ImpactItem {
  id: string
  label: string
  detail: string
  /** Effect on today's net, in dollars (negative = cost you or a missed gain). */
  netUsd: number
  /** Something you did not do but could have. */
  missed?: boolean
}

export interface PriceImpact {
  calendarUsd: number
  avgPaidUsd: number
  /** Best single price for the day, holding everything else as it was. */
  bestUsd: number
  bestNetUsd: number
  actualNetUsd: number
  guestsAtBest: number
  /** Longest lift line at the best price, in minutes. */
  waitAtBest: number
  actualDayGuests: number
  verdict: 'high' | 'low' | 'right'
}

export interface PromoImpact {
  kind: PromoKind
  extraGuests: number
  extraRevenueUsd: number
  /** Net effect today before the campaign's own cost. */
  netBeforeCostUsd: number
  /** Campaign cost paid today (the first day only). */
  costTodayUsd: number
}

export interface DayImpact {
  items: ImpactItem[]
  takeaways: string[]
  quotes: string[]
  price?: PriceImpact
  promos?: PromoImpact[]
}

export const IMPACT = {
  /** Price steps tried each side of the day's price, and the step between them. */
  priceRangeUsd: 30,
  priceStepUsd: 5,
  /** Prices that make lift lines longer than this (or longer than the day's own) are not recommended. */
  maxLineMin: 10,
  /** A better price must beat the actual net by this much to count as "too high / too low". */
  priceGainMinUsd: 300,
  /** Smaller effects than this are not worth a line. */
  minItemUsd: 150,
} as const

const k = (n: number) => {
  const a = Math.abs(Math.round(n))
  return a >= 1000 ? `$${(a / 1000).toFixed(a >= 10_000 ? 0 : 1)}k` : `$${a}`
}
const signedK = (n: number) => `${n < 0 ? '−' : '+'}${k(n)}`
const revenue = (r: DayResult) => r.ticketRevenueUsd + r.foodRevenueUsd + r.extrasRevenueUsd

interface Override {
  /** Hold one ticket price all day (ignores live price changes). */
  price?: number
  /** Replace the campaigns running today (undefined = as booked). */
  promos?: NonNullable<LiveContext['promos']>
  /** Ignore the player's lift settings (all open). */
  ignoreLifts?: boolean
  night?: boolean
  overtime?: boolean
  /** Extended hours (to 5 pm) on from the start, or off all day. */
  late?: boolean
  /** Half-day price all day (null = not sold), ignoring live changes. */
  halfDay?: number | null
  /** Apres special on from the start, or never. */
  apres?: boolean
  /** Overflow shuttle on from the start, or never. */
  shuttle?: boolean
  snowPush?: boolean
  /** Choose these options on event cards instead of the player's. */
  cards?: Record<string, string>
}

/** Play the day again from its start with the same decisions, except where overridden. */
export function replayDay(s: SeasonState, inp: SeasonInputs, base: LiveContext, log: LiveAction[], o: Override = {}): { live: LiveDay; result: DayResult } {
  const promo = o.promos === undefined ? base.promo : promoEffects(o.promos, s.day, seasonDate(s.year, s.day).getUTCDay())
  const ops = {
    ...base.ops,
    ...(o.night !== undefined ? { night: o.night } : {}),
    ...(o.overtime !== undefined ? { overtime: o.overtime } : {}),
    ...(o.snowPush !== undefined ? { snowPush: o.snowPush } : {}),
  }
  let l = startLiveDay(s, inp, {
    ...base, priceUsd: o.price ?? base.priceUsd, promo, ops,
    ...(o.halfDay !== undefined ? { halfDayUsd: o.halfDay } : {}),
  })
  if (o.late) l = setLiveLate(l, true)
  if (o.apres) l = setLiveApres(l, true)
  if (o.shuttle) l = setLiveShuttle(l, true)
  const applied = new Set<LiveAction>()
  for (let guard = 0; guard < 400 && !isDayDone(l, inp); guard++) {
    for (const a of log) {
      if (applied.has(a) || a.tick > l.tick || a.kind === 'card') continue
      applied.add(a)
      if (a.kind === 'price' && o.price === undefined) l = setLivePrice(l, a.value)
      else if (a.kind === 'nightPrice') l = setLiveNightPrice(l, a.value)
      else if (a.kind === 'lift' && !o.ignoreLifts) l = setLiftMode(l, a.lift, a.mode)
      else if (a.kind === 'night' && o.night === undefined) l = setLiveNight(l, a.on)
      else if (a.kind === 'overtime' && o.overtime === undefined) l = setLiveOvertime(l, a.on)
      else if (a.kind === 'late' && o.late === undefined) l = setLiveLate(l, a.on)
      else if (a.kind === 'halfDay' && o.halfDay === undefined) l = setLiveHalfDay(l, a.value)
      else if (a.kind === 'apres' && o.apres === undefined) l = setLiveApres(l, a.on)
      else if (a.kind === 'shuttle' && o.shuttle === undefined) l = setLiveShuttle(l, a.on)
    }
    l = tickLiveDay(l, inp)
    if (l.pending) {
      const id = l.pending
      const chosen = o.cards?.[id] ?? log.find((a) => a.kind === 'card' && a.cardId === id)
      l = answerCard(l, inp, typeof chosen === 'string' ? chosen : chosen && chosen.kind === 'card' ? chosen.option : '')
    }
  }
  return { live: l, result: finishLiveDay(l, s, inp).result }
}

/**
 * Compare the finished day with replays under other choices. `s` is the season state before
 * the day was played. Returns null if the day has no decision log (saved before it existed).
 */
export function computeImpact(s: SeasonState, inp: SeasonInputs, live: LiveDay, fallback: LiveContext): DayImpact | null {
  if (!live.log || !live.prep.open) return null
  const base = live.base ?? fallback
  const log = live.log
  const actual = finishLiveDay(live, s, inp).result
  // Every comparison rests on the replay reproducing the real day. If it does not (a day built
  // by hand in a test, or a save from an older build), say nothing rather than mislead.
  const check = replayDay(s, inp, base, log, {}).result
  if (check.netUsd !== actual.netUsd || check.guests !== actual.guests) return null
  const items: ImpactItem[] = []
  const amen = inp.amenity ?? NEUTRAL_EFFECTS
  const kind = dayKind(seasonDate(s.year, s.day))
  const out: DayImpact = { items, takeaways: [], quotes: [] }
  const net = actual.netUsd

  // ---- ticket price ----
  const p0 = base.priceUsd
  const lo = Math.max(10, p0 - IMPACT.priceRangeUsd)
  const grid: { p: number; net: number; guests: number; wait: number; away: number; total: number }[] = []
  for (let p = lo; p <= p0 + IMPACT.priceRangeUsd; p += IMPACT.priceStepUsd) {
    const r = replayDay(s, inp, base, log, { price: p }).result
    grid.push({ p, net: r.netUsd, guests: r.dayTicketGuests, wait: r.waitMin, away: r.turnedAway, total: r.guests })
  }
  const held = replayDay(s, inp, base, log, { price: p0 }).result
  // Only recommend prices that keep the mountain comfortable: no lines longer than today's (or the
  // limit), and no more guests turned away than today. Cheaper tickets always fill slack room, so
  // the useful answer is the price that fills the hill without choking it.
  const feasible = grid.filter((g) => g.wait <= Math.max(IMPACT.maxLineMin, actual.waitMin) && g.away <= Math.max(actual.turnedAway, Math.ceil(g.total * 0.02)))
  const pool = feasible.length ? feasible : grid
  const best = pool.reduce((a, b) => (b.net > a.net ? b : a))
  const gain = best.net - net
  const avgPaid = actual.dayTicketGuests > 0 ? actual.ticketRevenueUsd / actual.dayTicketGuests : p0
  const verdict: PriceImpact['verdict'] = gain >= IMPACT.priceGainMinUsd && best.p <= p0 - IMPACT.priceStepUsd ? 'high'
    : gain >= IMPACT.priceGainMinUsd && best.p >= p0 + IMPACT.priceStepUsd ? 'low' : 'right'
  out.price = { calendarUsd: p0, avgPaidUsd: Math.round(avgPaid), bestUsd: best.p, bestNetUsd: Math.round(best.net), actualNetUsd: net, guestsAtBest: best.guests, waitAtBest: best.wait, actualDayGuests: actual.dayTicketGuests, verdict }
  const lifts = actual.turnedAway - actual.parkingTurnedAway
  if (verdict === 'high') {
    items.push({
      id: 'price', label: `Ticket price $${p0} (${kind})`, netUsd: -gain,
      detail: `Too high: about ${Math.max(0, best.guests - actual.dayTicketGuests)} fewer day skiers than at $${best.p}, which would have netted ${k(gain)} more (lines about ${best.wait} min).`,
    })
  } else if (verdict === 'low') {
    items.push({
      id: 'price', label: `Ticket price $${p0} (${kind})`, netUsd: -gain, missed: true,
      detail: `Room to charge more${lifts > 0 || actual.parkingTurnedAway > 0 ? ' (the mountain was full)' : ''}: $${best.p} would have netted ${k(gain)} more.`,
    })
  } else {
    items.push({ id: 'price', label: `Ticket price $${p0} (${kind})`, netUsd: 0, detail: `About right: nothing from $${lo} to $${p0 + IMPACT.priceRangeUsd} beat it by much.` })
  }
  if (log.some((a) => a.kind === 'price')) {
    const d = net - held.netUsd
    items.push({ id: 'livePrice', label: 'Changing the price during the day', netUsd: d, detail: `${d >= 0 ? 'Paid off' : 'Cost you'} ${k(d)} compared with holding $${p0} all day.` })
  }

  // ---- campaigns running today ----
  const active = (base.promos ?? []).filter((p) => p.startDay <= s.day && promoEnd(p) >= s.day)
  const kinds = [...new Set(active.map((p) => p.kind))]
  if (kinds.length) out.promos = []
  for (const kd of kinds) {
    const without = (base.promos ?? []).filter((p) => p.kind !== kd)
    const r = replayDay(s, inp, base, log, { promos: without }).result
    const costToday = active.filter((p) => p.kind === kd && p.startDay === s.day).reduce((a, p) => a + costOf(p), 0)
    const extraGuests = actual.dayTicketGuests - r.dayTicketGuests
    const extraRev = revenue(actual) - revenue(r)
    const before = net - r.netUsd + costToday
    out.promos!.push({ kind: kd, extraGuests, extraRevenueUsd: extraRev, netBeforeCostUsd: Math.round(before), costTodayUsd: costToday })
    const eff = PROMOS[kd]
    const ineffective = eff.weekdaysOnly && (actual.weekday === 0 || actual.weekday === 6)
    items.push({
      id: `promo-${kd}`, label: eff.name, netUsd: net - r.netUsd,
      detail: ineffective
        ? `Weekdays only: no effect today${costToday ? `, and ${k(costToday)} was paid` : ''}.`
        : `${extraGuests >= 0 ? `Brought in ${Math.round(extraGuests)} extra day skiers` : `${Math.round(-extraGuests)} fewer day skiers`}, ${signedK(extraRev)} in sales${costToday ? `; the campaign cost ${k(costToday)} (paid today)` : ''}.`,
    })
  }

  // ---- lifts run slowly or closed ----
  if (log.some((a) => a.kind === 'lift')) {
    const open = replayDay(s, inp, base, log, { ignoreLifts: true }).result
    const saved = open.costUsd - actual.costUsd
    const lostGuests = open.guests - actual.guests
    const lostRev = revenue(open) - revenue(actual)
    const d = net - open.netUsd
    items.push({
      id: 'lifts', label: 'Lifts run slowly or closed', netUsd: d,
      detail: `${saved >= 0 ? `Saved ${k(saved)} in running costs` : `Cost ${k(-saved)} more`}${lostGuests > 0 ? `, but lost ${Math.round(lostGuests)} skiers (${k(lostRev)})` : ''}. Net ${signedK(d)} vs leaving them open.`,
    })
  }

  // ---- night session ----
  if (amen.nightShare > 0) {
    if (actual.nightGuests) {
      const r = replayDay(s, inp, base, log, { night: false }).result
      const d = net - r.netUsd
      items.push({
        id: 'night', label: 'Night session', netUsd: d,
        detail: `${Math.round(actual.nightGuests)} night skiers brought ${k(actual.nightRevenueUsd ?? 0)}; lights, crew and lifts cost ${k(actual.costUsd - r.costUsd)}. Net ${signedK(d)}.`,
      })
    } else {
      const r = replayDay(s, inp, base, log, { night: true }).result
      const d = r.netUsd - net
      if (d > IMPACT.minItemUsd) items.push({ id: 'night', label: 'Night session (not run)', netUsd: -d, missed: true, detail: `Running it would have added about ${Math.round(r.nightGuests ?? 0)} skiers and ${k(d)} net.` })
    }
  }

  // ---- overtime crew (planned for the day, or called in during it) ----
  if (base.ops.overtime || live.ops.overtime) {
    const r = replayDay(s, inp, base, log, { overtime: false }).result
    const d = net - r.netUsd
    const more = Math.round(actual.guests - r.guests)
    items.push({
      id: 'overtime', label: 'Overtime crew', netUsd: d,
      detail: more >= 1
        ? `${more} more skiers got on the lifts for ${k(actual.costUsd - r.costUsd)} extra in payroll and costs. Net ${signedK(d)}.`
        : `No extra skiers: the lifts were not the limit today, so it only added ${k(actual.costUsd - r.costUsd)} of cost.`,
    })
  } else if (lifts >= Math.max(20, actual.guests * 0.03)) {
    const r = replayDay(s, inp, base, log, { overtime: true }).result
    const d = r.netUsd - net
    if (d > IMPACT.minItemUsd) items.push({ id: 'overtime', label: 'Overtime crew (not used)', netUsd: -d, missed: true, detail: `${Math.round(lifts)} skiers gave up at the lifts. A crew would have carried about ${Math.round(r.guests - actual.guests)} more: ${k(d)} net.` })
  }

  // ---- extended hours (lifts to 5 pm, crew on overtime) ----
  if (live.late) {
    const r = replayDay(s, inp, base, log, { late: false }).result
    const d = net - r.netUsd
    items.push({
      id: 'late', label: 'Open to 5 pm', netUsd: d,
      detail: `${Math.round(actual.guests - r.guests)} late skiers and ${k(revenue(actual) - revenue(r))} in sales, for ${k(actual.costUsd - r.costUsd)} of overtime and running costs. Net ${signedK(d)}.`,
    })
  } else {
    const r = replayDay(s, inp, base, log, { late: true }).result
    const d = r.netUsd - net
    if (d > IMPACT.minItemUsd) items.push({ id: 'late', label: 'Open to 5 pm (not used)', netUsd: -d, missed: true, detail: `Staying open an extra hour would have brought about ${Math.round(r.guests - actual.guests)} more skiers and ${k(d)} net.` })
  }

  // ---- half-day ticket from noon ----
  if (actual.halfDayUsd) {
    const r = replayDay(s, inp, base, log, { halfDay: null }).result
    const d = net - r.netUsd
    items.push({
      id: 'halfDay', label: 'Half-day ticket', netUsd: d,
      detail: `${d >= 0 ? 'Paid off' : 'Cost you'} ${k(d)}: ${Math.round(actual.dayTicketGuests - r.dayTicketGuests)} more afternoon skiers, but everyone arriving after noon paid the half-day price instead of the full one.`,
    })
  } else {
    const price = defaultHalfDayUsd(base.priceUsd)
    const r = replayDay(s, inp, base, log, { halfDay: price }).result
    const d = r.netUsd - net
    if (d > IMPACT.minItemUsd) items.push({ id: 'halfDay', label: 'Half-day ticket (not sold)', netUsd: -d, missed: true, detail: `A $${price} half-day ticket from noon would have brought about ${Math.round(r.dayTicketGuests - actual.dayTicketGuests)} more skiers and ${k(d)} net.` })
  }

  // ---- apres special ----
  if (live.apres || live.apresResult) {
    const r = replayDay(s, inp, base, log, { apres: false }).result
    const d = net - r.netUsd
    const a = live.apresResult
    items.push({
      id: 'apres', label: 'Après special', netUsd: d,
      detail: a
        ? `${a.served} of ${a.wanted} guests who wanted in got a seat: ${k(a.revenueUsd)} in sales for ${k(a.costUsd)} of setup and supplies.${a.reputationDelta < 0 ? ' The lodge overflowed, which guests noticed.' : ''}`
        : `It did not run. Net ${signedK(d)}.`,
    })
  } else {
    const r = replayDay(s, inp, base, log, { apres: true }).result
    const d = r.netUsd - net
    if (d > IMPACT.minItemUsd) items.push({ id: 'apres', label: 'Après special (not run)', netUsd: -d, missed: true, detail: `A 3 pm special at the lodge would have added about ${k(d)} net.` })
  }

  // ---- overflow parking shuttle ----
  if (live.shuttle) {
    const r = replayDay(s, inp, base, log, { shuttle: false }).result
    const d = net - r.netUsd
    items.push({
      id: 'shuttle', label: 'Overflow shuttle', netUsd: d,
      detail: `Carried about ${Math.max(0, Math.round(actual.guests - r.guests))} extra skiers in from the overflow lot, for ${k(actual.costUsd - r.costUsd)} in buses and guest costs. Net ${signedK(d)}.`,
    })
  } else if (actual.parkingTurnedAway >= 20) {
    const r = replayDay(s, inp, base, log, { shuttle: true }).result
    const d = r.netUsd - net
    if (d > IMPACT.minItemUsd) items.push({ id: 'shuttle', label: 'Overflow shuttle (not used)', netUsd: -d, missed: true, detail: `${actual.parkingTurnedAway} skiers found the lot full. A shuttle from the overflow lot would have added about ${k(d)} net.` })
  }

  // ---- snowmaking push ----
  if ((inp.snowmaking?.coverage ?? 0) > 0) {
    if (base.ops.snowPush) {
      const r = replayDay(s, inp, base, log, { snowPush: false }).result
      const d = net - r.netUsd
      items.push({ id: 'push', label: 'Snowmaking push', netUsd: d, detail: `Conditions ${Math.round(r.conditions * 100)}% → ${Math.round(actual.conditions * 100)}%, ${Math.round(actual.guests - r.guests)} more skiers, ${k(live.prep.pushCostUsd)} for the push. Net ${signedK(d)}.` })
    } else if (!live.prep.warm && actual.conditions < 1.15) {
      const r = replayDay(s, inp, base, log, { snowPush: true }).result
      const d = r.netUsd - net
      if (d > IMPACT.minItemUsd) items.push({ id: 'push', label: 'Snowmaking push (not used)', netUsd: -d, missed: true, detail: `Thin snow held the day to ${Math.round(actual.conditions * 100)}% conditions. A push would have netted about ${k(d)} more.` })
    }
  }

  // ---- event card choices ----
  for (const c of live.cards.filter((x) => x.answered && x.options.length > 1)) {
    let bestAlt: { id: string; net: number } | null = null
    for (const o of c.options.filter((x) => x.id !== c.answered)) {
      const r = replayDay(s, inp, base, log, { cards: { [c.id]: o.id } }).result
      if (!bestAlt || r.netUsd > bestAlt.net) bestAlt = { id: o.id, net: r.netUsd }
    }
    if (!bestAlt) continue
    const chosen = c.options.find((x) => x.id === c.answered)
    const alt = c.options.find((x) => x.id === bestAlt!.id)
    const d = net - bestAlt.net
    const carry = c.event.kind === 'liftBreakdown' && c.answered === 'rush' ? ' A standard repair would also keep it closed tomorrow.' : ''
    items.push({
      id: `card-${c.id}`, label: `${c.title}: ${chosen?.label ?? c.answered}`, netUsd: d,
      detail: d >= 0 ? `Better than “${alt?.label}” by ${k(d)} today.${carry}` : `“${alt?.label}” would have been ${k(-d)} better today.${carry}`,
    })
  }

  // ---- takeaways and guest quotes ----
  const sig = items.filter((i) => Math.abs(i.netUsd) >= IMPACT.minItemUsd)
  const win = [...sig].filter((i) => i.netUsd > 0 && !i.missed).sort((a, b) => b.netUsd - a.netUsd)[0]
  const miss = [...sig].filter((i) => i.netUsd < 0).sort((a, b) => a.netUsd - b.netUsd)[0]
  if (win) out.takeaways.push(`Best call: ${win.label} (${signedK(win.netUsd)}).`)
  if (miss) out.takeaways.push(`${miss.missed ? 'Biggest missed chance' : 'Biggest cost'}: ${miss.label} (${signedK(miss.netUsd)}).`)
  if (!win && !miss) out.takeaways.push('Nothing you changed moved the needle today. Try a different price or a campaign and compare.')

  const q = out.quotes
  if (verdict === 'high') q.push(`“$${p0} on a ${kind === 'weekday' ? 'weekday' : kind}? I'll wait for a deal.”`)
  if (actual.waitMin >= 10) q.push(`“Stood in line ${actual.waitMin} minutes. Ridiculous.”`)
  if (actual.parkingTurnedAway > 20) q.push('“The lot was full, so we turned around and went home.”')
  if (lifts > 20) q.push('“Gave up on the lift line and left.”')
  if (live.cards.some((c) => c.event.kind === 'liftBreakdown' && c.answered)) q.push('“A lift breaking down in the morning really hurt.”')
  if (actual.conditions >= 1.3) q.push('“Best snow of the season!”')
  else if (actual.conditions <= 0.7) q.push('“Thin and icy today. Not worth the ticket.”')
  else if (actual.warm) q.push('“Slushy by noon.”')
  if ((actual.nightGuests ?? 0) >= 40) q.push('“Night skiing was a blast.”')
  if (out.promos?.some((p) => p.extraGuests >= 20)) q.push('“Saw your ad and had to come up.”')
  if (verdict === 'right' && actual.waitMin < 6 && actual.parkingTurnedAway === 0 && actual.guests > 100) q.push('“Fair price, no lines. Good day.”')
  out.quotes = q.slice(0, 4)

  return out
}
