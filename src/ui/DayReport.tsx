/**
 * End-of-day report (PROPOSAL, for owner review): a dense, spreadsheet-style summary of the
 * day, with a "Your decisions" section that says what each choice was worth so the player can
 * learn from it. After a skip it summarises the days skipped.
 */
import { useMemo } from 'react'
import {
  PROMOS, forecast, priceForDay, promoEnd,
  type DayImpact, type DayResult, type GameState, type ImpactItem,
} from '../sim'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const signed = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const num = (n: number) => Math.round(n).toLocaleString('en-US')
const dateOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return { long: `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`, short: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`, wd: WEEKDAYS[d.getUTCDay()].slice(0, 3) }
}
const kindOf = (d: DayResult) => (d.holiday ? 'holiday' : d.weekday === 0 || d.weekday === 6 ? 'weekend' : 'weekday')
const clock = (tick: number, dayEnd = 14) => {
  const min = tick < dayEnd ? 9 * 60 + tick * 30 : 17 * 60 + (tick - dayEnd) * 30
  const h = Math.floor(min / 60)
  return `${h > 12 ? h - 12 : h}${min % 60 ? ':30' : ''}${h >= 12 ? 'p' : 'a'}`
}

/** One labelled row of a compact table. */
function R({ l, v, note, tone, sub }: { l: string; v?: string; note?: string; tone?: 'up' | 'down'; sub?: boolean }) {
  return (
    <tr className={sub ? 'sub' : undefined}>
      <th>{l}{note && <small>{note}</small>}</th>
      <td className={tone}>{v}</td>
    </tr>
  )
}

/** Guests arriving through the day as thin bars. */
function Arrivals({ hourly, late }: { hourly: number[]; late?: boolean }) {
  const max = Math.max(1, ...hourly)
  const end = 14 + (late ? 2 : 0)
  const dayTicks = Math.min(end, hourly.length)
  return (
    <div className="arrivals" role="img" aria-label="Guests arriving through the day">
      <div className="bars">
        {hourly.map((v, i) => <i key={i} className={i >= end ? 'night' : i >= 14 ? 'late' : ''} style={{ height: `${Math.max(6, (v / max) * 100)}%` }} />)}
      </div>
      <div className="arrivals-axis">
        <span>{clock(0)}</span><span>{clock(Math.floor(dayTicks / 2), end)}</span><span>{clock(dayTicks - 1, end)}</span>
        {hourly.length > end && <span>night</span>}
      </div>
    </div>
  )
}

/** What each decision was worth, with the lesson first. */
function Decisions({ impact, game }: { impact: DayImpact; game: GameState }) {
  // Campaign totals for the whole season so far, from every day's own comparison.
  const promoTotals = useMemo(() => {
    const m = new Map<string, { guests: number; before: number; cost: number }>()
    for (const d of game.season?.days ?? []) {
      for (const p of d.impact?.promos ?? []) {
        const t = m.get(p.kind) ?? { guests: 0, before: 0, cost: 0 }
        t.guests += p.extraGuests
        t.before += p.netBeforeCostUsd
        t.cost += p.costTodayUsd
        m.set(p.kind, t)
      }
    }
    return m
  }, [game.season])
  const kindFor = (it: ImpactItem) => (it.id.startsWith('promo-') ? it.id.slice(6) : null)
  return (
    <>
      <h3 className="rep-h">Your decisions</h3>
      {impact.takeaways.length > 0 && (
        <ul className="takeaways">{impact.takeaways.map((t, i) => <li key={i}>{t}</li>)}</ul>
      )}
      <table className="rep-table decisions">
        <tbody>
          {impact.items.map((it) => {
            const kd = kindFor(it)
            const tot = kd ? promoTotals.get(kd) : null
            return (
              <tr key={it.id} className={it.missed ? 'missed' : undefined}>
                <th>
                  {it.label}
                  <small>
                    {it.detail}
                    {tot && tot.cost > 0 && ` So far: ${tot.guests >= 0 ? '+' : '−'}${num(Math.abs(tot.guests))} skiers, ${signed(tot.before - tot.cost)} net after ${money(tot.cost)} of cost.`}
                  </small>
                </th>
                <td className={it.netUsd > 0 && !it.missed ? 'up' : it.netUsd < 0 ? 'down' : undefined}>
                  {it.netUsd === 0 ? '—' : `${signed(it.netUsd)}${it.missed ? '*' : ''}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {impact.items.some((i) => i.missed) && <p className="rep-foot">* a chance you did not take; the amount is what it would have added.</p>}
      <p className="rep-foot">Each line replays today with only that choice changed. They are for today&apos;s takings; they do not count reputation or later days.</p>
    </>
  )
}

function DayDetail({ d, vsAvg, game }: { d: DayResult; vsAvg: number | null; game: GameState }) {
  const cp = d.costParts
  const revenue = d.ticketRevenueUsd + d.foodRevenueUsd + d.extrasRevenueUsd + d.eventIncomeUsd
  const running = cp ? cp.payroll + cp.lifts + cp.overhead + cp.snowmaking + cp.guests + cp.lights + (cp.services ?? 0) : 0
  const other = d.costUsd - running - (d.marketingUsd ?? 0) - d.eventCostUsd
  const avgPrice = d.dayTicketGuests > 0 ? d.ticketRevenueUsd / d.dayTicketGuests : d.ticketPriceUsd
  return (
    <>
      <div className="kpis dense">
        <div><span>Net today</span><b className={d.netUsd < 0 ? 'down' : 'up'}>{signed(d.netUsd)}</b>{vsAvg !== null && <small>{signed(d.netUsd - vsAvg)} vs avg {kindOf(d)}</small>}</div>
        <div><span>Skiers</span><b>{num(d.guests)}</b><small>{num(d.dayTicketGuests)} tix · {num(d.passVisits)} pass{d.nightGuests ? ` · ${num(d.nightGuests)} night` : ''}</small></div>
        <div><span>Busiest</span><b>{d.peakOnHill !== undefined ? num(d.peakOnHill) : '—'}</b><small>line up to {d.waitMin} min</small></div>
        <div><span>Reputation</span><b>{Math.round(d.reputation * 100)}%</b><small>conditions {Math.round(d.conditions * 100)}%</small></div>
      </div>
      <p className="rep-line">
        {d.baseIn}″ base{d.newSnowIn > 0 ? `, +${d.newSnowIn}″ new` : ''}{d.warm ? ' · warm, slushy' : d.conditions >= 1.4 ? ' · powder day' : ''}{d.snowmaking ? ' · snowmaking ran' : ''}
        {d.parkingTurnedAway > 0 ? ` · ${num(d.parkingTurnedAway)} turned away (parking)` : ''}
        {d.turnedAway - d.parkingTurnedAway > 0 ? ` · ${num(d.turnedAway - d.parkingTurnedAway)} gave up (lift lines)` : ''}
      </p>

      {d.impact ? <Decisions impact={d.impact} game={game} /> : (
        <p className="rep-foot">Decision feedback is not available for this day.</p>
      )}

      <h3 className="rep-h">Money</h3>
      <div className="rep-cols">
        <table className="rep-table">
          <thead><tr><th colSpan={2}>In</th></tr></thead>
          <tbody>
            <R l="Day tickets" v={money(d.ticketRevenueUsd)} note={`${num(d.dayTicketGuests)} × $${Math.round(avgPrice)}`} />
            <R l="Food & drink" v={money(d.foodRevenueUsd)} />
            <R l="Rentals, lessons" v={money(d.extrasRevenueUsd)} />
            {d.eventIncomeUsd > 0 && <R l="Events" v={money(d.eventIncomeUsd)} />}
            {d.nightRevenueUsd ? <R l="of which night" v={money(d.nightRevenueUsd)} sub /> : null}
            <R l="Total in" v={money(revenue)} tone="up" />
          </tbody>
        </table>
        <table className="rep-table">
          <thead><tr><th colSpan={2}>Out</th></tr></thead>
          <tbody>
            {cp ? (
              <>
                <R l="Staff" v={money(cp.payroll)} />
                <R l="Lifts" v={money(cp.lifts)} />
                <R l="Overhead, grooming" v={money(cp.overhead)} />
                <R l="Guest costs" v={money(cp.guests)} />
                {cp.snowmaking > 0 && <R l="Snowmaking" v={money(cp.snowmaking)} />}
                {cp.lights > 0 && <R l="Night lights" v={money(cp.lights)} />}
                {(cp.services ?? 0) > 0 && <R l="Après, shuttle" v={money(cp.services!)} />}
              </>
            ) : <R l="Operating" v={money(d.costUsd - (d.marketingUsd ?? 0) - d.eventCostUsd)} />}
            {(d.marketingUsd ?? 0) > 0 && <R l="Marketing" v={money(d.marketingUsd!)} />}
            {d.eventCostUsd > 0 && <R l="Repairs, legal" v={money(d.eventCostUsd)} />}
            {cp && Math.abs(other) > 1 && <R l="Other" v={money(other)} />}
            <R l="Total out" v={money(d.costUsd)} tone="down" />
          </tbody>
        </table>
      </div>
      {d.hourly && d.hourly.length > 0 && <Arrivals hourly={d.hourly} late={d.late} />}

      {d.impact && d.impact.quotes.length > 0 && (
        <>
          <h3 className="rep-h">What guests said</h3>
          <ul className="quotes">{d.impact.quotes.map((q, i) => <li key={i}>{q}</li>)}</ul>
          <p className="rep-foot">Lines written from today&apos;s numbers, not real feedback.</p>
        </>
      )}

      {d.events.length > 0 && (
        <>
          <h3 className="rep-h">What happened</h3>
          <ul className="events compact">
            {d.events.map((e, i) => (
              <li key={i} className={e.reputationDelta > 0 || e.incomeUsd > 0 ? 'good' : 'bad'}>
                <b>{e.text}</b>
                {e.costUsd > 0 && ` ${money(-e.costUsd)}`}{e.incomeUsd > 0 && ` ${signed(e.incomeUsd)}`}
                {e.reputationDelta !== 0 && ` · reputation ${e.reputationDelta > 0 ? '+' : '−'}${Math.round(Math.abs(e.reputationDelta) * 100)}`}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

export function DayReport({ days, game, onNext, onSkipWeek, onCalendar }: {
  /** The day just played, or all the days of a skip (oldest first). */
  days: DayResult[]
  game: GameState
  onNext: () => void
  onSkipWeek: () => void
  onCalendar: () => void
}) {
  const last = days[days.length - 1]
  const season = game.season
  const totals = useMemo(() => {
    const all = season?.days ?? []
    const open = all.filter((d) => d.open)
    return { visits: open.reduce((s, d) => s + d.guests, 0), net: all.reduce((s, d) => s + d.netUsd, 0), openDays: open.length, days: all.length }
  }, [season])
  // Compared with the average of earlier open days of the same kind this season.
  const vsAvg = useMemo(() => {
    const same = (season?.days ?? []).filter((d) => d.open && d.day < last.day && kindOf(d) === kindOf(last))
    return same.length >= 2 ? same.reduce((s, d) => s + d.netUsd, 0) / same.length : null
  }, [season, last])
  const next = useMemo(() => (season ? forecast(season, game.difficulty.snow, 2)[0] : null), [season, game.difficulty.snow])
  const plan = next && season ? game.calendar.ops[next.day] : undefined
  const nextPrice = next ? priceForDay(game.ticketPriceUsd, game.calendar, game.year, next.day) : 0
  const campaigns = next ? game.promos.filter((p) => p.startDay <= next.day && promoEnd(p) >= next.day) : []
  const multi = days.length > 1
  const total = days.reduce((s, d) => s + d.netUsd, 0)
  const best = multi ? days.reduce((a, b) => (b.netUsd > a.netUsd ? b : a)) : null
  const worst = multi ? days.reduce((a, b) => (b.netUsd < a.netUsd ? b : a)) : null
  const first = dateOf(days[0].date), lastDate = dateOf(last.date)
  const openDays = days.filter((d) => d.open)
  const passNet = totals.net + (season?.passRevenueUsd ?? 0)

  return (
    <div className="report rep" role="dialog" aria-label="End of day report">
      <div className="report-scroll">
        <div className="rep-head">
          <div>
            <p className="report-eyebrow">{multi ? `${days.length} days skipped` : 'End of day'}</p>
            <h2 className="report-title">{multi ? `${first.short} – ${lastDate.short}` : lastDate.long}</h2>
          </div>
          <span className="rep-kind">{multi ? `${openDays.length} open` : kindOf(last)}{last.nightGuests && !multi ? ' + night' : ''}</span>
        </div>

        {multi && (
          <>
            <div className="kpis dense">
              <div><span>Net, {days.length} days</span><b className={total < 0 ? 'down' : 'up'}>{signed(total)}</b></div>
              <div><span>Skiers</span><b>{num(days.reduce((s, d) => s + d.guests, 0))}</b></div>
              {best && <div><span>Best</span><b className="up">{signed(best.netUsd)}</b><small>{dateOf(best.date).wd} {dateOf(best.date).short}</small></div>}
              {worst && <div><span>Slowest</span><b className={worst.netUsd < 0 ? 'down' : ''}>{signed(worst.netUsd)}</b><small>{dateOf(worst.date).wd} {dateOf(worst.date).short}</small></div>}
            </div>
            <table className="rep-table">
              <thead><tr><th>Day</th><td>Skiers</td><td>Net</td></tr></thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day}>
                    <th>{dateOf(d.date).wd} {dateOf(d.date).short}{d.events.length > 0 && <small>{d.events.length} event{d.events.length > 1 ? 's' : ''}</small>}</th>
                    <td>{d.open ? num(d.guests) : 'closed'}</td>
                    <td className={d.netUsd < 0 ? 'down' : 'up'}>{signed(d.netUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {days.flatMap((d) => d.impact?.takeaways ?? []).length > 0 && (
              <>
                <h3 className="rep-h">Lessons from these days</h3>
                <ul className="takeaways">
                  {days.filter((d) => d.impact).slice(-3).flatMap((d) => (d.impact!.takeaways.slice(0, 1).map((t) => `${dateOf(d.date).short}: ${t}`))).map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </>
            )}
            <h2 className="report-title small">The last day · {lastDate.long}</h2>
          </>
        )}

        {last.open ? <DayDetail d={last} vsAvg={vsAvg} game={game} /> : <p className="note">The resort was closed. Fixed costs of {money(last.costUsd)} still came out.</p>}

        <h3 className="rep-h">Season so far and tomorrow</h3>
        <div className="rep-cols">
          <table className="rep-table">
            <tbody>
              <R l="Skier visits" v={num(totals.visits)} note={`${totals.openDays} of ${totals.days} days open`} />
              <R l="Net incl. passes" v={signed(passNet)} note={`${money(season?.passRevenueUsd ?? 0)} of pass sales`} tone={passNet < 0 ? 'down' : undefined} />
              <R l="Cash" v={money(game.cashUsd)} />
            </tbody>
          </table>
          {next && (
            <table className="rep-table">
              <tbody>
                <R l="Tomorrow" v={next.beforeOpening ? 'not open' : next.outlook} note={`${dateOf(next.date).wd} ${dateOf(next.date).short} · ${next.snowHighIn > 0 ? `${next.snowLowIn === next.snowHighIn ? next.snowHighIn : `${next.snowLowIn}–${next.snowHighIn}`}″ snow` : 'no snow'}${next.warmChance >= 0.3 ? `, ${Math.round(next.warmChance * 100)}% warm` : ''}`} />
                <R l="Ticket" v={`$${nextPrice}`} note={plan?.price !== undefined ? 'your price' : `${next.kind} price`} />
                {(plan?.night || plan?.overtime || plan?.snowPush || campaigns.length > 0) && (
                  <R l="Planned" v={[plan?.night && 'night', plan?.overtime && 'overtime', plan?.snowPush && 'snow push', ...campaigns.map((c) => PROMOS[c.kind].name)].filter(Boolean).join(', ')} />
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <nav className="report-actions">
        <button className="btn primary" onClick={onNext}>Next day ▸</button>
        <div className="row">
          <button className="btn" onClick={onCalendar}>Calendar</button>
          <button className="btn" onClick={onSkipWeek}>Skip a week</button>
        </div>
      </nav>
    </div>
  )
}
