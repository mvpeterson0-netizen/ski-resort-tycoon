import {
  ROLES, ROLE_SPECS, effectiveBase, liftComfortGuests, seasonDate, seasonInputs, seasonTotals, siteById, staffing,
  type DayResult, type GameState,
} from '../sim'
import { usd } from './format'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (d: DayResult) => {
  const [, m, day] = d.date.split('-').map(Number)
  return `${WEEKDAYS[d.weekday]}, ${MONTHS[m - 1]} ${day}`
}
/** Calendar label for a season day, e.g. "Dec 22". */
const openingLabel = (year: number, day: number) => {
  const d = seasonDate(year, day)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
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

/** Season status: snow, the last day, recent events and season totals. Shown inside the live screen. */
export function SeasonSummary({ game }: { game: GameState }) {
  const site = siteById(game.siteId)!
  const season = game.season
  const today = season?.days.at(-1) ?? null
  const totals = season ? seasonTotals(season.days, season) : null
  const inputs = seasonInputs(game, site)
  const cap = liftComfortGuests(inputs.lifts)
  // Snowmaking holds covered runs at the made base, so show that depth (natural in small type).
  const coverage = inputs.snowmaking?.coverage ?? 0
  const staff = staffing(game, site)
  const recent = (season?.days ?? []).slice(0, -1).flatMap((d) => (d.events ?? []).map((e) => ({ d, e }))).slice(-5).reverse()
  const shortRoles = ROLES.filter((r) => staff.needed[r] > 0 && staff.effects.ratios[r] < 0.999)

  if (!season) return null // the app shows the year-end report once the season closes

  return (
    <div className="season-summary">
      <div className="content">
        <section className="panel snow">
          <div>
            <span>Base</span>
            <b>{Math.round(effectiveBase(season.baseIn, coverage))}"</b>
            {coverage > 0 && Math.round(effectiveBase(season.baseIn, coverage)) !== Math.round(season.baseIn) && (
              <small className="block">{Math.round(season.baseIn)}" natural + made snow</small>
            )}
          </div>
          <div><span>New snow</span><b>{today ? `${today.newSnowIn}"` : '—'}</b></div>
          <div>
            <span>Conditions</span>
            {today?.open ? (
              <b className={today.conditions >= 1.15 ? 'up' : today.conditions <= 0.8 ? 'down' : ''}>{Math.round(today.conditions * 100)}%</b>
            ) : (
              <b className="down">Closed</b>
            )}
          </div>
        </section>
        {today && !today.open && !today.stormClosed && (
          <p className="hint">Not enough snow yet. Opening day: {openingLabel(game.year, season.openingDay)}.</p>
        )}
        {today?.stormClosed && <p className="hint">Closed today: storm and wind hold.</p>}
        {today?.snowmaking && <p className="hint">Snowmaking ran today{today.open ? '' : ' to get you open sooner'}.</p>}
        {today?.open && today.conditions >= 1.4 && <p className="hint">Powder day: demand is way up.</p>}
        {shortRoles.length > 0 && (
          <p className="note">Short-staffed: {shortRoles.map((r) => `${ROLE_SPECS[r].name.toLowerCase()} ${Math.round(staff.effects.ratios[r] * 100)}%`).join(', ')}.</p>
        )}
        {today?.open && today.warm && <p className="hint">Warm day: slushy snow is keeping some skiers away.</p>}

        {today && (
          <>
            <h3 className="group">Last day · {dayLabel(today)}{today.holiday ? ' (holiday)' : ''}</h3>
            {today.events.length > 0 && (
              <ul className="events">
                {today.events.map((e, i) => (
                  <li key={i} className={e.reputationDelta > 0 || e.incomeUsd > 0 ? 'good' : 'bad'}>
                    <b>{e.text}</b>
                    {e.costUsd > 0 && <span>{money(-e.costUsd)}</span>}
                    {e.incomeUsd > 0 && <span>+{money(e.incomeUsd)}</span>}
                    {e.reputationDelta !== 0 && <span>Reputation {e.reputationDelta > 0 ? '+' : '−'}{Math.round(Math.abs(e.reputationDelta) * 100)}</span>}
                  </li>
                ))}
              </ul>
            )}
            <dl className="traits">
              <div className="trait">
                <dt>Guests</dt>
                <dd>
                  {today.guests.toLocaleString()}
                  {today.parkingTurnedAway > 0 && <small>{today.parkingTurnedAway.toLocaleString()} turned away: parking full</small>}
                  {today.turnedAway - today.parkingTurnedAway > 0 && <small>{(today.turnedAway - today.parkingTurnedAway).toLocaleString()} gave up: lifts full</small>}
                  {today.open && today.turnedAway === 0 && <small>Lift line ~{today.waitMin} min</small>}
                </dd>
              </div>
              <div className="trait">
                <dt>Day tickets<small>{today.dayTicketGuests.toLocaleString()} sold · {today.passVisits.toLocaleString()} pass visits</small></dt>
                <dd>{money(today.ticketRevenueUsd)}</dd>
              </div>
              <div className="trait"><dt>Food & drink</dt><dd>{money(today.foodRevenueUsd)}</dd></div>
              <div className="trait"><dt>Operating costs</dt><dd>{money(-today.costUsd)}</dd></div>
              <div className="trait total"><dt>Net today</dt><dd className={today.netUsd < 0 ? 'down' : 'up'}>{money(today.netUsd)}</dd></div>
            </dl>
          </>
        )}

        {recent.length > 0 && (
          <>
            <h3 className="group">Recent events</h3>
            <ul className="events compact">
              {recent.map(({ d, e }, i) => (
                <li key={i} className={e.reputationDelta > 0 || e.incomeUsd > 0 ? 'good' : 'bad'}>
                  <b>{dayLabel(d)}</b> {e.text}{e.costUsd > 0 ? ` (${money(-e.costUsd)})` : ''}
                </li>
              ))}
            </ul>
          </>
        )}
        <h3 className="group">Season so far</h3>
        <GuestBars days={season.days} cap={cap} />
        <div className="kpis">
          <div><span>Skier visits</span><b>{totals!.guests.toLocaleString()}</b></div>
          <div><span>Net</span><b className={totals!.netUsd < 0 ? 'down' : ''}>{usd(totals!.netUsd)}</b></div>
          <div><span>Cash</span><b>{usd(game.cashUsd)}</b></div>
          <div><span>Days open</span><b>{totals!.openDays}</b></div>
          <div><span>Passes sold</span><b>{season.passesSold.toLocaleString()}</b></div>
          <div><span>Pass revenue</span><b>{usd(season.passRevenueUsd)}</b></div>
          <div><span>Reputation</span><b>{Math.round(season.reputation * 100)}%</b></div>
          <div><span>Rentals & lessons</span><b>{usd(totals!.extrasRevenueUsd)}</b></div>
        </div>

      </div>
    </div>
  )
}
