import {
  SEASON, advanceDay, liftComfortGuests, seasonInputs, seasonTotals, setTicketPrice, siteById,
  type DayResult, type GameState,
} from '../sim'
import { usd } from './format'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (d: DayResult) => {
  const [, m, day] = d.date.split('-').map(Number)
  return `${WEEKDAYS[d.weekday]}, ${MONTHS[m - 1]} ${day}`
}
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`

/** Last N days of guests as small bars (closed days shown as empty). */
function GuestBars({ days, cap }: { days: DayResult[]; cap: number }) {
  const recent = days.slice(-21)
  const max = Math.max(cap, ...recent.map((d) => d.guests), 1)
  return (
    <div className="bars" role="img" aria-label="Guests, last 21 days">
      {recent.map((d) => (
        <i
          key={d.day}
          className={!d.open ? 'closed' : d.holiday ? 'holiday' : d.weekday === 0 || d.weekday === 6 ? 'weekend' : ''}
          style={{ height: `${Math.max(3, (d.guests / max) * 100)}%` }}
          title={`${dayLabel(d)}: ${d.guests}`}
        />
      ))}
    </div>
  )
}

export function SeasonScreen({ game, onChange, onExit }: {
  game: GameState; onChange: (g: GameState) => void; onExit: () => void
}) {
  const site = siteById(game.siteId)!
  const season = game.season
  const today = season?.days.at(-1) ?? null
  const totals = season ? seasonTotals(season.days) : null
  const cap = liftComfortGuests(seasonInputs(game, site).lifts)

  const step = (n: number) => {
    let g = game
    for (let i = 0; i < n && g.phase === 'season'; i++) g = advanceDay(g, site).game
    onChange(g)
  }

  if (!season) return null // the app shows the year-end report once the season closes

  return (
    <main className="screen">
      <div className="season-head">
        <h2 className="screen-title">{today ? dayLabel(today) : 'Opening soon'}</h2>
        <span>Day {season.day} of {SEASON.lengthDays}{today?.holiday && <b className="tag">Holiday</b>}</span>
      </div>
      <div className="content">
        <section className="panel snow">
          <div><span>Base</span><b>{season.baseIn.toFixed(0)}"</b></div>
          <div><span>New snow</span><b>{today ? `${today.newSnowIn}"` : '—'}</b></div>
          <div><span>Status</span><b className={today?.open ? 'up' : 'down'}>{today ? (today.open ? 'Open' : 'Closed') : '—'}</b></div>
        </section>
        {today && !today.open && (
          <p className="hint">Need {SEASON.weather.openBaseIn}" of base to open. Snowmaking comes later.</p>
        )}
        {today?.warm && <p className="hint">Warm day: the base melted.</p>}

        {today && (
          <>
            <h3 className="group">Today</h3>
            <dl className="traits">
              <div className="trait">
                <dt>Guests</dt>
                <dd>
                  {today.guests.toLocaleString()}
                  {today.turnedAway > 0 && <small>{today.turnedAway.toLocaleString()} gave up: lifts full</small>}
                  {today.open && today.turnedAway === 0 && <small>Lift line ~{today.waitMin} min</small>}
                </dd>
              </div>
              <div className="trait"><dt>Tickets</dt><dd>{money(today.ticketRevenueUsd)}</dd></div>
              <div className="trait"><dt>Food & drink</dt><dd>{money(today.foodRevenueUsd)}</dd></div>
              <div className="trait"><dt>Operating costs</dt><dd>{money(-today.costUsd)}</dd></div>
              <div className="trait total"><dt>Net today</dt><dd className={today.netUsd < 0 ? 'down' : 'up'}>{money(today.netUsd)}</dd></div>
            </dl>
          </>
        )}

        <h3 className="group">Season so far</h3>
        <GuestBars days={season.days} cap={cap} />
        <div className="kpis">
          <div><span>Skier visits</span><b>{totals!.guests.toLocaleString()}</b></div>
          <div><span>Net</span><b className={totals!.netUsd < 0 ? 'down' : ''}>{usd(totals!.netUsd)}</b></div>
          <div><span>Cash</span><b>{usd(game.cashUsd)}</b></div>
          <div><span>Days open</span><b>{totals!.openDays}</b></div>
        </div>

        <div className="panel price">
          <span>Day ticket</span>
          <button className="btn" aria-label="Lower price" onClick={() => onChange(setTicketPrice(game, season.ticketPriceUsd - 5))}>−</button>
          <b>${season.ticketPriceUsd}</b>
          <button className="btn" aria-label="Raise price" onClick={() => onChange(setTicketPrice(game, season.ticketPriceUsd + 5))}>+</button>
        </div>
        <p className="foot">All guest, price and cost figures are placeholders.</p>
      </div>
      <nav className="actions">
        <button className="btn primary" onClick={() => step(1)}>Next day</button>
        <div className="row">
          <button className="btn" onClick={onExit}>Resort</button>
          <button className="btn" onClick={() => step(7)}>Sim 7 days</button>
        </div>
      </nav>
    </main>
  )
}
