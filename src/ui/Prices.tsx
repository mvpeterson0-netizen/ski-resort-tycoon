/**
 * Prices tab: base ticket prices (weekday, weekend, holiday, night, season pass), a season
 * calendar for per-day plans (price, night session, overtime, snowmaking push) and the
 * marketing campaigns. Pass holders are never affected by daily prices.
 */
import { useMemo, useState, type ReactNode } from 'react'
import {
  PRICING, PROMOS, PROMO_KINDS, SEASON, bookCampaign, campaignBlocker, campaignCostUsd, cancelPromo, costOf, clampPrice, dayKind, estimatePassSales, forecast, priceForDay, promoEnd, promoResults, promoStatus,
  resolvedPrices, seasonDate, seasonInputs, setDayOps, setKindPrice, setPassPrice, setTicketPrice, siteById,
  type DayKind, type DayOps, type GameState, type Promo, type PromoKind,
} from '../sim'
import { usd } from './format'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayName = (year: number, day: number) => {
  const d = seasonDate(year, day)
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

type Tab = 'prices' | 'calendar' | 'marketing'

function Stepper({ label, hint, value, step = PRICING.stepUsd, onSet, badge, onReset, disabled }: {
  label: string; hint?: ReactNode; value: number; step?: number; onSet: (v: number) => void; badge?: string; onReset?: () => void; disabled?: boolean
}) {
  return (
    <div className="panel price">
      <span>
        {label}{badge && <em className="badge-inline">{badge}</em>}
        {hint && <small className="block">{hint}</small>}
        {onReset && <button className="link" onClick={onReset}>Use default</button>}
      </span>
      <button className="btn" aria-label={`Lower ${label}`} disabled={disabled} onClick={() => onSet(value - step)}>−</button>
      <b>${value}</b>
      <button className="btn" aria-label={`Raise ${label}`} disabled={disabled} onClick={() => onSet(value + step)}>+</button>
    </div>
  )
}

export function PricesScreen({ game, onChange, onBack }: { game: GameState; onChange: (g: GameState) => void; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('prices')
  return (
    <main className="screen">
      <h2 className="screen-title">Prices &amp; planning</h2>
      <div className="seg" role="tablist">
        {(['prices', 'calendar', 'marketing'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {k === 'prices' ? 'Prices' : k === 'calendar' ? 'Calendar' : 'Marketing'}
          </button>
        ))}
      </div>
      <div className="content">
        {tab === 'prices' && <BasePrices game={game} onChange={onChange} />}
        {tab === 'calendar' && <CalendarTab game={game} onChange={onChange} />}
        {tab === 'marketing' && <MarketingTab game={game} onChange={onChange} />}
      </div>
      <nav className="actions"><button className="btn" onClick={onBack}>Back to resort</button></nav>
    </main>
  )
}

function BasePrices({ game, onChange }: { game: GameState; onChange: (g: GameState) => void }) {
  const site = siteById(game.siteId)
  const inSeason = game.phase === 'season'
  const p = resolvedPrices(game.ticketPriceUsd, game.calendar)
  const lights = game.amenities.lights > 0
  const cal = (k: 'weekend' | 'holiday' | 'night', v: number | null) => onChange({ ...game, calendar: setKindPrice(game.calendar, k, v) })
  const estimate = site && !inSeason && game.lifts.length && game.trails.length
    ? estimatePassSales(game.year, seasonInputs(game, site), game.passPriceUsd, game.ticketPriceUsd) : null
  return (
    <>
      <h3 className="group">Day tickets</h3>
      <Stepper label="Weekday" hint="Monday to Friday" value={p.weekday} onSet={(v) => onChange(setTicketPrice(game, v))} />
      <Stepper
        label="Weekend" hint="Saturday and Sunday: busier, so it can bear more" value={p.weekend} badge={game.calendar.weekend === null ? 'default' : undefined}
        onSet={(v) => cal('weekend', v)} onReset={game.calendar.weekend === null ? undefined : () => cal('weekend', null)}
      />
      <Stepper
        label="Holiday" hint="Dec 24–Jan 1, MLK and Presidents' Day weekends" value={p.holiday} badge={game.calendar.holiday === null ? 'default' : undefined}
        onSet={(v) => cal('holiday', v)} onReset={game.calendar.holiday === null ? undefined : () => cal('holiday', null)}
      />
      {lights && <Stepper label="Night session" hint="5:00 to 9:00 pm, on nights you run the lights" value={p.night} onSet={(v) => cal('night', clampPrice(v))} />}
      <p className="hint small">Weekend and holiday prices follow the weekday price until you set them. Change any single day on the calendar.</p>

      <h3 className="group">Season pass</h3>
      {inSeason ? (
        <div className="panel price"><span>Season pass<small className="block">Locked for this season</small></span><b>${game.passPriceUsd}</b></div>
      ) : (
        <Stepper label="Season pass" hint="Locked when the season starts" step={25} value={game.passPriceUsd} onSet={(v) => onChange(setPassPrice(game, v))} />
      )}
      {estimate && (
        <p className="hint small center">
          Estimated <b>{estimate.passesSold.toLocaleString()}</b> passes · <b>{usd(estimate.revenueUsd)}</b> cash when the season starts.
          Pass holders ski on any day without paying more, so daily prices never touch them.
        </p>
      )}
      {game.lastSeason && (
        <>
          <h3 className="group">Last season (year {game.lastSeason.year})</h3>
          <dl className="traits">
            <div className="trait"><dt>Days open</dt><dd>{game.lastSeason.openDays} of {game.lastSeason.days}</dd></div>
            <div className="trait"><dt>Skier visits</dt><dd>{game.lastSeason.guests.toLocaleString()}</dd></div>
            <div className="trait"><dt>Passes sold</dt><dd>{game.lastSeason.passesSold.toLocaleString()}</dd></div>
            <div className="trait"><dt>Operating profit</dt><dd>{usd(game.lastSeason.netUsd)}</dd></div>
          </dl>
        </>
      )}
    </>
  )
}

const KIND_CLASS: Record<DayKind, string> = { weekday: 'wk', weekend: 'we', holiday: 'ho' }

function CalendarTab({ game, onChange }: { game: GameState; onChange: (g: GameState) => void }) {
  const site = siteById(game.siteId)
  const today = game.phase === 'season' ? game.season?.day ?? 0 : -1
  const playing = game.phase === 'season' && !!game.live
  const [sel, setSel] = useState<number | null>(null)
  const lights = game.amenities.lights > 0
  const hasSnow = game.snowmakingKm > 0
  const fc = useMemo(() => (game.season && game.phase === 'season' ? forecast(game.season, game.difficulty.snow) : []), [game.season, game.phase, game.difficulty.snow])
  const promoDays = useMemo(() => {
    const m = new Set<number>()
    for (const p of game.promos) for (let d = p.startDay; d <= promoEnd(p); d++) m.add(d)
    return m
  }, [game.promos])

  // Group the season's days by month.
  const months = useMemo(() => {
    const out: { key: string; label: string; offset: number; days: number[] }[] = []
    for (let d = 0; d < SEASON.lengthDays; d++) {
      const dt = seasonDate(game.year, d)
      const key = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`
      let m = out.at(-1)
      if (!m || m.key !== key) { m = { key, label: `${MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`, offset: dt.getUTCDay(), days: [] }; out.push(m) }
      m.days.push(d)
    }
    return out
  }, [game.year])

  const patch = (day: number, p: Partial<DayOps> | null) => onChange({ ...game, calendar: setDayOps(game.calendar, day, p) })
  const editable = (d: number) => d > today || (d === today && !playing && game.phase === 'season')
  const selOps = sel !== null ? game.calendar.ops[sel] ?? {} : {}
  const selPrice = sel !== null ? priceForDay(game.ticketPriceUsd, game.calendar, game.year, sel) : 0
  const selDefault = sel !== null ? priceForDay(game.ticketPriceUsd, setDayOps(game.calendar, sel, { price: undefined }), game.year, sel) : 0
  const selFc = fc.find((f) => f.day === sel)
  void site

  return (
    <>
      <p className="hint">
        {game.phase === 'season' ? 'Plan the days ahead.' : 'Plan next season.'} Tap a day to change its price, run the night session, add an overtime crew or push snowmaking.
        Weekends and holidays get their own default prices.
      </p>
      <div className="cal-legend">
        <span><i className="wk" /> Weekday</span><span><i className="we" /> Weekend</span><span><i className="ho" /> Holiday</span><span>★ campaign</span><span>● planned</span>
      </div>
      {months.map((m) => (
        <section key={m.key} className="cal-month">
          <h3 className="group">{m.label}</h3>
          <div className="cal-grid">
            {WEEKDAYS.map((w) => <b key={w} className="cal-h">{w[0]}</b>)}
            {Array.from({ length: m.offset }, (_, i) => <span key={`o${i}`} />)}
            {m.days.map((d) => {
              const kind = dayKind(seasonDate(game.year, d))
              const price = priceForDay(game.ticketPriceUsd, game.calendar, game.year, d)
              const ops = game.calendar.ops[d]
              const past = d < today || (d === today && !editable(d))
              return (
                <button
                  key={d} disabled={!editable(d)}
                  className={`cal-day ${KIND_CLASS[kind]}${sel === d ? ' sel' : ''}${past ? ' past' : ''}${ops?.price !== undefined ? ' ovr' : ''}`}
                  onClick={() => setSel(d)}
                >
                  <small>{seasonDate(game.year, d).getUTCDate()}</small>
                  <b>${price}</b>
                  <span className="cal-flags">{promoDays.has(d) ? '★' : ''}{ops && (ops.night || ops.overtime || ops.snowPush) ? '●' : ''}</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}

      {sel !== null && (
        <div className="day-editor" role="dialog" aria-label="Plan this day">
          <div className="day-editor-head">
            <div><b>{dayName(game.year, sel)}</b><small className="block">{dayKind(seasonDate(game.year, sel))}</small></div>
            <button className="bcard-x" aria-label="Close" onClick={() => setSel(null)}>×</button>
          </div>
          {selFc && (
            <p className="hint small">
              Forecast: {selFc.beforeOpening ? 'not open yet' : selFc.outlook}, {selFc.snowHighIn > 0 ? `${selFc.snowLowIn}–${selFc.snowHighIn}″ snow` : 'no snow'}
              {selFc.warmChance >= 0.3 ? `, ${Math.round(selFc.warmChance * 100)}% warm` : ''}.
            </p>
          )}
          <Stepper
            label="Day ticket" hint={selOps.price === undefined ? 'Default for this kind of day' : `Default would be $${selDefault}`} value={selPrice}
            onSet={(v) => patch(sel, { price: clampPrice(v) })} onReset={selOps.price === undefined ? undefined : () => patch(sel, { price: undefined })}
          />
          {lights && (
            <label className="toggle-row"><input type="checkbox" checked={!!selOps.night} onChange={(e) => patch(sel, { night: e.target.checked })} />
              <span>Night session<small className="block">Needs the lights; costs power and crew</small></span></label>
          )}
          <label className="toggle-row"><input type="checkbox" checked={!!selOps.overtime} onChange={(e) => patch(sel, { overtime: e.target.checked })} />
            <span>Overtime crew<small className="block">+15% lift capacity for the day, +25% payroll</small></span></label>
          {hasSnow && (
            <label className="toggle-row"><input type="checkbox" checked={!!selOps.snowPush} onChange={(e) => patch(sel, { snowPush: e.target.checked })} />
              <span>Snowmaking push<small className="block">Adds made snow to the base overnight; not on warm days</small></span></label>
          )}
          <button className="btn" onClick={() => { setSel(null) }}>Done</button>
        </div>
      )}
    </>
  )
}

const signedMoney = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`

/** What a campaign did, from the comparison recorded on each day it ran. */
function PromoResultsCard({ game, promo, status }: { game: GameState; promo: Promo; status: 'running' | 'completed' }) {
  const r = promoResults(promo, game.season?.days ?? [])
  const spec = PROMOS[promo.kind]
  const played = r.perDay.length > 0 || r.daysPlayed > 0
  return (
    <div className="promo-results">
      {!played ? (
        <p className="hint">No results yet. They appear once the days it runs have been played.</p>
      ) : (
        <>
          <table className="rep-table">
            <tbody>
              <tr><th>Days played</th><td>{r.daysPlayed} of {r.daysTotal}</td></tr>
              <tr><th>Extra day skiers<small>vs the same days without it</small></th><td>{r.extraGuests >= 0 ? '+' : '−'}{Math.abs(r.extraGuests).toLocaleString('en-US')}</td></tr>
              <tr><th>Extra sales<small>tickets, food, rentals</small></th><td>{signedMoney(r.extraRevenueUsd)}</td></tr>
              <tr><th>Net before the campaign cost</th><td className={r.netBeforeCostUsd < 0 ? 'down' : 'up'}>{signedMoney(r.netBeforeCostUsd)}</td></tr>
              <tr><th>Campaign cost<small>paid on the first day</small></th><td>−${r.costUsd.toLocaleString('en-US')}</td></tr>
              <tr><th>Result{status === 'running' ? ' so far' : ''}</th><td className={r.netUsd < 0 ? 'down' : 'up'}>{signedMoney(r.netUsd)}</td></tr>
            </tbody>
          </table>
          <p className="rep-foot">
            {status === 'completed'
              ? (r.netUsd > 0 ? 'It paid for itself.' : 'It did not pay for itself.')
              : (r.netUsd > 0 ? 'Paying off so far.' : 'Not paid off yet.')}
            {spec.weekdaysOnly && r.perDay.some((d) => d.extraGuests === 0) ? ' Weekdays only: weekends in its window had no effect.' : ''}
            {r.daysWithoutResults > 0 ? ` ${r.daysWithoutResults} day${r.daysWithoutResults > 1 ? 's' : ''} had no comparison recorded.` : ''}
            {' '}This counts sales on the days it ran; it does not include reputation or later days.
          </p>
          {r.perDay.length > 1 && (
            <table className="rep-table">
              <thead><tr><th>Day</th><td>Extra skiers</td><td>Net</td></tr></thead>
              <tbody>
                {r.perDay.map((d) => (
                  <tr key={d.day}>
                    <th>{dayName(game.year, d.day)}</th>
                    <td>{d.extraGuests >= 0 ? '+' : '−'}{Math.abs(Math.round(d.extraGuests))}</td>
                    <td className={d.netBeforeCostUsd < 0 ? 'down' : 'up'}>{signedMoney(d.netBeforeCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

function MarketingTab({ game, onChange }: { game: GameState; onChange: (g: GameState) => void }) {
  const inSeason = game.phase === 'season'
  const today = inSeason ? game.season?.day ?? 0 : -99
  const [start, setStart] = useState<Record<string, number>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const firstDay = (k: PromoKind) => Math.max(0, today + PROMOS[k].leadDays)
  const options = (k: PromoKind) => Array.from({ length: 30 }, (_, i) => firstDay(k) + i).filter((d) => d < SEASON.lengthDays)
  const fc = game.season && inSeason ? forecast(game.season, game.difficulty.snow) : []
  const snowSoon = fc.find((f) => f.lead > 0 && (f.snowLowIn + f.snowHighIn) / 2 >= 6)
  const site = siteById(game.siteId)

  return (
    <>
      <p className="hint">Campaigns lift day-ticket demand for a few days. They never change what pass holders do. Costs grow with your resort and are paid on the first day. Each one comes out a little ahead at its best time and loses money otherwise.</p>
      {snowSoon && <p className="note">Storm forecast for {dayName(game.year, snowSoon.day)}: a powder alert on that day would catch the crowd.</p>}
      <h3 className="group">Booked</h3>
      {game.promos.length === 0 ? <p className="hint">Nothing booked.</p> : (
        <table className="rep-table promo-table">
          <tbody>
            {game.promos.map((p) => {
              const status = promoStatus(p, today)
              const dates = `${dayName(game.year, p.startDay)}${PROMOS[p.kind].lengthDays > 1 ? ` – ${dayName(game.year, promoEnd(p))}` : ''}`
              const open = openId === p.id
              return [
                <tr key={p.id} className={status === 'scheduled' ? undefined : 'tap'} onClick={status === 'scheduled' ? undefined : () => setOpenId(open ? null : p.id)}>
                  <th>{PROMOS[p.kind].name}<small>{dates} · {usd(costOf(p))}{status === 'scheduled' ? '' : ' · tap for results'}</small></th>
                  <td>
                    {status === 'scheduled' ? (
                      <span className="promo-act">
                        <span className="status">Scheduled</span>
                        <button className="btn" onClick={() => onChange({ ...game, promos: cancelPromo(game.promos, p.id, today) })}>Cancel</button>
                      </span>
                    ) : (
                      <span className={`status ${status}`} aria-expanded={open}>{status === 'running' ? 'Running' : 'Completed'} {open ? '▴' : '▾'}</span>
                    )}
                  </td>
                </tr>,
                open && status !== 'scheduled' ? (
                  <tr key={`${p.id}-r`}><td colSpan={2} className="promo-cell"><PromoResultsCard game={game} promo={p} status={status} /></td></tr>
                ) : null,
              ]
            })}
          </tbody>
        </table>
      )}
      <h3 className="group">Book a campaign</h3>
      {msg && <p className="warn">{msg}</p>}
      <table className="rep-table promo-table">
        <tbody>
          {PROMO_KINDS.map((k) => {
            const s = PROMOS[k]
            const day = start[k] ?? firstDay(k)
            const blocked = campaignBlocker(game, k)
            if (blocked && s.maxLifts !== undefined) return null
            const cost = site ? campaignCostUsd(game, site, k) : s.minCostUsd
            return (
              <tr key={k}>
                <th>
                  {s.name} <b>{usd(cost)}</b>
                  <small>{s.lengthDays}d · book {s.leadDays}d ahead{s.weekdaysOnly ? ' · weekdays only' : ''}{s.maxLifts !== undefined ? ` · small resorts (${s.maxLifts} lifts or fewer)` : ''}. {s.blurb} <i>Best: {s.bestTime}.</i>{s.luck ? ' Results vary: most runs pay a little, some lose, a few do well.' : ''}</small>
                </th>
                <td>
                  <span className="promo-act">
                    <select value={day} aria-label={`${s.name} start`} onChange={(e) => setStart({ ...start, [k]: Number(e.target.value) })}>
                      {options(k).map((d) => <option key={d} value={d}>{dayName(game.year, d)}</option>)}
                    </select>
                    <button className="btn primary" disabled={!site} onClick={() => {
                      if (!site) return
                      const r = bookCampaign(game, site, k, day)
                      if (r.ok) { setMsg(null); onChange({ ...game, promos: r.promos }) } else setMsg(r.reason)
                    }}>Book</button>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}
