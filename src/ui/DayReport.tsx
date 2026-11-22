/**
 * End-of-day report (PROPOSAL, for owner review): what the day brought in, where the money
 * went, what happened, and what tomorrow looks like. Shown after each open day; after a
 * skip it summarises the days skipped. Content is a first proposal to adjust.
 */
import { useMemo } from 'react'
import {
  PROMOS, forecast, priceForDay, promoEnd,
  type DayResult, type GameState,
} from '../sim'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const signed = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const num = (n: number) => Math.round(n).toLocaleString('en-US')
const dateOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return { long: `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`, short: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` }
}
const kindOf = (d: DayResult) => (d.holiday ? 'holiday' : d.weekday === 0 || d.weekday === 6 ? 'weekend' : 'weekday')
const clock = (tick: number) => {
  const min = tick < 14 ? 9 * 60 + tick * 30 : 17 * 60 + (tick - 14) * 30
  const h = Math.floor(min / 60)
  return `${h > 12 ? h - 12 : h}${min % 60 ? ':30' : ''}${h >= 12 ? 'p' : 'a'}`
}

function Row({ label, value, sub, tone, indent }: { label: string; value: string; sub?: string; tone?: 'up' | 'down'; indent?: boolean }) {
  return (
    <div className={`trait${indent ? ' indent' : ''}`}>
      <dt>{label}{sub && <small>{sub}</small>}</dt>
      <dd className={tone ?? ''}>{value}</dd>
    </div>
  )
}

/** Guests arriving through the day as small bars, with the hours marked. */
function Arrivals({ hourly }: { hourly: number[] }) {
  const max = Math.max(1, ...hourly)
  const dayTicks = Math.min(14, hourly.length)
  return (
    <div className="arrivals" role="img" aria-label="Guests arriving through the day">
      <div className="bars">
        {hourly.map((v, i) => <i key={i} className={i >= 14 ? 'night' : ''} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />)}
      </div>
      <div className="arrivals-axis">
        <span>{clock(0)}</span><span>{clock(Math.floor(dayTicks / 2))}</span><span>{clock(dayTicks - 1)}</span>
        {hourly.length > 14 && <span>night</span>}
      </div>
    </div>
  )
}

function DayDetail({ d, vsAvg }: { d: DayResult; vsAvg: number | null }) {
  const cp = d.costParts
  const revenue = d.ticketRevenueUsd + d.foodRevenueUsd + d.extrasRevenueUsd + d.eventIncomeUsd
  const running = cp ? cp.payroll + cp.lifts + cp.overhead + cp.snowmaking + cp.guests + cp.lights : 0
  const other = d.costUsd - running - (d.marketingUsd ?? 0) - d.eventCostUsd
  const avgPrice = d.dayTicketGuests > 0 ? d.ticketRevenueUsd / d.dayTicketGuests : d.ticketPriceUsd
  const sameKind = kindOf(d)
  return (
    <>
      <div className="report-net">
        <span>Net today</span>
        <b className={d.netUsd < 0 ? 'down' : 'up'}>{signed(d.netUsd)}</b>
        {vsAvg !== null && <small>{signed(d.netUsd - vsAvg)} vs your average {sameKind}</small>}
      </div>

      <h3 className="group">Guests</h3>
      <dl className="traits">
        <Row
          label="Skier visits" value={num(d.guests)}
          sub={`${num(d.dayTicketGuests)} day tickets · ${num(d.passVisits)} pass visits${d.nightGuests ? ` · ${num(d.nightGuests)} at night` : ''}`}
        />
        {d.peakOnHill !== undefined && <Row label="Busiest moment" value={`${num(d.peakOnHill)} on the hill`} sub={`Longest lift line ${d.waitMin} min`} />}
        {d.peakOnHill === undefined && <Row label="Longest lift line" value={`${d.waitMin} min`} />}
        {d.parkingTurnedAway > 0 && <Row label="Turned away: parking full" value={num(d.parkingTurnedAway)} tone="down" />}
        {d.turnedAway - d.parkingTurnedAway > 0 && <Row label="Gave up: lift lines too long" value={num(d.turnedAway - d.parkingTurnedAway)} tone="down" />}
        <Row label="Reputation" value={`${Math.round(d.reputation * 100)}%`} />
      </dl>
      {d.hourly && d.hourly.length > 0 && <Arrivals hourly={d.hourly} />}

      <h3 className="group">Money in</h3>
      <dl className="traits">
        <Row label="Day tickets" value={money(d.ticketRevenueUsd)} sub={`${num(d.dayTicketGuests)} × avg $${Math.round(avgPrice)} · sticker $${d.ticketPriceUsd}`} />
        <Row label="Food & drink" value={money(d.foodRevenueUsd)} />
        <Row label="Rentals & lessons" value={money(d.extrasRevenueUsd)} />
        {d.eventIncomeUsd > 0 && <Row label="Events (race fee etc.)" value={money(d.eventIncomeUsd)} />}
        {d.nightRevenueUsd ? <Row label="Night session" value={money(d.nightRevenueUsd)} sub="included in the lines above" indent /> : null}
        <Row label="Total in" value={money(revenue)} />
      </dl>

      <h3 className="group">Money out</h3>
      <dl className="traits">
        {cp ? (
          <>
            <Row label="Staff payroll" value={money(cp.payroll)} />
            <Row label="Lifts" value={money(cp.lifts)} />
            <Row label="Overhead, grooming & base area" value={money(cp.overhead)} />
            <Row label="Guest costs" value={money(cp.guests)} sub="supplies, card fees, wear" />
            {cp.snowmaking > 0 && <Row label="Snowmaking" value={money(cp.snowmaking)} />}
            {cp.lights > 0 && <Row label="Night lighting" value={money(cp.lights)} />}
          </>
        ) : (
          <Row label="Operating costs" value={money(d.costUsd - (d.marketingUsd ?? 0) - d.eventCostUsd)} />
        )}
        {(d.marketingUsd ?? 0) > 0 && <Row label="Marketing" value={money(d.marketingUsd!)} />}
        {d.eventCostUsd > 0 && <Row label="Repairs, settlements & fixes" value={money(d.eventCostUsd)} />}
        {cp && Math.abs(other) > 1 && <Row label="Other" value={money(other)} />}
        <Row label="Total out" value={money(d.costUsd)} />
      </dl>

      <h3 className="group">Conditions</h3>
      <dl className="traits">
        <Row label="Snow" value={`${d.baseIn}″ base`} sub={d.newSnowIn > 0 ? `${d.newSnowIn}″ of new snow` : 'No new snow'} />
        <Row label="Conditions" value={`${Math.round(d.conditions * 100)}%`} sub={d.warm ? 'A warm, slushy day' : d.conditions >= 1.4 ? 'Powder day' : undefined} />
        {d.snowmaking && <Row label="Snowmaking" value="Ran" />}
      </dl>

      {d.events.length > 0 && (
        <>
          <h3 className="group">What happened</h3>
          <ul className="events">
            {d.events.map((e, i) => (
              <li key={i} className={e.reputationDelta > 0 || e.incomeUsd > 0 ? 'good' : 'bad'}>
                <b>{e.text}</b>
                {e.costUsd > 0 && <span>{money(-e.costUsd)}</span>}
                {e.incomeUsd > 0 && <span>{signed(e.incomeUsd)}</span>}
                {e.reputationDelta !== 0 && <span>Reputation {e.reputationDelta > 0 ? '+' : '−'}{Math.round(Math.abs(e.reputationDelta) * 100)}</span>}
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
  const best = multi ? days.reduce((a, b) => (b.netUsd > a.netUsd ? b : a)) : null
  const worst = multi ? days.reduce((a, b) => (b.netUsd < a.netUsd ? b : a)) : null
  const first = dateOf(days[0].date), lastDate = dateOf(last.date)
  const openDays = days.filter((d) => d.open)

  return (
    <div className="report" role="dialog" aria-label="End of day report">
      <div className="report-scroll">
        <p className="report-eyebrow">{multi ? `${days.length} days skipped` : 'End of day'}</p>
        <h2 className="report-title">{multi ? `${first.short} – ${lastDate.short}` : lastDate.long}</h2>
        <p className="tagline">
          {multi ? `${openDays.length} open days` : `${kindOf(last)} · ${last.open ? `open 9 am – 4 pm${last.nightGuests ? ', then night skiing' : ''}` : 'resort closed'}`}
          {last.holiday && !multi ? ' · holiday' : ''}
        </p>

        {multi && (
          <>
            <div className="report-net">
              <span>Net over {days.length} days</span>
              <b className={days.reduce((s, d) => s + d.netUsd, 0) < 0 ? 'down' : 'up'}>{signed(days.reduce((s, d) => s + d.netUsd, 0))}</b>
              <small>{num(days.reduce((s, d) => s + d.guests, 0))} skier visits</small>
            </div>
            {best && worst && openDays.length > 1 && (
              <dl className="traits">
                <Row label="Best day" value={signed(best.netUsd)} sub={dateOf(best.date).long} tone="up" />
                <Row label="Slowest day" value={signed(worst.netUsd)} sub={dateOf(worst.date).long} tone={worst.netUsd < 0 ? 'down' : undefined} />
              </dl>
            )}
            <h3 className="group">Day by day</h3>
            <dl className="traits">
              {days.map((d) => (
                <Row
                  key={d.day} label={dateOf(d.date).long}
                  sub={d.open ? `${num(d.guests)} skiers${d.events.length ? ` · ${d.events.length} event${d.events.length > 1 ? 's' : ''}` : ''}` : 'Closed'}
                  value={signed(d.netUsd)} tone={d.netUsd < 0 ? 'down' : undefined}
                />
              ))}
            </dl>
            {days.flatMap((d) => d.events.map((e) => ({ d, e }))).length > 0 && (
              <>
                <h3 className="group">Events while you skipped</h3>
                <ul className="events compact">
                  {days.flatMap((d) => d.events.map((e) => ({ d, e }))).map(({ d, e }, i) => (
                    <li key={i} className={e.reputationDelta > 0 || e.incomeUsd > 0 ? 'good' : 'bad'}><b>{dateOf(d.date).short}</b> {e.text}</li>
                  ))}
                </ul>
              </>
            )}
            <h2 className="report-title small">The last day · {lastDate.long}</h2>
          </>
        )}

        {last.open ? <DayDetail d={last} vsAvg={vsAvg} /> : <p className="note">The resort was closed. Fixed costs of {money(last.costUsd)} still came out.</p>}

        <h3 className="group">Season so far</h3>
        <dl className="traits">
          <Row label="Skier visits" value={num(totals.visits)} sub={`${totals.openDays} open days of ${totals.days}`} />
          <Row label="Net from running the mountain" value={signed(totals.net + (season?.passRevenueUsd ?? 0))} sub={`includes ${money(season?.passRevenueUsd ?? 0)} of season-pass sales`} tone={totals.net + (season?.passRevenueUsd ?? 0) < 0 ? 'down' : undefined} />
          <Row label="Cash" value={money(game.cashUsd)} />
        </dl>

        {next && (
          <>
            <h3 className="group">Tomorrow · {dateOf(next.date).long}</h3>
            <dl className="traits">
              <Row label="Forecast" value={next.beforeOpening ? 'Not open yet' : next.outlook} sub={`${next.snowHighIn > 0 ? `${next.snowLowIn === next.snowHighIn ? next.snowHighIn : `${next.snowLowIn}–${next.snowHighIn}`}″ snow` : 'No snow'}${next.warmChance >= 0.3 ? ` · ${Math.round(next.warmChance * 100)}% warm` : ''}`} />
              <Row label="Day ticket" value={`$${nextPrice}`} sub={plan?.price !== undefined ? 'Set by you for this date' : `${next.kind} price`} />
              {plan && (plan.night || plan.overtime || plan.snowPush) && (
                <Row label="Planned" value={[plan.night && 'night session', plan.overtime && 'overtime crew', plan.snowPush && 'snowmaking push'].filter(Boolean).join(', ')} />
              )}
              {campaigns.length > 0 && <Row label="Campaigns" value={campaigns.map((c) => PROMOS[c.kind].name).join(', ')} />}
            </dl>
          </>
        )}
      </div>
      <nav className="report-actions">
        <button className="btn primary" onClick={onNext}>Next day ▸</button>
        <div className="row">
          <button className="btn" onClick={onCalendar}>Plan on the calendar</button>
          <button className="btn" onClick={onSkipWeek}>Skip a week</button>
        </div>
      </nav>
    </div>
  )
}
